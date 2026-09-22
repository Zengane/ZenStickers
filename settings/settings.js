/**
 * Zen Stickers - settings dialog. A separate ModalDialog extension (house
 * pattern) sharing settings.json with the panel through store.js. Save writes
 * the file and sends an event; the panel also checks the file's time when it
 * gets focus, so a lost event costs nothing.
 */
(function () {
    'use strict';

    var cs = new CSInterface();
    var Store = window.ZSStore, Net = window.ZSNet;
    var s = Store.loadSettings();
    var $ = function (id) { return document.getElementById(id); };
    var KEYS = Store.KEYS;

    Store.applyScale(s.uiScale);

    function pick(group, v) {
        Array.prototype.forEach.call($(group).children, function (b) {
            b.classList.toggle('on', b.getAttribute('data-v') === String(v));
        });
    }

    function render() {
        pick('click', s.click);
        pick('saveTo', s.saveTo);
        pick('gifFormat', s.gifFormat);
        pick('rating', s.rating);
        pick('emojiSize', s.emojiSize);
        pick('upscale', s.upscale ? 'on' : 'off');
        pick('aeShapes', s.aeShapes ? 'on' : 'off');
        pick('theme', s.theme);
        pick('animate', s.animate);
        $('folder').value = s.folder;
        KEYS.forEach(function (k) { $(k).value = s[k] || ''; });
        pick('trending', s.trending ? 'on' : 'off');
        pick('photoSize', s.photoSize);
        pick('videoQuality', s.videoQuality);
        pick('flickrFree', s.flickrFree ? 'on' : 'off');
        pick('loop', s.loop ? 'on' : 'off');
        pick('loopMarker', s.loopMarker);
        pick('markerOn', s.markerOn);
        $('loopUnder').value = s.loopUnder;
        $('ffmpegPath').value = s.ffmpegPath || '';
        ffStatus();
        $('loopTarget').value = s.loopTarget;
        $('markerOn').classList.toggle('dim', s.loopMarker === 'none');
        $('ui').value = Math.round(s.uiScale * 100);
        $('ui-val').textContent = Math.round(s.uiScale * 100) + ' %';
    }

    function segBind(id, set) {
        Array.prototype.forEach.call($(id).children, function (b) {
            b.addEventListener('click', function () { set(b.getAttribute('data-v')); render(); });
        });
    }

    function bind() {
        var navs = document.querySelectorAll('.nav');
        Array.prototype.forEach.call(navs, function (b) {
            b.addEventListener('click', function () {
                Array.prototype.forEach.call(navs, function (x) { x.classList.toggle('on', x === b); });
                Array.prototype.forEach.call(document.querySelectorAll('.page'), function (p) {
                    p.classList.toggle('hidden', p.id !== 'page-' + b.getAttribute('data-page'));
                });
            });
        });
        segBind('click', function (v) { s.click = v; });
        segBind('saveTo', function (v) { s.saveTo = v; });
        segBind('gifFormat', function (v) { s.gifFormat = v; });
        segBind('rating', function (v) { s.rating = v; });
        segBind('emojiSize', function (v) { s.emojiSize = Number(v); });
        segBind('upscale', function (v) { s.upscale = v === 'on'; });
        segBind('aeShapes', function (v) { s.aeShapes = v === 'on'; });
        segBind('animate', function (v) { s.animate = v; });
        segBind('theme', function (v) {
            s.theme = v;
            /* Takes effect at once, here and in the panel. */
            try {
                var saved = Store.loadSettings(); saved.theme = v; Store.saveSettings(saved); Store.applyTheme();
                cs.dispatchEvent(new CSEvent('com.zengane.zenstickers.settings', 'APPLICATION', cs.getApplicationID(), cs.getExtensionID()));
            } catch (e) {}
        });
        $('folder').addEventListener('input', function () { s.folder = this.value; });
        KEYS.forEach(function (k) { $(k).addEventListener('input', function () { s[k] = this.value.trim(); }); });
        segBind('trending', function (v) { s.trending = v === 'on'; });
        segBind('photoSize', function (v) { s.photoSize = v; });
        segBind('videoQuality', function (v) { s.videoQuality = v; });
        segBind('flickrFree', function (v) { s.flickrFree = v === 'on'; });
        segBind('loop', function (v) { s.loop = v === 'on'; });
        segBind('loopMarker', function (v) { s.loopMarker = v; });
        segBind('markerOn', function (v) { s.markerOn = v; });
        $('ffmpegPath').addEventListener('change', function () { s.ffmpegPath = this.value.trim(); ffStatus(); });
        $('ff-install').addEventListener('click', function () {
            var b = this; b.disabled = true;
            window.ZSFfmpeg.install(function (m) { $('ff-status').textContent = m; })
                .then(function () { b.disabled = false; ffStatus(); }, function (e) { b.disabled = false; $('ff-status').textContent = 'Download failed: ' + e.message; });
        });
        $('loopUnder').addEventListener('change', function () { s.loopUnder = Number(this.value) || 1; });
        $('loopTarget').addEventListener('change', function () { s.loopTarget = Number(this.value) || 5; });
        $('browse').addEventListener('click', function () {
            try {
                var r = window.cep.fs.showOpenDialogEx(false, true, 'Save Zen Stickers files in', s.folder);
                if (r && r.data && r.data[0]) { s.folder = r.data[0]; render(); }
            } catch (e) {}
        });
        $('ui').addEventListener('input', function () {
            s.uiScale = Number(this.value) / 100;
            $('ui-val').textContent = this.value + ' %';
            Store.applyScale(s.uiScale);
        });
        $('test').addEventListener('click', test);
        $('open-guide').addEventListener('click', function () {
            try { cs.openURLInDefaultBrowser('https://github.com/Zengane/ZenStickers/blob/main/docs/GUIDE.md'); } catch (e) {}
        });
        /* "Get one" opens the sign-up page in the normal web browser. */
        Array.prototype.forEach.call(document.querySelectorAll('.getkey'), function (b) {
            b.addEventListener('click', function () {
                try { cs.openURLInDefaultBrowser(b.getAttribute('data-url')); }
                catch (e) { try { window.cep.util.openURLInDefaultBrowser(b.getAttribute('data-url')); } catch (x) {} }
            });
        });
        $('reset').addEventListener('click', function () {
            var keep = { klipyCustomer: s.klipyCustomer };
            KEYS.forEach(function (k) { keep[k] = s[k]; });
            s = Store.normalise(Object.assign({}, Store.DEFAULTS, keep));
            render();
            Store.applyScale(s.uiScale);
        });
        $('cancel').addEventListener('click', close);
        $('save').addEventListener('click', save);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    }

    /* One cheap request per key; each line says OK or why not. */
    function test() {
        var out = $('test-out');
        out.textContent = 'Testing…';
        function line(name, key, p) {
            if (!key) return Promise.resolve('<div><span class="faint">' + name + ': no key</span></div>');
            return p().then(function (r) {
                if (r && (r.result === false || r.stat === 'fail')) throw new Error(r.message || 'refused');
                return '<div><span class="good">' + name + ' OK</span></div>';
            }, function (e) { return '<div><span class="bad">' + name + ': ' + e.message + '</span></div>'; });
        }
        Promise.all([
            line('GIPHY', s.giphyKey, function () { return Net.json('https://api.giphy.com/v1/gifs/trending?' + Net.query({ api_key: s.giphyKey, limit: 1 })); }),
            line('KLIPY', s.klipyKey, function () { return Net.json('https://api.klipy.com/api/v1/' + encodeURIComponent(s.klipyKey) + '/gifs/trending?' + Net.query({ per_page: 1, customer_id: s.klipyCustomer || 'test' })); }),
            line('Unsplash', s.unsplashKey, function () { return Net.jsonWith('https://api.unsplash.com/photos?per_page=1', { Authorization: 'Client-ID ' + s.unsplashKey }); }),
            line('Pexels', s.pexelsKey, function () { return Net.jsonWith('https://api.pexels.com/v1/curated?per_page=1', { Authorization: s.pexelsKey }); }),
            line('Pixabay', s.pixabayKey, function () { return Net.json('https://pixabay.com/api/?' + Net.query({ key: s.pixabayKey, q: 'cat', per_page: 3 })); }),
            line('Flickr', s.flickrKey, function () { return Net.json('https://www.flickr.com/services/rest/?' + Net.query({ method: 'flickr.test.echo', api_key: s.flickrKey, format: 'json', nojsoncallback: 1 })); })
        ]).then(function (r) { out.innerHTML = r.join(''); });
    }

    function ffStatus() {
        var f = window.ZSFfmpeg.find(s);
        $('ff-status').textContent = f ? 'Using ffmpeg from ' + f.from + ': ' + f.ffmpeg : 'Not found yet. It will be downloaded the first time a loop needs it.';
    }

    function save() {
        try { Store.saveSettings(s); }
        catch (e) { $('save').textContent = 'Save failed'; return; }
        try { cs.dispatchEvent(new CSEvent('com.zengane.zenstickers.settings', 'APPLICATION', cs.getApplicationID(), cs.getExtensionID())); } catch (e) {}
        close();
    }

    function close() {
        try { cs.closeExtension(); } catch (e) { window.close(); }
    }

    try {
        var p = require('path').dirname(decodeURIComponent(window.location.pathname).replace(/^\/([A-Za-z]:)/, '$1'));
        var m = require('fs').readFileSync(require('path').join(p, '..', 'CSXS', 'manifest.xml'), 'utf8').match(/ExtensionBundleVersion="([^"]+)"/);
        if (m) $('ver').textContent = 'v' + m[1];
    } catch (e) {}

    bind();
    render();
})();
