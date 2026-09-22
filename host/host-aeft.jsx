/*
 * Zen Stickers - After Effects half.
 *
 * Imports the file into the "Zen Stickers" folder and, when asked, adds it to
 * the open comp at the current time. SVG files (icons, vector emojis) import
 * as footage in After Effects 2025 and newer; with "shapes" on, the layer is
 * then turned into a shape layer by AE's own "Create Shapes from Vector Layer".
 *
 * One closure, one global name: host scripts share the ExtendScript scope.
 * One undo group per call, never nested.
 */
$.global.ZenStickers = (function () {

    var BUILD = "zs-aeft 1.5.3";

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

    function folder(name, parent) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof FolderItem && it.name === name && it.parentFolder === (parent || app.project.rootFolder)) { return it; }
        }
        var f = app.project.items.addFolder(name);
        if (parent) { f.parentFolder = parent; }
        return f;
    }

    /* The same file twice reuses its footage item. */
    function findFootage(file) {
        var want = file.fsName.toLowerCase();
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            try {
                if (it instanceof FootageItem && it.file && it.file.fsName.toLowerCase() === want) { return it; }
            } catch (e) {}
        }
        return null;
    }

    /* Only ever shrinks, to fit the comp. */
    function fit(layer, item, comp) {
        if (!item.width || !item.height) { return; }
        var s = Math.min(comp.width / item.width, comp.height / item.height);
        if (s >= 1) { return; }
        layer.property("ADBE Transform Group").property("ADBE Scale").setValue([s * 100, s * 100]);
    }

    function info() {
        try {
            var f = app.project.file;
            var comp = app.project.activeItem;
            var hasComp = (comp instanceof CompItem);
            return json({ ok: true, build: BUILD, saved: f ? true : false, projectDir: f ? f.parent.fsName : "",
                          hasComp: hasComp, comp: hasComp ? comp.name : "", version: String(app.version) });
        } catch (e) {
            return fail(e.toString());
        }
    }

    /*
     * After Effects loops footage itself (Interpret Footage > Loop), so a short
     * clip just gets mainSource.loop = N: one layer, exact timing.
     */
    function place(path, doPlace, sub, shapes, loopUnder, loopTarget, marker, markerOn) {
        var opened = false;
        try {
            var file = new File(path);
            if (!file.exists) { return fail("The file is missing: " + path); }
            var comp = app.project.activeItem;
            var hasComp = (comp instanceof CompItem);

            app.beginUndoGroup("Zen Stickers");
            opened = true;

            var item = findFootage(file);
            if (!item) {
                var io = new ImportOptions(file);
                if (io.canImportAs(ImportAsType.FOOTAGE)) { io.importAs = ImportAsType.FOOTAGE; }
                item = app.project.importFile(io);
                var top = folder("Zen Stickers", null);
                item.parentFolder = sub ? folder(String(sub), top) : top;
            }

            var placed = false, note = "", shaped = false, loops = 0, cycle = 0;
            try {
                var src = item.mainSource;
                cycle = src && !src.isStill ? item.duration : 0;
                if (src && src.loop > 1 && cycle > 0) { cycle = cycle / src.loop; }
                var under = Number(loopUnder), target = Number(loopTarget);
                if (cycle > 0 && under > 0 && cycle < under && target > cycle) {
                    loops = Math.ceil(target / cycle - 1e-9);
                    src.loop = loops;
                }
            } catch (eL) {}
            if (bool(doPlace)) {
                if (!hasComp) {
                    note = "No comp is open, so it went to the project only.";
                } else {
                    var L = comp.layers.add(item);
                    L.startTime = comp.time;
                    fit(L, item, comp);
                    placed = true;
                    if (loops > 1 && marker !== "none") {
                        var last = marker === "every" ? loops - 1 : 1;
                        for (var k = 1; k <= last; k++) {
                            var t = L.startTime + k * cycle;
                            if (markerOn === "timeline" && comp.markerProperty) { comp.markerProperty.setValueAtTime(t, new MarkerValue("Loop")); }
                            else { L.property("ADBE Marker").setValueAtTime(t, new MarkerValue("Loop")); }
                        }
                    }
                    if (bool(shapes) && /\.svg$/i.test(file.name)) {
                        for (var i = 1; i <= comp.numLayers; i++) { comp.layer(i).selected = false; }
                        L.selected = true;
                        var id = app.findMenuCommandId("Create Shapes from Vector Layer");
                        if (id) {
                            app.executeCommand(id);
                            shaped = true;
                        } else {
                            note = "Could not find Create Shapes from Vector Layer.";
                        }
                    } else {
                        for (var j = 1; j <= comp.numLayers; j++) { comp.layer(j).selected = false; }
                        L.selected = true;
                    }
                }
            }

            app.endUndoGroup();
            opened = false;
            return json({ ok: true, imported: true, placed: placed, shaped: shaped, name: item.name, note: note, comp: hasComp ? comp.name : "", loops: loops });
        } catch (e) {
            if (opened) { app.endUndoGroup(); }
            return fail(e.toString());
        }
    }

    return { build: BUILD, info: info, place: place, ping: function () { return BUILD; } };
})();
