// Asks every source for real results.   npm run test:live [sourceId]
// Keys come from ZS_<NAME>KEY environment variables or this computer's Zen
// Stickers settings. A source without a key is reported as KEY, not FAIL.
'use strict';
const { load, userKeys } = require('./shim');

const realAppData = process.env.APPDATA;
process.env.ZS_REAL_APPDATA = realAppData;
const keys = userKeys();
const env = load(['store', 'net', 'iconify', 'sources', 'emoji']);
const W = env.window;
const S = Object.assign(W.ZSStore.normalise({}), keys);
const only = process.argv[2];

const QUERY = { gifs: 'cat', stickers: 'wow', photos: 'mountain', videos: 'ocean', icons: 'rocket' };

(async () => {
    let fail = 0, ok = 0, nokey = 0;
    const line = (tag, name, msg) => console.log(tag.padEnd(5), name.padEnd(28), msg);
    for (const tab of Object.keys(W.ZSSources.tabs)) {
        for (const src of W.ZSSources.tabs[tab]) {
            if (only && src.id !== only) continue;
            const q = src.id === 'twitch' ? 'xqc' : QUERY[tab];
            const name = tab + '/' + src.id;
            try {
                const r = await src.page(q, 0, S, { set: '*popular', filters: {} });
                const first = r.items[0];
                if (!first) throw new Error('no results for "' + q + '"');
                const f = first.files || {};
                if (src.id !== 'iconify' && !(f.gif || f.mp4 || f.image || f.video || f.svg)) throw new Error('first result has no file');
                if (src.id !== 'iconify' && !first.thumb) throw new Error('first result has no preview');
                ok++; line('OK', name, r.items.length + ' results' + (r.total ? ' of ' + r.total : '') + ', more=' + r.more + ' | ' + String(first.title).slice(0, 40));
                if (r.more) {
                    const r2 = await src.page(q, 1, S, { set: '*popular', filters: {} });
                    if (!r2.items.length) throw new Error('page 2 is empty');
                }
            } catch (e) {
                if (e.noKey) { nokey++; line('KEY', name, 'no key (add one in Settings > Sources)'); }
                else { fail++; line('FAIL', name, e.message); }
            }
        }
    }
    /* Emoji designs: one emoji each, plus a skin tone. */
    const E = W.ZSEmoji, idx = E.load();
    const heart = idx.rows.find(r => r.n === 'smiling face with heart-eyes');
    const wave = E.withTone(idx.rows.find(r => r.n === 'waving hand'), 3);
    for (const v of E.VENDORS) {
        if (only && only !== 'emoji' && only !== v.id) continue;
        for (const r of [heart, wave]) {
            try { const s = await E.source(v.id, r); ok++; line('OK', 'emoji/' + v.id, r.n + ': ' + s.kind + ' ' + s.body.length + ' bytes'); }
            catch (e) { fail++; line('FAIL', 'emoji/' + v.id, r.n + ': ' + e.message); }
        }
    }
    console.log('\n' + ok + ' ok, ' + fail + ' failed, ' + nokey + ' need a key');
    env.cleanup();
    process.exitCode = fail ? 1 : 0;
})();
