// Compares the JavaScript Apple extractor with a reference folder made by HarfBuzz.
//   node tools/test-applepack.js <font.ttf> <reference dir>
const fs = require('fs'), path = require('path'), os = require('os');
const pack = require('../js/applepack.js');
const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'emoji-index.json'), 'utf8'));
const rows = []; idx.rows.forEach(r => { rows.push(r); (r.s || []).forEach(s => rows.push(s)); });
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-apple-'));
const [font, ref] = process.argv.slice(2);
pack.build(rows, out, null, font).then(r => {
  let same = 0, diff = 0, onlyRef = 0;
  for (const f of fs.readdirSync(ref)) {
    const a = path.join(out, f);
    if (!fs.existsSync(a)) { onlyRef++; continue; }
    fs.readFileSync(a).equals(fs.readFileSync(path.join(ref, f))) ? same++ : diff++;
  }
  console.log('written', r.written, 'missing', r.missing.length, r.missing.slice(0, 5), '| byte-identical', same, 'different', diff, 'only in reference', onlyRef);
  fs.rmSync(out, { recursive: true, force: true });
  process.exitCode = (diff || onlyRef) ? 1 : 0;
});
