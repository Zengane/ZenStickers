// Evaluate JS in a running CEP window through its DevTools port.
//   node --experimental-websocket tools/cdp.js <port> "<expression>" [timeoutMs]
// The expression may return a Promise; its resolved value is printed as JSON.
const port = process.argv[2], expr = process.argv[3], ms = +process.argv[4] || 60000;
const http = require('http');
http.get(`http://127.0.0.1:${port}/json`, res => {
    let s = ''; res.on('data', d => s += d); res.on('end', () => {
        const pages = JSON.parse(s).filter(p => p.webSocketDebuggerUrl);
        if (!pages.length) { console.error('no page on', port); process.exit(2); }
        const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
        const t = setTimeout(() => { console.error('timeout'); process.exit(3); }, ms);
        ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
            params: { expression: expr, awaitPromise: true, returnByValue: true } }));
        ws.onmessage = m => {
            const d = JSON.parse(m.data);
            if (d.id !== 1) return;
            clearTimeout(t);
            const r = d.result || {};
            if (r.exceptionDetails) console.log('EXCEPTION', JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails));
            else console.log(JSON.stringify(r.result && r.result.value, null, 1));
            ws.close(); process.exit(0);
        };
        ws.onerror = e => { console.error('ws error', e.message); process.exit(4); };
    });
}).on('error', e => { console.error('port', port, e.message); process.exit(1); });
