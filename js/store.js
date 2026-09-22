/**
 * Zen Stickers - shared storage. Loaded by the panel and the settings dialog;
 * they are separate CEF contexts, so files on disk are the only thing they
 * share. All settings schema and defaults live here and nowhere else.
 *
 *   %APPDATA%\Zengane\Zen Stickers\settings.json   settings (dialog)
 *   %APPDATA%\Zengane\Zen Stickers\state.json      panel state: tab, source, recents
 *   %APPDATA%\Zengane\Zen Stickers\cache\          finished emoji and icon files
 */
(function () {
    'use strict';

    var fs   = require('fs');
    var path = require('path');
    var os   = require('os');

    /* Windows: %APPDATA%. macOS: ~/Library/Application Support. */
    var APPDATA = process.env.APPDATA ||
        (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
    var DIR     = path.join(APPDATA, 'Zengane', 'Zen Stickers');
    var HOST    = 'PPRO';
    try { HOST = JSON.parse(window.__adobe_cep__.getHostEnvironment()).appName || 'PPRO'; } catch (e) {}

    var DEFAULTS = {
        giphyKey: '',
        klipyKey: '',
        klipyCustomer: '',
        unsplashKey: '',
        pexelsKey: '',
        pixabayKey: '',
        flickrKey: '',
        trending: false,          // show trending / popular when the search box is empty
        photoSize: 'large',       // large (about 2500 px) | original
        videoQuality: 'hd',       // sd (720p) | hd (1080p) | uhd (biggest)
        flickrFree: true,         // Flickr: only photos you may reuse (CC BY, CC BY-SA, CC0, public domain)
        rating: 'pg-13',          // g | pg | pg-13 | r
        click: 'place',           // place | import
        saveTo: 'project',        // project | folder
        folder: path.join(os.homedir(), 'Documents', 'Zen Stickers'),
        gifFormat: 'gif',         // gif | mp4 | webm (stickers: gif or webm, both keep transparency; mp4 cannot)
        loop: true,               // lay short moving clips as one looping clip
        loopUnder: 1,             // seconds: loop clips shorter than this
        loopTarget: 5,            // seconds: loop until at least this long
        loopMarker: 'first',      // none | first | every
        markerOn: 'clip',         // clip | timeline
        ffmpegPath: '',           // empty: PATH, then Zen Stickers' own copy (downloaded when first needed, Windows)
        emojiSize: 1024,          // 512 | 1024 | 2048
        upscale: true,            // AI upscale for Apple, Samsung, WhatsApp, Facebook
        aeShapes: false,          // After Effects: turn an imported SVG into a shape layer
        animate: 'all',           // all | hover
        theme: 'auto',            // auto | dark | light
        uiScale: 1
    };

    var STATE_DEFAULTS = {
        tab: 'gifs',
        source: { gifs: 'giphy', stickers: 'giphy', photos: 'openverse', videos: 'klipy', icons: 'iconify' },
        filters: {},              // the Google-style filter bar; kept until changed ("permanent")
        zoom: {},                 // per tab: 0.6 .. 2.4, 1 = normal
        vendor: 'apple',
        tone: 0,
        iconSet: '',
        iconColor: '#ffffff',
        recentEmoji: [],
        recentIcons: []
    };

    function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} }

    function readJson(file, fallback) {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
    }

    /* Write then rename, so a crash mid-write never leaves half a file. */
    function writeJson(file, obj) {
        ensureDir(path.dirname(file));
        var tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
        fs.renameSync(tmp, file);
    }

    var KEY_NAMES = ['giphyKey', 'klipyKey', 'unsplashKey', 'pexelsKey', 'pixabayKey', 'flickrKey'];

    function clamp(v, lo, hi, d) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; }
    function oneOf(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }

    function normalise(s) {
        var o = {};
        s = s || {};
        o.giphyKey = String(s.giphyKey || '').trim();
        o.klipyKey = String(s.klipyKey || '').trim();
        o.klipyCustomer = String(s.klipyCustomer || '').trim();
        KEY_NAMES.forEach(function (k) { o[k] = String(s[k] || '').trim(); });
        o.trending = !!s.trending;
        o.photoSize = oneOf(s.photoSize, ['large', 'original'], DEFAULTS.photoSize);
        o.videoQuality = oneOf(s.videoQuality, ['sd', 'hd', 'uhd'], DEFAULTS.videoQuality);
        o.flickrFree = s.flickrFree === undefined ? true : !!s.flickrFree;
        o.rating = oneOf(s.rating, ['g', 'pg', 'pg-13', 'r'], DEFAULTS.rating);
        o.click = oneOf(s.click, ['place', 'import'], DEFAULTS.click);
        o.saveTo = oneOf(s.saveTo, ['project', 'folder'], DEFAULTS.saveTo);
        o.folder = String(s.folder || DEFAULTS.folder);
        o.gifFormat = oneOf(s.gifFormat, ['gif', 'mp4', 'webm'], DEFAULTS.gifFormat);
        o.loop = s.loop === undefined ? true : !!s.loop;
        o.loopUnder = Math.round(clamp(s.loopUnder, 0.1, 30, 1) * 10) / 10;
        o.loopTarget = Math.round(clamp(s.loopTarget, 0.5, 120, 5) * 10) / 10;
        o.loopMarker = oneOf(s.loopMarker, ['none', 'first', 'every'], DEFAULTS.loopMarker);
        o.markerOn = oneOf(s.markerOn, ['clip', 'timeline'], DEFAULTS.markerOn);
        o.ffmpegPath = String(s.ffmpegPath || '').trim();
        o.emojiSize = oneOf(Number(s.emojiSize), [512, 1024, 2048], DEFAULTS.emojiSize);
        o.upscale = s.upscale === undefined ? DEFAULTS.upscale : !!s.upscale;
        o.aeShapes = !!s.aeShapes;
        o.animate = oneOf(s.animate, ['all', 'hover'], DEFAULTS.animate);
        o.theme = oneOf(s.theme, ['auto', 'dark', 'light'], DEFAULTS.theme);
        o.uiScale = Math.round(clamp(s.uiScale, 0.75, 2, 1) * 100) / 100;
        return o;
    }

    var Store = {
        KEYS: KEY_NAMES,
        DIR: DIR,
        HOST: HOST,
        AE: HOST === 'AEFT',
        DEFAULTS: DEFAULTS,
        cacheDir: function (sub) { var d = path.join(DIR, 'cache', sub || ''); ensureDir(d); return d; },

        loadSettings: function () {
            var s = normalise(readJson(path.join(DIR, 'settings.json'), {}));
            if (!s.klipyCustomer) {
                /* Klipy wants a stable per-user id; it never leaves this machine except to Klipy. */
                s.klipyCustomer = 'zen-' + Math.random().toString(36).slice(2, 12);
                Store.saveSettings(s);
            }
            return s;
        },
        saveSettings: function (s) {
            var n = normalise(s);
            writeJson(path.join(DIR, 'settings.json'), n);
            Store._selfWrite = Store.settingsTime();
            return n;
        },
        settingsTime: function () {
            try { return fs.statSync(path.join(DIR, 'settings.json')).mtimeMs; } catch (e) { return 0; }
        },
        normalise: normalise,

        loadState: function () {
            var s = readJson(path.join(DIR, 'state.json'), {});
            var o = JSON.parse(JSON.stringify(STATE_DEFAULTS));
            for (var k in s) if (Object.prototype.hasOwnProperty.call(o, k)) o[k] = s[k];
            if (!o.source || typeof o.source !== 'object') o.source = {};
            for (var t in STATE_DEFAULTS.source) if (!o.source[t]) o.source[t] = STATE_DEFAULTS.source[t];
            if (o.tab === 'clips') o.tab = 'videos';
            if (!o.filters || typeof o.filters !== 'object') o.filters = {};
            if (!o.zoom || typeof o.zoom !== 'object') o.zoom = {};
            return o;
        },
        saveState: function (st) {
            try { writeJson(path.join(DIR, 'state.json'), st); } catch (e) {}
        },

        applyTheme: applyTheme,

        /* Show a file in Explorer / Finder, or open a folder. */
        reveal: function (file) {
            var cp = require('child_process');
            if (process.platform === 'darwin') cp.execFile('open', ['-R', file]);
            else cp.execFile('explorer.exe', ['/select,', file]);
        },
        openDir: function (dir) {
            var cp = require('child_process');
            cp.execFile(process.platform === 'darwin' ? 'open' : 'explorer.exe', [dir]);
        },
        applyScale: function (scale) {
            document.body.style.zoom = scale === 1 ? '' : String(scale);
        }
    };

    /* Light or dark. "auto" follows the host app's panel colour, and the
       window background takes that exact colour (Zen Wheel's rule). */
    function hostPanelColor() {
        try {
            var c = JSON.parse(window.__adobe_cep__.getHostEnvironment()).appSkinInfo.panelBackgroundColor.color;
            return [c.red, c.green, c.blue];
        } catch (e) { return null; }
    }
    function applyTheme() {
        if (typeof document === 'undefined' || !document.documentElement) return;
        var pref = 'auto';
        try { pref = normalise(readJson(path.join(DIR, 'settings.json'), {})).theme; } catch (e) {}
        var host = hostPanelColor(), light = false;
        if (pref === 'light') light = true;
        else if (pref === 'auto' && host) light = (0.2126 * host[0] + 0.7152 * host[1] + 0.0722 * host[2]) / 255 > 0.5;
        var root = document.documentElement;
        root.setAttribute('data-theme', light ? 'light' : 'dark');
        if (pref === 'auto' && host) root.style.setProperty('--k232323', 'rgb(' + host.join(',') + ')');
        else root.style.removeProperty('--k232323');
    }

    /* Every window: no browser right-click menu, one slim scrollbar style. */
    (function windowChrome() {
        if (typeof document === 'undefined') return;
        document.addEventListener('contextmenu', function (e) {
            var t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            e.preventDefault();
        });
        var css = '::-webkit-scrollbar{width:9px;height:9px;background:transparent}' +
                  '::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}' +
                  '::-webkit-scrollbar-thumb{background:rgba(var(--hl, 255,255,255),.13);border-radius:6px;border:2px solid transparent;background-clip:padding-box}' +
                  '::-webkit-scrollbar-thumb:hover{background-color:rgba(var(--hl, 255,255,255),.26)}' +
                  '::-webkit-scrollbar-button{display:none;height:0;width:0}';
        function add() { var st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st); }
        if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
    })();

    if (typeof document !== 'undefined') {
        applyTheme();
        try { window.__adobe_cep__.addEventListener('com.adobe.csxs.events.ThemeColorChanged', applyTheme); } catch (e) {}
        try { window.addEventListener('focus', applyTheme); } catch (e) {}
    }

    window.ZSStore = Store;
})();
