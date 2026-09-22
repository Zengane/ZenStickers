// Offline checks: no network, no Adobe app.   npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const acorn = require('acorn');
const { load, ROOT } = require('./shim');

test('every panel script parses', () => {
    for (const dir of ['js', 'settings']) {
        for (const f of fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith('.js'))) {
            assert.doesNotThrow(() => acorn.parse(fs.readFileSync(path.join(ROOT, dir, f), 'utf8'), { ecmaVersion: 2017 }), dir + '/' + f);
        }
    }
});

/* ExtendScript is ES3. One modern construct in a host script and the app
   refuses every call with "EvalScript error.", so parse them as ES3. */
test('host scripts are plain ES3', () => {
    for (const f of ['host-ppro.jsx', 'host-aeft.jsx']) {
        const src = fs.readFileSync(path.join(ROOT, 'host', f), 'utf8');
        assert.doesNotThrow(() => acorn.parse(src, { ecmaVersion: 3, allowReserved: false }), f);
        assert.ok(/^\$\.global\.ZenStickers = \(function \(\) \{/m.test(src), f + ' exposes one namespace');
        /* a ? b : c ? d : e without brackets binds the wrong way in ExtendScript */
        const bad = src.split('\n').filter(l => /\?[^:,;()]*:[^;,()]*\?/.test(l.replace(/"[^"]*"|'[^']*'/g, '""')) && !/\/\//.test(l));
        assert.deepStrictEqual(bad, [], f + ': nested ternary without brackets');
    }
});

test('manifest lists both apps and both windows', () => {
    const m = fs.readFileSync(path.join(ROOT, 'CSXS', 'manifest.xml'), 'utf8');
    assert.ok(m.includes('Host Name="PPRO"') && m.includes('Host Name="AEFT"'));
    assert.ok(m.includes('com.zengane.zenstickers.panel') && m.includes('com.zengane.zenstickers.settings'));
    const v = m.match(/ExtensionBundleVersion="([^"]+)"/)[1];
    for (const f of ['host-ppro.jsx', 'host-aeft.jsx']) {
        assert.ok(fs.readFileSync(path.join(ROOT, 'host', f), 'utf8').includes(' ' + v + '"'), f + ' build matches manifest ' + v);
    }
});

test('settings are cleaned and keep their keys', () => {
    const env = load(['store']);
    const S = env.window.ZSStore;
    const n = S.normalise({ rating: 'x', emojiSize: '2048', uiScale: 9, giphyKey: '  abc ', flickrKey: 'f1', photoSize: 'huge' });
    assert.strictEqual(n.rating, 'pg-13');
    assert.strictEqual(n.emojiSize, 2048);
    assert.strictEqual(n.uiScale, 2);
    assert.strictEqual(n.giphyKey, 'abc');
    assert.strictEqual(n.flickrKey, 'f1');
    assert.strictEqual(n.photoSize, 'large');
    for (const k of S.KEYS) assert.ok(k in n, 'normalise keeps ' + k);
    const saved = S.saveSettings(Object.assign(S.loadSettings(), { klipyKey: 'k' }));
    assert.strictEqual(S.loadSettings().klipyKey, 'k');
    assert.ok(saved.klipyCustomer.startsWith('zen-'));
    env.cleanup();
});

test('emoji index is complete and consistent', () => {
    const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'emoji-index.json'), 'utf8'));
    assert.ok(idx.rows.length > 1800, 'about 1900 base emojis');
    const keys = new Set();
    let skins = 0;
    for (const r of idx.rows) {
        assert.ok(r.k && r.e && r.n && typeof r.g === 'number', 'row ' + r.k);
        assert.ok(!keys.has(r.k), 'unique ' + r.k); keys.add(r.k);
        assert.ok(!/fe0f/.test(r.k), 'keys have no FE0F: ' + r.k);
        for (const s of r.s || []) { skins++; assert.ok(s.tone, 'skin has a tone ' + s.k); assert.ok(!keys.has(s.k)); keys.add(s.k); }
    }
    assert.ok(skins > 1800, 'skin tones present');
    assert.strictEqual(idx.groups.length, 9);
});

test('no Apple images are shipped', () => {
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const pngs = walk(path.join(ROOT, 'data')).filter(f => f.endsWith('.png'));
    assert.deepStrictEqual(pngs, [], 'data/ must not contain emoji images');
});

test('Emojipedia file names follow the known rules', () => {
    const env = load(['store', 'net', 'iconify', 'sources', 'emoji']);
    const E = env.window.ZSEmoji, idx = E.load();
    const row = n => idx.rows.find(r => r.n === n);
    assert.ok(E.epNames(row('red heart')).includes('red-heart_2764-fe0f'));
    assert.ok(E.epNames(row('water pistol')).includes('pistol_1f52b'), 'falls back to the Unicode name');
    const wave3 = E.withTone(row('waving hand'), 3);
    assert.strictEqual(E.epNames(wave3)[0], 'waving-hand_medium-skin-tone_1f44b-1f3fd_1f3fd');
    assert.strictEqual(E.withTone(row('grinning face'), 3).k, '1f600', 'no skins: stays yellow');
    assert.strictEqual(E.slug('piñata'), 'pinata');
    env.cleanup();
});

