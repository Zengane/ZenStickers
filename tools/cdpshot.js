// node --experimental-websocket tools/cdpshot.js <port> <out.png> [width height]
const [port, out, w, h] = process.argv.slice(2);
const http = require('http'), fs = require('fs');
http.get(`http://127.0.0.1:${port}/json`, res => { let s = ''; res.on('data', d => s += d); res.on('end', () => {
  const ws = new WebSocket(JSON.parse(s).filter(p => p.webSocketDebuggerUrl)[0].webSocketDebuggerUrl);
  let id = 0; const send = (method, params) => new Promise(r => { const my = ++id; ws.addEventListener('message', function f(m) { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener('message', f); r(d.result); } }); ws.send(JSON.stringify({ id: my, method, params })); });
  ws.onopen = async () => {
    if (w) await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 1500));
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    if (w) await send('Emulation.clearDeviceMetricsOverride', {});
    console.log('saved', out); process.exit(0);
  };
}); });
