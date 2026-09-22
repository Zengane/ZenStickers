// Publishes dist/ as a GitHub release:   npm run release [-- --delete-old v1.2.3]
//
// Uses the GitHub sign-in that Git already holds (Git Credential Manager), read
// with `git credential fill`. The token is only sent to api.github.com and is
// never printed or written anywhere.
'use strict';
const fs = require('fs'), path = require('path'), https = require('https'), cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const REPO = 'Zengane/ZenStickers';

function token() {
    const out = cp.execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', cwd: ROOT });
    const m = out.match(/^password=(.+)$/m);
    if (!m) throw new Error('Git has no GitHub sign-in. Run "git push" once first.');
    return m[1].trim();
}

function api(method, url, body, headers) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const data = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
        const req = https.request(u, { method, headers: Object.assign({
            'User-Agent': 'zen-stickers-release', Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + TOKEN,
            'X-GitHub-Api-Version': '2022-11-28'
        }, data ? { 'Content-Length': data.length } : {}, headers || {}) }, res => {
            const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) {}
                if (res.statusCode >= 400) return reject(new Error(method + ' ' + u.pathname + ': HTTP ' + res.statusCode + ' ' + ((json && json.message) || text.slice(0, 200))));
                resolve(json);
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

let TOKEN = '';
(async () => {
    TOKEN = token();
    const version = fs.readFileSync(path.join(ROOT, 'CSXS', 'manifest.xml'), 'utf8').match(/ExtensionBundleVersion="([^"]+)"/)[1];
    const tag = 'v' + version;
    const files = fs.readdirSync(DIST).filter(f => fs.statSync(path.join(DIST, f)).isFile());
    if (!files.some(f => f === 'ZenStickers-' + version + '.zxp')) throw new Error('dist/ has no ZenStickers-' + version + '.zxp. Run npm run build:zxp first.');

    const releases = await api('GET', `https://api.github.com/repos/${REPO}/releases?per_page=50`);
    let rel = releases.find(r => r.tag_name === tag);
    const body = [
                '**Install:** download the `.zxp` and `Install-Windows.cmd` (or `Install-macOS.command`), put them in one folder, close Premiere Pro and After Effects, and double-click the installer. No admin rights and no Creative Cloud sign-in needed.',
                '',
                'Panel blank after installing? Run `Fix-blank-panel-Windows.cmd` (or the macOS one), then restart the app.',
                '',
                'Full instructions: [user guide](https://github.com/' + REPO + '/blob/main/docs/GUIDE.md)'
            ].join('\n')
        });
        console.log('Created release', tag);
    } else console.log('Release', tag, 'already exists: updating its files');

    /* Replace every file: remove the release's current files first, so renamed or
       dropped ones do not linger. */
    for (const a of (rel.assets || [])) await api('DELETE', `https://api.github.com/repos/${REPO}/releases/assets/${a.id}`);
    for (const f of files) {
        const buf = fs.readFileSync(path.join(DIST, f));
        const type = /\.zxp$/.test(f) ? 'application/zip' : 'application/octet-stream';
        const up = await api('POST', rel.upload_url.replace(/\{.*$/, '') + '?name=' + encodeURIComponent(f), buf, { 'Content-Type': type });
        console.log('  uploaded', up.name, (buf.length / 1048576).toFixed(1) + ' MB');
    }

    const i = process.argv.indexOf('--delete-old');
    if (i > 0 && process.argv[i + 1]) {
        const oldTag = process.argv[i + 1];
        const oldRel = releases.find(r => r.tag_name === oldTag);
        if (oldRel && oldTag !== tag) { await api('DELETE', `https://api.github.com/repos/${REPO}/releases/${oldRel.id}`); console.log('Deleted the old release', oldTag); }
        else console.log('No old release', oldTag, 'to delete');
    }
    console.log('Done:', rel.html_url);
})().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1; });
