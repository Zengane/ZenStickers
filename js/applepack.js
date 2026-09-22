/**
 * Zen Stickers - the optional Apple emoji pack.
 *
 * Apple's emoji images are not in this project. When the user asks for them,
 * this downloads the community build of Apple's emoji font
 * (github.com/samuelngs/apple-emoji-ttf) and pulls every emoji out of it as a
 * 96 px PNG, into %APPDATA%\Zengane\Zen Stickers\apple96. That folder is the
 * Apple grid preview and the fallback when Emojipedia has no file.
 *
 * Only the parts of the font that are needed are downloaded, with HTTP range
 * requests: the table directory, cmap, GSUB, CBLC, and the 96 px strike of
 * CBDT (about 66 MB of 256 MB). A server without range support gets the whole
 * file instead.
 *
 * Font facts this relies on (checked on the macos-26-20260722 release):
 *   cmap format 12 maps code points to glyphs
 *   GSUB has one ligature lookup (type 4, maybe wrapped in type 7) under ccmp;
 *     a sequence (ZWJ, skin tones, flags, keycaps) becomes one glyph
 *   CBLC index subtables are format 1 (uint32 offsets), CBDT images format 17
 *     (small metrics, then a length-prefixed PNG)
 */
(function () {
    'use strict';

    var fs    = require('fs');
    var path  = require('path');
    var https = require('https');
    var URL_  = require('url');

    var FONT_URL = 'https://github.com/samuelngs/apple-emoji-ttf/releases/download/macos-26-20260722-484daf4e/AppleColorEmoji-Windows.ttf';
    var PPEM = 96;

    /* ---------- range download ---------- */

    function get(url, start, end, onData, redirects) {
        if (!/^https?:/i.test(url)) {
            /* A font already on disk (tests, or a copy the user downloaded). */
            return new Promise(function (resolve) {
                var fd = fs.openSync(url, 'r'), len = end - start + 1, b = Buffer.alloc(len);
                fs.readSync(fd, b, 0, len, start); fs.closeSync(fd);
                if (onData) onData(len);
                resolve(b);
            });
        }
        return new Promise(function (resolve, reject) {
            var u = new URL_.URL(url);
            var headers = { 'User-Agent': 'ZenStickers' };
            if (start !== null) headers.Range = 'bytes=' + start + '-' + end;
            var req = https.get(u, { headers: headers }, function (res) {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirects || 0) < 6) {
                    res.resume();
                    return resolve(get(new URL_.URL(res.headers.location, url).toString(), start, end, onData, (redirects || 0) + 1));
                }
                if (res.statusCode !== 206 && res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' from ' + u.hostname)); }
                var chunks = [], got = 0;
                res.on('data', function (c) { chunks.push(c); got += c.length; if (onData) onData(got); });
                res.on('end', function () {
                    var buf = Buffer.concat(chunks);
                    /* A 200 means the server ignored Range: cut the slice out ourselves. */
                    if (res.statusCode === 200 && start !== null) buf = buf.slice(start, end + 1);
                    resolve(buf);
                });
                res.on('error', reject);
            });
            req.setTimeout(120000, function () { req.destroy(new Error('Timed out downloading the Apple font.')); });
            req.on('error', reject);
        });
    }

    /* ---------- font tables ---------- */

    function directory(buf) {
        var n = buf.readUInt16BE(4), t = {};
        for (var i = 0; i < n; i++) {
            var o = 12 + i * 16;
            t[buf.toString('latin1', o, o + 4)] = { offset: buf.readUInt32BE(o + 8), length: buf.readUInt32BE(o + 12) };
        }
        return t;
    }

    function parseCmap(buf) {
        var n = buf.readUInt16BE(2), map = {};
        for (var i = 0; i < n; i++) {
            var off = buf.readUInt32BE(4 + i * 8 + 4);
            if (buf.readUInt16BE(off) !== 12) continue;
            var groups = buf.readUInt32BE(off + 12);
            for (var g = 0; g < groups; g++) {
                var p = off + 16 + g * 12;
                var s = buf.readUInt32BE(p), e = buf.readUInt32BE(p + 4), gid = buf.readUInt32BE(p + 8);
                for (var c = s; c <= e; c++) map[c] = gid + (c - s);
            }
            return map;
        }
        throw new Error('The Apple font has no format 12 cmap.');
    }

    function coverage(buf, off) {
        var fmt = buf.readUInt16BE(off), out = [];
        if (fmt === 1) {
            var n = buf.readUInt16BE(off + 2);
            for (var i = 0; i < n; i++) out.push(buf.readUInt16BE(off + 4 + i * 2));
        } else {
            var r = buf.readUInt16BE(off + 2);
            for (var j = 0; j < r; j++) {
                var p = off + 4 + j * 6, s = buf.readUInt16BE(p), e = buf.readUInt16BE(p + 2), ci = buf.readUInt16BE(p + 4);
                for (var gg = s; gg <= e; gg++) out[ci + gg - s] = gg;
            }
        }
        return out;
    }

    /* first glyph -> [{ rest: [glyphs...], lig: glyph }] in the font's order of preference */
    function parseGsub(buf) {
        var lookupList = buf.readUInt16BE(8);
        var n = buf.readUInt16BE(lookupList), ligs = {};
        for (var i = 0; i < n; i++) {
            var lk = lookupList + buf.readUInt16BE(lookupList + 2 + i * 2);
            var type = buf.readUInt16BE(lk), subs = buf.readUInt16BE(lk + 4);
            for (var s = 0; s < subs; s++) {
                var st = lk + buf.readUInt16BE(lk + 6 + s * 2), t = type;
                if (t === 7) { t = buf.readUInt16BE(st + 2); st = st + buf.readUInt32BE(st + 4); }
                if (t !== 4) continue;
                var cov = coverage(buf, st + buf.readUInt16BE(st + 2));
                var sets = buf.readUInt16BE(st + 4);
                for (var k = 0; k < sets; k++) {
                    var so = st + buf.readUInt16BE(st + 6 + k * 2), cnt = buf.readUInt16BE(so);
                    var first = cov[k], list = ligs[first] = ligs[first] || [];
                    for (var m = 0; m < cnt; m++) {
                        var lo = so + buf.readUInt16BE(so + 2 + m * 2);
                        var lig = buf.readUInt16BE(lo), comps = buf.readUInt16BE(lo + 2), rest = [];
                        for (var q = 1; q < comps; q++) rest.push(buf.readUInt16BE(lo + 4 + (q - 1) * 2));
                        list.push({ rest: rest, lig: lig });
                    }
                }
            }
        }
        return ligs;
    }

    /* The strike's glyph -> [start, end) in CBDT, plus the byte range of that strike. */
    function parseCblc(buf) {
        var num = buf.readUInt32BE(4);
        for (var i = 0; i < num; i++) {
            var b = 8 + i * 48;
            if (buf.readUInt8(b + 44) !== PPEM) continue;
            var arr = buf.readUInt32BE(b), nsub = buf.readUInt32BE(b + 8);
            var loc = {}, lo = Infinity, hi = 0;
            for (var s = 0; s < nsub; s++) {
                var e = arr + s * 8;
                var firstG = buf.readUInt16BE(e), lastG = buf.readUInt16BE(e + 2), add = buf.readUInt32BE(e + 4);
                var h = arr + add;
                var ifmt = buf.readUInt16BE(h), imgFmt = buf.readUInt16BE(h + 2), dataOff = buf.readUInt32BE(h + 4);
                if (ifmt !== 1 || imgFmt !== 17) throw new Error('Unexpected Apple font layout (' + ifmt + '/' + imgFmt + ').');
                for (var g = firstG; g <= lastG; g++) {
                    var k = g - firstG;
                    var a = dataOff + buf.readUInt32BE(h + 8 + k * 4), z = dataOff + buf.readUInt32BE(h + 8 + (k + 1) * 4);
                    if (z > a) { loc[g] = [a, z]; if (a < lo) lo = a; if (z > hi) hi = z; }
                }
            }
            return { loc: loc, lo: lo, hi: hi };
        }
        throw new Error('The Apple font has no ' + PPEM + ' px images.');
    }

    /* Code points -> one glyph, the way the font's ligature lookup would do it. */
    function glyphFor(emoji, cmap, ligs) {
        function attempt(cps) {
            var gs = [];
            for (var i = 0; i < cps.length; i++) { var g = cmap[cps[i]]; if (g === undefined) return null; gs.push(g); }
            if (gs.length === 1) return gs[0];
            var list = ligs[gs[0]] || [];
            for (var j = 0; j < list.length; j++) {
                var L = list[j];
                if (L.rest.length !== gs.length - 1) continue;
                var ok = true;
                for (var k = 0; k < L.rest.length; k++) if (L.rest[k] !== gs[k + 1]) { ok = false; break; }
                if (ok) return L.lig;
            }
            return null;
        }
        var cps = Array.from(emoji).map(function (c) { return c.codePointAt(0); });
        var g = attempt(cps);
        if (g === null) g = attempt(cps.filter(function (c) { return c !== 0xfe0f; }));
        return g;
    }

    /*
     * Build the pack. rows: the emoji index (every base emoji and skin).
     * onStep(text, fraction) reports progress. Resolves { written, missing }.
     */
    function build(rows, outDir, onStep, url) {
        url = url || FONT_URL;
        var say = onStep || function () {};
        var dir, cmap, ligs, cblc, dataOff;
        say('Reading the Apple font…', 0);
        return get(url, 0, 4095).then(function (head) {
            dir = directory(head);
            ['cmap', 'GSUB', 'CBLC', 'CBDT'].forEach(function (t) { if (!dir[t]) throw new Error('The Apple font has no ' + t + ' table.'); });
            return Promise.all(['cmap', 'GSUB', 'CBLC'].map(function (t) { return get(url, dir[t].offset, dir[t].offset + dir[t].length - 1); }));
        }).then(function (tables) {
            cmap = parseCmap(tables[0]);
            ligs = parseGsub(tables[1]);
            cblc = parseCblc(tables[2]);
            dataOff = dir.CBDT.offset;
            var size = cblc.hi - cblc.lo;
            say('Downloading Apple emojis (' + Math.round(size / 1048576) + ' MB)…', 0.02);
            return get(url, dataOff + cblc.lo, dataOff + cblc.hi - 1, function (got) {
                say('Downloading Apple emojis ' + Math.round(got / size * 100) + '%', 0.02 + 0.9 * got / size);
            });
        }).then(function (strike) {
            fs.mkdirSync(outDir, { recursive: true });
            var written = 0, missing = [];
            rows.forEach(function (r) {
                var g = glyphFor(r.e, cmap, ligs);
                var at = g === null ? null : cblc.loc[g];
                if (!at) { missing.push(r.n); return; }
                var rec = strike.slice(at[0] - cblc.lo, at[1] - cblc.lo);
                /* format 17: 5 bytes small metrics, uint32 length, PNG */
                var len = rec.readUInt32BE(5);
                fs.writeFileSync(path.join(outDir, r.k + '.png'), rec.slice(9, 9 + len));
                written++;
            });
            fs.writeFileSync(path.join(outDir, 'pack.json'), JSON.stringify({ source: url, built: new Date().toISOString(), written: written }));
            say('Apple pack ready: ' + written + ' emojis.', 1);
            return { written: written, missing: missing };
        });
    }

    var API = { build: build, glyphFor: glyphFor, FONT_URL: FONT_URL, _parse: { directory: directory, parseCmap: parseCmap, parseGsub: parseGsub, parseCblc: parseCblc } };
    if (typeof window !== 'undefined') window.ZSApplePack = API;
    if (typeof module !== 'undefined') module.exports = API;
})();
