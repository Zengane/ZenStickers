/**
 * Zen Stickers - where things come from.
 *
 * Every source answers page(query, pageIndex, settings) with
 *   { items: [...], more: bool, total?: n }
 * and every item has the same shape, so the grid never cares who sent it:
 *   { id, source, kind, title, thumb, still, w, h, files: { gif, mp4, image, video }, link, credit }
 *
 * kind: gif | sticker | photo | video
 * A source with `key` needs that settings field; `keyUrl` is where it is free to get.
 * A source with `trending: false` shows nothing until you type.
 */
(function () {
    'use strict';

    var Net = window.ZSNet;
    var PER_PAGE = 36;

    function need(S, src) {
        if (src.key && !S[src.key]) {
            var e = new Error('No ' + src.name + ' key yet. Add it in Settings > Sources (free at ' + src.keyUrl + ').');
            e.noKey = true;
            return Promise.reject(e);
        }
        return null;
    }

    /* The Google-style filter bar (Size, Colour, Type, Rights, Shape). Each source
       lists the ones it can honour in `filters`; the panel greys out the rest. */
    function FF(opt) { return (opt && opt.filters) || {}; }
    var COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'white', 'gray', 'black', 'brown'];

    function stripHtml(s) { return String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim(); }

    /* ---------------- GIPHY ---------------- */

    function giphyItem(d, kind) {
        var im = d.images || {};
        var fw = im.fixed_width || {}, fws = im.fixed_width_still || {}, orig = im.original || {};
        return {
            id: 'giphy-' + d.id, source: 'giphy', kind: kind,
            title: d.title || d.slug || d.id,
            thumb: fw.webp || fw.url || orig.url, still: fws.url || fw.url,
            w: Number(fw.width) || 200, h: Number(fw.height) || 200,
            files: { gif: orig.url, mp4: kind === 'sticker' ? '' : (orig.mp4 || '') },
            link: d.url
        };
    }

    function giphy(kind) {
        var ep = kind === 'sticker' ? 'stickers' : 'gifs';
        var src = {
            id: 'giphy', name: 'GIPHY', logo: 'giphy', color: '#121212', attribution: 'Powered by GIPHY',
            key: 'giphyKey', keyUrl: 'developers.giphy.com',
            page: function (q, n, S) {
                return need(S, src) || Net.json('https://api.giphy.com/v1/' + ep + '/' + (q ? 'search' : 'trending') + '?' + Net.query({
                    api_key: S.giphyKey, limit: PER_PAGE, offset: n * PER_PAGE, rating: S.rating, bundle: 'messaging_non_clips',
                    q: q || undefined, lang: q ? 'en' : undefined
                })).then(function (r) {
                    var p = r.pagination || {};
                    var items = (r.data || []).map(function (d) { return giphyItem(d, kind); });
                    return { items: items, total: p.total_count, more: (p.offset || 0) + (p.count || items.length) < (p.total_count || 0) };
                });
            }
        };
        return src;
    }

    /* ---------------- KLIPY ---------------- */

    var KLIPY_FILTER = { 'g': 'high', 'pg': 'medium', 'pg-13': 'low', 'r': 'off' };

    function klipyPick(f, fmt, order) {
        if (!f) return null;
        if (typeof f[fmt] === 'string') return { url: f[fmt] };
        for (var i = 0; i < order.length; i++) { var s = f[order[i]]; if (s && s[fmt] && s[fmt].url) return s[fmt]; }
        return null;
    }

    function klipyItem(d, kind) {
        var f = d.file || {};
        var small = ['sm', 'md', 'xs', 'hd'], big = ['hd', 'md', 'sm', 'xs'];
        var thumb = klipyPick(f, 'webp', small) || klipyPick(f, 'gif', small) || {};
        var still = klipyPick(f, 'jpg', small) || thumb;
        var gif = klipyPick(f, 'gif', big) || {}, mp4 = klipyPick(f, 'mp4', big) || {}, webm = klipyPick(f, 'webm', big) || {};
        var dims = (d.file_meta || {}).mp4 || (d.file_meta || {}).gif || {};
        return {
            id: 'klipy-' + d.id, source: 'klipy', kind: kind,
            title: d.title || d.slug || String(d.id),
            thumb: thumb.url, still: still.url,
            w: Number(thumb.width || dims.width) || 200, h: Number(thumb.height || dims.height) || 200,
            files: kind === 'video' ? { video: mp4.url || '', gif: gif.url || '' }
                                    : { gif: gif.url || '', mp4: kind === 'sticker' ? '' : (mp4.url || ''), webm: webm.url || '' },
            link: d.url || ''
        };
    }

    function klipy(kind) {
        var ep = kind === 'sticker' ? 'stickers' : kind === 'video' ? 'clips' : 'gifs';
        var src = {
            id: 'klipy', name: kind === 'video' ? 'KLIPY clips' : 'KLIPY', logo: 'K', color: '#6c47ff', attribution: 'Powered by KLIPY',
            key: 'klipyKey', keyUrl: 'klipy.com',
            page: function (q, n, S) {
                return need(S, src) || Net.json('https://api.klipy.com/api/v1/' + encodeURIComponent(S.klipyKey) + '/' + ep + '/' + (q ? 'search' : 'trending') + '?' + Net.query({
                    page: n + 1, per_page: PER_PAGE, customer_id: S.klipyCustomer, locale: 'en', content_filter: KLIPY_FILTER[S.rating], q: q || undefined
                })).then(function (r) {
                    if (r.result === false) throw new Error('KLIPY: ' + JSON.stringify(r.errors || r.message || 'refused'));
                    var d = r.data || {};
                    var items = (d.data || []).filter(function (x) { return x && x.file && x.type !== 'ad'; })
                        .map(function (x) { return klipyItem(x, kind); })
                        .filter(function (x) { return x.thumb && (x.files.gif || x.files.mp4 || x.files.video); });
                    return { items: items, more: !!d.has_next };
                });
            }
        };
        return src;
    }

    /* ---------------- Wikimedia Commons (GIFs and photos, no key) ---------------- */

    function commons(kind) {
        var src = {
            id: 'commons', name: kind === 'vector' ? 'Wikimedia SVG' : 'Wikimedia', logo: 'wikimediacommons', color: '#006699', attribution: 'Wikimedia Commons',
            trending: false,
            filters: kind === 'photo' ? ['color'] : [],
            page: function (q, n, S, opt) {
                if (!q) return Promise.resolve({ items: [], more: false, needQuery: true });
                var per = 40;
                var filter = kind === 'gif' ? ' filemime:image/gif' : kind === 'vector' ? ' filemime:image/svg+xml'
                    : (FF(opt).color === 'transparent' ? ' filemime:image/png' : ' filetype:bitmap -filemime:image/tiff -filemime:image/gif');
                return Net.json('https://commons.wikimedia.org/w/api.php?' + Net.query({
                    action: 'query', format: 'json', generator: 'search', gsrsearch: q + filter, gsrnamespace: 6,
                    gsrlimit: per, gsroffset: n * per, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata',
                    iiextmetadatafilter: 'Artist|LicenseShortName|ObjectName', iiurlwidth: 320
                })).then(function (r) {
                    var pages = (r.query && r.query.pages) ? Object.keys(r.query.pages).map(function (k) { return r.query.pages[k]; }) : [];
                    pages.sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
                    var items = pages.map(function (p) {
                        var ii = (p.imageinfo || [])[0];
                        if (!ii || !ii.url) return null;
                        var md = ii.extmetadata || {};
                        var title = (md.ObjectName && stripHtml(md.ObjectName.value)) || p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
                        return {
                            id: 'commons-' + p.pageid, source: 'commons', kind: kind, title: title,
                            thumb: ii.thumburl || ii.url, still: ii.thumburl || ii.url,
                            w: ii.thumbwidth || ii.width || 300, h: ii.thumbheight || ii.height || 300,
                            files: kind === 'gif' ? { gif: ii.url } : kind === 'vector' ? { svg: ii.url } : { image: ii.url },
                            link: ii.descriptionurl || '',
                            credit: { author: md.Artist ? stripHtml(md.Artist.value) : '', license: md.LicenseShortName ? md.LicenseShortName.value : '', link: ii.descriptionurl || '' }
                        };
                    }).filter(Boolean);
                    return { items: items, more: !!(r['continue'] && r['continue'].gsroffset) };
                });
            }
        };
        return src;
    }

    /* ---------------- 7TV emotes (stickers, no key) ---------------- */

    var seventv = {
        id: '7tv', name: '7TV emotes', logo: '7', color: '#29b6f6', attribution: '7TV',
        page: function (q, n) {
            var body = JSON.stringify({
                query: 'query($q:String!,$p:Int){emotes(query:$q,page:$p,limit:' + PER_PAGE + ',filter:{exact_match:false}){count items{id name animated host{url files{name format width height}}}}}',
                variables: { q: q || '', p: n + 1 }
            });
            return Net.post('https://7tv.io/v3/gql', body).then(function (r) {
                var e = r.data && r.data.emotes;
                if (!e) throw new Error('7TV: ' + JSON.stringify(r.errors || 'no answer').slice(0, 200));
                var items = (e.items || []).map(function (x) {
                    var base = 'https:' + x.host.url + '/';
                    var files = x.host.files || [];
                    var big = files.filter(function (f) { return f.name === '4x.' + (x.animated ? 'gif' : 'png'); })[0] || files[files.length - 1] || {};
                    return {
                        id: '7tv-' + x.id, source: '7tv', kind: 'sticker', title: x.name,
                        thumb: base + '2x.webp', still: base + '2x.webp', w: big.width || 128, h: big.height || 128,
                        files: { gif: base + (x.animated ? '4x.gif' : '4x.webp') },
                        link: 'https://7tv.app/emotes/' + x.id
                    };
                });
                return { items: items, total: e.count, more: (n + 1) * PER_PAGE < (e.count || 0) };
            });
        }
    };

    /* ---------------- Twitch emotes (no login) ---------------- */

    function emote(src, id, name, animated, thumb, file, where, link) {
        return { id: src + '-' + id, source: src, kind: 'sticker', title: name + (where ? ' (' + where + ')' : ''),
                 thumb: thumb, still: thumb, w: 1, h: 1, files: { gif: file }, link: link || '', animated: animated };
    }
    function twitchEmote(e, where) {
        var base = 'https://static-cdn.jtvnw.net/emoticons/v2/' + e.id + '/';
        return emote('twitch', e.id, e.code, e.assetType === 'ANIMATED', base + 'default/dark/2.0', base + 'default/dark/3.0', where);
    }
    function bttvEmote(e, where) {
        var base = 'https://cdn.betterttv.net/emote/' + e.id + '/';
        return emote('bttv', e.id, e.code, !!e.animated, base + '2x', base + (e.animated ? '3x.gif' : '3x.png'), where, 'https://betterttv.com/emotes/' + e.id);
    }
    function ffzEmote(e, where) {
        var a = e.animated;
        var file = a ? a['4'] || a['2'] || a['1'] : e.urls['4'] || e.urls['2'] || e.urls['1'];
        return emote('ffz', e.id, e.name, !!a, (e.urls['2'] || e.urls['1']), a ? file + '.gif' : file, where, 'https://www.frankerfacez.com/emoticon/' + e.id);
    }
    function sevenEmote(id, name, animated, where) {
        var base = 'https://cdn.7tv.app/emote/' + id + '/';
        return emote('7tv', id, name, animated, base + '2x.webp', base + (animated ? '4x.gif' : '4x.webp'), where, 'https://7tv.app/emotes/' + id);
    }
    function quiet(p) { return p.catch(function () { return null; }); }

    /* A channel's whole emote wall: Twitch subscriber and follower emotes (via
       the community API at ivr.fi), plus its 7TV, BetterTTV and FrankerFaceZ sets. */
    var twitchChannel = {
        id: 'twitch', name: 'Twitch channel', logo: 'twitch', color: '#9146ff', attribution: 'Twitch, 7TV, BTTV, FFZ',
        trending: false, hint: 'Type a Twitch channel name, like xqc.',
        page: function (q, n) {
            if (!q) return Promise.resolve({ items: [], more: false, needQuery: true });
            if (n > 0) return Promise.resolve({ items: [], more: false });
            var login = q.trim().toLowerCase().replace(/^.*twitch\.tv\//, '').replace(/[^a-z0-9_]/g, '');
            return Net.json('https://api.ivr.fi/v2/twitch/user?login=' + encodeURIComponent(login)).then(function (users) {
                var u = users && users[0];
                if (!u) throw new Error('No Twitch channel called "' + login + '".');
                var who = u.displayName || login;
                return Promise.all([
                    quiet(Net.json('https://api.ivr.fi/v2/twitch/emotes/channel/' + encodeURIComponent(login) + '?id=false')),
                    quiet(Net.json('https://7tv.io/v3/users/twitch/' + u.id)),
                    quiet(Net.json('https://api.betterttv.net/3/cached/users/twitch/' + u.id)),
                    quiet(Net.json('https://api.frankerfacez.com/v1/room/id/' + u.id))
                ]).then(function (r) {
                    var items = [], seen = {};
                    function add(it) { if (it && !seen[it.id]) { seen[it.id] = 1; items.push(it); } }
                    var tw = r[0] || {};
                    (tw.subProducts || []).forEach(function (p) { (p.emotes || []).forEach(function (e) { add(twitchEmote(e, 'Twitch tier ' + String(p.tier || '1000').charAt(0))); }); });
                    (tw.localEmotes || []).forEach(function (p) { (p.emotes || []).forEach(function (e) { add(twitchEmote(e, 'Twitch follower')); }); });
                    (tw.bitEmotes || []).forEach(function (e) { if (e && e.id) add(twitchEmote(e, 'Twitch bits')); });
                    var sv = r[1] && r[1].emote_set;
                    ((sv && sv.emotes) || []).forEach(function (e) { add(sevenEmote(e.id, e.name, !!(e.data && e.data.animated), '7TV')); });
                    var bt = r[2] || {};
                    (bt.channelEmotes || []).concat(bt.sharedEmotes || []).forEach(function (e) { add(bttvEmote(e, 'BTTV')); });
                    var fz = r[3];
                    if (fz && fz.sets) Object.keys(fz.sets).forEach(function (k) { (fz.sets[k].emoticons || []).forEach(function (e) { add(ffzEmote(e, 'FFZ')); }); });
                    if (!items.length) throw new Error(who + ' has no emotes on Twitch, 7TV, BTTV or FFZ.');
                    return { items: items, total: items.length, more: false, label: who };
                });
            });
        }
    };

    var ffz = {
        id: 'ffz', name: 'FrankerFaceZ', logo: 'Z', color: '#3a3a3a', attribution: 'FrankerFaceZ',
        page: function (q, n) {
            return Net.json('https://api.frankerfacez.com/v1/emotes?' + Net.query({ q: q || undefined, sort: 'count-desc', per_page: PER_PAGE, page: n + 1, sensitive: 'false' }))
                .then(function (r) {
                    return { items: (r.emoticons || []).map(function (e) { return ffzEmote(e, ''); }), total: r._total, more: n + 1 < (r._pages || 0) };
                });
        }
    };

    /* ---------------- emoji.gg (stickers, no key: one list, searched here) ---------------- */

    var eggList = null;
    var emojigg = {
        id: 'emojigg', name: 'emoji.gg', logo: 'discord', color: '#5865f2', attribution: 'emoji.gg',
        page: function (q, n) {
            var got = eggList ? Promise.resolve(eggList) : Net.json('https://emoji.gg/api/', 30000).then(function (d) { eggList = d || []; return eggList; });
            return got.then(function (all) {
                var words = String(q || '').toLowerCase().split(/[\s_-]+/).filter(Boolean);
                var hits = !words.length ? all.filter(function (e) { return /\.gif$/i.test(e.image); }) : all.filter(function (e) {
                    var t = (e.title + ' ' + (e.description || '').split(' is a ')[0]).toLowerCase();
                    for (var i = 0; i < words.length; i++) if (t.indexOf(words[i]) < 0) return false;
                    return true;
                });
                var slice = hits.slice(n * PER_PAGE, (n + 1) * PER_PAGE);
                return {
                    items: slice.map(function (e) {
                        return { id: 'emojigg-' + e.id, source: 'emojigg', kind: 'sticker', title: e.title, thumb: e.image, still: e.image,
                                 w: 1, h: 1, files: { gif: e.image }, link: 'https://emoji.gg/emoji/' + e.slug };
                    }),
                    total: hits.length, more: (n + 1) * PER_PAGE < hits.length
                };
            });
        }
    };

    /* ---------------- Unsplash (photos) ---------------- */

    var unsplash = {
        filters: ['color', 'orient'],
        id: 'unsplash', name: 'Unsplash', logo: 'unsplash', color: '#000000', attribution: 'Photos from Unsplash',
        key: 'unsplashKey', keyUrl: 'unsplash.com/developers',
        page: function (q, n, S, opt) {
            var no = need(S, unsplash); if (no) return no;
            var f = FF(opt);
            var ucol = f.color === 'bw' ? 'black_and_white' : f.color === 'pink' ? 'magenta' :
                (COLORS.indexOf(f.color) >= 0 && f.color !== 'gray' && f.color !== 'brown' ? f.color : undefined);
            var uori = f.orient === 'square' ? 'squarish' : (f.orient || undefined);
            var url = q ? 'https://api.unsplash.com/search/photos?' + Net.query({ query: q, page: n + 1, per_page: 30, content_filter: S.rating === 'r' ? 'low' : 'high', color: ucol, orientation: uori })
                        : 'https://api.unsplash.com/photos?' + Net.query({ page: n + 1, per_page: 30 });
            return Net.jsonWith(url, { Authorization: 'Client-ID ' + S.unsplashKey, 'Accept-Version': 'v1' }).then(function (r) {
                var list = q ? (r.results || []) : (r || []);
                return {
                    items: list.map(function (p) {
                        return {
                            id: 'unsplash-' + p.id, source: 'unsplash', kind: 'photo',
                            title: p.alt_description || p.description || ('Photo by ' + (p.user && p.user.name)),
                            thumb: p.urls.small, still: p.urls.small, w: p.width, h: p.height,
                            files: { image: S.photoSize === 'original' ? p.urls.full : p.urls.raw + '&w=2560&q=90&fm=jpg' },
                            link: p.links && p.links.html,
                            track: p.links && p.links.download_location,
                            credit: { author: p.user && p.user.name, license: 'Unsplash License', link: p.links && p.links.html }
                        };
                    }),
                    total: r.total, more: q ? n + 1 < (r.total_pages || 0) : list.length > 0
                };
            });
        },
        /* Unsplash's rules: tell them when a photo is actually used. */
        used: function (item, S) {
            if (item.track) Net.jsonWith(item.track, { Authorization: 'Client-ID ' + S.unsplashKey }).catch(function () {});
        }
    };

    /* ---------------- Pexels (photos, videos) ---------------- */

    function pexels(kind) {
        var src = {
            filters: kind === 'video' ? ['size', 'orient'] : ['size', 'color', 'orient'],
            id: 'pexels', name: 'Pexels', logo: 'pexels', color: '#05a081', attribution: 'Photos and videos from Pexels',
            key: 'pexelsKey', keyUrl: 'pexels.com/api',
            page: function (q, n, S, opt) {
                var no = need(S, src); if (no) return no;
                var f = FF(opt);
                var pcol = { teal: 'turquoise', purple: 'violet' }[f.color] || (COLORS.indexOf(f.color) >= 0 ? f.color : undefined);
                var psize = { large: 'large', medium: 'medium', icon: 'small' }[f.size];
                var base = kind === 'video' ? 'https://api.pexels.com/videos/' : 'https://api.pexels.com/v1/';
                var url = base + (q ? 'search' : (kind === 'video' ? 'popular' : 'curated')) + '?' + Net.query({ query: q || undefined, page: n + 1, per_page: 30,
                    color: q && kind !== 'video' ? pcol : undefined, size: q ? psize : undefined, orientation: q ? (f.orient || undefined) : undefined });
                return Net.jsonWith(url, { Authorization: S.pexelsKey }).then(function (r) {
                    var list = kind === 'video' ? (r.videos || []) : (r.photos || []);
                    return {
                        items: list.map(function (p) {
                            if (kind === 'video') {
                                var file = pickVideo(p.video_files || [], S.videoQuality, function (f) { return { url: f.link, w: f.width, h: f.height }; });
                                return {
                                    id: 'pexels-v' + p.id, source: 'pexels', kind: 'video', title: 'Video by ' + (p.user && p.user.name),
                                    thumb: p.image, still: p.image, w: p.width, h: p.height, duration: p.duration,
                                    files: { video: file && file.url }, link: p.url,
                                    credit: { author: p.user && p.user.name, license: 'Pexels License', link: p.url }
                                };
                            }
                            return {
                                id: 'pexels-' + p.id, source: 'pexels', kind: 'photo', title: p.alt || ('Photo by ' + p.photographer),
                                thumb: p.src.medium, still: p.src.medium, w: p.width, h: p.height,
                                files: { image: S.photoSize === 'original' ? p.src.original : p.src.large2x }, link: p.url,
                                credit: { author: p.photographer, license: 'Pexels License', link: p.url }
                            };
                        }),
                        total: r.total_results, more: !!r.next_page
                    };
                });
            }
        };
        return src;
    }

    /* Pick a video file by quality: uhd = biggest, hd = up to 1080p, sd = up to 720p. */
    function pickVideo(files, q, map) {
        var list = files.map(map).filter(function (f) { return f && f.url; });
        if (!list.length) return null;
        list.sort(function (a, b) { return (b.h || 0) - (a.h || 0); });
        if (q === 'uhd') return list[0];
        var cap = q === 'sd' ? 720 : 1080;
        for (var i = 0; i < list.length; i++) if (Math.min(list[i].w || 0, list[i].h || 0) <= cap) return list[i];
        return list[list.length - 1];
    }

    /* ---------------- Pixabay (photos, videos) ---------------- */

    function pixabay(kind) {
        var src = {
            filters: kind === 'video' ? ['size', 'orient'] : ['size', 'color', 'type', 'orient'],
            id: 'pixabay', name: 'Pixabay', logo: 'pixabay', color: '#2ec66d', attribution: 'Images from Pixabay',
            key: 'pixabayKey', keyUrl: 'pixabay.com/api/docs',
            page: function (q, n, S, opt) {
                var no = need(S, src); if (no) return no;
                var f = FF(opt);
                var url = 'https://pixabay.com/api/' + (kind === 'video' ? 'videos/' : '') + '?' + Net.query({
                    key: S.pixabayKey, q: q || undefined, page: n + 1, per_page: 30, safesearch: S.rating === 'r' ? 'false' : 'true',
                    order: q ? 'popular' : 'latest',
                    image_type: kind === 'video' ? undefined : ({ photo: 'photo', clipart: 'illustration', lineart: 'illustration', vector: 'vector' }[f.type] || 'all'),
                    colors: kind === 'video' ? undefined : ({ transparent: 'transparent', bw: 'grayscale', teal: 'turquoise', purple: 'lilac' }[f.color] ||
                        (COLORS.indexOf(f.color) >= 0 ? f.color : undefined)),
                    orientation: { landscape: 'horizontal', portrait: 'vertical' }[f.orient],
                    min_width: { large: 1920, medium: 800 }[f.size]
                });
                return Net.json(url).then(function (r) {
                    return {
                        items: (r.hits || []).map(function (h) {
                            if (kind === 'video') {
                                var v = h.videos || {};
                                var file = pickVideo(['large', 'medium', 'small', 'tiny'].map(function (k) { return v[k]; }).filter(Boolean), S.videoQuality,
                                    function (f) { return { url: f.url, w: f.width, h: f.height }; });
                                var th = (v.small && v.small.thumbnail) || (v.tiny && v.tiny.thumbnail) || '';
                                return {
                                    id: 'pixabay-v' + h.id, source: 'pixabay', kind: 'video', title: h.tags || ('Video by ' + h.user),
                                    thumb: th, still: th, w: (v.small || {}).width || 16, h: (v.small || {}).height || 9, duration: h.duration,
                                    files: { video: file && file.url }, link: h.pageURL,
                                    credit: { author: h.user, license: 'Pixabay Content License', link: h.pageURL }
                                };
                            }
                            return {
                                id: 'pixabay-' + h.id, source: 'pixabay', kind: 'photo', title: h.tags || ('Image by ' + h.user),
                                thumb: h.webformatURL, still: h.webformatURL, w: h.imageWidth, h: h.imageHeight,
                                files: { image: h.largeImageURL }, link: h.pageURL,
                                credit: { author: h.user, license: 'Pixabay Content License', link: h.pageURL }
                            };
                        }),
                        total: r.totalHits, more: (n + 1) * 30 < (r.totalHits || 0)
                    };
                });
            }
        };
        return src;
    }

    /* Openverse's own thumbnail server counts against the anonymous limit of
       20 requests a minute, so a grid of 20 goes blank. Ask the original site
       for a small copy instead, and keep Openverse's as the fallback. */
    function ovThumb(p) {
        var u = String(p.url || '');
        var fl = u.match(/^(https:\/\/live\.staticflickr\.com\/\d+\/\d+_[0-9a-f]+)(_[a-z])?\.(jpg|png)$/i);
        if (fl) return fl[1] + '_n.' + fl[3];
        var wm = u.match(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(?:[0-9a-f]\/[0-9a-f]{2}\/)([^?#]+)$/i);
        if (wm) return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + wm[1] + '?width=330';
        return p.thumbnail || u;
    }

    /* ---------------- Openverse (photos, no key: Creative Commons from Flickr, Wikimedia and more) ----------------
       Anonymous use: at most 20 per page, 20 requests a minute, 200 a day (per user). */

    var openverse = {
        filters: ['size', 'color', 'type', 'rights', 'orient'],
        id: 'openverse', name: 'Openverse', logo: 'openverse', color: '#ffe033', ink: '#000', attribution: 'Openverse (Creative Commons)',
        trending: false,
        page: function (q, n, S, opt) {
            if (!q) return Promise.resolve({ items: [], more: false, needQuery: true });
            var f = FF(opt);
            return Net.json('https://api.openverse.org/v1/images/?' + Net.query({ q: q, page: n + 1, page_size: 20, mature: S.rating === 'r' ? 'true' : undefined,
                size: { large: 'large', medium: 'medium', icon: 'small' }[f.size],
                aspect_ratio: { landscape: 'wide', portrait: 'tall', square: 'square' }[f.orient],
                license_type: { reuse: 'modification', commercial: 'commercial' }[f.rights],
                category: { photo: 'photograph', clipart: 'illustration', lineart: 'illustration' }[f.type],
                extension: f.color === 'transparent' ? 'png' : (f.type === 'vector' ? 'svg' : (f.type === 'animated' ? 'gif' : undefined)) }))
                .then(function (r) {
                    return {
                        items: (r.results || []).map(function (p) {
                            return {
                                id: 'openverse-' + p.id, source: 'openverse', kind: 'photo', title: p.title || 'Untitled',
                                thumb: ovThumb(p), still: ovThumb(p), alt: p.thumbnail, w: p.width || 4, h: p.height || 3,
                                files: { image: p.url }, link: p.foreign_landing_url,
                                credit: { author: p.creator, license: 'CC ' + String(p.license || '').toUpperCase() + ' ' + (p.license_version || ''), link: p.foreign_landing_url, text: p.attribution }
                            };
                        }),
                        total: r.result_count, more: n + 1 < (r.page_count || 0)
                    };
                });
        }
    };

    /* ---------------- Flickr (photos) ---------------- */

    var flickr = {
        filters: ['orient'],
        id: 'flickr', name: 'Flickr', logo: 'flickr', color: '#0063dc', attribution: 'Photos from Flickr',
        key: 'flickrKey', keyUrl: 'flickr.com/services/apps/create',
        page: function (q, n, S, opt) {
            var no = need(S, flickr); if (no) return no;
            var f = FF(opt);
            var LIC = { '1': 'CC BY-NC-SA 2.0', '2': 'CC BY-NC 2.0', '3': 'CC BY-NC-ND 2.0', '4': 'CC BY 2.0', '5': 'CC BY-SA 2.0', '6': 'CC BY-ND 2.0',
                        '7': 'No known copyright', '9': 'CC0', '10': 'Public Domain' };
            return Net.json('https://www.flickr.com/services/rest/?' + Net.query({
                method: q ? 'flickr.photos.search' : 'flickr.interestingness.getList', api_key: S.flickrKey, text: q || undefined,
                format: 'json', nojsoncallback: 1, per_page: 30, page: n + 1, sort: q ? 'relevance' : undefined,
                license: q && S.flickrFree ? '4,5,7,9,10' : undefined, safe_search: S.rating === 'r' ? 3 : 1, media: 'photos',
                extras: 'url_q,url_m,url_l,url_k,url_o,owner_name,license,o_dims',
                orientation: q ? f.orient || undefined : undefined
            })).then(function (r) {
                if (r.stat === 'fail') throw new Error('Flickr: ' + r.message);
                var ph = r.photos || {};
                return {
                    items: (ph.photo || []).map(function (p) {
                        var big = p.url_o || p.url_k || p.url_l || p.url_m;
                        var page = 'https://www.flickr.com/photos/' + p.owner + '/' + p.id;
                        return {
                            id: 'flickr-' + p.id, source: 'flickr', kind: 'photo', title: p.title || 'Untitled',
                            thumb: p.url_m || p.url_q, still: p.url_m || p.url_q, w: Number(p.width_m) || 4, h: Number(p.height_m) || 3,
                            files: { image: big }, link: page,
                            credit: { author: p.ownername, license: LIC[p.license] || 'All rights reserved', link: page }
                        };
                    }).filter(function (x) { return x.files.image; }),
                    total: Number(ph.total) || 0, more: (ph.page || 1) < (ph.pages || 0)
                };
            });
        }
    };

    /* ---------------- Openverse SVG (vectors, no key) ---------------- */

    var openverseSvg = {
        id: 'openversesvg', name: 'Openverse SVG', logo: 'openverse', color: '#ffe033', ink: '#000', attribution: 'Openverse (Creative Commons)',
        trending: false,
        page: function (q, n) {
            if (!q) return Promise.resolve({ items: [], more: false, needQuery: true });
            return Net.json('https://api.openverse.org/v1/images/?' + Net.query({ q: q, page: n + 1, page_size: 20, extension: 'svg' })).then(function (r) {
                return {
                    items: (r.results || []).map(function (p) {
                        return {
                            id: 'openversesvg-' + p.id, source: 'openversesvg', kind: 'vector', title: p.title || 'Untitled',
                            thumb: ovThumb(p), still: ovThumb(p), alt: p.thumbnail, w: p.width || 1, h: p.height || 1,
                            files: { svg: p.url }, link: p.foreign_landing_url,
                            credit: { author: p.creator, license: 'CC ' + String(p.license || '').toUpperCase() + ' ' + (p.license_version || ''), link: p.foreign_landing_url, text: p.attribution }
                        };
                    }),
                    total: r.result_count, more: n + 1 < (r.page_count || 0)
                };
            });
        }
    };

    /* ---------------- Google Images, in your own web browser ----------------
       No scraping: Google forbids it and blocks it. This opens the real Google
       Images page in the default browser with the filter bar already applied
       (the same "tbs" settings Google's Tools row writes), and the user drags or
       pastes the picture they want back into the panel. */

    var GOOGLE_COLOR = { red: 1, orange: 1, yellow: 1, green: 1, teal: 1, blue: 1, purple: 1, pink: 1, white: 1, gray: 1, black: 1, brown: 1 };
    function googleUrl(q, f, kind, S) {
        f = f || {};
        var tbs = [];
        var size = { large: 'isz:l', medium: 'isz:m', icon: 'isz:i' }[f.size];
        if (size) tbs.push(size);
        if (f.color === 'transparent') tbs.push('ic:trans');
        else if (f.color === 'bw') tbs.push('ic:gray');
        else if (GOOGLE_COLOR[f.color]) tbs.push('ic:specific,isc:' + f.color);
        var type = kind === 'gif' ? 'itp:animated' : { photo: 'itp:photo', clipart: 'itp:clipart', lineart: 'itp:lineart', animated: 'itp:animated', face: 'itp:face' }[f.type];
        if (type) tbs.push(type);
        var rights = { reuse: 'sur:cl', commercial: 'sur:ol' }[f.rights];
        if (rights) tbs.push(rights);
        var shape = { landscape: 'iar:w', portrait: 'iar:t', square: 'iar:s' }[f.orient];
        if (shape) tbs.push(shape);
        return 'https://www.google.com/search?' + Net.query({ tbm: 'isch', q: q, tbs: tbs.join(',') || undefined, safe: S && S.rating === 'r' ? 'off' : 'active' });
    }

    function googleWeb(kind) {
        return {
            id: 'google', name: kind === 'gif' ? 'Google (moving)' : 'Google Images', logo: 'G', color: '#ffffff', ink: '#4285f4',
            attribution: 'Opens in your web browser', trending: false, web: true, kind: kind,
            filters: kind === 'gif' ? ['size', 'color', 'rights', 'orient'] : ['size', 'color', 'type', 'rights', 'orient'],
            url: function (q, f, S) { return googleUrl(q, f, kind, S); },
            page: function () { return Promise.resolve({ items: [], more: false, web: true }); }
        };
    }

    /* ---------------- ICONIFY (icons) ---------------- */

    var POPULAR = ['material-symbols', 'lucide', 'ph', 'tabler', 'fluent', 'solar', 'hugeicons', 'mingcute', 'ri',
                   'heroicons', 'fa7-solid', 'fa7-brands', 'simple-icons', 'logos', 'mdi', 'bi', 'iconoir', 'carbon',
                   'game-icons', 'skill-icons', 'circle-flags'];
    var ICONIFY = 'https://api.iconify.design';

    /* The set list changes rarely: keep it on disk for a week. */
    var collections = null;
    function loadCollections() {
        if (collections) return Promise.resolve(collections);
        var fs = require('fs'), path = require('path');
        var file = path.join(window.ZSStore.cacheDir('iconify'), '_collections.json');
        try {
            var st = fs.statSync(file);
            if (Date.now() - st.mtimeMs < 7 * 864e5) { collections = JSON.parse(fs.readFileSync(file, 'utf8')); return Promise.resolve(collections); }
        } catch (e) {}
        return Net.json(ICONIFY + '/collections').then(function (c) {
            collections = c;
            try { fs.writeFileSync(file, JSON.stringify(c)); } catch (e) {}
            return c;
        });
    }

    var setCache = {};
    function setIcons(prefix) {
        if (setCache[prefix]) return Promise.resolve(setCache[prefix]);
        return Net.json(ICONIFY + '/collection?' + Net.query({ prefix: prefix })).then(function (r) {
            var names = [], seen = {};
            function add(list) { (list || []).forEach(function (n) { if (!seen[n]) { seen[n] = 1; names.push(n); } }); }
            add(r.uncategorized);
            var cats = r.categories || {};
            Object.keys(cats).forEach(function (k) { add(cats[k]); });
            setCache[prefix] = names;
            return names;
        });
    }

    function iconItem(full) {
        return { id: 'icon-' + full, source: 'iconify', kind: 'icon', title: full, name: full, w: 1, h: 1, files: {} };
    }

    var searchCache = {};
    var icons = {
        id: 'iconify', name: 'Icons (Iconify)', logo: 'I', color: '#1769aa', attribution: 'Icons via Iconify',
        POPULAR: POPULAR,
        collections: loadCollections,
        page: function (q, n, S, opt) {
            var set = opt.set || '';
            var per = 120;
            if (!q) {
                if (!set || set === '*popular' || set === '*all') return Promise.resolve({ items: [], more: false, needQuery: true });
                return setIcons(set).then(function (names) {
                    return { items: names.slice(n * per, (n + 1) * per).map(function (nm) { return iconItem(set + ':' + nm); }), more: (n + 1) * per < names.length, total: names.length };
                });
            }
            var prefixes = set === '*all' ? '' : set === '*popular' || !set ? POPULAR.join(',') : set;
            var url = ICONIFY + '/search?' + Net.query({ query: q, limit: 999, prefixes: prefixes });
            /* Iconify's search caps at 999: fetch once per query, slice locally. */
            var hit = searchCache[url] ? Promise.resolve(searchCache[url]) :
                Net.json(url).then(function (r) { searchCache[url] = r.icons || []; return searchCache[url]; });
            return hit.then(function (list) {
                return { items: list.slice(n * per, (n + 1) * per).map(iconItem), more: (n + 1) * per < list.length, total: list.length };
            });
        }
    };

    window.ZSSources = {
        tabs: {
            gifs:     [giphy('gif'), klipy('gif'), googleWeb('gif'), commons('gif')],
            stickers: [giphy('sticker'), klipy('sticker'), twitchChannel, seventv, ffz, emojigg],
            photos:   [googleWeb('photo'), unsplash, pexels('photo'), pixabay('photo'), openverse, commons('photo'), flickr],
            videos:   [klipy('video'), pexels('video'), pixabay('video')],
            icons:    [icons, commons('vector'), openverseSvg]
        },
        icons: icons,
        googleUrl: googleUrl
    };
})();
