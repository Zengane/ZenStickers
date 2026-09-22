/**
 * Zen Stickers - the panel.
 *
 * Tabs: GIFs, Stickers, Photos, Videos (many sources each), Icons (Iconify),
 * Emojis (nine designs). Click a result: it is saved to disk and imported (and
 * placed at the playhead unless Settings says "import only"). Right-click for
 * the other choices. No timer ever talks to the host app.
 *
 * Speed rules (from the first round, where switching tabs lagged):
 *  - every tab keeps its own view, with its results and scroll position, so
 *    switching tabs only hides and shows; nothing is fetched or rebuilt
 *  - nothing loads before it is needed: no trending on start, the emoji index
 *    and the icon set list load when their tab first opens
 *  - emoji thumbnails are saved as small PNGs on disk the first time they are
 *    drawn, so every later visit reads local files
 *  - big grids are built in slices across animation frames, and off-screen
 *    sections are skipped by the browser (content-visibility)
 */
(function () {
    'use strict';

    var fs    = require('fs');
    var path  = require('path');
    var cp    = require('child_process');
    var Store = window.ZSStore, Sources = window.ZSSources, Emoji = window.ZSEmoji, Media = window.ZSMedia, Iconify = window.ZSIconify;
    var cs    = new CSInterface();

    var S  = Store.loadSettings();
    var ST = Store.loadState();
    var AE = Store.AE;

    var $ = function (id) { return document.getElementById(id); };
    var list = $('list'), foot = $('foot'), status = $('status'), search = $('search');

    var TAB_COLORS = { gifs: '#4ea1ff', stickers: '#ff6fae', photos: '#b48cff', videos: '#f0b44c', icons: '#5fd08a', emojis: '#ffd24a' };
    var SUB_BIN = { gifs: 'GIFs', stickers: 'Stickers', photos: 'Images', videos: 'Videos', icons: 'Vectors', emojis: 'Emojis' };
    var PLACEHOLDER = { gifs: 'Search GIFs', stickers: 'Search stickers and emotes', photos: 'Search images', videos: 'Search videos',
                        icons: 'Search icons and SVGs', emojis: 'Search emojis' };
    var TONES = [
        { v: 0, c: '#ffcc3a', t: 'No skin tone' }, { v: 1, c: '#f7dece', t: 'Light' }, { v: 2, c: '#f3d2a2', t: 'Medium-light' },
        { v: 3, c: '#d5ab88', t: 'Medium' }, { v: 4, c: '#af7e57', t: 'Medium-dark' }, { v: 5, c: '#7c533e', t: 'Dark' }
    ];

    var LOGOS = {};
    try { LOGOS = JSON.parse(fs.readFileSync(path.join(Emoji.ROOT, 'data', 'logos.json'), 'utf8')); } catch (e) {}

    /* ---------------- status ---------------- */

    var statusTimer = 0;
    function say(msg, kind) {
        status.className = 'status' + (kind ? ' ' + kind : '');
        status.textContent = msg;
        status.title = msg;
        clearTimeout(statusTimer);
        if (kind === 'ok') statusTimer = setTimeout(function () { status.className = 'status'; status.textContent = 'Ready'; }, 6000);
    }

    /* ---------------- host calls (always time-limited) ---------------- */

    /*
     * Every call to the app goes through one queue: the app has ONE script engine
     * shared by all panels, so a second call only waits behind the first, and
     * stacking them made every later call time out too.
     *
     * A slow answer is not an error. After a few seconds the status says the app
     * is busy (with a timer); only after `ms` does it give up. Each call's time
     * is written to log.txt in the settings folder, so a slow moment can be read
     * back later.
     */
    var APP = AE ? 'After Effects' : 'Premiere';
    var hostChain = Promise.resolve();
    var LOG = path.join(Store.DIR, 'log.txt');
    function logLine(text) {
        try {
            var st = fs.existsSync(LOG) ? fs.statSync(LOG) : null;
            if (st && st.size > 256 * 1024) fs.renameSync(LOG, LOG.replace(/\.txt$/, '.old.txt'));
            fs.appendFileSync(LOG, new Date().toISOString().replace('T', ' ').slice(0, 19) + '  ' + text + '\n');
        } catch (e) {}
    }
    function host(expr, ms) {
        var label = String(expr).replace(/\((.|\n)*$/, '').slice(0, 40);
        var run = function () {
            return new Promise(function (resolve, reject) {
                var done = false, t0 = Date.now();
                var busyTimer = setInterval(function () {
                    if (!done && Date.now() - t0 > 4000) say(APP + ' is busy\u2026 ' + Math.round((Date.now() - t0) / 1000) + ' s', 'busy');
                }, 1000);
                var t = setTimeout(function () {
                    if (done) return;
                    done = true; clearInterval(busyTimer);
                    logLine('TIMEOUT ' + label + ' after ' + (ms || 60000) + ' ms');
                    reject(new Error(APP + ' did not answer for ' + Math.round((ms || 60000) / 1000) + ' s. Is a dialog box open in ' + APP + '?'));
                }, ms || 60000);
                cs.evalScript(expr, function (r) {
                    var took = Date.now() - t0;
                    if (took > 1500 || done) logLine((done ? 'LATE ' : 'slow ') + label + ' ' + took + ' ms');
                    if (done) return;
                    done = true; clearTimeout(t); clearInterval(busyTimer);
                    if (r === 'EvalScript error.' || r === undefined) return reject(new Error('The host script failed to run.'));
                    var o = null;
                    try { o = JSON.parse(r); } catch (e) { return resolve(r); }
                    if (o && o.ok === false) return reject(new Error(o.error || 'Failed.'));
                    if (o && o.ms) logLine('  ' + label + ' steps: ' + o.ms);
                    resolve(o);
                });
            });
        };
        var p = hostChain.then(run, run);
        hostChain = p.catch(function () {});
        return p;
    }
    function jsStr(s) { return JSON.stringify(String(s)); }

    /* The host script the app holds must match this panel's version: after an
       update the app still has the old one until it restarts, so load it again. */
    var HOST_BUILD = (function () {
        try {
            var v = fs.readFileSync(path.join(Emoji.ROOT, 'CSXS', 'manifest.xml'), 'utf8').match(/ExtensionBundleVersion="([^"]+)"/)[1];
            return 'zs-' + (AE ? 'aeft' : 'ppro') + ' ' + v;
        } catch (e) { return ''; }
    })();
    function ensureHost() {
        return host('typeof ZenStickers === "undefined" ? "missing" : ZenStickers.ping()', 90000).then(function (r) {
            if (r !== 'missing' && (!HOST_BUILD || r === HOST_BUILD)) return r;
            var file = path.join(Emoji.ROOT, 'host', AE ? 'host-aeft.jsx' : 'host-ppro.jsx').replace(/\\/g, '/');
            return host('$.evalFile(new File(' + jsStr(file) + ')); ZenStickers.ping()', 90000);
        });
    }
    function projectInfo() { return host('ZenStickers.info()', 90000).catch(function () { return {}; }); }

    function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function hexA(hex, a) {
        var n = parseInt(hex.slice(1), 16);
        return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
    }

    /* ---------------- source logos ---------------- */

    function badge(src, size) {
        var b = document.createElement('span');
        b.className = 'badge';
        b.style.background = src.color || '#444';
        b.style.color = src.ink || '#fff';
        if (size) { b.style.width = b.style.height = size + 'px'; }
        var lg = LOGOS[src.logo];
        if (lg) {
            b.innerHTML = '<svg viewBox="0 0 ' + lg.w + ' ' + lg.h + '" width="58%" height="58%"><g fill="currentColor">' + lg.body.replace(/fill="[^"]*"/g, '') + '</g></svg>';
        } else {
            b.textContent = src.logo || src.name.charAt(0);
        }
        return b;
    }

    /* ---------------- views: one per tab + source + query, kept alive ---------------- */

    var views = {};          // key -> view
    var order = [];          // LRU of keys
    var current = null;
    var MAX_VIEWS = 10;

    function viewKey(tab, q) {
        if (tab === 'emojis') return ['emojis', ST.vendor, ST.tone, animatedOn ? 1 : 0, q].join('|');
        if (tab === 'icons' && ST.source.icons === 'iconify') return ['icons', 'iconify', ST.iconSet || '*popular', ST.iconColor, q].join('|');
        var src = currentSource(tab);
        var f = (src.filters || []).map(function (k) { return ST.filters[k] || ''; }).join(',');
        return [tab, ST.source[tab], q, S.rating, f].join('|');
    }

    function makeView(key) {
        var el = document.createElement('div');
        el.className = 'view';
        list.appendChild(el);
        var v = { key: key, el: el, foot: '', attribution: '', tab: ST.tab };
        el.addEventListener('scroll', function () { if (v.onScroll) v.onScroll(); });
        views[key] = v;
        return v;
    }

    function dropView(key) {
        var v = views[key];
        if (!v) return;
        if (v.obs) v.obs.disconnect();
        v.dead = true;
        if (v.el.parentNode) v.el.parentNode.removeChild(v.el);
        delete views[key];
    }

    function show(v) {
        if (current && current !== v) current.el.classList.add('off');
        v.el.classList.remove('off');
        current = v;
        order = order.filter(function (k) { return k !== v.key; });
        order.push(v.key);
        while (order.length > MAX_VIEWS) dropView(order.shift());
        renderFoot();
    }

    function renderFoot() {
        foot.innerHTML = '';
        var l = document.createElement('span'); l.className = 'l'; l.textContent = current ? current.foot : '';
        var r = document.createElement('span'); r.className = 'r'; r.textContent = current ? current.attribution : '';
        foot.appendChild(l); foot.appendChild(r);
    }
    function setFoot(v, left, attribution) {
        if (left !== undefined) v.foot = left;
        if (attribution !== undefined) v.attribution = attribution;
        if (v === current) renderFoot();
    }

    function note(v, html) {
        clearNote(v);
        if (!html) return;
        var d = document.createElement('div');
        d.className = 'empty-note';
        d.innerHTML = html;
        v.note = d;
        v.el.insertBefore(d, v.el.firstChild);
    }
    function clearNote(v) { if (v.note && v.note.parentNode) v.note.parentNode.removeChild(v.note); v.note = null; }

    /* ---------------- tabs and bars ---------------- */

    var queries = {};

    function setTab(tab) {
        ST.tab = tab;
        var btns = document.querySelectorAll('.tab');
        for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-tab') === tab);
        document.documentElement.style.setProperty('--tab-color', TAB_COLORS[tab]);
        document.documentElement.style.setProperty('--soft', hexA(TAB_COLORS[tab], .14));
        var multi = !!Sources.tabs[tab];
        $('bar-source').classList.toggle('hidden', !multi);
        $('bar-icons').classList.toggle('hidden', !(tab === 'icons' && currentSource('icons').id === 'iconify'));
        drawFilters();
        applyZoom();
        $('bar-emojis').classList.toggle('hidden', tab !== 'emojis');
        if (multi) drawSourceButton();
        if (tab === 'icons' && !iconSetsFilled) fillIconSets();
        if (tab === 'emojis' && !vendorsFilled) { fillVendors(); fillTones(); updateAnimatedChip(); }
        search.placeholder = PLACEHOLDER[tab];
        search.value = queries[tab] || '';
        $('search-clear').classList.toggle('hidden', !search.value);
        Store.saveState(ST);
        run();
    }

    function run(force) {
        var tab = ST.tab;
        var q = (queries[tab] || '').trim();
        var key = viewKey(tab, q);
        if (force) dropView(key);
        var v = views[key];
        if (v) { show(v); return; }
        v = makeView(key);
        show(v);
        if (tab === 'emojis') return buildEmojis(v, q);
        return startPaged(v, tab, q);
    }

    function currentSource(tab) {
        var arr = Sources.tabs[tab];
        for (var i = 0; i < arr.length; i++) if (arr[i].id === ST.source[tab]) return arr[i];
        return arr[0];
    }

    /* ---------------- source picker (a button that opens a list, like Wander) ---------------- */

    function drawSourceButton() {
        var tab = ST.tab, src = currentSource(tab);
        var btn = $('source-btn');
        btn.innerHTML = '';
        btn.appendChild(badge(src));
        var t = document.createElement('span'); t.className = 'sname'; t.textContent = src.name;
        btn.appendChild(t);
        if (src.key && !S[src.key]) { var k = document.createElement('span'); k.className = 'needkey'; k.textContent = 'needs key'; btn.appendChild(k); }
        var c = document.createElement('span'); c.className = 'caret'; c.innerHTML = '<svg viewBox="0 0 8 8" width="8" height="8"><path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
        btn.appendChild(c);
        $('source-hint').textContent = src.trending === false ? 'search only' : '';
    }

    $('source-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        var menu = $('source-menu');
        if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
        menu.innerHTML = '';
        Sources.tabs[ST.tab].forEach(function (src) {
            var b = document.createElement('button');
            b.className = 'srow' + (src.id === currentSource(ST.tab).id ? ' on' : '');
            b.appendChild(badge(src, 26));
            var t = document.createElement('span'); t.className = 'sname'; t.textContent = src.name;
            b.appendChild(t);
            if (src.key && !S[src.key]) { var k = document.createElement('span'); k.className = 'needkey'; k.textContent = 'needs key'; b.appendChild(k); }
            b.addEventListener('click', function () {
                ST.source[ST.tab] = src.id;
                Store.saveState(ST);
                menu.classList.add('hidden');
                drawSourceButton();
                $('bar-icons').classList.toggle('hidden', !(ST.tab === 'icons' && src.id === 'iconify'));
                drawFilters();
                run();
            });
            menu.appendChild(b);
        });
        menu.classList.remove('hidden');
    });
    document.addEventListener('mousedown', function (e) {
        var m = $('source-menu');
        if (!m.contains(e.target) && e.target !== $('source-btn') && !$('source-btn').contains(e.target)) m.classList.add('hidden');
    });

    /* ---------------- paged sources (GIFs, stickers, photos, videos, icons) ---------------- */

    function startPaged(v, tab, q) {
        var src = currentSource(tab);
        v.src = src; v.tab = tab; v.q = q; v.page = 0; v.more = true; v.busy = false; v.count = 0;
        setFoot(v, '', src.attribution);
        if (src.id === 'iconify' || EMOTES[src.id]) {
            v.grid = document.createElement('div'); v.grid.className = 'grid ' + (src.id === 'iconify' ? 'icons' : 'emotes');
            v.el.appendChild(v.grid);
            v.obs = lazyObserver(v);
        } else {
            makeMasonry(v, tab === 'stickers');
        }
        v.onScroll = function () { checkScroll(v); };
        if (src.web) { webGuide(v, src, q); return; }
        /* Empty search: show nothing until asked (no network, no previews). */
        if (!q && src.id !== 'iconify' && (!S.trending || src.trending === false)) {
            v.more = false;
            var hint = 'Type to search <b>' + escapeHtml(src.name) + '</b>.';
            if (src.hint) hint = escapeHtml(src.hint);
            if (src.trending !== false) hint += ' <button class="linkbtn" data-act="trend">Show trending</button>';
            note(v, hint);
            var b = v.note.querySelector('[data-act="trend"]');
            if (b) b.addEventListener('click', function () { clearNote(v); v.more = true; nextPage(v); });
            return;
        }
        nextPage(v);
    }

    /* Google Images opens in the web browser, filters already set. The picture
       comes back by dragging it here or pasting it. */
    function webGuide(v, src, q) {
        v.more = false;
        setFoot(v, '', src.attribution);
        var d = document.createElement('div');
        d.className = 'webguide';
        d.innerHTML =
            '<button class="bigbtn" data-act="open"></button>' +
            '<ol><li>Google Images opens in your web browser, with the filters above.</li>' +
            '<li><b>Click a picture</b> there so the big version shows. (The small ones in the grid are JPEG copies: no transparency.)</li>' +
            '<li><b>Drag it into this panel</b>. Or right-click it, choose <b>Copy image</b>, and press <b>Paste</b> here (or Ctrl+V).</li></ol>' +
            '<button class="btn-mini" data-act="paste">Paste</button>' +
            '<p class="small">This works with pictures from any website, on every tab.</p>';
        v.el.appendChild(d);
        var open = d.querySelector('[data-act="open"]');
        open.textContent = q ? 'Search Google for \u201c' + q + '\u201d' : 'Open Google Images';
        open.addEventListener('click', function () { openWeb(src, q); });
        d.querySelector('[data-act="paste"]').addEventListener('click', pasteFromClipboard);
    }
    function openWeb(src, q) {
        var url = src.url(q || '', ST.filters, S);
        try { cs.openURLInDefaultBrowser(url); say('Google Images is open in your browser. Drag a picture back here.', 'ok'); }
        catch (e) { say('Could not open the browser: ' + e.message, 'err'); }
    }

    function nextPage(v) {
        if (v.dead || v.busy || !v.more) return;
        v.busy = true;
        if (v.page === 0) note(v, 'Loading…');
        v.src.page(v.q, v.page, S, { set: ST.iconSet || '*popular', color: ST.iconColor, filters: ST.filters }).then(function (res) {
            if (v.dead) return;
            v.busy = false;
            clearNote(v);
            if (res.needQuery) {
                v.more = false;
                note(v, v.src.id === 'iconify' ? 'Type to search <b>' + (ST.iconSet === '*all' ? 'every icon set' : 'the popular icon sets') + '</b>, or pick one set above to browse it.'
                                          : 'Type to search <b>' + escapeHtml(v.src.name) + '</b>.');
                return;
            }
            v.page++;
            v.more = !!res.more;
            v.count += res.items.length;
            if (!res.items.length && v.page === 1) { note(v, 'Nothing found' + (v.q ? ' for <b>' + escapeHtml(v.q) + '</b>' : '') + '.'); return; }
            if (v.src.id === 'iconify') addIcons(v, res.items);
            else if (v.grid) addEmotes(v, res.items);
            else addToMasonry(v, res.items);
            setFoot(v, v.count + (res.total ? ' of ' + res.total : '') + (v.q ? ' for "' + v.q + '"' : ' trending'));
            setTimeout(function () { checkScroll(v); }, 50);
        }, function (err) {
            if (v.dead) return;
            v.busy = false;
            v.more = false;
            note(v, '<span class="err">' + escapeHtml(err.message) + '</span>' +
                (err.noKey ? ' <button class="linkbtn" data-act="keys">Open Settings</button>' : ''));
            var b = v.note && v.note.querySelector('[data-act="keys"]');
            if (b) b.addEventListener('click', openSettings);
        });
    }

    function checkScroll(v) {
        if (v.dead || v.busy || !v.more || v !== current) return;
        if (v.el.scrollTop + v.el.clientHeight > v.el.scrollHeight - 700) nextPage(v);
    }

    /* ---------------- masonry ---------------- */

    function zoomOf(tab) { return Number(ST.zoom[tab || ST.tab]) || 1; }
    function colCount() { return Math.max(1, Math.min(8, Math.floor((list.clientWidth || 300) / (130 * zoomOf())))); }

    function makeMasonry(v, sticker) {
        if (v.mason && v.mason.el.parentNode) v.mason.el.parentNode.removeChild(v.mason.el);
        var wrap = document.createElement('div');
        wrap.className = 'masonry';
        var n = colCount();
        v.mason = { el: wrap, cols: [], h: [], sticker: sticker, items: v.mason ? v.mason.items : [] };
        for (var i = 0; i < n; i++) {
            var c = document.createElement('div'); c.className = 'mcol';
            wrap.appendChild(c); v.mason.cols.push(c); v.mason.h.push(0);
        }
        v.el.appendChild(wrap);
    }

    function addToMasonry(v, items, replay) {
        var m = v.mason;
        items.forEach(function (it) {
            var i = 0;
            for (var k = 1; k < m.h.length; k++) if (m.h[k] < m.h[i]) i = k;
            var ratio = it.h / it.w;
            if (!(ratio > 0.2 && ratio < 5)) ratio = 1;
            var cell = document.createElement('div');
            cell.className = 'cell' + (m.sticker || it.kind === 'vector' ? ' sticker' : '') + (it.kind === 'video' ? ' video' : '');
            cell.style.paddingTop = (ratio * 100) + '%';
            var img = document.createElement('img');
            img.loading = 'lazy';
            img.decoding = 'async';
            img.src = S.animate === 'hover' ? (it.still || it.thumb) : it.thumb;
            img.draggable = false;
            /* A preview that fails: try the source's other preview, then say so. */
            img.onerror = function () {
                if (it.alt && img.src !== it.alt) { img.src = it.alt; return; }
                img.onerror = null;
                cell.classList.add('broken');
            };
            cell.appendChild(img);
            if (it.kind === 'video' && it.duration) {
                var d = document.createElement('span'); d.className = 'dur';
                d.textContent = Math.floor(it.duration / 60) + ':' + ('0' + Math.round(it.duration % 60)).slice(-2);
                cell.appendChild(d);
            }
            cell.title = it.title;
            cell._item = it;
            if (S.animate === 'hover' && it.still && it.still !== it.thumb) {
                cell.addEventListener('mouseenter', function () { img.src = it.thumb; });
                cell.addEventListener('mouseleave', function () { img.src = it.still; });
            }
            m.cols[i].appendChild(cell);
            m.h[i] += ratio;
            if (!replay) m.items.push(it);
        });
    }

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            Object.keys(views).forEach(function (k) {
                var v = views[k];
                if (!v.mason || v.mason.cols.length === colCount()) return;
                var items = v.mason.items;
                makeMasonry(v, v.mason.sticker);
                addToMasonry(v, items, true);
            });
        }, 150);
    });

    /* ---------------- lazy thumbnails ---------------- */

    function lazyObserver(v) {
        return new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting) return;
                var img = en.target;
                v.obs.unobserve(img);
                if (img._load) { var f = img._load; img._load = null; f(); }
            });
        }, { root: v.el, rootMargin: '500px 0px' });
    }

    /* ---------------- emotes: small, square, many ---------------- */

    var EMOTES = { twitch: 1, '7tv': 1, ffz: 1, emojigg: 1 };
    function addEmotes(v, items) {
        var frag = document.createDocumentFragment();
        items.forEach(function (it) {
            var sq = document.createElement('div');
            sq.className = 'sq';
            sq.title = it.title + (it.animated ? ' (moving)' : '');
            var img = document.createElement('img');
            img.decoding = 'async';
            sq.appendChild(img);
            sq._item = it;
            img._load = function () { img.src = it.thumb; };
            v.obs.observe(img);
            if (it.animated) { var a = document.createElement('span'); a.className = 'an'; a.textContent = 'GIF'; sq.appendChild(a); }
            frag.appendChild(sq);
        });
        v.grid.appendChild(frag);
    }

    /* ---------------- icons ---------------- */

    var iconSetsFilled = false;
    function addIcons(v, items) {
        var frag = document.createDocumentFragment();
        items.forEach(function (it) {
            var sq = document.createElement('div');
            sq.className = 'sq';
            sq.title = it.name;
            var img = document.createElement('img');
            sq.appendChild(img);
            sq._item = it;
            var parts = it.name.split(':'), color = ST.iconColor;
            img._load = function () {
                Iconify.want(parts[0], parts[1], function (ic) {
                    if (ic) img.src = Iconify.dataUrl(ic, color); else sq.classList.add('missing');
                });
            };
            v.obs.observe(img);
            frag.appendChild(sq);
        });
        v.grid.appendChild(frag);
    }

    function fillIconSets() {
        iconSetsFilled = true;
        var sel = $('icon-set');
        sel.innerHTML = '';
        function opt(parent, v, t) { var o = document.createElement('option'); o.value = v; o.textContent = t; parent.appendChild(o); return o; }
        opt(sel, '*popular', 'Popular sets');
        opt(sel, '*all', 'All sets');
        if (ST.iconSet && ST.iconSet[0] !== '*') opt(sel, ST.iconSet, ST.iconSet);
        sel.value = ST.iconSet || '*popular';
        Sources.icons.collections().then(function (c) {
            var keep = sel.value;
            sel.innerHTML = '';
            opt(sel, '*popular', 'Popular sets');
            opt(sel, '*all', 'All sets');
            var pop = document.createElement('optgroup'); pop.label = 'Popular';
            Sources.icons.POPULAR.forEach(function (p) { if (c[p]) opt(pop, p, c[p].name + '  (' + c[p].total + ')'); });
            sel.appendChild(pop);
            var cats = {};
            Object.keys(c).forEach(function (p) {
                if (c[p].hidden) return;
                (cats[c[p].category || 'Other'] = cats[c[p].category || 'Other'] || []).push(p);
            });
            Object.keys(cats).sort().forEach(function (cat) {
                var g = document.createElement('optgroup'); g.label = cat;
                cats[cat].sort(function (a, b) { return c[a].name.localeCompare(c[b].name); })
                    .forEach(function (p) { opt(g, p, c[p].name + '  (' + c[p].total + ')'); });
                sel.appendChild(g);
            });
            sel.value = keep;
        }, function () {});
    }

    $('icon-set').addEventListener('change', function () { ST.iconSet = this.value; Store.saveState(ST); run(); });

    /* ---------------- filter bar (Google's Tools row) ---------------- */

    var FILTERS = {
        size:   { label: 'Size',   opts: [['', 'Any size'], ['large', 'Large'], ['medium', 'Medium'], ['icon', 'Icon']] },
        color:  { label: 'Colour', opts: [['', 'Any colour'], ['transparent', 'Transparent'], ['bw', 'Black and white'], ['red', 'Red'], ['orange', 'Orange'],
                  ['yellow', 'Yellow'], ['green', 'Green'], ['teal', 'Teal'], ['blue', 'Blue'], ['purple', 'Purple'], ['pink', 'Pink'], ['white', 'White'],
                  ['gray', 'Grey'], ['black', 'Black'], ['brown', 'Brown']] },
        type:   { label: 'Type',   opts: [['', 'Any type'], ['photo', 'Photo'], ['clipart', 'Clip art'], ['lineart', 'Line drawing'], ['vector', 'Vector'], ['animated', 'Moving'], ['face', 'Face']] },
        rights: { label: 'Rights', opts: [['', 'Any rights'], ['reuse', 'Free to reuse'], ['commercial', 'Commercial use OK']] },
        orient: { label: 'Shape',  opts: [['', 'Any shape'], ['landscape', 'Wide'], ['portrait', 'Tall'], ['square', 'Square']] }
    };

    function drawFilters() {
        var bar = $('bar-filters');
        var src = Sources.tabs[ST.tab] ? currentSource(ST.tab) : null;
        var can = (src && src.filters) || [];
        bar.classList.toggle('hidden', !can.length);
        if (!can.length) return;
        bar.innerHTML = '';
        Object.keys(FILTERS).forEach(function (k) {
            var F = FILTERS[k];
            var sel = document.createElement('select');
            sel.className = 'fsel' + (ST.filters[k] ? ' set' : '');
            sel.title = can.indexOf(k) < 0 ? F.label + ': ' + src.name + ' cannot filter this' : F.label;
            sel.disabled = can.indexOf(k) < 0;
            F.opts.forEach(function (o) {
                var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op);
            });
            sel.value = ST.filters[k] || '';
            sel.addEventListener('change', function () {
                if (this.value) ST.filters[k] = this.value; else delete ST.filters[k];
                Store.saveState(ST);
                drawFilters();
                run();
            });
            bar.appendChild(sel);
        });
        var any = Object.keys(ST.filters).some(function (k) { return ST.filters[k]; });
        if (any) {
            var clr = document.createElement('button'); clr.className = 'fclear'; clr.textContent = 'Clear';
            clr.addEventListener('click', function () { ST.filters = {}; Store.saveState(ST); drawFilters(); run(); });
            bar.appendChild(clr);
        }
    }

    /* ---------------- zoom (the result size) ---------------- */

    function applyZoom() {
        list.style.setProperty('--z', String(zoomOf()));
        $('zoom-val').textContent = Math.round(zoomOf() * 100) + '%';
    }
    function zoomBy(step) {
        var z = Math.round(Math.min(2.4, Math.max(0.6, zoomOf() + step)) * 10) / 10;
        ST.zoom[ST.tab] = z;
        Store.saveState(ST);
        applyZoom();
        Object.keys(views).forEach(function (k) {
            var v = views[k];
            if (v.tab !== ST.tab || !v.mason || v.mason.cols.length === colCount()) return;
            var items = v.mason.items;
            makeMasonry(v, v.mason.sticker);
            addToMasonry(v, items, true);
        });
        if (current) checkScroll(current);
    }
    $('zoom-out').addEventListener('click', function () { zoomBy(-0.2); });
    $('zoom-in').addEventListener('click', function () { zoomBy(0.2); });
    $('zoom-val').addEventListener('click', function () { ST.zoom[ST.tab] = 1; zoomBy(0); });
    list.addEventListener('wheel', function (e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 0.2 : -0.2);
    }, { passive: false });

    /* ---------------- preview (a closer look without importing) ---------------- */

    function preview(cell) {
        var box = $('preview'), stage = $('preview-stage');
        stage.innerHTML = '';
        var it = cell._item, r = cell._emoji, el;
        if (it && it.kind === 'video' && it.files.video) {
            el = document.createElement('video'); el.src = it.files.video; el.autoplay = true; el.loop = true; el.muted = true; el.controls = true;
        } else {
            el = document.createElement('img');
            var img = cell.querySelector('img');
            el.src = (img && img.src) || '';
            var big = it ? (it.kind === 'photo' ? it.files.image : (it.files.gif && it.kind !== 'icon' ? it.files.gif : '')) : '';
            if (big) { var hi = new Image(); hi.onload = function () { el.src = big; }; hi.src = big; }
        }
        stage.appendChild(el);
        $('preview-title').textContent = it ? it.title : r.n;
        box.classList.remove('hidden');
        box._cell = cell;
    }
    $('preview').addEventListener('click', function (e) {
        if (e.target.closest('[data-act="pv-import"]')) { var c = this._cell; this.classList.add('hidden'); if (c) pick(c, S.click === 'place'); return; }
        this.classList.add('hidden');
        $('preview-stage').innerHTML = '';
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !$('preview').classList.contains('hidden')) { $('preview').classList.add('hidden'); $('preview-stage').innerHTML = ''; }
    });
    $('icon-color').addEventListener('change', function () {
        ST.iconColor = this.value;
        document.documentElement.style.setProperty('--icon-color', this.value);
        Store.saveState(ST);
        if (ST.tab === 'icons') run();
    });

    /* ---------------- emojis ---------------- */

    var vendorsFilled = false;
    function fillVendors() {
        vendorsFilled = true;
        var box = $('vendors');
        box.innerHTML = '';
        var idx = Emoji.load();
        var grin = idx.all['1f600'];
        Emoji.VENDORS.forEach(function (v) {
            var b = document.createElement('button');
            b.className = 'vchip' + (ST.vendor === v.id ? ' on' : '');
            b.setAttribute('data-v', v.id);
            var img = document.createElement('img');
            Thumbs.load(v, grin, img);
            b.appendChild(img);
            b.appendChild(document.createTextNode(v.name));
            b.title = v.kind === 'vector' ? v.name + ': SVG, sharp at any size' + (AE ? ' (imports as SVG)' : ' (drawn to PNG at ' + S.emojiSize + ' px)')
                                          : v.name + ': ' + v.src + ' px source' + (S.upscale && v.src < S.emojiSize ? ', AI upscaled to ' + S.emojiSize + ' px' : '');
            box.appendChild(b);
        });
        var on = box.querySelector('.on');
        if (on) setTimeout(function () { on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, 0);
    }

    $('vendors').addEventListener('click', function (e) {
        var b = e.target.closest('.vchip');
        if (!b) return;
        ST.vendor = b.getAttribute('data-v');
        Store.saveState(ST);
        var chips = document.querySelectorAll('.vchip');
        for (var i = 0; i < chips.length; i++) chips[i].classList.toggle('on', chips[i] === b);
        updateAnimatedChip();
        run();
    });

    function fillTones() {
        var box = $('tones');
        box.innerHTML = '';
        TONES.forEach(function (t) {
            var b = document.createElement('button');
            b.className = 'tone' + (Number(ST.tone) === t.v ? ' on' : '');
            b.title = t.t;
            b.setAttribute('data-v', t.v);
            var i = document.createElement('i'); i.style.background = t.c;
            b.appendChild(i);
            box.appendChild(b);
        });
    }
    $('tones').addEventListener('click', function (e) {
        var b = e.target.closest('.tone');
        if (!b) return;
        ST.tone = Number(b.getAttribute('data-v'));
        Store.saveState(ST);
        fillTones();
        run();
    });

    var animatedOn = false;
    function updateAnimatedChip() {
        $('animated').classList.toggle('hidden', ST.vendor !== 'noto');
        $('animated').classList.toggle('on', animatedOn);
    }
    $('animated').addEventListener('click', function () { animatedOn = !animatedOn; updateAnimatedChip(); if (ST.tab === 'emojis') run(); });

    /*
     * Emoji thumbnails, cached as 64 px PNGs in cache\thumbs\<design>\<key>.png.
     * Apple ships its own 64 px set. First sight of any other emoji: vector
     * designs are drawn from the Iconify body, Emojipedia designs fetched, and
     * the result written to disk. At most 6 fetches run at once.
     */
    var Thumbs = (function () {
        var have = {};           // vendor -> Set of keys on disk
        function dir(v) { return Store.cacheDir(path.join('thumbs', v.id)); }
        function known(v) {
            if (!have[v.id]) {
                var s = {};
                try { fs.readdirSync(dir(v)).forEach(function (f) { s[f.replace(/\.png$/, '')] = 1; }); } catch (e) {}
                have[v.id] = s;
            }
            return have[v.id];
        }
        var queue = [], running = 0;
        function pump() {
            while (running < 6 && queue.length) {
                var job = queue.shift();
                if (job.img._gone) continue;
                running++;
                job.run().then(function () { running--; pump(); }, function () { running--; pump(); });
            }
        }
        function save(v, k, buf) {
            try { fs.writeFileSync(path.join(dir(v), k + '.png'), buf); known(v)[k] = 1; } catch (e) {}
        }
        function rasterSvg(svg) {
            return Media.svgToPng(svg, 64);
        }
        function load(v, r, img, onMissing) {
            if (v.id === 'apple' && r.a && Emoji.appleReady()) { img.src = Emoji.fileUrl(path.join(Emoji.APPLE_DIR, r.k + '.png')); return; }
            if (known(v)[r.k]) { img.src = Emoji.fileUrl(path.join(dir(v), r.k + '.png')); return; }
            queue.push({ img: img, run: function () {
                var ref = Emoji.iconRef(v.id, r);
                var got;
                if (ref) {
                    got = Iconify.get(ref.prefix, ref.name).then(function (ic) {
                        return ic ? rasterSvg(Iconify.svgText(ic, null, 64)) : null;
                    });
                } else {
                    var urls = Emoji.thumbs(v.id, r);
                    got = (function tryNext(i) {
                        if (i >= urls.length) return Promise.resolve(null);
                        return window.ZSNet.buffer(urls[i], 15000).then(function (b) {
                            if (!b || !b.body || b.body.length < 60) return tryNext(i + 1);
                            Emoji.markFound(v.id, r, urls[i]);
                            if (/svg/.test(b.type) || /\.svg$/.test(urls[i])) return rasterSvg(b.body.toString('utf8'));
                            return Media.resizeTo(b.body, 64);
                        }, function () { return tryNext(i + 1); });
                    })(0);
                }
                return got.then(function (png) {
                    if (!png) { Emoji.markMissing(v.id, r); if (onMissing) onMissing(); return; }
                    save(v, r.k, png);
                    img.src = 'data:image/png;base64,' + png.toString('base64');
                });
            } });
            pump();
        }
        return { load: load };
    })();

    /* Build the grid for one design in slices, so the panel never freezes. */
    function buildEmojis(v, q) {
        var idx = Emoji.load();
        var vend = Emoji.vendor(ST.vendor);
        var tone = Number(ST.tone) || 0;
        setFoot(v, '', vend.kind === 'bitmap' ? vend.name + ' via Emojipedia' : vend.name + (vend.id === 'noto' ? ' (Noto)' : '') + ' via Iconify');
        v.obs = lazyObserver(v);
        var pick = function (r) { return Emoji.withTone(r, tone); };
        var usable = function (r) { return Emoji.has(vend, r) && (!animatedOn || vend.id !== 'noto' || r.m); };
        var sections = [];

        if (q) {
            var words = q.toLowerCase().split(/\s+/).filter(Boolean), w0 = words.join(' ');
            var hits = idx.rows.filter(function (r) {
                for (var i = 0; i < words.length; i++) if (r.search.indexOf(words[i]) < 0) return false;
                return true;
            });
            var rank = function (r) { if (r.n === w0) return -1; var p = r.n.indexOf(w0); return p === 0 ? 0 : (p > 0 ? 1 : 2); };
            hits.sort(function (a, b) { return rank(a) - rank(b); });
            sections.push({ t: 'Results', rows: hits.map(pick).filter(usable) });
        } else {
            sections.push({ t: 'Recent', rows: (ST.recentEmoji || []).map(function (k) { return idx.all[k]; }).filter(Boolean).map(pick).filter(usable) });
            idx.groups.forEach(function (g, gi) {
                sections.push({ t: g, rows: idx.rows.filter(function (r) { return r.g === gi; }).map(pick).filter(usable) });
            });
        }
        sections = sections.filter(function (s) { return s.rows.length; });
        var shown = sections.reduce(function (n, s) { return n + s.rows.length; }, 0);
        setFoot(v, shown + ' emojis' + (q ? ' for "' + q + '"' : '') + (tone ? ', ' + TONES[tone].t.toLowerCase() + ' skin' : ''));
        if (!shown) { note(v, q ? 'No emoji matches <b>' + escapeHtml(q) + '</b>.' : 'No emojis.'); return; }

        if (vend.id === 'apple' && !Emoji.appleReady()) appleBanner(v);

        /* Headers and empty sized grids first (so the scrollbar is right), cells in slices. */
        var cellsPerRow = Math.max(1, Math.floor(((list.clientWidth || 300) - 8) / 44));
        var jobs = [];
        sections.forEach(function (s) {
            var h = document.createElement('div'); h.className = 'grp';
            h.innerHTML = '<span class="g"></span><span class="n"></span>';
            h.firstChild.textContent = s.t; h.lastChild.textContent = s.rows.length;
            var g = document.createElement('div'); g.className = 'grid emoji';
            g.style.containIntrinsicSize = 'auto ' + (Math.ceil(s.rows.length / cellsPerRow) * 44 + 8) + 'px';
            v.el.appendChild(h); v.el.appendChild(g);
            for (var i = 0; i < s.rows.length; i += 240) jobs.push({ g: g, rows: s.rows.slice(i, i + 240) });
        });
        (function slice() {
            if (v.dead) return;
            var t0 = performance.now();
            while (jobs.length && performance.now() - t0 < 12) {
                var j = jobs.shift(), frag = document.createDocumentFragment();
                j.rows.forEach(function (r) { frag.appendChild(emojiCell(v, r, vend)); });
                j.g.appendChild(frag);
            }
            if (jobs.length) requestAnimationFrame(slice);
        })();
    }

    /* Offer the Apple pack. It is downloaded from the community font build on
       GitHub, never shipped with Zen Stickers. */
    var packBusy = false;
    function appleBanner(v) {
        var d = document.createElement('div');
        d.className = 'banner';
        d.innerHTML = '<div><b>Apple pack not downloaded.</b> Previews come from Emojipedia. The pack (66 MB, once) makes previews instant and fills the few emojis Emojipedia lacks.</div>' +
            '<button class="btn-mini" data-act="pack">Download</button>';
        v.el.insertBefore(d, v.el.firstChild);
        d.querySelector('[data-act="pack"]').addEventListener('click', function () {
            if (packBusy) return;
            packBusy = true;
            var btn = this; btn.disabled = true;
            var rows = [];
            Emoji.load().rows.forEach(function (r) { rows.push(r); (r.s || []).forEach(function (x) { rows.push(x); }); });
            window.ZSApplePack.build(rows, Emoji.APPLE_DIR, function (t) { say(t, 'busy'); btn.textContent = t.replace(/^Downloading Apple emojis ?/, '') || '…'; })
                .then(function (r) {
                    packBusy = false;
                    Emoji.appleChanged();
                    say('Apple pack ready: ' + r.written + ' emojis.', 'ok');
                    Object.keys(views).forEach(function (k) { if (k.indexOf('emojis|apple|') === 0) dropView(k); });
                    run();
                }, function (e) { packBusy = false; btn.disabled = false; btn.textContent = 'Try again'; say('Apple pack: ' + e.message, 'err'); });
        });
    }

    function emojiCell(view, r, vend) {
        var sq = document.createElement('div');
        sq.className = 'sq';
        sq.title = r.n;
        var img = document.createElement('img');
        img.draggable = false;
        img.decoding = 'async';
        sq.appendChild(img);
        sq._emoji = r;
        img._load = function () {
            Thumbs.load(vend, r, img, function () {
                sq.classList.add('missing');
                sq.title = r.n + ' (not in ' + vend.name + ')';
            });
        };
        view.obs.observe(img);
        if (animatedOn && vend.id === 'noto' && r.m) {
            var a = document.createElement('span'); a.className = 'an'; a.textContent = 'GIF';
            sq.appendChild(a);
        }
        return sq;
    }

    /* ---------------- picking ---------------- */

    var busy = false;

    list.addEventListener('click', function (e) {
        var cell = e.target.closest('.cell, .sq');
        if (cell && e.altKey) return preview(cell);
        if (cell) return pick(cell, S.click === 'place');
    });

    function pick(cell, doPlace, opts) {
        if (busy) { say('Still busy with the last one…', 'busy'); return; }
        if (cell.classList.contains('missing')) { say('This design does not have that emoji.', 'err'); return; }
        busy = true;
        cell.classList.remove('done');
        cell.classList.add('busy');
        var tab = ST.tab;
        var info = null;
        ensureHost().then(function () { return projectInfo(); }).then(function (inf) {
            info = inf || {};
            return makeFile(cell, info, opts || {});
        }).then(function (file) {
            cell._file = file;
            say((doPlace ? 'Placing ' : 'Importing ') + path.basename(file) + '…', 'busy');
            return placeFile(file, doPlace, tab, cell._item ? cell._item.kind === 'video' : false).catch(function (err) {
                /* A WebM Premiere or After Effects cannot read: fetch the GIF and try again. */
                if (!/\.webm$/i.test(file) || !cell._item || !cell._item.files.gif) throw err;
                say('This app could not read the WebM. Getting the GIF instead…', 'busy');
                var S2 = Object.assign({}, S, { gifFormat: 'gif' });
                return Media.mediaFile(cell._item, S2, info || {}).then(function (f2) { cell._file = f2; return placeFile(f2, doPlace, tab, false); });
            });
        }).then(function (r) {
            busy = false;
            cell.classList.remove('busy');
            cell.classList.add('done');
            remember(cell);
            var it = cell._item;
            if (it) {
                var src = (Sources.tabs[tab] || []).filter(function (s) { return s.id === it.source; })[0];
                if (src && src.used) src.used(it, S);
            }
            var where = r.placed ? (AE ? 'added to ' + (r.comp || 'the comp') : 'placed on ' + r.track) : 'imported to the project';
            say((r.name || 'File') + ' ' + where + (r.loops > 1 ? ', looped ' + r.loops + ' times' : '') + (r.shaped ? ' as shapes' : '') + '.' + (r.note ? ' ' + r.note : ''), 'ok');
        }).catch(function (err) {
            busy = false;
            cell.classList.remove('busy');
            say(err.message || String(err), 'err');
        });
    }

    /*
     * One call for every import.
     * Premiere: a short moving clip is first looped by ffmpeg into a new file
     * (ProRes 4444 with transparency, or a copied MP4), which is then placed
     * like any clip, on a free track, with no audio unless the file has sound.
     * After Effects loops the footage itself, so it gets the loop settings.
     */
    function placeFile(file, doPlace, tab, sound) {
        if (AE) {
            var aeArgs = [S.loop ? S.loopUnder : 0, S.loopTarget, S.loopMarker, S.markerOn].map(jsStr).join(',');
            return host('ZenStickers.place(' + jsStr(file) + ',' + jsStr(doPlace ? '1' : '0') + ',' + jsStr(SUB_BIN[tab]) + ',' +
                jsStr(S.aeShapes ? '1' : '0') + ',' + aeArgs + ')', 120000);
        }
        var moving = /\.(gif|mp4|mov|webm)$/i.test(file);
        var looped = S.loop && moving
            ? window.ZSFfmpeg.loop(S, file, function (m) { say(m, 'busy'); }).catch(function (e) {
                say('Could not loop (' + e.message + '). Placing it as it is.', 'busy');
                return null;
            })
            : Promise.resolve(null);
        return looped.then(function (lp) {
            var f = lp ? lp.file : file;
            var audio = lp ? lp.audio : (sound === undefined ? /\.(mp4|mov|webm)$/i.test(f) : !!sound);
            var expr = 'ZenStickers.place(' + [f, doPlace ? '1' : '0', SUB_BIN[tab], audio ? '1' : '0',
                lp ? lp.loops : 0, lp ? lp.cycle : 0, S.loopMarker, S.markerOn].map(jsStr).join(',') + ')';
            return host(expr, 300000);
        });
    }

    function makeFile(cell, info, opts) {
        if (cell._emoji) {
            var animated = opts.animated !== undefined ? opts.animated : animatedOn;
            return Media.emojiFile(ST.vendor, cell._emoji, S, info, { animated: animated }, function (m) { say(m, 'busy'); });
        }
        var it = cell._item;
        if (it.kind === 'icon') { say('Getting ' + it.name + '…', 'busy'); return Media.iconFile(it, ST.iconColor, S, info); }
        say('Downloading ' + it.title + '…', 'busy');
        return Media.mediaFile(it, S, info, function (f) { say('Downloading ' + it.title + ' ' + Math.round(f * 100) + '%', 'busy'); });
    }

    function remember(cell) {
        if (!cell._emoji) return;
        var k = (cell._emoji.base || cell._emoji).k;
        ST.recentEmoji = [k].concat((ST.recentEmoji || []).filter(function (x) { return x !== k; })).slice(0, 32);
        Store.saveState(ST);
    }

    /* ---------------- drop and paste: pictures from anywhere ---------------- */

    var browserBox = $('browser');
    browserBox.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; browserBox.classList.add('dropping'); });
    browserBox.addEventListener('dragleave', function (e) { if (!browserBox.contains(e.relatedTarget)) browserBox.classList.remove('dropping'); });
    browserBox.addEventListener('drop', function (e) {
        e.preventDefault();
        browserBox.classList.remove('dropping');
        importIncoming(window.ZSIncoming.candidates(e.dataTransfer), !e.altKey === (S.click === 'place'));
    });
    document.addEventListener('paste', function (e) {
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        var c = window.ZSIncoming.candidates(e.clipboardData);
        e.preventDefault();
        if (c.length) importIncoming(c, S.click === 'place'); else pasteFromClipboard();
    });
    /* Premiere keeps Ctrl+V for itself unless the panel asks for it. */
    try {
        cs.registerKeyEventsInterest(JSON.stringify(process.platform === 'darwin'
            ? [{ keyCode: 9, metaKey: true }] : [{ keyCode: 86, ctrlKey: true }]));
    } catch (e) {}

    function pasteFromClipboard() {
        say('Reading the clipboard…', 'busy');
        window.ZSIncoming.osClipboard().then(function (c) {
            if (!c) { say('The clipboard has no picture or link. In the browser, right-click a picture and choose Copy image.', 'err'); return; }
            importIncoming(c.then ? [c, c.then] : [c], S.click === 'place');
        });
    }

    var KIND_FOR_TAB = { gifs: 'gif', stickers: 'sticker', photos: 'photo', videos: 'video', icons: 'vector', emojis: 'emoji' };
    function importIncoming(cands, doPlace) {
        if (!cands.length) { say('Nothing to import in what was dropped.', 'err'); return; }
        if (busy) { say('Still busy with the last one…', 'busy'); return; }
        busy = true;
        var tab = ST.tab, info = {}, usedThumb = false;
        say('Getting the dropped picture…', 'busy');
        ensureHost().then(projectInfo).then(function (inf) {
            info = inf || {};
            var dir = Media.outDir('drop', S, info);
            var i = 0, lastErr = null;
            function next() {
                if (i >= cands.length) return Promise.reject(lastErr || new Error('Nothing could be downloaded.'));
                var c = cands[i++];
                usedThumb = !!c.thumb;
                return window.ZSIncoming.save(c, dir, 'Dropped', function (f) { say('Downloading ' + Math.round(f * 100) + '%', 'busy'); })
                    .then(Media.fixIncoming)
                    .catch(function (e) { lastErr = e; return next(); });
            }
            return next();
        }).then(function (file) {
            say((doPlace ? 'Placing ' : 'Importing ') + path.basename(file) + '…', 'busy');
            return placeFile(file, doPlace, tab);
        }).then(function (r) {
            busy = false;
            var where = r.placed ? (AE ? 'added to ' + (r.comp || 'the comp') : 'placed on ' + r.track) : 'imported to the project';
            if (usedThumb) {
                say('Imported Google\u2019s small preview: it has no transparency and is low quality. On Google, click the picture first, then drag the big one.', 'err');
                return;
            }
            say((r.name || 'File') + ' ' + where + (r.loops > 1 ? ', looped ' + r.loops + ' times' : '') + '.' + (r.note ? ' ' + r.note : ''), 'ok');
        }).catch(function (e) {
            busy = false;
            say(e.message || String(e), 'err');
        });
    }

    /* ---------------- right-click menu ---------------- */

    var menu = $('menu'), menuCell = null;
    list.addEventListener('contextmenu', function (e) {
        var cell = e.target.closest('.cell, .sq');
        if (!cell) return;
        e.preventDefault();
        menuCell = cell;
        menu.querySelector('[data-act="place"]').textContent = AE ? 'Import and add to the comp' : 'Import and place at playhead';
        var anim = cell._emoji && ST.vendor === 'noto' && cell._emoji.m && !animatedOn;
        menu.querySelector('[data-act="animated"]').classList.toggle('hidden', !anim);
        menu.querySelector('[data-act="link"]').classList.toggle('hidden', !(cell._item && cell._item.link));
        menu.querySelector('[data-act="reveal"]').classList.toggle('hidden', !cell._file);
        menu.classList.remove('hidden');
        var z = Number(document.body.style.zoom) || 1;
        var x = e.clientX / z, y = e.clientY / z;
        var w = menu.offsetWidth, h = menu.offsetHeight;
        var W = window.innerWidth / z, H = window.innerHeight / z;
        menu.style.left = Math.max(4, Math.min(x, W - w - 4)) + 'px';
        menu.style.top = Math.max(4, Math.min(y, H - h - 4)) + 'px';
    });
    document.addEventListener('mousedown', function (e) { if (!menu.contains(e.target)) menu.classList.add('hidden'); });
    menu.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b || !menuCell) return;
        var act = b.getAttribute('data-act');
        menu.classList.add('hidden');
        if (act === 'place') pick(menuCell, true);
        else if (act === 'import') pick(menuCell, false);
        else if (act === 'animated') pick(menuCell, S.click === 'place', { animated: true });
        else if (act === 'preview') preview(menuCell);
        else if (act === 'reveal' && menuCell._file) Store.reveal(menuCell._file);
        else if (act === 'link' && menuCell._item) { copyText(menuCell._item.link); say('Link copied.', 'ok'); }
    });

    function copyText(t) {
        var ta = document.createElement('textarea');
        ta.value = t; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
    }

    /* ---------------- search box ---------------- */

    var typeTimer = 0;
    search.addEventListener('input', function () {
        queries[ST.tab] = search.value;
        $('search-clear').classList.toggle('hidden', !search.value);
        clearTimeout(typeTimer);
        typeTimer = setTimeout(run, ST.tab === 'emojis' ? 150 : 450);
    });
    search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            clearTimeout(typeTimer); run();
            var ws = Sources.tabs[ST.tab] ? currentSource(ST.tab) : null;
            if (ws && ws.web && search.value.trim()) openWeb(ws, search.value.trim());
        }
        if (e.key === 'Escape' && search.value) { search.value = ''; queries[ST.tab] = ''; clearTimeout(typeTimer); run(); }
    });
    $('search-clear').addEventListener('click', function () {
        search.value = ''; queries[ST.tab] = ''; $('search-clear').classList.add('hidden'); run(); search.focus();
    });

    /* ---------------- top bar ---------------- */

    $('tabs').addEventListener('click', function (e) {
        var b = e.target.closest('.tab');
        if (b) setTab(b.getAttribute('data-tab'));
    });

    function openSettings() {
        try { cs.requestOpenExtension('com.zengane.zenstickers.settings', ''); }
        catch (e) { say('Could not open Settings: ' + e.message, 'err'); }
    }
    $('open-settings').addEventListener('click', openSettings);

    var KIND_OF_TAB = { gifs: 'gif', stickers: 'sticker', photos: 'photo', videos: 'video', icons: 'icon', emojis: 'emoji' };
    function openFolder() {
        projectInfo().then(function (info) { Store.openDir(Media.outDir(KIND_OF_TAB[ST.tab], S, info)); });
    }
    $('open-folder').addEventListener('click', openFolder);

    try {
        cs.setPanelFlyoutMenu('<Menu><MenuItem Id="settings" Label="Settings…"/><MenuItem Id="guide" Label="User guide"/><MenuItem Label="---"/>' +
            '<MenuItem Id="folder" Label="Open the download folder"/><MenuItem Id="cache" Label="Open the cache"/></Menu>');
        cs.addEventListener('com.adobe.csxs.events.flyoutMenuClicked', function (ev) {
            var id = ev.data && ev.data.menuId;
            if (id === 'settings') openSettings();
            else if (id === 'guide') { try { cs.openURLInDefaultBrowser('https://github.com/Zengane/ZenStickers/blob/main/docs/GUIDE.md'); } catch (e) {} }
            else if (id === 'folder') openFolder();
            else if (id === 'cache') Store.openDir(Store.cacheDir(''));
        });
    } catch (e) {}

    /* ---------------- settings sync ---------------- */

    function reloadSettings() {
        var old = S;
        S = Store.loadSettings();
        Store.applyTheme();
        Store.applyScale(S.uiScale);
        var keysChanged = Store.KEYS
            .some(function (k) { return old[k] !== S[k]; });
        if (keysChanged || old.rating !== S.rating || old.animate !== S.animate || old.trending !== S.trending ||
            old.photoSize !== S.photoSize || old.videoQuality !== S.videoQuality || old.flickrFree !== S.flickrFree) {
            Object.keys(views).forEach(dropView);
            order = [];
            current = null;
            if (Sources.tabs[ST.tab]) drawSourceButton();
            run();
        }
    }
    cs.addEventListener('com.zengane.zenstickers.settings', reloadSettings);
    var seenTime = Store.settingsTime();
    window.addEventListener('focus', function () {
        var t = Store.settingsTime();
        if (t !== seenTime) { seenTime = t; reloadSettings(); }
    });

    document.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey && e.shiftKey)) return;
        var d = e.code === 'Equal' ? 0.1 : e.code === 'Minus' ? -0.1 : e.code === 'Digit0' ? 0 : null;
        if (d === null) return;
        e.preventDefault();
        S.uiScale = d === 0 ? 1 : Math.round(Math.min(2, Math.max(0.75, S.uiScale + d)) * 100) / 100;
        Store.saveSettings(S);
        seenTime = Store.settingsTime();
        Store.applyScale(S.uiScale);
    });

    /* ---------------- start ---------------- */

    Store.applyScale(S.uiScale);
    $('icon-color').value = ST.iconColor || '#ffffff';
    document.documentElement.style.setProperty('--icon-color', ST.iconColor || '#ffffff');
    setTab(TAB_COLORS[ST.tab] ? ST.tab : 'gifs');
    ensureHost().then(function () { say('Ready. ' + (AE ? 'After Effects' : 'Premiere') + ' connected.'); }, function (e) { say(e.message, 'err'); });

    window.ZenStickersDebug = { pick: pick, run: run, views: function () { return views; }, current: function () { return current; },
        state: function () { return { S: S, ST: ST }; }, host: host, setTab: setTab, queries: queries, importIncoming: importIncoming };
})();
