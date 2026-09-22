// Checks what a page inside an <iframe> of a CEP panel can reach.
//   node --experimental-websocket tools/cdp-frames.js <port> <url>
// Adds a hidden iframe, then asks INSIDE the iframe whether Node (require,
// process) and the CEP bridge (__adobe_cep__) exist there, and whether it can
// read its parent. Removes the iframe afterwards.
const port = process.argv[2], url = process.argv[3] || 'https://example.com/';
const http = require('http');
http.get(`http://127.0.0.1:${port}/json`, res => {
    let s = ''; res.on('data', d => s += d); res.on('end', async () => {
        const page = JSON.parse(s).filter(p => p.type === 'page' && p.webSocketDebuggerUrl)[0];
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        let id = 0; const pending = {}; const contexts = [];
        const send = (method, params) => new Promise(r => { const my = ++id; pending[my] = r; ws.send(JSON.stringify({ id: my, method, params })); });
        ws.onmessage = m => {
            const d = JSON.parse(m.data);
            if (d.id && pending[d.id]) { pending[d.id](d.result || d); delete pending[d.id]; }
            if (d.method === 'Runtime.executionContextCreated') contexts.push(d.params.context);
        };
        ws.onopen = async () => {
            await send('Runtime.enable', {});
            await send('Runtime.evaluate', { expression: `(() => { const f = document.createElement('iframe'); f.id = 'zs-probe'; f.style.cssText = 'position:fixed;width:1px;height:1px;left:-9px;top:-9px'; f.src = ${JSON.stringify(url)}; document.body.appendChild(f); return 1; })()` });
            await new Promise(r => setTimeout(r, 5000));
            const inFrame = contexts.filter(c => c.auxData && !c.auxData.isDefault === false && c.origin && !/^file:/.test(c.origin));
            const out = [];
            for (const c of contexts) {
                if (!c.origin || /^file:/.test(c.origin) || c.origin === '://') continue;
                const r = await send('Runtime.evaluate', { contextId: c.id, returnByValue: true, expression:
                    `({ origin: location.origin, require: typeof require, process: typeof process, cep: typeof __adobe_cep__, csif: typeof window.cep,
                        parentReadable: (() => { try { return typeof window.parent.document; } catch (e) { return 'blocked: ' + e.name; } })(),
                        parentRequire: (() => { try { return typeof window.parent.require; } catch (e) { return 'blocked: ' + e.name; } })() })` });
                out.push(r.result && r.result.value);
            }
            await send('Runtime.evaluate', { expression: `document.getElementById('zs-probe') && document.getElementById('zs-probe').remove(), 1` });
            console.log(JSON.stringify(out, null, 1));
            process.exit(0);
        };
    });
});
