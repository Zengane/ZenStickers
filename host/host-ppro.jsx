/*
 * Zen Stickers - Premiere half.
 *
 * The panel has already written the file to disk. This side imports it into
 * the "Zen Stickers" bin and, when asked, lays it at the playhead on the lowest
 * track that is free for the clip's whole length - Zen Drop's search, so
 * nothing already on the timeline is ever overwritten.
 *
 * Every Premiere panel's host script shares ONE ExtendScript global scope, so
 * all of this lives inside one closure and exposes exactly one name.
 * ES3 only: no nested ternaries without parentheses, no reserved words as names.
 */
$.global.ZenStickers = (function () {

    var TICKS_PER_SECOND = 254016000000;
    var BUILD = "zs-ppro 1.5.2";

    /* ---------- tiny JSON writer (ExtendScript has no JSON object) ---------- */

    function esc(s) {
        s = String(s);
        var out = "";
        for (var i = 0; i < s.length; i++) {
            var c = s.charAt(i), n = s.charCodeAt(i);
            if (c === "\\") { out += "\\\\"; }
            else if (c === '"') { out += '\\"'; }
            else if (c === "\n") { out += "\\n"; }
            else if (c === "\r") { out += "\\r"; }
            else if (c === "\t") { out += "\\t"; }
            else if (n < 32 || n > 126) {
                /* Escape everything outside plain ASCII: a mangled accent kills the whole parse. */
                var h = n.toString(16);
                while (h.length < 4) { h = "0" + h; }
                out += "\\u" + h;
            }
            else { out += c; }
        }
        return out;
    }

    function json(obj) {
        var parts = [];
        for (var k in obj) {
            if (!obj.hasOwnProperty(k)) { continue; }
            var v = obj[k], piece;
            if (v === null || v === undefined) { piece = "null"; }
            else if (typeof v === "number") { piece = isFinite(v) ? String(v) : "null"; }
            else if (typeof v === "boolean") { piece = v ? "true" : "false"; }
            else { piece = '"' + esc(v) + '"'; }
            parts.push('"' + esc(k) + '":' + piece);
        }
        return "{" + parts.join(",") + "}";
    }

    function fail(msg) { return json({ ok: false, error: String(msg) }); }
    function bool(v) { return v === true || v === "true" || v === 1 || v === "1"; }
    function normPath(p) { return String(p).replace(/\\/g, "/").toLowerCase(); }
    function ext(p) {
        var m = String(p).match(/\.([A-Za-z0-9]+)\s*$/);
        return m ? m[1].toLowerCase() : "";
    }

    function mkTime(ticks) {
        var t = new Time();
        t.ticks = String(Math.round(ticks));
        return t;
    }

    /* ---------- bin ---------- */

    function isBin(item) {
        try { return item.type === ProjectItemType.BIN; } catch (e) { return item.type === 2; }
    }

    function findBin(parent, name) {
        var kids = parent.children;
        for (var i = 0; i < kids.numItems; i++) {
            var c = kids[i];
            if (isBin(c) && String(c.name) === String(name)) { return c; }
        }
        return null;
    }

    function binFor(name, sub) {
        var root = app.project.rootItem;
        var b = findBin(root, name);
        if (!b) { root.createBin(String(name)); b = findBin(root, name); }
        if (!b) { throw new Error("Could not make the bin: " + name); }
        if (!sub) { return b; }
        var s = findBin(b, sub);
        if (!s) { b.createBin(String(sub)); s = findBin(b, sub); }
        return s || b;
    }

    /* ---------- project items ---------- */

    function collectIds(item, out) {
        var kids;
        try { kids = item.children; } catch (e) { return out; }
        if (!kids) { return out; }
        for (var i = 0; i < kids.numItems; i++) {
            var c = kids[i];
            try { out[String(c.nodeId)] = true; } catch (e2) {}
            collectIds(c, out);
        }
        return out;
    }

    function findNew(item, known, found) {
        var kids;
        try { kids = item.children; } catch (e) { return found; }
        if (!kids) { return found; }
        for (var i = 0; i < kids.numItems && !found.item; i++) {
            var c = kids[i], id = null;
            try { id = String(c.nodeId); } catch (e2) {}
            if (id && !known[id] && !isBin(c)) { found.item = c; return found; }
            findNew(c, known, found);
        }
        return found;
    }

    function findByPath(item, wanted, found) {
        var kids;
        try { kids = item.children; } catch (e) { return found; }
        if (!kids) { return found; }
        for (var i = 0; i < kids.numItems && !found.item; i++) {
            var c = kids[i];
            try {
                var mp = c.getMediaPath();
                if (mp && normPath(mp) === wanted) { found.item = c; return found; }
            } catch (e2) {}
            findByPath(c, wanted, found);
        }
        return found;
    }

    /* Import once. A file already in the project is reused, not imported again. */
    function importOne(path, bin) {
        var existing = findByPath(app.project.rootItem, normPath(path), { item: null }).item;
        if (existing) { return existing; }
        var known = collectIds(app.project.rootItem, {});
        app.project.importFiles([String(path)], true, bin, false);
        var item = findNew(app.project.rootItem, known, { item: null }).item;
        if (!item) { item = findByPath(app.project.rootItem, normPath(path), { item: null }).item; }
        if (!item) { throw new Error("Premiere did not import " + path); }
        try {
            if (!item.parent || String(item.parent.nodeId) !== String(bin.nodeId)) { item.moveBin(bin); }
        } catch (e) {}
        return item;
    }

    /* ---------- free space (Zen Drop's search) ---------- */

    /* Clips on one track never overlap and come in time order, so their ends
       are sorted too: binary-search the first clip that ends after s, then
       check whether it starts before e. Reading every clip cost 2.7 s on a
       3,392-clip timeline; this reads about 12 per track. */
    function spanBusy(collection, s, e) {
        if (!collection) { return false; }
        var n = collection.numItems;
        if (!n) { return false; }
        var lo = 0, hi = n - 1, first = -1;
        try {
            while (lo <= hi) {
                var mid = (lo + hi) >> 1;
                if (Number(collection[mid].end.ticks) > s) { first = mid; hi = mid - 1; } else { lo = mid + 1; }
            }
            if (first < 0) { return false; }
            return Number(collection[first].start.ticks) < e;
        } catch (err) {
            /* Unexpected order or a read error: fall back to looking at every clip. */
            for (var i = 0; i < n; i++) {
                var c = collection[i], cs, ce;
                try { cs = Number(c.start.ticks); ce = Number(c.end.ticks); } catch (err2) { continue; }
                if (cs < e && ce > s) { return true; }
            }
            return false;
        }
    }

    function trackFree(track, s, e) {
        if (!track) { return false; }
        try { if (track.isLocked()) { return false; } } catch (err) {}
        if (spanBusy(track.clips, s, e)) { return false; }
        if (spanBusy(track.transitions, s, e)) { return false; }
        return true;
    }

    function freeIndex(seq, kind, s, e) {
        var v = seq.videoTracks, a = seq.audioTracks, i;
        for (i = 0; i < v.numTracks; i++) {
            if (!trackFree(v[i], s, e)) { continue; }
            if (kind === "both") {
                if (i >= a.numTracks) { continue; }
                if (!trackFree(a[i], s, e)) { continue; }
            }
            return i;
        }
        return -1;
    }

    function addTracks(seq, addV, addA) {
        try { app.enableQE(); } catch (e) { return false; }
        var qs = null;
        try { qs = qe.project.getActiveSequence(); } catch (e2) { return false; }
        if (!qs) { return false; }
        var numV = seq.videoTracks.numTracks, numA = seq.audioTracks.numTracks;
        if (addV > 0) {
            try { qs.addTracks(addV, numV, 0, 0, 1, 0, 0); } catch (e3) { return false; }
        }
        if (addA > 0) {
            /* Measured in 26.3.2: an audio "insert after" index is silently ignored
               unless Premiere likes it - numA never works, numA - 1 only sometimes,
               low indexes always. Try from the end backwards; each miss is a no-op,
               and the new track lands as late in the list as Premiere allows. */
            for (var ai = numA - 1; ai >= 0; ai--) {
                try { qs.addTracks(0, numV + addV, addA, ai, 1, 0, 0); } catch (e4) {}
                if (app.project.activeSequence.audioTracks.numTracks >= numA + addA) { break; }
            }
        }
        var after = app.project.activeSequence;
        return (after.videoTracks.numTracks >= numV + addV) && (after.audioTracks.numTracks >= numA + addA);
    }

    function ensureRoom(kind, s, e) {
        var seq = app.project.activeSequence;
        var idx = freeIndex(seq, kind, s, e);
        if (idx >= 0) { return { seq: seq, idx: idx, added: false }; }
        for (var n = 0; n < 16; n++) {
            var numV = seq.videoTracks.numTracks, numA = seq.audioTracks.numTracks;
            var addV = 0, addA = 0;
            if (kind === "video") { addV = 1; }
            else if (numV < numA) { addV = 1; }
            else if (numA < numV) { addA = 1; }
            else { addV = 1; addA = 1; }
            if (!addTracks(seq, addV, addA)) {
                throw new Error("No free track, and adding one failed.");
            }
            /* Re-read: the Sequence object keeps stale track lists after a QE change. */
            seq = app.project.activeSequence;
            idx = freeIndex(seq, kind, s, e);
            if (idx >= 0) { return { seq: seq, idx: idx, added: true }; }
        }
        throw new Error("Added 16 tracks and still no room.");
    }

    function selectAt(track, s) {
        try {
            var clips = track.clips;
            for (var i = 0; i < clips.numItems; i++) {
                if (Number(clips[i].start.ticks) === s) { clips[i].setSelected(true, true); return; }
            }
        } catch (e) {}
    }

    /* The clip's length in ticks, 0 when Premiere does not say (stills). */
    function itemTicks(item) {
        var inT = 0, outT = 0;
        try { inT = Number(item.getInPoint().ticks); } catch (e) {}
        try { outT = Number(item.getOutPoint().ticks); } catch (e2) {}
        return outT > inT ? outT - inT : 0;
    }

    function placeOne(item, hasAudio, knownTicks) {
        var seq = app.project.activeSequence;
        if (!seq) { throw new Error("No sequence is open."); }
        var start = Number(seq.getPlayerPosition().ticks);
        var tb = Number(seq.timebase);
        if (tb > 0) { start = Math.round(start / tb) * tb; }

        var dur = knownTicks || itemTicks(item);
        if (!(dur > 0)) { dur = 5 * TICKS_PER_SECOND; }
        var end = start + dur;

        var kind = hasAudio ? "both" : "video";
        var room = ensureRoom(kind, start, end);
        var track = room.seq.videoTracks[room.idx];
        if (!track) { throw new Error("Track V" + (room.idx + 1) + " does not exist."); }
        track.overwriteClip(item, mkTime(start));
        selectAt(track, start);
        return { track: "V" + (room.idx + 1), start: start };
    }

    /* ---------- loop markers ----------
       The panel makes the looped file with ffmpeg; this side only marks where
       each pass starts, on the clip (source markers, which travel with the
       clip) or on the timeline. */

    function addMarkers(markers, firstTicks, cycleTicks, n, every, name) {
        var last = every ? n - 1 : 1;
        for (var k = 1; k <= last && k < n; k++) {
            var m = markers.createMarker((firstTicks + k * cycleTicks) / TICKS_PER_SECOND);
            try { m.name = name; } catch (e) {}
        }
    }

    /* ---------- called by the panel ---------- */

    function info() {
        try {
            var p = app.project;
            if (!p) { return json({ ok: true, build: BUILD, saved: false, projectDir: "", hasComp: false, comp: "" }); }
            var path = "";
            try { path = String(p.path || ""); } catch (e) {}
            var dir = "", saved = false;
            if (path) {
                var f = new File(path);
                if (f.exists) { saved = true; dir = f.parent.fsName; }
            }
            var seq = null;
            try { seq = p.activeSequence; } catch (e2) {}
            return json({ ok: true, build: BUILD, saved: saved, projectDir: dir, hasComp: seq ? true : false, comp: seq ? String(seq.name) : "" });
        } catch (err) {
            return fail(err.toString());
        }
    }

    /*
     * path     the file on disk
     * place    "1" = also put it at the playhead
     * sub      sub-bin inside "Zen Stickers" (GIFs, Emojis...)
     */
    /*
     * hasAudio: "1" when the file has sound (its audio needs a free track too).
     * loops, cycle: a looped file made by the panel (N passes of cycle seconds).
     * marker: "none" | "first" | "every".  markerOn: "clip" | "timeline".
     */
    function place(path, doPlace, sub, hasAudio, loops, cycle, marker, markerOn) {
        try {
            var t0 = new Date().getTime(), steps = [];
            var lap = function (name) { var t = new Date().getTime(); steps.push(name + " " + (t - t0)); t0 = t; };
            if (!app.project) { return fail("No project is open."); }
            var f = new File(path);
            if (!f.exists) { return fail("The file is missing: " + path); }
            var bin = binFor("Zen Stickers", sub ? String(sub) : "");
            var item = importOne(String(path), bin);
            lap("import");
            var track = "";
            var n = Math.round(Number(loops) || 0), cyc = Number(cycle) * TICKS_PER_SECOND;
            var marks = n > 1 && cyc > 0 && marker !== "none";
            /* Source markers go on the project item once, before it is placed. */
            if (marks && markerOn === "clip") {
                var have = 0;
                try { have = item.getMarkers().numMarkers; } catch (eM) {}
                if (!have) { addMarkers(item.getMarkers(), 0, cyc, n, marker === "every", "Loop"); }
            }
            var seq = null;
            try { seq = app.project.activeSequence; } catch (e) {}
            if (bool(doPlace)) {
                if (!seq) { return json({ ok: true, imported: true, placed: false, name: String(item.name), note: "No sequence is open, so it went to the bin only." }); }
                var res = placeOne(item, bool(hasAudio), n > 1 && cyc > 0 ? n * cyc : 0);
                track = res.track;
                lap("place");
                if (marks && markerOn === "timeline") { addMarkers(seq.markers, res.start, cyc, n, marker === "every", "Loop"); }
            }
            return json({ ok: true, imported: true, placed: track !== "", track: track, name: String(item.name), loops: n, ms: steps.join(", ") });
        } catch (err) {
            return fail(err.toString());
        }
    }

    return { build: BUILD, info: info, place: place, ping: function () { return BUILD; } };
})();
