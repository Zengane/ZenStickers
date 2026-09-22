/**
 * Zen Stickers - turns a picked item into a file on disk, ready to import.
 *
 *   GIFs / stickers / clips   downloaded as they are (GIF, or MP4 when set)
 *   icons                     After Effects: SVG.  Premiere: PNG drawn from the SVG.
 *   vector emojis             same as icons
 *   bitmap emojis             AI upscale (Real-ESRGAN, on the graphics card) to the
 *                             chosen size, then an exact high-quality downscale
 *
 * Finished emoji and icon files are cached in %APPDATA%\Zengane\Zen Stickers\cache,
 * then copied next to the project, so a project never points into the cache.
 */
(function () {
    'use strict';

    var fs    = require('fs');
    var path  = require('path');
    var cp    = require('child_process');
    var crypto = require('crypto');
    var Net   = window.ZSNet;
    var Store = window.ZSStore;
    var Emoji = window.ZSEmoji;

    var ESRGAN_DIR = path.join(Emoji.ROOT, 'bin', 'esrgan');
    var MAC = process.platform === 'darwin';
    var ESRGAN = MAC ? path.join(ESRGAN_DIR, 'mac', 'realesrgan-ncnn-vulkan') : path.join(ESRGAN_DIR, 'realesrgan-ncnn-vulkan.exe');
    /* A zip (ZXP) install can drop the executable bit on macOS. */
    if (MAC) { try { fs.chmodSync(ESRGAN, 493); } catch (e) {} }

    var FOLDERS = { gif: 'GIFs', sticker: 'Stickers', photo: 'Images', video: 'Videos', icon: 'Icons', vector: 'Vectors', emoji: 'Emojis', drop: 'Dropped' };

    function safe(s, max) {
        s = String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
        s = s.replace(/[. ]+$/, '');
        return (s || 'untitled').slice(0, max || 60).trim();
    }

    function outDir(kind, S, info) {
        var root = (S.saveTo === 'project' && info && info.saved && info.projectDir)
            ? path.join(info.projectDir, 'Zen Stickers') : S.folder;
        var d = path.join(root, FOLDERS[kind] || 'Other');
        fs.mkdirSync(d, { recursive: true });
        return d;
    }

    function exists(p) { try { return fs.statSync(p).size > 0; } catch (e) { return false; } }

    function copyIfNeeded(from, to) {
        if (!exists(to)) fs.copyFileSync(from, to);
        return to;
    }

    /* ---------------- canvas helpers ---------------- */

    function loadImage(src) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('The picture could not be read.')); };
            img.src = src;
        });
    }

    function canvasPng(canvas) {
        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (blob) {
                if (!blob) return reject(new Error('Could not make the PNG.'));
                var fr = new FileReader();
                fr.onload = function () { resolve(Buffer.from(fr.result)); };
                fr.onerror = function () { reject(new Error('Could not make the PNG.')); };
                fr.readAsArrayBuffer(blob);
            }, 'image/png');
        });
    }

    /* Give an SVG an explicit pixel size, keeping its shape. Without width and
       height, Chromium draws it at 0x0 or 150 px, and AE guesses its size. */
    function sizeSvg(text, px) {
        var m = text.match(/<svg\b[^>]*>/i);
        if (!m) throw new Error('Not an SVG file.');
        var tag = m[0];
        var vb = tag.match(/viewBox\s*=\s*["']\s*([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)/i);
        var w = 1, h = 1;
        if (vb) { w = parseFloat(vb[3]); h = parseFloat(vb[4]); }
        else {
            var ww = tag.match(/\swidth\s*=\s*["']([\d.]+)/i), hh = tag.match(/\sheight\s*=\s*["']([\d.]+)/i);
            if (ww && hh) { w = parseFloat(ww[1]); h = parseFloat(hh[1]); }
        }
        var sw, sh;
        if (w >= h) { sw = px; sh = Math.round(px * h / w); } else { sh = px; sw = Math.round(px * w / h); }
        var t2 = tag.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '');
        if (!vb && w && h) t2 = t2.replace(/<svg\b/i, '<svg viewBox="0 0 ' + w + ' ' + h + '"');
        t2 = t2.replace(/<svg\b/i, '<svg width="' + sw + '" height="' + sh + '"');
        return { text: text.replace(tag, t2), w: sw, h: sh };
    }

    function svgToPng(svgText, px) {
        var s = sizeSvg(svgText, px);
        var src = 'data:image/svg+xml;base64,' + Buffer.from(s.text, 'utf8').toString('base64');
        return loadImage(src).then(function (img) {
            var c = document.createElement('canvas');
            c.width = s.w; c.height = s.h;
            var g = c.getContext('2d');
            g.drawImage(img, 0, 0, s.w, s.h);
            return canvasPng(c);
        });
    }

    /* Redraw a PNG at an exact size (only ever used to shrink, or 1:1 to make it plain RGBA). */
    function resizePng(buf, px) {
        var src = 'data:image/png;base64,' + buf.toString('base64');
        return loadImage(src).then(function (img) {
            var w = img.naturalWidth, h = img.naturalHeight;
            var tw = px || w, th = px ? Math.round(px * h / w) : h;
            /* Halve in steps for big reductions: one 2.5x drawImage aliases. */
            var cur = img, cw = w, ch = h;
            while (cw / 2 >= tw) {
                var hc = document.createElement('canvas');
                hc.width = Math.round(cw / 2); hc.height = Math.round(ch / 2);
                var hg = hc.getContext('2d'); hg.imageSmoothingEnabled = true; hg.imageSmoothingQuality = 'high';
                hg.drawImage(cur, 0, 0, hc.width, hc.height);
                cur = hc; cw = hc.width; ch = hc.height;
            }
            var c = document.createElement('canvas');
            c.width = tw; c.height = th;
            var g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
            g.drawImage(cur, 0, 0, tw, th);
            return canvasPng(c);
        });
    }

    function pngSize(buf) {
        /* IHDR: width at byte 16, height at 20. */
        if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return { w: 0, h: 0 };
        return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }

    /* ---------------- upscaling ---------------- */

    function esrganOnce(inFile, outFile) {
        return new Promise(function (resolve, reject) {
            var args = ['-i', inFile, '-o', outFile, '-n', 'realesrgan-x4plus-anime', '-s', '4',
                        '-m', path.join(ESRGAN_DIR, 'models'), '-f', 'png'];
            cp.execFile(ESRGAN, args, { cwd: ESRGAN_DIR, windowsHide: true, timeout: 120000 }, function (err, so, se) {
                if (err) return reject(new Error('Upscaler failed: ' + (String(se || '').trim().split('\n').pop() || err.message)));
                if (!exists(outFile)) return reject(new Error('Upscaler made no file. ' + String(se || '').trim().split('\n').pop()));
                resolve(outFile);
            });
        });
    }

    /* 4x passes until the picture is at least the target size. 160 px: two passes (2560). */
    function upscale(buf, px, onStep) {
        var tmp = Store.cacheDir('tmp');
        var id = crypto.randomBytes(6).toString('hex');
        var files = [];
        function clean() { files.forEach(function (f) { try { fs.unlinkSync(f); } catch (e) {} }); }
        return resizePng(buf, 0).then(function (rgba) {       // plain 8-bit RGBA: the upscaler drops palette transparency
            var cur = path.join(tmp, id + '-0.png');
            fs.writeFileSync(cur, rgba); files.push(cur);
            var size = pngSize(rgba).w || 1, pass = 0;
            function step() {
                if (size >= px || pass >= 3) return Promise.resolve(cur);
                pass++;
                if (onStep) onStep(pass);
                var out = path.join(tmp, id + '-' + pass + '.png');
                files.push(out);
                return esrganOnce(cur, out).then(function () { cur = out; size *= 4; return step(); });
            }
            return step();
        }).then(function (last) {
            return resizePng(fs.readFileSync(last), px);
        }).then(function (b) { clean(); return b; }, function (e) { clean(); throw e; });
    }

    /* ---------------- per kind ---------------- */

    /* Premiere and After Effects cannot import WebP or AVIF: redraw those as PNG. */
    function toPngIfNeeded(file) {
        var buf = fs.readFileSync(file);
        var webp = buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
        var avif = buf.length > 12 && buf.toString('latin1', 4, 12).indexOf('ftypavi') === 0;
        if (!webp && !avif) return Promise.resolve(file);
        var mime = webp ? 'image/webp' : 'image/avif';
        return loadImage('data:' + mime + ';base64,' + buf.toString('base64')).then(function (img) {
            var c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            return canvasPng(c);
        }).then(function (png) {
            var out = file.replace(/\.[a-z0-9]+$/i, '') + '.png';
            fs.writeFileSync(out, png);
            try { fs.unlinkSync(file); } catch (e) {}
            return out;
        });
    }

    /* The file's real type from its first bytes: URLs often lie or say nothing. */
    function sniffExt(file, fallback) {
        var b = Buffer.alloc(16), fd = fs.openSync(file, 'r');
        try { fs.readSync(fd, b, 0, 16, 0); } finally { fs.closeSync(fd); }
        var a = b.toString('latin1');
        if (a.indexOf('GIF8') === 0) return 'gif';
        if (b[0] === 0x89 && a.substr(1, 3) === 'PNG') return 'png';
        if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
        if (a.substr(0, 4) === 'RIFF' && a.substr(8, 4) === 'WEBP') return 'webp';
        if (a.substr(4, 4) === 'ftyp') return /avif/.test(a) ? 'avif' : 'mp4';
        if (b[0] === 0x1a && b[1] === 0x45) return 'webm';
        return fallback;
    }

    /* Photos with a licence get a text file beside them saying who made them. */
    function writeCredit(file, item) {
        var c = item.credit;
        if (!c || (!c.author && !c.license)) return;
        var lines = [item.title || '', c.text || ('By ' + (c.author || 'unknown') + (c.license ? ', ' + c.license : '')),
                     'Source: ' + (c.link || item.link || ''), 'Found with Zen Stickers via ' + item.source];
        try { fs.writeFileSync(file.replace(/\.[a-z0-9]+$/i, '') + ' (credit).txt', lines.join(String.fromCharCode(13, 10)), 'utf8'); } catch (e) {}
    }

    /* SVG illustrations (Wikimedia, Openverse): After Effects gets the SVG with a
       real pixel size, Premiere gets a PNG drawn from it. */
    function vectorFile(item, S, info) {
        var dir = outDir('vector', S, info);
        var id = String(item.id).replace(/^[a-z0-9]+-/, '');
        var stem = safe(item.title, 50) + ' [' + item.source + ' ' + safe(id, 24) + ']';
        var svgPath = path.join(dir, stem + '.svg');
        var pngPath = path.join(dir, stem + ' ' + S.emojiSize + '.png');
        var want = Store.AE ? svgPath : pngPath;
        if (exists(want)) return Promise.resolve(want);
        return Net.buffer(item.files.svg, 60000).then(function (b) {
            if (!b) throw new Error('The SVG is gone from ' + item.source + '.');
            var text = b.body.toString('utf8');
            if (Store.AE) { fs.writeFileSync(svgPath, sizeSvg(text, S.emojiSize).text, 'utf8'); writeCredit(svgPath, item); return svgPath; }
            return svgToPng(text, S.emojiSize).then(function (png) { fs.writeFileSync(pngPath, png); writeCredit(pngPath, item); return pngPath; });
        });
    }

    /* A dropped or pasted file: name it by what its bytes are, make WebP/AVIF a PNG. */
    function fixIncoming(file) {
        var real = sniffExt(file, '');
        if (!real) {
            if (/\.(gif|png|jpe?g|mp4|mov|webm|svg|psd|tiff?|bmp|mp3|wav)$/i.test(file)) return Promise.resolve(file);
            try { fs.unlinkSync(file); } catch (e) {}
            return Promise.reject(new Error('That is not a picture or a video Zen Stickers knows.'));
        }
        var want = file.replace(/\.[a-z0-9]+$/i, '') + '.' + real;
        if (want !== file) { try { fs.unlinkSync(want); } catch (e) {} fs.renameSync(file, want); }
        return toPngIfNeeded(want);
    }

    function mediaFile(item, S, info, onProgress) {
        if (item.kind === 'vector') return vectorFile(item, S, info);
        var url, ext;
        var f = item.files || {};
        /* Stickers keep their see-through parts: GIF, or WebM when chosen and offered. MP4 cannot. */
        if (item.kind === 'sticker') { if (S.gifFormat === 'webm' && f.webm) { url = f.webm; ext = 'webm'; } else { url = f.gif; ext = 'gif'; } }
        else if (item.kind === 'gif' && S.gifFormat === 'webm' && f.webm) { url = f.webm; ext = 'webm'; }
        else if (item.kind === 'photo') { url = f.image; ext = 'jpg'; }
        else if (item.kind === 'video') { url = f.video || f.mp4 || f.gif; ext = (f.video || f.mp4) ? 'mp4' : 'gif'; }
        else if (S.gifFormat === 'mp4' && f.mp4) { url = f.mp4; ext = 'mp4'; }
        else { url = f.gif || f.mp4; ext = f.gif ? 'gif' : 'mp4'; }
        if (!url) return Promise.reject(new Error('This one has no file to download.'));
        var m = String(url).split('?')[0].match(/\.(gif|png|jpe?g|webp|mp4|webm|mov)$/i);
        if (m) ext = m[1].toLowerCase().replace('jpeg', 'jpg');
        var id = String(item.id).replace(/^[a-z0-9]+-/, '');
        var stem = safe(item.title, 50) + ' [' + item.source + ' ' + safe(id, 24) + ']';
        var dir = outDir(item.kind, S, info);
        var done = ['gif', 'png', 'jpg', 'mp4', 'webm', 'mov'].map(function (e) { return path.join(dir, stem + '.' + e); }).filter(exists)[0];
        var dest = path.join(dir, stem + '.' + ext);
        var got = done ? Promise.resolve(done) : Net.download(url, dest, onProgress);
        return got.then(function (file) {
            /* Rename to what the bytes really are, then make it importable. */
            var real = sniffExt(file, ext);
            if (real !== ext) {
                var fixed = path.join(dir, stem + '.' + real);
                try { fs.unlinkSync(fixed); } catch (e) {}
                fs.renameSync(file, fixed);
                file = fixed;
            }
            return toPngIfNeeded(file);
        }).then(function (file) {
            writeCredit(file, item);
            /* Still emotes and stickers are tiny (112-128 px): upscale them like emojis. */
            if (item.kind === 'sticker' && S.upscale && /\.png$/i.test(file)) {
                var buf = fs.readFileSync(file);
                if (pngSize(buf).w && pngSize(buf).w < 512) {
                    var big = file.replace(/\.png$/i, ' ' + S.emojiSize + '.png');
                    if (exists(big)) return big;
                    if (onProgress) onProgress(1);
                    return upscale(buf, S.emojiSize).then(function (png) { fs.writeFileSync(big, png); return big; }, function () { return file; });
                }
            }
            return file;
        });
    }

    function iconFile(item, color, S, info) {
        var ae = Store.AE;
        var parts = item.name.split(':');
        var base = safe(parts[0] + ' ' + parts[1], 70) + ' ' + (color || '').replace('#', '');
        var ext = ae ? 'svg' : 'png';
        var file = base + (ae ? '' : ' ' + S.emojiSize) + '.' + ext;
        var cache = path.join(Store.cacheDir('icons'), file);
        var dest = path.join(outDir('icon', S, info), file);
        if (exists(cache)) return Promise.resolve(copyIfNeeded(cache, dest));
        return window.ZSIconify.get(parts[0], parts[1]).then(function (ic) {
            if (!ic) throw new Error('Iconify has no ' + item.name + '.');
            var text = window.ZSIconify.svgText(ic, color, S.emojiSize);
            if (ae) { fs.writeFileSync(cache, text, 'utf8'); return cache; }
            return svgToPng(text, S.emojiSize).then(function (png) { fs.writeFileSync(cache, png); return cache; });
        }).then(function () { return copyIfNeeded(cache, dest); });
    }

    function emojiFile(vid, row, S, info, opts, onStatus) {
        var v = Emoji.vendor(vid);
        var ae = Store.AE;
        opts = opts || {};
        var label = safe(row.n, 60);
        var animated = !!(opts.animated && v.id === 'noto' && row.m);
        var ext = animated ? 'gif' : (v.kind === 'vector' && ae ? 'svg' : 'png');
        var sizeTag = ext === 'png' ? ' ' + S.emojiSize + (v.kind === 'bitmap' && !S.upscale ? 'src' : '') : '';
        var file = label + ' (' + v.name + (animated ? ' animated' : '') + ')' + sizeTag + '.' + ext;
        var cacheDir = Store.cacheDir(path.join('emoji', v.id));
        var cache = path.join(cacheDir, row.k + (animated ? '-anim' : '') + sizeTag.replace(' ', '_') + '.' + ext);
        var dest = path.join(outDir('emoji', S, info), file);
        if (exists(cache)) return Promise.resolve(copyIfNeeded(cache, dest));

        if (onStatus) onStatus('Getting ' + row.n + ' from ' + v.name + '…');
        return Emoji.source(vid, row, { animated: animated }).then(function (src) {
            if (src.kind === 'gif') { fs.writeFileSync(cache, src.body); return; }
            if (src.kind === 'svg') {
                var text = src.body.toString('utf8');
                if (ae) { fs.writeFileSync(cache, sizeSvg(text, S.emojiSize).text, 'utf8'); return; }
                return svgToPng(text, S.emojiSize).then(function (png) { fs.writeFileSync(cache, png); });
            }
            /* bitmap */
            if (!S.upscale) { fs.writeFileSync(cache, src.body); return; }
            if (pngSize(src.body).w >= S.emojiSize) {
                return resizePng(src.body, S.emojiSize).then(function (png) { fs.writeFileSync(cache, png); });
            }
            if (onStatus) onStatus('Upscaling ' + row.n + ' (' + pngSize(src.body).w + ' px to ' + S.emojiSize + ')…');
            return upscale(src.body, S.emojiSize, function (pass) {
                if (onStatus) onStatus('Upscaling ' + row.n + ', pass ' + pass + '…');
            }).then(function (png) { fs.writeFileSync(cache, png); }, function (err) {
                /* No graphics card the upscaler can use: keep the original rather than fail. */
                if (onStatus) onStatus(err.message + ' Using the original size.');
                fs.writeFileSync(cache.replace(/(\.png)$/, '-orig$1'), src.body);
                cache = cache.replace(/(\.png)$/, '-orig$1');
            });
        }).then(function () { return copyIfNeeded(cache, dest); });
    }

    window.ZSMedia = {
        mediaFile: mediaFile,
        fixIncoming: fixIncoming,
        iconFile: iconFile,
        emojiFile: emojiFile,
        upscale: upscale,
        svgToPng: svgToPng,
        resizeTo: resizePng,
        sniffExt: sniffExt,
        sizeSvg: sizeSvg,
        pngSize: pngSize,
        outDir: outDir,
        safe: safe
    };
})();
