/**
 * Zen Stickers - Iconify, the polite way.
 *
 * One SVG per request got the panel rate-limited (HTTP 429) after a few
 * hundred emoji thumbnails. Iconify's own advice is to ask for many icons at
 * once: /<prefix>.json?icons=a,b,c returns every body in one answer. So
 * thumbnails queue their names while they scroll into view, the queue is
 * flushed in batches, and every body is kept in memory and on disk, so the
 * same icon is never asked for twice.
 */
(function () {
    'use strict';

    var fs    = require('fs');
    var path  = require('path');
    var Net   = window.ZSNet;
    var Store = window.ZSStore;

    var API = 'https://api.iconify.design';
    var BATCH = 80;

    var sets = {};           // prefix -> { icons: {name: {body,w,h}}, missing: {name:1}, dirty }

    function diskFile(prefix) { return path.join(Store.cacheDir('iconify'), prefix.replace(/[^a-z0-9-]/gi, '') + '.json'); }

    function set(prefix) {
        if (sets[prefix]) return sets[prefix];
        var s = { icons: {}, missing: {}, dirty: false };
        try {
            var d = JSON.parse(fs.readFileSync(diskFile(prefix), 'utf8'));
            s.icons = d.icons || {};
        } catch (e) {}
        sets[prefix] = s;
        return s;
    }

    var saveTimer = 0;
    function saveSoon() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            Object.keys(sets).forEach(function (p) {
                if (!sets[p].dirty) return;
                sets[p].dirty = false;
                try { fs.writeFileSync(diskFile(p), JSON.stringify({ icons: sets[p].icons })); } catch (e) {}
            });
        }, 2000);
    }

    /* Iconify JSON -> {body, w, h}, following aliases to their parent. */
    function absorb(prefix, data, asked) {
        var s = set(prefix);
        var dw = data.width || 16, dh = data.height || 16;
        var icons = data.icons || {}, aliases = data.aliases || {};
        function resolve(name, depth) {
            if (icons[name]) return icons[name];
            if (aliases[name] && depth < 5) {
                var a = aliases[name], p = resolve(a.parent, depth + 1);
                if (!p) return null;
                var o = {}; for (var k in p) o[k] = p[k]; for (var k2 in a) if (k2 !== 'parent') o[k2] = a[k2];
                return o;
            }
            return null;
        }
        asked.forEach(function (name) {
            var ic = resolve(name, 0);
            if (!ic) { s.missing[name] = 1; return; }
            var body = ic.body;
            if (ic.hFlip || ic.vFlip) {
                var w0 = ic.width || dw, h0 = ic.height || dh;
                body = '<g transform="translate(' + (ic.hFlip ? w0 : 0) + ' ' + (ic.vFlip ? h0 : 0) + ') scale(' + (ic.hFlip ? -1 : 1) + ' ' + (ic.vFlip ? -1 : 1) + ')">' + body + '</g>';
            }
            s.icons[name] = { body: body, w: ic.width || dw, h: ic.height || dh, l: ic.left || 0, t: ic.top || 0 };
            s.dirty = true;
        });
        (data.not_found || []).forEach(function (n) { s.missing[n] = 1; });
        saveSoon();
    }

    function fetchBatch(prefix, names, tries) {
        var url = API + '/' + encodeURIComponent(prefix) + '.json?icons=' + names.map(encodeURIComponent).join(',');
        return Net.json(url, 20000).then(function (data) {
            absorb(prefix, data, names);
        }, function (err) {
            /* Rate limited or a blip: back off and try again, a few times. */
            if ((tries || 0) < 3 && /429|Timed out|ECONNRESET/.test(err.message)) {
                return new Promise(function (r) { setTimeout(r, 1500 * ((tries || 0) + 1)); })
                    .then(function () { return fetchBatch(prefix, names, (tries || 0) + 1); });
            }
            throw err;
        });
    }

    /* ---------- the lazy queue for thumbnails ---------- */

    var queue = {};          // prefix -> {name: [callbacks]}
    var flushTimer = 0;
    var inFlight = 0;

    function want(prefix, name, cb) {
        var s = set(prefix);
        if (s.icons[name]) return cb(s.icons[name]);
        if (s.missing[name]) return cb(null);
        var q = queue[prefix] = queue[prefix] || {};
        (q[name] = q[name] || []).push(cb);
        if (!flushTimer) flushTimer = setTimeout(flush, 60);
    }

    function flush() {
        flushTimer = 0;
        Object.keys(queue).forEach(function (prefix) {
            var q = queue[prefix];
            delete queue[prefix];
            var names = Object.keys(q);
            for (var i = 0; i < names.length; i += BATCH) {
                (function (chunk) {
                    inFlight++;
                    fetchBatch(prefix, chunk).then(function () {
                        inFlight--;
                        var s = set(prefix);
                        chunk.forEach(function (n) { (q[n] || []).forEach(function (cb) { cb(s.icons[n] || null); }); });
                    }, function () {
                        inFlight--;
                        chunk.forEach(function (n) { (q[n] || []).forEach(function (cb) { cb(null); }); });
                    });
                })(names.slice(i, i + BATCH));
            }
        });
    }

    /* ---------- building SVG text ---------- */

    function svgText(ic, color, px) {
        var body = ic.body;
        if (color) body = body.replace(/currentColor/g, color);
        var w = ic.w, h = ic.h;
        var sw, sh;
        if (px) { if (w >= h) { sw = px; sh = Math.round(px * h / w); } else { sh = px; sw = Math.round(px * w / h); } }
        else { sw = w; sh = h; }
        return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + sw + '" height="' + sh +
            '" viewBox="' + ic.l + ' ' + ic.t + ' ' + w + ' ' + h + '">' + body + '</svg>';
    }

    function dataUrl(ic, color) {
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText(ic, color, 0));
    }

    /* One icon, for importing: resolves the SVG text or null. */
    function get(prefix, name) {
        return new Promise(function (resolve) { want(prefix, name, resolve); });
    }

    window.ZSIconify = { want: want, get: get, svgText: svgText, dataUrl: dataUrl };
})();
