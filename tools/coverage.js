// Random-sample hit rate of the Emojipedia name rules per vendor.
const path = require('path'), os = require('os'), fs = require('fs');
process.env.APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-cov-'));
global.window = { __adobe_cep__: { getHostEnvironment: () => JSON.stringify({ appName: 'PPRO' }), addEventListener() {} },
  location: { pathname: '/' + path.join(__dirname, '..', 'index.html').split(path.sep).join('/') }, addEventListener() {} };
for (const f of ['store', 'net', 'emoji']) require('../js/' + f + '.js');
const Emoji = window.ZSEmoji, idx = Emoji.load();
const all = Object.values(idx.all);
const N = +process.argv[2] || 100;
(async () => {
  for (const v of ['apple', 'samsung', 'whatsapp', 'facebook']) {
    const sample = all.slice().sort(() => Math.random() - .5).slice(0, N);
    let ok = 0, fb = 0; const miss = [];
    const q = sample.slice();
    async function w() { while (q.length) { const r = q.pop(); try { const s = await Emoji.source(v, r); if (/96 px/.test(s.from)) { fb++; miss.push(r.n); } else ok++; } catch (e) { miss.push(r.n); } } }
    await Promise.all([w(), w(), w(), w(), w(), w()]);
    console.log(v, 'found', ok, '/', N, 'apple-fallback', fb, '\n   missing:', miss.slice(0, 25).join(' | '));
  }
})();
