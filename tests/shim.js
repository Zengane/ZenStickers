// Loads the panel's modules under Node with a tiny stand-in for the CEP window.
// Settings and caches go to a fresh temporary folder, never the real one.
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');

const ROOT = path.join(__dirname, '..');

function load(modules, opts) {
    opts = opts || {};
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-test-'));
    process.env.APPDATA = tmp;
    global.window = {
        __adobe_cep__: { getHostEnvironment: () => JSON.stringify({ appName: opts.host || 'PPRO' }), addEventListener() {} },
        location: { pathname: '/' + path.join(ROOT, 'index.html').split(path.sep).join('/') },
        addEventListener() {}
    };
    global.document = undefined;
    for (const m of modules) {
        const file = path.join(ROOT, 'js', m + '.js');
        delete require.cache[require.resolve(file)];
        require(file);
    }
    /* Windows can still hold a just-run program open for a moment: retry, then leave it to the temp cleaner. */
    const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) {} };
    return { window: global.window, tmp, cleanup };
}

/* The user's own keys, for the live tests only: from environment variables
   (ZS_GIPHYKEY=...) or, if present, this computer's Zen Stickers settings. */
function userKeys() {
    const out = {};
    const real = process.env.ZS_SETTINGS ||
        path.join(process.env.ZS_REAL_APPDATA || process.env.APPDATA || '', 'Zengane', 'Zen Stickers', 'settings.json');
    try { Object.assign(out, JSON.parse(fs.readFileSync(real, 'utf8'))); } catch (e) {}
    for (const k of Object.keys(process.env)) {
        const m = k.match(/^ZS_([A-Z]+KEY|GOOGLECX)$/);
        if (m) {
            const name = m[1].toLowerCase().replace(/key$/, 'Key').replace('googlecx', 'googleCx');
            out[name] = process.env[k];
        }
    }
    return out;
}

module.exports = { load, userKeys, ROOT };
