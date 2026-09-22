// Builds a signed ZXP installer:   npm run build:zxp
//
//   dist/ZenStickers-<version>.zxp        the extension, signed
//   dist/Install-Windows.cmd           double-click installers that unpack the ZXP
//   dist/Install-macOS.command         into the user's CEP folder (no Adobe installer)
//   dist/Fix blank panel (...)            optional: turns on PlayerDebugMode
//
// Signing needs Adobe's ZXPSignCmd and a certificate. Both live OUTSIDE the
// repository:
//   ZXPSignCmd   downloaded once from github.com/Adobe-CEP/CEP-Resources into
//                _build/zxpsign (ignored by git), or set ZXPSIGNCMD
//   certificate  %APPDATA%/Zengane/signing/zenstickers.p12 (or ZXP_CERT), made
//                on first run as a self-signed certificate
//   password     ZXP_PASSWORD, or the file next to the certificate, made on
//                first run. Keep both: an update must be signed with the same one.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), https = require('https'), crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'stage', 'ZenStickers');
const SHIP = ['CSXS', 'index.html', 'css', 'js', 'settings', 'host', 'data', 'bin', 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'README.md'];
const MAC = process.platform === 'darwin';

const appdata = process.env.APPDATA || path.join(os.homedir(), MAC ? 'Library/Application Support' : '.config');
const SIGN_DIR = path.join(appdata, 'Zengane', 'signing');
const CERT = process.env.ZXP_CERT || path.join(SIGN_DIR, 'zenstickers.p12');
const PASS_FILE = CERT.replace(/\.p12$/i, '') + '-password.txt';

const TOOL_URL = MAC
    ? 'https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/4.1.103/macOS/ZXPSignCmd-64bit'
    : 'https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/4.1.103/win64/ZXPSignCmd.exe';
const TOOL = process.env.ZXPSIGNCMD || path.join(ROOT, '_build', 'zxpsign', MAC ? 'ZXPSignCmd' : 'ZXPSignCmd.exe');

function download(url, dest) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'zen-stickers-build' } }, res => {
            if (res.statusCode >= 300 && res.headers.location) return resolve(download(res.headers.location, dest));
            if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            const out = fs.createWriteStream(dest);
            res.pipe(out);
            out.on('finish', () => { out.close(); if (MAC) fs.chmodSync(dest, 0o755); resolve(dest); });
        }).on('error', reject);
    });
}

function run(args) {
    const r = cp.spawnSync(TOOL, args, { encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0) throw new Error('ZXPSignCmd ' + args[0] + ' failed:\n' + out);
    return out;
}

function copy(src, dst) {
    const st = fs.lstatSync(src);
    if (st.isSymbolicLink()) throw new Error('Symlink in the package (breaks ZXP signatures): ' + src);
    if (st.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); for (const f of fs.readdirSync(src)) if (f !== '.DS_Store') copy(path.join(src, f), path.join(dst, f)); }
    else fs.copyFileSync(src, dst);
}

(async () => {
    const version = fs.readFileSync(path.join(ROOT, 'CSXS', 'manifest.xml'), 'utf8').match(/ExtensionBundleVersion="([^"]+)"/)[1];
    if (!fs.existsSync(TOOL)) { console.log('Getting ZXPSignCmd from Adobe…'); await download(TOOL_URL, TOOL); }

    /* Certificate and password: made once, then reused for every update. */
    fs.mkdirSync(SIGN_DIR, { recursive: true });
    let password = process.env.ZXP_PASSWORD || (fs.existsSync(PASS_FILE) ? fs.readFileSync(PASS_FILE, 'utf8').trim() : '');
    if (!fs.existsSync(CERT)) {
        if (!password) { password = crypto.randomBytes(18).toString('base64').replace(/[^A-Za-z0-9]/g, ''); fs.writeFileSync(PASS_FILE, password + '\n'); }
        console.log('Making a self-signed certificate:', CERT);
        run(['-selfSignedCert', 'US', 'NA', 'Zengane', 'Zengane', password, CERT, '-validityDays', '7300']);
    }
    if (!password) throw new Error('No certificate password. Set ZXP_PASSWORD or put it in ' + PASS_FILE);

    /* Stage only what ships: no .debug (it opens debug ports), no tests, no tools. */
    fs.rmSync(path.join(DIST, 'stage'), { recursive: true, force: true });
    for (const f of SHIP) if (fs.existsSync(path.join(ROOT, f))) copy(path.join(ROOT, f), path.join(STAGE, f));
    const out = path.join(DIST, 'ZenStickers-' + version + '.zxp');
    fs.rmSync(out, { force: true });
    console.log('Signing', path.basename(out), '…');
    /* A timestamp keeps the signature valid after the certificate expires. Try a few servers. */
    const TSA = ['http://timestamp.sectigo.com', 'http://timestamp.digicert.com', 'http://time.certum.pl'];
    let signed = false;
    for (const t of TSA) {
        try { run(['-sign', STAGE, out, CERT, password, '-tsa', t]); signed = true; console.log('Timestamped by', t); break; }
        catch (e) { fs.rmSync(out, { force: true }); }
    }
    if (!signed) { console.log('No timestamp server answered: signing without one (the certificate lasts 20 years).'); run(['-sign', STAGE, out, CERT, password]); }
    const check = run(['-verify', out]);
    if (!/Signature verified successfully/i.test(check)) throw new Error('The ZXP did not verify:\n' + check);

    /* Double-click installers (tools/installers). They unpack the ZXP themselves into
       the user's CEP folder: Adobe's own installer (UPIA) fails with -631 when the
       Creative Cloud app is not signed in, and ZXP installer apps call the same thing.
       Windows scripts need CRLF line endings or cmd.exe loses its place at labels. */
    for (const f of fs.readdirSync(path.join(ROOT, 'tools', 'installers'))) {
        let text = fs.readFileSync(path.join(ROOT, 'tools', 'installers', f), 'utf8').split('\r\n').join('\n');
        if (/\.cmd$/i.test(f)) text = text.split('\n').join('\r\n');
        fs.writeFileSync(path.join(DIST, f), text);
        if (/\.command$/.test(f)) { try { fs.chmodSync(path.join(DIST, f), 0o755); } catch (e) {} }
    }

    const mb = (fs.statSync(out).size / 1048576).toFixed(1);
    console.log('Done:', path.relative(ROOT, out), mb + ' MB, signature verified.');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
