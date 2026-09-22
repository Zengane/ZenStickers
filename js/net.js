/**
 * Zen Stickers - network. Node's https, not the page's fetch: no CORS rules to
 * trip over, redirects followed by hand, and every request has a time limit.
 */
(function () {
    'use strict';

    var https = require('https');
    var http  = require('http');
    var fs    = require('fs');
    var path  = require('path');
    var URL_  = require('url');

    /* Wikimedia asks every client for a descriptive User-Agent with a way to reach us. */
    var UA = 'ZenStickers/1.5 (Adobe CEP panel; https://github.com/Zengane/ZenStickers)';

    function request(url, opts, cb) {
        var redirects = opts.redirects === undefined ? 5 : opts.redirects;
        var done = false;
        function finish(err, res, body) { if (done) return; done = true; cb(err, res, body); }

        var u;
        try { u = new URL_.URL(url); } catch (e) { return finish(new Error('Bad address: ' + url)); }
        var lib = u.protocol === 'http:' ? http : https;
        var headers = { 'User-Agent': UA, 'Accept': opts.accept || '*/*' };
        for (var h in (opts.headers || {})) headers[h] = opts.headers[h];
        if (opts.body) { headers['Content-Type'] = opts.contentType || 'application/json'; headers['Content-Length'] = Buffer.byteLength(opts.body); }
        var req = lib.request(u, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: headers }, function (res) {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
                res.resume();
                var next = new URL_.URL(res.headers.location, url).toString();
                opts.redirects = redirects - 1;
                return request(next, opts, finish);
            }
            if (opts.method === 'HEAD') { res.resume(); return finish(null, res, null); }
            if (opts.stream) return finish(null, res, null);
            var chunks = [], size = 0, cap = opts.maxBytes || 400 * 1024 * 1024;
            res.on('data', function (c) {
                size += c.length;
                if (size > cap) { req.destroy(new Error('File is too big')); return; }
                chunks.push(c);
            });
            res.on('end', function () { finish(null, res, Buffer.concat(chunks)); });
            res.on('error', function (e) { finish(e); });
        });
        req.setTimeout(opts.timeout || 20000, function () { req.destroy(new Error('Timed out: ' + u.hostname)); });
        req.on('error', function (e) { finish(e); });
        req.end(opts.body || undefined);
    }

    var Net = {
        /* GET and parse JSON. HTTP errors carry the server's own message when it sent one. */
        json: function (url, timeout, extra) {
            return new Promise(function (resolve, reject) {
                var o = { timeout: timeout || 15000, accept: 'application/json' };
                for (var k in (extra || {})) o[k] = extra[k];
                request(url, o, function (err, res, body) {
                    if (err) return reject(err);
                    var data = null;
                    try { data = JSON.parse(body.toString('utf8')); } catch (e) {}
                    if (res.statusCode >= 400) {
                        var msg = data && (data.message || (data.meta && data.meta.msg) ||
                            (data.errors && JSON.stringify(data.errors))) || '';
                        return reject(new Error('HTTP ' + res.statusCode + (msg ? ': ' + msg : '')));
                    }
                    if (!data) return reject(new Error('The server did not send JSON.'));
                    resolve(data);
                });
            });
        },

        /* GET with extra headers (API keys that go in a header). */
        jsonWith: function (url, headers, timeout) { return Net.json(url, timeout, { headers: headers }); },

        /* POST a JSON body, parse the JSON answer. */
        post: function (url, body, headers, timeout) { return Net.json(url, timeout, { body: body, headers: headers }); },

        /* GET into memory. Resolves null on 404, so callers can try the next address. */
        buffer: function (url, timeout) {
            return new Promise(function (resolve, reject) {
                request(url, { timeout: timeout || 30000 }, function (err, res, body) {
                    if (err) return reject(err);
                    if (res.statusCode === 404 || res.statusCode === 403) return resolve(null);
                    if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode + ' from ' + new URL_.URL(url).hostname));
                    resolve({ body: body, type: String(res.headers['content-type'] || '') });
                });
            });
        },

        /* Stream to disk. Writes to .part, renames on success, deletes its own partial file on failure. */
        download: function (url, dest, onProgress) {
            return new Promise(function (resolve, reject) {
                request(url, { stream: true, timeout: 60000 }, function (err, res) {
                    if (err) return reject(err);
                    if (res.statusCode >= 400) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' downloading')); }
                    try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch (e) {}
                    var part = dest + '.part';
                    var out = fs.createWriteStream(part);
                    var total = Number(res.headers['content-length']) || 0, got = 0;
                    res.on('data', function (c) { got += c.length; if (onProgress && total) onProgress(got / total); });
                    res.on('error', function (e) { out.destroy(); try { fs.unlinkSync(part); } catch (x) {} reject(e); });
                    out.on('error', function (e) { try { fs.unlinkSync(part); } catch (x) {} reject(e); });
                    out.on('finish', function () {
                        try {
                            try { fs.unlinkSync(dest); } catch (x) {}
                            fs.renameSync(part, dest);
                            resolve(dest);
                        } catch (e) { reject(e); }
                    });
                    res.pipe(out);
                });
            });
        },

        query: function (o) {
            return Object.keys(o).filter(function (k) { return o[k] !== undefined && o[k] !== ''; })
                .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&');
        }
    };

    window.ZSNet = Net;
})();
