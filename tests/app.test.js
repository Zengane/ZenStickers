// Drives the real panel inside Premiere Pro or After Effects.
//
//   npm run test:app -- ppro      (panel open in Premiere, debug port 8160)
//   npm run test:app -- aeft      (panel open in After Effects, debug port 8162)
//
// It needs PlayerDebugMode and the .debug file (a developer install). It makes
// its own throwaway project in the system temp folder and REFUSES to run while
// a saved project of yours is open, so it cannot touch your work.
'use strict';
const http = require('http'), os = require('os'), path = require('path');

const app = (process.argv[2] || 'ppro').toLowerCase();
const PORT = app === 'aeft' ? 8162 : 8160;
const AE = app === 'aeft';
const TEST_DIR = path.join(os.tmpdir(), 'Zen Stickers app test').split(path.sep).join('/');

function evaluate(expr, ms) {
    return new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:' + PORT + '/json', res => {
            let s = ''; res.on('data', d => s += d); res.on('end', () => {
                const page = JSON.parse(s).filter(p => p.webSocketDebuggerUrl)[0];
                if (!page) return reject(new Error('The panel is not open (no page on port ' + PORT + ').'));
                const ws = new WebSocket(page.webSocketDebuggerUrl);
                const t = setTimeout(() => { ws.close(); reject(new Error('timed out')); }, ms || 60000);
                ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
                ws.onmessage = m => {
                    const d = JSON.parse(m.data); if (d.id !== 1) return;
                    clearTimeout(t); ws.close();
                    const r = d.result || {};
                    if (r.exceptionDetails) reject(new Error((r.exceptionDetails.exception || {}).description || 'exception'));
                    else resolve(r.result && r.result.value);
                };
                ws.onerror = () => reject(new Error('Could not talk to the panel.'));
            });
        }).on('error', () => reject(new Error('Nothing on port ' + PORT + '. Open the Zen Stickers panel (developer install) first.')));
    });
}

const host = (script, ms) => evaluate('ZenStickersDebug.host(' + JSON.stringify(script) + ',' + (ms || 60000) + ')', (ms || 60000) + 5000);

/* Each case: tab, source, search, and optionally the emoji design. */
const CASES = [
    { tab: 'gifs', source: 'klipy', q: 'cat', needs: 'klipyKey' },
    { tab: 'gifs', source: 'giphy', q: 'dog', needs: 'giphyKey' },
    { tab: 'gifs', source: 'commons', q: 'cat' },
    { tab: 'stickers', source: '7tv', q: 'wow' },
    { tab: 'stickers', source: 'twitch', q: 'xqc' },
    { tab: 'stickers', source: '7tv', q: 'catjam', loop: true },
    { tab: 'photos', source: 'commons', q: 'mountain' },
    { tab: 'photos', source: 'openverse', q: 'forest' },
    { tab: 'videos', source: 'klipy', q: 'ocean', needs: 'klipyKey' },
    { tab: 'icons', source: 'iconify', q: 'rocket' },
    { tab: 'icons', source: 'commons', q: 'star' },
    { tab: 'emojis', vendor: 'apple', q: 'fire' },
    { tab: 'emojis', vendor: 'noto', q: 'heart' },
    { tab: 'emojis', vendor: 'twemoji', q: 'rocket' }
];

async function main() {
    console.log('Zen Stickers app test in ' + (AE ? 'After Effects' : 'Premiere') + '\n');
    const build = await evaluate('ZenStickersDebug.host("ZenStickers.ping()")');
    console.log('host script:', build);

    /* Safety: only a throwaway project. */
    const cur = await host(AE ? '(app.project.file ? app.project.file.fsName : "")' : 'String(app.project && app.project.path || "")');
    if (cur && !/Zen Stickers app test/i.test(cur) && process.argv.indexOf('--force') < 0) {
        throw new Error('A project is open (' + cur + '). Save and close it first. The test makes its own project.');
    }
    await evaluate('require("fs").mkdirSync(' + JSON.stringify(TEST_DIR) + ', { recursive: true }), 1');
    if (AE) {
        await host('(function(){ app.newProject(); app.project.save(new File("' + TEST_DIR + '/ZS AE test.aep")); var c = app.project.items.addComp("Test", 1920, 1080, 1, 10, 30); c.openInViewer(); return c.name; })()');
    } else {
        await host('String(app.newProject("' + TEST_DIR + '/ZS test.prproj"))');
    }

    const S = await evaluate('ZenStickersDebug.state().S');
    let pass = 0, fail = 0, skip = 0, madeSeq = AE;
    for (const c of CASES) {
        const name = c.tab + '/' + (c.source || c.vendor) + ' "' + c.q + '"';
        if (c.needs && !S[c.needs]) { skip++; console.log('SKIP ', name, '(no ' + c.needs + ')'); continue; }
        const r = await evaluate('(async () => {' +
            'const D = ZenStickersDebug, sleep = ms => new Promise(r => setTimeout(r, ms));' +
            'D.setTab(' + JSON.stringify(c.tab) + ');' +
            (c.source ? 'const st = D.state().ST; st.source[' + JSON.stringify(c.tab) + '] = ' + JSON.stringify(c.source) + '; D.setTab(' + JSON.stringify(c.tab) + ');' : '') +
            (c.vendor ? 'document.querySelector(".vchip[data-v=' + c.vendor + ']").click(); await sleep(300);' : '') +
            'const s = document.getElementById("search"); s.value = ' + JSON.stringify(c.q) + '; D.queries[' + JSON.stringify(c.tab) + '] = s.value; D.run();' +
            'let cell = null; for (let i = 0; i < 60 && !cell; i++) { await sleep(500); cell = D.current().el.querySelector(".cell:not(.missing), .sq:not(.missing)"); }' +
            'if (!cell) return { ok: false, msg: "no results" };' +
            (madeSeq ? '' : 'D.pick(cell, false); for (let i = 0; i < 240 && (cell.classList.contains("busy") || !cell._file); i++) await sleep(500);' +
                'await D.host("(function(){ var b = app.project.rootItem.children[0]; var it = b.children[0].children[0]; var q = app.project.createNewSequenceFromClips(\\"Test\\", [it], app.project.rootItem); app.project.openSequence(q.sequenceID); return 1; })()");') +
            (c.loop ? 'Object.assign(D.state().S, { loop: true, loopUnder: 30, loopTarget: 8, loopMarker: "every", markerOn: "clip" });' : 'Object.assign(D.state().S, { loop: false });') +
            'const stEl = document.getElementById("status"); stEl.className = "status"; const t0 = Date.now(); D.pick(cell, true);' +
            'for (let i = 0; i < 240; i++) { await sleep(500); if (!cell.classList.contains("busy") && (stEl.classList.contains("ok") || stEl.classList.contains("err"))) break; }' +
            'const st2 = document.getElementById("status"); return { ok: st2.classList.contains("ok")' + (c.loop ? ' && /looped/.test(st2.textContent)' : '') + ', msg: st2.textContent, ms: Date.now() - t0 };' +
            '})()', 180000).catch(e => ({ ok: false, msg: e.message }));
        madeSeq = true;
        if (r.ok) pass++; else fail++;
        console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  ' + (r.ms ? r.ms + ' ms  ' : '') + r.msg);
    }
    await host(AE ? 'app.project.save(), "saved"' : 'app.project.save(), "saved"');
    console.log('\n' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped. Test project: ' + TEST_DIR);
    process.exitCode = fail ? 1 : 0;
}

main().catch(e => { console.error('STOPPED:', e.message); process.exitCode = 2; });
