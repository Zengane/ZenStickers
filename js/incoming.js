/**
 * Zen Stickers - pictures that come in from outside: dragged from a web
 * browser, dropped from Explorer / Finder, or pasted.
 *
 * What a browser hands over when you drag a picture varies:
 *   - a file (Explorer, Finder, some browsers)       -> use it
 *   - text/uri-list or text/plain with a link          -> download it
 *   - text/html with <img src=...>                     -> download that source
 *   - a Google result link (/imgres?imgurl=...)        -> the original picture
 *   - a data: URL (small inline pictures)              -> decode it
 * Pasting gives an image (copied picture, screenshot) or text with a link.
 * If the page cannot paste (CEP does not always allow it), the OS clipboard is
 * read directly: PowerShell on Windows, osascript on macOS.
 */
(function () {
    'use strict';

    var fs   = require('fs');
    var path = require('path');
    var cp   = require('child_process');
    var os   = require('os');
    var URL_ = require('url');
    var Net  = window.ZSNet;

    /* A Google result link points at Google; the picture is in imgurl=. */
    function unwrap(u) {
        try {
            var x = new URL_.URL(u);
            if (/(^|\.)google\./.test(x.hostname) && x.searchParams.get('imgurl')) return x.searchParams.get('imgurl');
            if (/(^|\.)bing\.com$/.test(x.hostname) && x.searchParams.get('mediaurl')) return x.searchParams.get('mediaurl');
            if (/(^|\.)duckduckgo\.com$/.test(x.hostname) && x.searchParams.get('u')) return x.searchParams.get('u');
        } catch (e) {}
        return u;
    }

    /* Google's result grid shows small JPEG copies (encrypted-tbn*.gstatic.com or
       inline data:image/jpeg). JPEG has no transparency, so a "transparent"
       result dragged from the grid arrives with a white or checkered background.
       Only the big picture shown after clicking a result is the original. */
    function isGoogleThumb(u) {
        return /^https?:\/\/encrypted-tbn\d*\.gstatic\.com\//i.test(u || '') || /^data:image\/jpe?g/i.test(u || '');
    }

    function firstUrl(text) {
        var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); })
            .filter(function (l) { return l && l.charAt(0) !== '#'; });
        for (var i = 0; i < lines.length; i++) if (/^(https?:|data:image\/)/i.test(lines[i])) return lines[i];
        return '';
    }

    function html(s) { return String(s).replace(/&amp;/g, '&'); }

    function imgFromHtml(html) {
        var m = String(html || '').match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
        return m ? m[1].replace(/&amp;/g, '&') : '';
    }

    /* Everything a drop or paste offers, best first. Returns [{file}|{url}|{blob}]. */
    function candidates(dt) {
        var out = [];
        if (!dt) return out;
        var files = dt.files || [];
        for (var i = 0; i < files.length; i++) {
            if (files[i].path) out.push({ file: files[i].path });
            else if (/^image\//.test(files[i].type)) out.push({ blob: files[i] });
        }
        if (dt.items) {
            for (var j = 0; j < dt.items.length; j++) {
                var it = dt.items[j];
                if (it.kind === 'file' && /^image\//.test(it.type) && !files.length) { var f = it.getAsFile(); if (f) out.push(f.path ? { file: f.path } : { blob: f }); }
            }
        }
        var get = function (t) { try { return dt.getData(t); } catch (e) { return ''; } };
        var links = [firstUrl(get('text/uri-list')), imgFromHtml(get('text/html')), firstUrl(get('text/plain'))];
        /* A link to a Google result wins over its tiny thumbnail. */
        links.sort(function (a, b) { return (/imgurl=/.test(b) ? 1 : 0) - (/imgurl=/.test(a) ? 1 : 0); });
        links.forEach(function (u) { if (u) out.push({ url: unwrap(u), thumb: isGoogleThumb(unwrap(u)) }); });
        /* Best first: a real file, then the original picture's address (full
           size, transparency intact), then raw picture bytes (a browser's
           "Copy image" can lose transparency on the way), then Google's small
           JPEG previews. */
        var rank = function (c) { return c.file ? 0 : c.thumb ? 3 : c.blob ? 2 : 1; };
        out = out.map(function (c, i) { return { c: c, i: i }; })
            .sort(function (a, b) { return rank(a.c) - rank(b.c) || a.i - b.i; })
            .map(function (x) { return x.c; });
        var seen = {};
        return out.filter(function (c) { var k = c.file || c.url || 'blob' + out.indexOf(c); if (seen[k]) return false; seen[k] = 1; return true; });
    }

    function blobToBuffer(blob) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve(Buffer.from(fr.result)); };
            fr.onerror = function () { reject(new Error('Could not read the picture.')); };
            fr.readAsArrayBuffer(blob);
        });
    }

    /* The OS clipboard, when the page's own paste gives nothing. */
    function osClipboard() {
        return new Promise(function (resolve) {
            var tmp = path.join(os.tmpdir(), 'zs-clip-' + Date.now() + '.png');
            if (process.platform === 'darwin') {
                var script = 'try\nset d to the clipboard as «class PNGf»\nset f to open for access POSIX file "' + tmp + '" with write permission\nwrite d to f\nclose access f\nreturn "IMG"\non error\nreturn "TXT|" & (the clipboard as text)\nend try';
                cp.execFile('osascript', ['-e', script], { timeout: 8000 }, function (err, so) {
                    so = String(so || '').trim();
                    if (so === 'IMG' && fs.existsSync(tmp)) return resolve({ file: tmp, temp: true });
                    if (/^TXT\|/.test(so)) { var u = firstUrl(so.slice(4)); return resolve(u ? { url: unwrap(u) } : null); }
                    resolve(null);
                });
                return;
            }
            /* Windows clipboard, best first. A browser's "Copy image" puts three
               things there: HTML with the picture's address, a "PNG" copy (keeps
               transparency) and a bitmap (GetImage: transparency is lost). */
            var tq = tmp.replace(/'/g, "''");
            var ps = 'Add-Type -AssemblyName System.Windows.Forms; ' +
                '$f = [Windows.Forms.Clipboard]::GetFileDropList(); if ($f.Count -gt 0) { "FILE|" + $f[0]; exit } ' +
                '$h = [Windows.Forms.Clipboard]::GetText([Windows.Forms.TextDataFormat]::Html); ' +
                'if ($h -match \'<img[^>]+src="(https?://[^"]+)"\') { "URL|" + $matches[1] } ' +
                '$d = [Windows.Forms.Clipboard]::GetData("PNG"); ' +
                'if ($d -is [IO.MemoryStream]) { [IO.File]::WriteAllBytes(\'' + tq + '\', $d.ToArray()); "PNG"; exit } ' +
                '$i = [Windows.Forms.Clipboard]::GetImage(); if ($i) { $i.Save(\'' + tq + '\', [Drawing.Imaging.ImageFormat]::Png); "IMG"; exit } ' +
                '$t = [Windows.Forms.Clipboard]::GetText(); "TEXT|" + $t';
            cp.execFile('powershell.exe', ['-NoProfile', '-Sta', '-Command', ps], { timeout: 8000, windowsHide: true }, function (err, so) {
                so = String(so || '').trim();
                var lines = so.split(/\r?\n/);
                if (/^FILE\|/.test(so)) return resolve({ file: so.slice(5).trim() });
                /* The picture's address wins when it is the original; the PNG copy is the fallback. */
                var urlLine = lines.filter(function (l) { return /^URL\|/.test(l); })[0];
                var url = urlLine ? html(urlLine.slice(4).trim()) : '';
                var bytes = (lines.indexOf('PNG') >= 0 || lines.indexOf('IMG') >= 0) && fs.existsSync(tmp) ? { file: tmp, temp: true, lossy: lines.indexOf('IMG') >= 0 } : null;
                if (url && !isGoogleThumb(url)) return resolve({ url: unwrap(url), then: bytes });
                if (bytes) return resolve(bytes);
                if (url) return resolve({ url: unwrap(url), thumb: true });
                if (so === 'IMG' && fs.existsSync(tmp)) return resolve({ file: tmp, temp: true });
                if (/^TEXT\|/.test(so)) { var u = firstUrl(so.slice(5)); return resolve(u ? { url: unwrap(u) } : null); }
                resolve(null);
            });
        });
    }

    /*
     * Turn one candidate into a file in dir. Returns the path.
     * Web pages (HTML) are refused with a clear message, not imported.
     */
    function save(c, dir, baseName, onProgress) {
        fs.mkdirSync(dir, { recursive: true });
        var d = new Date(), two = function (n) { return (n < 10 ? '0' : '') + n; };
        var stamp = d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + ' ' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
        var stem = path.join(dir, (baseName || 'Dropped') + ' ' + stamp);
        if (c.file) {
            var ext = path.extname(c.file) || '.bin';
            var dest = c.temp ? stem + ext : path.join(dir, path.basename(c.file));
            if (path.resolve(dest) !== path.resolve(c.file)) {
                if (!fs.existsSync(dest)) fs.copyFileSync(c.file, dest);
                if (c.temp) try { fs.unlinkSync(c.file); } catch (e) {}
            }
            return Promise.resolve(dest);
        }
        if (c.blob) return blobToBuffer(c.blob).then(function (b) { fs.writeFileSync(stem + '.bin', b); return stem + '.bin'; });
        if (/^data:image\//i.test(c.url)) {
            var m = c.url.match(/^data:image\/[a-z+.-]+;base64,(.*)$/i);
            if (!m) return Promise.reject(new Error('That picture could not be read.'));
            fs.writeFileSync(stem + '.bin', Buffer.from(m[1], 'base64'));
            return Promise.resolve(stem + '.bin');
        }
        return Net.download(c.url, stem + '.bin', onProgress).then(function (f) {
            var head = fs.readFileSync(f).slice(0, 512).toString('latin1');
            if (/<(!doctype|html|head)/i.test(head)) {
                fs.unlinkSync(f);
                throw new Error('That link is a web page, not a picture. Open the picture itself (for example "Open image in new tab") and drag that.');
            }
            return f;
        });
    }

    window.ZSIncoming = { isGoogleThumb: isGoogleThumb, candidates: candidates, osClipboard: osClipboard, save: save, unwrap: unwrap, firstUrl: firstUrl, imgFromHtml: imgFromHtml };
})();
