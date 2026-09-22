// Checks the ffmpeg download and the loop recipe, in a temporary folder.
//   npm run test:ffmpeg            (uses ffmpeg from PATH if present)
//   npm run test:ffmpeg -- install (forces the download of Zen Stickers' own copy)
'use strict';
const fs = require('fs'), path = require('path'), https = require('https');
const { load, userKeys } = require('./shim');
process.env.ZS_REAL_APPDATA = process.env.APPDATA;
const keys = userKeys();
const env = load(['store', 'net', 'ffmpeg']);
const F = env.window.ZSFfmpeg;
const S = Object.assign(env.window.ZSStore.normalise({}), { loop: true, loopUnder: 30, loopTarget: 5 });
const forceInstall = process.argv.includes('install');
const say = m => process.stdout.write('  ' + m + '\r');

function get(url, dest) {
    return new Promise((res, rej) => https.get(url, r => {
        if (r.statusCode >= 300 && r.headers.location) return res(get(r.headers.location, dest));
        const o = fs.createWriteStream(dest); r.pipe(o); o.on('finish', () => res(dest));
    }).on('error', rej));
}

(async () => {
    let fail = 0;
    const t0 = Date.now();
    const ff = forceInstall ? await F.install(say) : await F.ensure(S, say);
    console.log('\nffmpeg:', ff.from, ff.ffmpeg, forceInstall ? '(installed in ' + Math.round((Date.now() - t0) / 1000) + ' s)' : '');
    const dir = env.tmp;
    const cases = [];
    /* A GIPHY sticker (GIF with partial frames) and a KLIPY sticker (WebM with alpha). */
    if (keys.giphyKey) {
        const r = await env.window.ZSNet.json('https://api.giphy.com/v1/stickers/search?api_key=' + keys.giphyKey + '&q=wow&limit=3');
        cases.push({ name: 'GIPHY sticker (GIF)', url: r.data[2].images.original.url, ext: 'gif' });
    }
    if (keys.klipyKey) {
        const r = await env.window.ZSNet.json('https://api.klipy.com/api/v1/' + keys.klipyKey + '/stickers/search?q=wow&per_page=2&customer_id=test');
        const f = r.data.data[0].file;
        cases.push({ name: 'KLIPY sticker (WebM)', url: (f.hd.webm || f.md.webm).url, ext: 'webm' });
    }
    for (const c of cases) {
        try {
            const src = await get(c.url, path.join(dir, 'in.' + c.ext));
            const lp = await F.loop(S, src, say);
            const p = await F.probe(ff, lp.file);
            const ok = p.duration >= S.loopTarget - 0.05 && p.alpha;
            if (!ok) fail++;
            console.log((ok ? 'PASS ' : 'FAIL ') + c.name.padEnd(22), lp.loops + ' passes of ' + lp.cycle.toFixed(2) + ' s ->', p.duration.toFixed(2) + ' s,',
                p.codec, p.alpha ? 'with transparency' : 'NO TRANSPARENCY', path.basename(lp.file));
        } catch (e) { fail++; console.log('FAIL ' + c.name, e.message); }
    }
    env.cleanup();
    process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('\nFAIL', e.message); process.exitCode = 1; });
