/**
 * Zen Stickers - emoji designs.
 *
 * Two families:
 *   bitmap  Apple, Samsung, WhatsApp, Facebook. Images from Emojipedia's image
 *           server (direct file requests, never their web pages). 108-512 px,
 *           so they are AI-upscaled on import. Apple can also have a 96 px copy
 *           of every emoji on disk (the optional Apple pack, js/applepack.js,
 *           downloaded by the user): then that is the grid preview, and the
 *           fallback when Emojipedia has no file.
 *   vector  Google Noto, Twemoji, OpenMoji, Fluent. SVG from Iconify (Google's
 *           own server as a fallback for Noto). After Effects gets the SVG,
 *           Premiere gets a PNG drawn from it at full size.
 *
 * Emojipedia file names: <slug>_<codepoints>.png, where slug is the emoji's
 * name in lowercase with hyphens. One skin tone: <base slug>_<tone slug>_<cps>_<tone cp>.
 * Some files use the older Unicode name ("pistol", not "water pistol"), and
 * some need or drop FE0F, so every emoji gets a short list of candidates and
 * the first that answers is remembered on disk.
 */
(function () {
    'use strict';

    var fs   = require('fs');
    var path = require('path');
    var Net  = window.ZSNet;
    var Store = window.ZSStore;

    /* The extension folder: the panel page (index.html) sits at its root. */
    var ROOT = path.dirname(path.normalize(decodeURIComponent(window.location.pathname).replace(/^\/([A-Za-z]:)/, '$1')));
    /* The optional Apple pack (js/applepack.js) lives in the user's data folder, never in the project. */
    var APPLE_DIR = path.join(Store.DIR, 'apple96');
    var applePackReady = null;
    function appleReady() {
        if (applePackReady === null) applePackReady = fs.existsSync(path.join(APPLE_DIR, 'pack.json'));
        return applePackReady;
    }

    var EP = 'https://em-content.zobj.net';
    var ICONIFY = 'https://api.iconify.design';

    var VENDORS = [
        { id: 'apple',    name: 'Apple',       kind: 'bitmap', ep: 'apple',    ver: [454, 453, 426, 419, 415], src: 160 },
        { id: 'samsung',  name: 'Samsung',     kind: 'bitmap', ep: 'samsung',  ver: [456, 424, 411, 405],      src: 108 },
        { id: 'whatsapp', name: 'WhatsApp',    kind: 'bitmap', ep: 'whatsapp', ver: [477, 470, 469, 466, 452], src: 160 },
        { id: 'facebook', name: 'Facebook',    kind: 'bitmap', ep: 'facebook', ver: [431],                     src: 512 },
        { id: 'noto',     name: 'Google',      kind: 'vector', ic: 'noto' },
        { id: 'twemoji',  name: 'Twemoji',     kind: 'vector', ic: 'twemoji' },
        { id: 'openmoji', name: 'OpenMoji',    kind: 'vector', ic: 'openmoji' },
        { id: 'fluent',   name: 'Fluent',      kind: 'vector', ic: 'fluent-emoji', names: 'fluent' },
        { id: 'fluentflat', name: 'Fluent Flat', kind: 'vector', ic: 'fluent-emoji-flat', names: 'fluent' }
    ];
    var BY_ID = {};
    VENDORS.forEach(function (v) { BY_ID[v.id] = v; });

    var TONE = { '1f3fb': 'light-skin-tone', '1f3fc': 'medium-light-skin-tone', '1f3fd': 'medium-skin-tone',
                 '1f3fe': 'medium-dark-skin-tone', '1f3ff': 'dark-skin-tone' };

    function slug(s) {
        return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
            .replace(/[’'“”".,!()]/g, '').replace(/[^a-z0-9*#]+/g, '-').replace(/^-|-$/g, '');
    }

    /* ---------- index ---------- */

    var index = null;
    function load() {
        if (index) return index;
        var raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'emoji-index.json'), 'utf8'));
        var all = {};
        raw.rows.forEach(function (r) {
            r.search = (r.n + ' ' + (r.u || '') + ' ' + (r.t || '')).toLowerCase();
            all[r.k] = r;
            (r.s || []).forEach(function (s) { s.base = r; all[s.k] = s; });
        });
        index = { groups: raw.groups, rows: raw.rows, all: all };
        return index;
    }

    /* The row to show for a base emoji under the chosen skin tone (0 = yellow). */
    function withTone(r, tone) {
        if (!tone || !r.s) return r;
        for (var i = 0; i < r.s.length; i++) if (String(r.s[i].tone) === String(tone)) return r.s[i];
        return r;
    }

    function has(v, r) {
        if (v.id === 'apple') return true;                   // local copy, or Emojipedia
        if (v.kind === 'bitmap') return true;                // unknown until asked
        if (v.id === 'noto') return true;                    // Google's server has the rest
        return !!(r.i && r.i[v.names || v.id]);
    }

    /* ---------- Emojipedia candidates ---------- */

    function epNames(r) {
        var q = r.q, k = r.k;
        var cpv = [q];
        if (k !== q) cpv.push(k);
        var out = [];
        var base = r.base;
        var parts = k.split('-');
        if (base && parts.length === 2 && TONE[parts[1]]) {
            cpv.forEach(function (c) { out.push(slug(base.n) + '_' + TONE[parts[1]] + '_' + c + '_' + parts[1]); });
            if (base.u) out.push(slug(base.u) + '_' + TONE[parts[1]] + '_' + q + '_' + parts[1]);
        }
        cpv.forEach(function (c) { out.push(slug(r.n) + '_' + c); });
        if (r.u) cpv.forEach(function (c) { out.push(slug(r.u) + '_' + c); });
        if (base && base.u && parts.length > 2) out.push(slug(base.u) + slug(r.n).slice(slug(base.n).length) + '_' + q);
        var seen = {};
        return out.filter(function (n) { if (seen[n]) return false; seen[n] = 1; return true; });
    }

    /* Resolved Emojipedia file per vendor, kept on disk so a name is only searched for once. */
    var resolved = {};
    function resolvedFile(v) { return path.join(Store.cacheDir('emoji'), 'resolved-' + v.id + '.json'); }
    function getResolved(v) {
        if (!resolved[v.id]) { try { resolved[v.id] = JSON.parse(fs.readFileSync(resolvedFile(v), 'utf8')); } catch (e) { resolved[v.id] = {}; } }
        return resolved[v.id];
    }
    function setResolved(v, k, val) {
        var m = getResolved(v); m[k] = val;
        clearTimeout(setResolved.t);
        setResolved.t = setTimeout(function () {
            VENDORS.forEach(function (vv) { if (resolved[vv.id]) try { fs.writeFileSync(resolvedFile(vv), JSON.stringify(resolved[vv.id])); } catch (e) {} });
        }, 1500);
    }

    /* Thumbnail addresses for the grid, tried in order by the <img> onerror chain. */
    function thumbs(vid, r) {
        var v = BY_ID[vid];
        if (v.id === 'apple' && r.a && appleReady()) return [fileUrl(path.join(APPLE_DIR, r.k + '.png'))];
        if (v.kind === 'bitmap') {
            var m = getResolved(v)[r.k];
            if (m === 0) return [];
            if (m) return [EP + '/thumbs/72/' + v.ep + '/' + m];
            return epNames(r).slice(0, 4).map(function (n) { return EP + '/thumbs/72/' + v.ep + '/' + v.ver[0] + '/' + n + '.png'; });
        }
        /* Vector sets draw from Iconify bodies (see iconRef); only Noto has a plain-file fallback. */
        return v.id === 'noto' ? [notoUrl(r, 'emoji.svg')] : [];
    }

    /* Which Iconify icon draws this emoji in a vector set, or null. */
    function iconRef(vid, r) {
        var v = BY_ID[vid];
        if (!v || v.kind !== 'vector') return null;
        var nm = r.i && r.i[v.names || v.id];
        return nm ? { prefix: v.ic, name: nm } : null;
    }

    function notoUrl(r, file) {
        return 'https://fonts.gstatic.com/s/e/notoemoji/latest/' + r.k.replace(/-/g, '_') + '/' + file;
    }

    function fileUrl(p) {
        var u = p.replace(/\\/g, '/').replace(/%/g, '%25').replace(/ /g, '%20').replace(/#/g, '%23').replace(/\?/g, '%3F');
        return u.charAt(0) === '/' ? 'file://' + u : 'file:///' + u;
    }

    /* The source picture for an emoji: { kind: 'png'|'svg'|'gif', body: Buffer, from: string } */
    function source(vid, r, opts) {
        var v = BY_ID[vid];
        opts = opts || {};
        if (v.kind === 'vector') {
            if (opts.animated && v.id === 'noto' && r.m) {
                return Net.buffer(notoUrl(r, '512.gif')).then(function (b) {
                    if (b) return { kind: 'gif', body: b.body, from: 'Google (animated)' };
                    return source(vid, r, {});
                });
            }
            var ref = iconRef(vid, r);
            var viaIconify = ref ? window.ZSIconify.get(ref.prefix, ref.name) : Promise.resolve(null);
            return viaIconify.then(function (ic) {
                if (ic) return { kind: 'svg', body: Buffer.from(window.ZSIconify.svgText(ic, null, 0), 'utf8'), from: v.name };
                return tryUrls(thumbs(vid, r), function (b) { return { kind: 'svg', body: b.body, from: v.name }; });
            }).then(function (res) { if (!res) throw new Error(v.name + ' has no "' + r.n + '".'); return res; });
        }
        /* bitmap */
        var m = getResolved(v)[r.k];
        var urls2 = [];
        if (m) urls2.push(EP + '/source/' + v.ep + '/' + m);
        var names = epNames(r);
        v.ver.forEach(function (ver, i) {
            (i === 0 ? names : names.slice(0, 2)).forEach(function (n) { urls2.push(EP + '/source/' + v.ep + '/' + ver + '/' + n + '.png'); });
        });
        var seen = {};
        urls2 = urls2.filter(function (u) { if (seen[u]) return false; seen[u] = 1; return true; });
        return tryUrls(urls2, function (b, url) {
            setResolved(v, r.k, url.split('/source/' + v.ep + '/')[1]);
            return { kind: 'png', body: b.body, from: v.name + ' (Emojipedia)' };
        }).then(function (res) {
            if (res) return res;
            setResolved(v, r.k, 0);
            if (v.id === 'apple' && r.a && appleReady() && fs.existsSync(path.join(APPLE_DIR, r.k + '.png'))) {
                return { kind: 'png', body: fs.readFileSync(path.join(APPLE_DIR, r.k + '.png')), from: 'Apple (96 px pack)' };
            }
            throw new Error(v.name + ' has no "' + r.n + '".');
        });
    }

    function tryUrls(urls, make) {
        var i = 0;
        function next() {
            if (i >= urls.length) return Promise.resolve(null);
            var u = urls[i++];
            return Net.buffer(u, 20000).then(function (b) {
                if (b && b.body && b.body.length > 60 && !/text\/html/.test(b.type)) return make(b, u);
                return next();
            }, function () { return next(); });
        }
        return next();
    }

    function markMissing(vid, r) {
        var v = BY_ID[vid];
        if (v.kind === 'bitmap') setResolved(v, r.k, 0);
    }
    function markFound(vid, r, url) {
        var v = BY_ID[vid];
        if (v.kind !== 'bitmap' || url.indexOf('/thumbs/72/' + v.ep + '/') < 0) return;
        setResolved(v, r.k, url.split('/thumbs/72/' + v.ep + '/')[1]);
    }

    window.ZSEmoji = {
        VENDORS: VENDORS,
        vendor: function (id) { return BY_ID[id] || BY_ID.apple; },
        load: load,
        withTone: withTone,
        has: has,
        thumbs: thumbs,
        iconRef: iconRef,
        APPLE_DIR: APPLE_DIR,
        appleReady: appleReady,
        appleChanged: function () { applePackReady = null; },
        source: source,
        markMissing: markMissing,
        markFound: markFound,
        slug: slug,
        epNames: epNames,
        fileUrl: fileUrl,
        ROOT: ROOT
    };
})();