test('SVG sizing keeps the shape', () => {
    const env = load(['store', 'net', 'iconify', 'sources', 'emoji', 'media']);
    const M = env.window.ZSMedia;
    const r = M.sizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" width="1em" height="1em"><path d="M0 0h24v12H0z"/></svg>', 1024);
    assert.strictEqual(r.w, 1024); assert.strictEqual(r.h, 512);
    assert.ok(/<svg width="1024" height="512"/.test(r.text));
    assert.ok(!/1em/.test(r.text));
    const noVb = M.sizeSvg('<svg width="10" height="20"></svg>', 100);
    assert.strictEqual(noVb.h, 100); assert.strictEqual(noVb.w, 50);
    assert.ok(/viewBox="0 0 10 20"/.test(noVb.text));
    env.cleanup();
});

test('file names are safe on Windows and macOS', () => {
    const env = load(['store', 'net', 'iconify', 'sources', 'emoji', 'media']);
    const M = env.window.ZSMedia;
    assert.strictEqual(M.safe('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
    assert.strictEqual(M.safe('trailing dots...'), 'trailing dots');
    assert.strictEqual(M.safe(''), 'untitled');
    assert.ok(M.safe('x'.repeat(200)).length <= 60);
    env.cleanup();
});

test('file type is read from the bytes', () => {
    const env = load(['store', 'net', 'iconify', 'sources', 'emoji', 'media']);
    const M = env.window.ZSMedia;
    const tmp = path.join(env.tmp, 'f');
    const cases = { gif: Buffer.from('GIF89a' + '\0'.repeat(10)), png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0]),
        jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), webp: Buffer.from('RIFF\0\0\0\0WEBPVP8 '),
        mp4: Buffer.from('\0\0\0\x18ftypisom\0\0\0\0'), avif: Buffer.from('\0\0\0\x18ftypavif\0\0\0\0') };
    for (const [ext, buf] of Object.entries(cases)) { fs.writeFileSync(tmp, buf); assert.strictEqual(M.sniffExt(tmp, 'x'), ext, ext); }
    env.cleanup();
});

test('Apple pack glyph lookup follows ligatures', () => {
    const P = require('../js/applepack.js');
    const cmap = { 0x1f44b: 10, 0x1f3fd: 11, 0x1f468: 20, 0x200d: 21, 0x1f4bb: 22, 0xfe0f: 30, 0x2764: 40 };
    const ligs = { 10: [{ rest: [11], lig: 100 }], 20: [{ rest: [21, 22], lig: 200 }] };
    assert.strictEqual(P.glyphFor('\u{1f44b}\u{1f3fd}', cmap, ligs), 100);
    assert.strictEqual(P.glyphFor('\u{1f468}‍\u{1f4bb}', cmap, ligs), 200);
    assert.strictEqual(P.glyphFor('❤️', cmap, ligs), 40, 'drops FE0F when there is no ligature for it');
    assert.strictEqual(P.glyphFor('\u{1f600}', cmap, ligs), null);
});

test('every source has a name, a logo and a page function', () => {
    const env = load(['store', 'net', 'iconify', 'sources']);
    const T = env.window.ZSSources.tabs;
    for (const tab of Object.keys(T)) {
        const ids = new Set();
        for (const s of T[tab]) {
            assert.ok(s.id && s.name && typeof s.page === 'function', tab + '/' + s.id);
            assert.ok(!ids.has(s.id), 'unique id in ' + tab); ids.add(s.id);
            if (s.key) assert.ok(env.window.ZSStore.KEYS.includes(s.key), s.id + ' key is a known setting');
        }
    }
    env.cleanup();
});

test('keyed sources refuse politely without a key', async () => {
    const env = load(['store', 'net', 'iconify', 'sources']);
    const T = env.window.ZSSources.tabs, S = env.window.ZSStore.normalise({});
    for (const tab of Object.keys(T)) for (const s of T[tab]) {
        if (!s.key) continue;
        await assert.rejects(s.page('cat', 0, S, {}), e => e.noKey === true, s.id);
    }
    env.cleanup();
});

