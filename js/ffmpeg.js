/**
 * Zen Stickers - ffmpeg: find it, install it when missing (Windows), and make
 * looped copies of short clips.
 *
 * Where ffmpeg comes from, first that works:
 *   1. the path in Settings (GIFs and loops > ffmpeg)
 *   2. ffmpeg on the system PATH
 *   3. our own copy in %APPDATA%\Zengane\Zen Stickers\ffmpeg (downloaded once)
 * The download is the LGPL build from github.com/BtbN/FFmpeg-Builds (linked from
 * ffmpeg.org), checked against the release's own SHA-256 list, unpacked with
 * Windows' built-in tar. macOS: install ffmpeg yourself (brew install ffmpeg).
 *
 * The loop: `-stream_loop N-1` repeats the input inside ffmpeg, which decodes
 * GIF frame disposal and WebM (VP9) transparency properly. Anything that can be
 * see-through becomes ProRes 4444 with alpha (.mov); a plain MP4 is copied
 * without re-encoding.
 */
(function () {
    'use strict';

    var fs     = require('fs');
    var path   = require('path');
    var cp     = require('child_process');
    var crypto = require('crypto');
    var Store  = window.ZSStore;
    var Net    = window.ZSNet;

    var WIN = process.platform === 'win32';
    var BUILD = 'ffmpeg-n8.1-latest-win64-lgpl-8.1';
    var ZIP_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/' + BUILD + '.zip';
    var SUMS_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/checksums.sha256';
    var OWN_DIR = path.join(Store.DIR, 'ffmpeg');
    var EXE = WIN ? '.exe' : '';

    function exists(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

    function onPath(name) {
        try {
            var out = cp.execFileSync(WIN ? 'where.exe' : 'which', [name], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
            var first = String(out).split(/\r?\n/)[0].trim();
            return first && exists(first) ? first : '';
        } catch (e) { return ''; }
    }

    /* { ffmpeg, ffprobe, from } or null */
    var cached = null;
    function find(S) {
        if (cached && exists(cached.ffmpeg)) return cached;
        var custom = S && S.ffmpegPath ? String(S.ffmpegPath).trim() : '';
        var tries = [];
        if (custom) {
            var dir = /ffmpeg(\.exe)?$/i.test(custom) ? path.dirname(custom) : custom;
            tries.push({ ffmpeg: path.join(dir, 'ffmpeg' + EXE), ffprobe: path.join(dir, 'ffprobe' + EXE), from: 'your setting' });
        }
        var fp = onPath('ffmpeg');
        if (fp) tries.push({ ffmpeg: fp, ffprobe: onPath('ffprobe') || path.join(path.dirname(fp), 'ffprobe' + EXE), from: 'the system PATH' });
        tries.push({ ffmpeg: path.join(OWN_DIR, 'bin', 'ffmpeg' + EXE), ffprobe: path.join(OWN_DIR, 'bin', 'ffprobe' + EXE), from: 'Zen Stickers’ own copy' });
        for (var i = 0; i < tries.length; i++) if (exists(tries[i].ffmpeg) && exists(tries[i].ffprobe)) { cached = tries[i]; return cached; }
        return null;
    }

    function sha256(file) {
        return new Promise(function (resolve, reject) {
            var h = crypto.createHash('sha256');
            fs.createReadStream(file).on('data', function (d) { h.update(d); }).on('end', function () { resolve(h.digest('hex')); }).on('error', reject);
        });
    }

    /* Download, verify and unpack our own copy. Windows only. */
    var installing = null;
    function install(onStatus) {
        if (!WIN) return Promise.reject(new Error('ffmpeg is needed for loops. On macOS install it (brew install ffmpeg) or set its path in Settings.'));
        if (installing) return installing;
        var say = onStatus || function () {};
        var tmp = path.join(Store.cacheDir('tmp'), BUILD + '.zip');
        installing = Net.buffer(SUMS_URL, 30000).then(function (b) {
            if (!b) throw new Error('Could not get the ffmpeg checksums.');
            var line = b.body.toString('utf8').split(/\r?\n/).filter(function (l) { return l.indexOf(BUILD + '.zip') >= 0; })[0];
            if (!line) throw new Error('The ffmpeg build ' + BUILD + ' is no longer published.');
            var want = line.split(/\s+/)[0].toLowerCase();
            say('Downloading ffmpeg (once, about 100 MB)…');
            var lastPct = -1;
            return Net.download(ZIP_URL, tmp, function (f) { var pc = Math.floor(f * 100); if (pc !== lastPct) { lastPct = pc; say('Downloading ffmpeg ' + pc + '%'); } })
                .then(function () { return sha256(tmp); })
                .then(function (got) { if (got !== want) throw new Error('The ffmpeg download is damaged (checksum). Try again.'); });
        }).then(function () {
            say('Unpacking ffmpeg…');
            var stage = OWN_DIR + '.new';
            fs.rmSync(stage, { recursive: true, force: true });
            fs.mkdirSync(stage, { recursive: true });
            /* Windows 10 and 11 ship bsdtar in System32, which unpacks zip files. Name it by
               full path: another tar on the PATH (Git's) reads "C:" as a network host. */
            var sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
            try { cp.execFileSync(sysTar, ['-xf', tmp, '-C', stage], { windowsHide: true, timeout: 300000 }); }
            catch (eTar) {
                cp.execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:ZS_ZIP -DestinationPath $env:ZS_TO -Force'],
                    { windowsHide: true, timeout: 600000, env: Object.assign({}, process.env, { ZS_ZIP: tmp, ZS_TO: stage }) });
            }
            var inner = path.join(stage, BUILD);
            if (!exists(path.join(inner, 'bin', 'ffmpeg.exe'))) throw new Error('The ffmpeg download did not contain ffmpeg.exe.');
            fs.rmSync(OWN_DIR, { recursive: true, force: true });
            fs.renameSync(inner, OWN_DIR);
            fs.rmSync(stage, { recursive: true, force: true });
            try { fs.unlinkSync(tmp); } catch (e) {}
            installing = null;
            cached = { ffmpeg: path.join(OWN_DIR, 'bin', 'ffmpeg.exe'), ffprobe: path.join(OWN_DIR, 'bin', 'ffprobe.exe'), from: 'Zen Stickers’ own copy' };
            return cached;
        }, function (e) { installing = null; try { fs.unlinkSync(tmp); } catch (x) {} throw e; });
        return installing;
    }

    function ensure(S, onStatus) {
        var f = find(S);
        return f ? Promise.resolve(f) : install(onStatus);
    }

    function run(exe, args, timeout) {
        return new Promise(function (resolve, reject) {
            cp.execFile(exe, args, { windowsHide: true, timeout: timeout || 120000, maxBuffer: 8 * 1024 * 1024 }, function (err, so, se) {
                if (err) return reject(new Error(path.basename(exe) + ': ' + (String(se || '').trim().split(/\r?\n/).pop() || err.message)));
                resolve(String(so || ''));
            });
        });
    }

    /* { duration, fps, codec, alpha, audio } */
    function probe(ff, file) {
        return run(ff.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,r_frame_rate,avg_frame_rate,pix_fmt:stream_tags=alpha_mode',
                                '-of', 'json', file], 30000).then(function (out) {
            var j = JSON.parse(out), v = null, audio = false;
            (j.streams || []).forEach(function (s) { if (s.codec_type === 'video' && !v) v = s; if (s.codec_type === 'audio') audio = true; });
            var rate = function (r) { var p = String(r || '0/1').split('/'); return Number(p[0]) / (Number(p[1]) || 1); };
            var fps = v ? rate(v.avg_frame_rate) || rate(v.r_frame_rate) : 0;
            return {
                duration: Number(j.format && j.format.duration) || 0,
                fps: fps,
                codec: v ? v.codec_name : '',
                alpha: !!v && (v.codec_name === 'gif' || v.codec_name === 'png' || /a/.test(String(v.pix_fmt).replace('yuv', '')) ||
                        (v.tags && String(v.tags.alpha_mode) === '1')),
                audio: audio
            };
        });
    }

    /*
     * Make "<name> (loop xN).mov|mp4" next to the file. Resolves
     * { file, loops, cycle } or null when the clip is long enough already.
     */
    function loop(S, file, onStatus) {
        return ensure(S, onStatus).then(function (ff) {
            return probe(ff, file).then(function (p) {
                if (!(p.duration > 0) || p.duration >= S.loopUnder) return null;
                var n = Math.max(2, Math.ceil(S.loopTarget / p.duration - 1e-9));
                var copy = p.codec === 'h264' && !p.alpha;
                var out = file.replace(/\.[a-z0-9]+$/i, '') + ' (loop x' + n + ')' + (copy ? '.mp4' : '.mov');
                if (exists(out)) return { file: out, loops: n, cycle: p.duration, audio: p.audio && copy };
                if (onStatus) onStatus('Looping ' + path.basename(file) + ' ' + n + ' times…');
                var args = ['-v', 'error', '-y'];
                /* The built-in VP9 decoder drops WebM transparency; libvpx keeps it. */
                if (p.codec === 'vp9' && p.alpha) args.push('-c:v', 'libvpx-vp9');
                else if (p.codec === 'vp8' && p.alpha) args.push('-c:v', 'libvpx');
                args.push('-stream_loop', String(n - 1), '-i', file);
                if (copy) args.push('-c', 'copy', '-movflags', '+faststart');
                else {
                    var fps = p.fps >= 1 && p.fps <= 60 ? Math.round(p.fps * 1000) / 1000 : 30;
                    args.push('-vf', 'fps=' + fps + ',format=yuva444p10le', '-c:v', 'prores_ks', '-profile:v', '4444', '-vendor', 'apl0', '-an');
                }
                args.push(out + '.part.' + (copy ? 'mp4' : 'mov'));
                return run(ff.ffmpeg, args, 300000).then(function () {
                    fs.renameSync(out + '.part.' + (copy ? 'mp4' : 'mov'), out);
                    return { file: out, loops: n, cycle: p.duration, audio: p.audio && copy };
                });
            });
        });
    }

    window.ZSFfmpeg = { find: find, ensure: ensure, install: install, probe: probe, loop: loop, OWN_DIR: OWN_DIR, BUILD: BUILD };
})();
