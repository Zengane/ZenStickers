/*
 * Builds data/emoji-index.json from the sources downloaded into _build/.
 *
 *   node tools/build-index.js
 *
 * Inputs (all in _build/):
 *   emojibase-en.json, emojibase-messages.json   names, tags, groups, skins (emojibase-data 17)
 *   iamcal.json                                   Unicode names; Emojipedia's file names sometimes
 *                                                 use them ("pistol", not "water pistol")
 *   ic-noto.json, ic-twemoji.json, ic-openmoji.json, ic-fluent-emoji-flat.json
 *                                                 Iconify "chars" maps: which emojis each set has,
 *                                                 and the icon name to ask Iconify for
 *   noto-anim.json                                Google's list of animated Noto emojis
 *   apple96/                                      Apple images pulled out of the font
 *
 * Output: one row per emoji, skins nested under their base emoji.
 *   k  key: lowercase hex code points, FE0F removed, joined by "-"
 *   e  the emoji itself, fully qualified
 *   q  the fully qualified code points (Emojipedia file names need FE0F)
 *   n  name (CLDR)
 *   u  Unicode name, only when it differs from n
 *   t  search words
 *   g  group index into groups[]
 *   i  Iconify names per set: { noto, twemoji, openmoji, fluent } (missing = set lacks it)
 *   a  1 = Apple image on disk
 *   m  1 = Noto has an animated version
 *   s  skins: same shape, minus t/g/s, plus tone (1..5, or "1-3" style for two people)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const B = path.join(__dirname, '..', '_build');
const OUT = path.join(__dirname, '..', 'data', 'emoji-index.json');
const APPLE = path.join(__dirname, '..', 'data', 'apple96');

const base = JSON.parse(fs.readFileSync(path.join(B, 'emojibase-en.json'), 'utf8'));
const msgs = JSON.parse(fs.readFileSync(path.join(B, 'emojibase-messages.json'), 'utf8'));
const iamcal = JSON.parse(fs.readFileSync(path.join(B, 'iamcal.json'), 'utf8'));
const sets = {
    noto: 'ic-noto.json',
    twemoji: 'ic-twemoji.json',
    openmoji: 'ic-openmoji.json',
    fluent: 'ic-fluent-emoji-flat.json'
};
const chars = {};
for (const k of Object.keys(sets)) chars[k] = JSON.parse(fs.readFileSync(path.join(B, sets[k]), 'utf8')).chars || {};

const anim = new Set(JSON.parse(fs.readFileSync(path.join(B, 'noto-anim.json'), 'utf8')).icons
    .map(i => i.codepoint.split('_').filter(c => c !== 'fe0f').join('-')));
const apple = new Set(fs.readdirSync(APPLE).map(f => f.replace(/\.png$/, '')));

const uname = {};
for (const e of iamcal) {
    uname[e.unified.toLowerCase()] = e.name;
    if (e.non_qualified) uname[e.non_qualified.toLowerCase()] = e.name;
}

const cps = s => Array.from(s).map(c => c.codePointAt(0).toString(16));
const keyOf = s => cps(s).filter(c => c !== 'fe0f').join('-');

function row(e, withTags) {
    const k = keyOf(e.emoji);
    const r = { k: k, e: e.emoji, q: cps(e.emoji).join('-'), n: e.label };
    const un = uname[cps(e.emoji).join('-')] || uname[k];
    if (un && un.toLowerCase() !== e.label.toLowerCase()) r.u = un.toLowerCase();
    if (withTags) {
        const words = new Set((e.tags || []).concat(e.shortcodes || []));
        if (e.emoticon) [].concat(e.emoticon).forEach(x => words.add(x));
        if (words.size) r.t = Array.from(words).join(' ');
        r.g = e.group > 2 ? e.group - 1 : e.group;     // drop "component"
    }
    const i = {};
    for (const s of Object.keys(chars)) if (chars[s][k]) i[s] = chars[s][k];
    if (Object.keys(i).length) r.i = i;
    if (apple.has(k)) r.a = 1;
    if (anim.has(k)) r.m = 1;
    if (e.tone !== undefined) r.tone = Array.isArray(e.tone) ? e.tone.join('-') : e.tone;
    return r;
}

const groups = msgs.groups.filter(g => g.key !== 'component').sort((a, b) => a.order - b.order)
    .map(g => g.message.replace(/(^|\s)\S/g, c => c.toUpperCase()).replace(' & ', ' and '));

const rows = [];
for (const e of base) {
    if (e.group === undefined || e.group === 2) continue;       // components and bare letters
    const r = row(e, true);
    if (e.skins) r.s = e.skins.map(s => row(s, false));
    r.o = e.order;
    rows.push(r);
}
rows.sort((a, b) => a.o - b.o);
rows.forEach(r => { delete r.o; });

const count = (f) => rows.reduce((n, r) => n + (f(r) ? 1 : 0) + (r.s || []).filter(f).length, 0);
const report = {
    emojis: rows.length,
    withSkins: count(() => true),
    apple: count(r => r.a),
    noto: count(r => r.i && r.i.noto),
    twemoji: count(r => r.i && r.i.twemoji),
    openmoji: count(r => r.i && r.i.openmoji),
    fluent: count(r => r.i && r.i.fluent),
    animated: count(r => r.m)
};
fs.writeFileSync(OUT, JSON.stringify({ version: 1, built: new Date().toISOString().slice(0, 10), groups: groups, report: report, rows: rows }));
console.log(report, groups, (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB');