test('the repository holds nothing personal', () => {
    const skip = new Set(['node_modules', '_build', 'dist', '.git']);
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
        skip.has(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const text = walk(ROOT).filter(f => /\.(js|jsx|json|html|css|md|xml|ps1|cmd|txt|yml)$/i.test(f) || path.basename(f) === '.debug');
    /* Windows user folders, and anything that looks like a pasted API key. */
    const bad = /[A-Za-z]:\\Users\\(?!<)|\/Users\/(?!<)[a-z]|api_key=[A-Za-z0-9]{20,}|"(giphy|klipy|tenor|unsplash|pexels|pixabay|flickr|imgur|google)Key"\s*:\s*"[A-Za-z0-9_-]{12,}"/;
    const hits = text.filter(f => !f.endsWith('unit.test.js') && bad.test(fs.readFileSync(f, 'utf8')));
    assert.deepStrictEqual(hits.map(f => path.relative(ROOT, f)), []);
});

test('Google Images links carry the filters as Google writes them', () => {
    const env = load(['store', 'net', 'iconify', 'sources']);
    const G = env.window.ZSSources.googleUrl;
    const u = new URL(G('cat', { size: 'large', color: 'transparent', type: 'clipart', rights: 'reuse', orient: 'square' }, 'photo', {}));
    assert.strictEqual(u.hostname, 'www.google.com');
    assert.strictEqual(u.searchParams.get('tbm'), 'isch');
    assert.strictEqual(u.searchParams.get('q'), 'cat');
    assert.strictEqual(u.searchParams.get('tbs'), 'isz:l,ic:trans,itp:clipart,sur:cl,iar:s');
    assert.strictEqual(new URL(G('dog', { color: 'red' }, 'gif', {})).searchParams.get('tbs'), 'ic:specific,isc:red,itp:animated');
    assert.strictEqual(new URL(G('x', {}, 'photo', {})).searchParams.get('tbs'), null);
    env.cleanup();
});

test('dropped links are unwrapped to the picture itself', () => {
    const env = load(['store', 'net', 'incoming']);
    const I = env.window.ZSIncoming;
    assert.strictEqual(I.unwrap('https://www.google.com/imgres?imgurl=https%3A%2F%2Fexample.com%2Fa.png&imgrefurl=https%3A%2F%2Fexample.com%2F'), 'https://example.com/a.png');
    assert.strictEqual(I.unwrap('https://example.com/b.gif'), 'https://example.com/b.gif');
    assert.strictEqual(I.imgFromHtml('<meta charset="utf-8"><img alt="x" src="https://e.com/c.jpg?a=1&amp;b=2">'), 'https://e.com/c.jpg?a=1&b=2');
    assert.strictEqual(I.firstUrl('# comment\r\nhttps://e.com/d.webp\r\n'), 'https://e.com/d.webp');
    const dt = { files: [], items: [], getData: t => ({ 'text/uri-list': 'https://www.google.com/imgres?imgurl=https%3A%2F%2Fe.com%2Fbig.png', 'text/html': '<img src="data:image/png;base64,AAAA">' })[t] || '' };
    const c = I.candidates(dt);
    assert.strictEqual(c[0].url, 'https://e.com/big.png', 'the original picture comes before the thumbnail');
    assert.ok(c.some(x => /^data:image/.test(x.url)));
    env.cleanup();
});

test('Google grid previews are tried last and flagged', () => {
    const env = load(['store', 'net', 'incoming']);
    const I = env.window.ZSIncoming;
    assert.ok(I.isGoogleThumb('https://encrypted-tbn0.gstatic.com/images?q=tbn:abc'));
    assert.ok(I.isGoogleThumb('data:image/jpeg;base64,AAAA'));
    assert.ok(!I.isGoogleThumb('https://example.com/a.png'));
    const dt = { files: [], items: [], getData: t => ({ 'text/html': '<img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:x">', 'text/uri-list': 'https://example.com/original.png' })[t] || '' };
    const c = I.candidates(dt);
    assert.strictEqual(c[0].url, 'https://example.com/original.png');
    assert.ok(c[c.length - 1].thumb);
    env.cleanup();
});

test('loop settings are kept within sensible limits', () => {
    const env = load(['store']);
    const S = env.window.ZSStore;
    const d = S.normalise({});
    assert.strictEqual(d.loop, true); assert.strictEqual(d.loopUnder, 1); assert.strictEqual(d.loopTarget, 5);
    assert.strictEqual(d.loopMarker, 'first'); assert.strictEqual(d.markerOn, 'clip'); assert.strictEqual(d.gifFormat, 'gif');
    const n = S.normalise({ loop: false, loopUnder: 0, loopTarget: 999, loopMarker: 'x', markerOn: 'timeline', gifFormat: 'webm' });
    assert.strictEqual(n.loop, false); assert.strictEqual(n.loopUnder, 0.1); assert.strictEqual(n.loopTarget, 120);
    assert.strictEqual(n.loopMarker, 'first'); assert.strictEqual(n.markerOn, 'timeline'); assert.strictEqual(n.gifFormat, 'webm');
    env.cleanup();
});

test('host scripts take the loop arguments', () => {
    const pp = fs.readFileSync(path.join(ROOT, 'host', 'host-ppro.jsx'), 'utf8');
    const ae = fs.readFileSync(path.join(ROOT, 'host', 'host-aeft.jsx'), 'utf8');
    assert.ok(/function place\(path, doPlace, sub, hasAudio, loops, cycle, marker, markerOn\)/.test(pp));
    assert.ok(/function place\(path, doPlace, sub, shapes, loopUnder, loopTarget, marker, markerOn\)/.test(ae));
    assert.ok(!/createNewSequenceFromClips/.test(pp), 'Premiere no longer nests (it overwrote audio tracks)');
    assert.ok(/src\.loop = loops/.test(ae), 'After Effects loops the footage');
});
