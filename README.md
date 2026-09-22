# Zen Stickers

A free panel for **Adobe Premiere Pro** and **After Effects** that finds GIFs,
stickers, Twitch emotes, images, videos, icons, SVGs and emojis, and puts them
straight into your project, on the first free track at the playhead.

Made by Zengane as a replacement for Wander after the Tenor API closed.

**[Read the user guide](docs/GUIDE.md)** for how to install it and how to use every part.

![Zen Stickers in Premiere Pro](docs/images/gifs.png)

## What it has

| Tab | Sources |
|---|---|
| **GIFs** | GIPHY, KLIPY, Wikimedia, Google (moving images, in your browser) |
| **Stickers** | GIPHY, KLIPY, **Twitch channel** (type a streamer's name: their Twitch, 7TV, BetterTTV and FrankerFaceZ emotes), 7TV, FrankerFaceZ, emoji.gg |
| **Images** | Unsplash, Pexels, Pixabay, Openverse, Wikimedia, Flickr, and Google Images (in your browser), with Google-style filters: size, colour (including transparent), type, usage rights, shape |
| **Videos** | KLIPY clips (with sound), Pexels, Pixabay |
| **Vectors** | 200,000+ icons from Iconify (any colour), plus SVG illustrations from Wikimedia and Openverse |
| **Emojis** | Apple, Samsung, WhatsApp, Facebook, Google (with moving versions), Twemoji, OpenMoji, Fluent, Fluent Flat, in every skin tone |

- **Premiere** gets PNG, GIF, JPG or MP4. **After Effects** gets real SVG for icons
  and vector emojis, and can turn them into shape layers.
- Small pictures (Apple, Samsung and WhatsApp emojis, still Twitch emotes) are made
  1024 px with an AI upscaler (Real-ESRGAN) that runs on your graphics card.
- **Short GIFs loop.** A clip shorter than 1 s (you choose) becomes one clip that
  repeats until it is at least 5 s long (you choose), with a marker where the loop
  starts, or at every repeat, on the clip or on the timeline. In Premiere, ffmpeg
  makes a looped copy (ProRes 4444, transparency kept) that goes on a free track;
  After Effects uses the footage's own loop setting. If ffmpeg is not installed,
  Zen Stickers downloads it once (Windows, about 100 MB).
- GIFs and stickers download as GIF, MP4 or WebM (WebM keeps transparency when the
  source offers it). Settings > GIFs and loops.
- Zoom buttons (or Ctrl + mouse wheel) change the result size. Alt + click, or
  right-click > Preview, shows a result big without importing it.
- Images with a licence get a `(credit).txt` file next to them, saying who made them.
- **Drag in anything.** Drag a picture, GIF or video from any website (or from
  Explorer / Finder) into the panel, or copy it and press Ctrl+V (Cmd+V). It is
  downloaded and imported like a search result.
- **Google Images** opens in your own web browser with the filters already set.
  Drag the picture you want back into the panel. Zen Stickers does not scrape
  Google: Google forbids it and blocks it.

## Install

1. Download the latest `ZenStickers-x.y.z.zxp` and `Install-Windows.cmd` (or
   `Install-macOS.command`) from the [Releases](https://github.com/Zengane/ZenStickers/releases) page.
2. Put them in the same folder, close Premiere Pro and After Effects, and double-click
   the installer. No admin rights and no Creative Cloud sign-in needed.
3. Open **Window > Extensions > Zen Stickers**.

Panel blank? Run `Fix-blank-panel-...` from the same release. Details in the
[user guide](docs/GUIDE.md#1-install).

Needs Premiere Pro 2021 (15.0) or newer, or After Effects 2022 (22.0) or newer.
SVG import in After Effects needs version 2025 or newer.

## Keys

Many sources work with no key: Wikimedia, Openverse, all Twitch emotes, 7TV,
FrankerFaceZ, emoji.gg, Iconify and every emoji design.

The others need a free key from their own website. Open the panel's **Settings >
Sources**, press **Get one** next to a source, make the key there, and paste it
in. **Test all keys** checks them.

Your keys are saved only on your computer, in
`%APPDATA%\Zengane\Zen Stickers\settings.json` (Windows) or
`~/Library/Application Support/Zengane/Zen Stickers/settings.json` (macOS).
Zen Stickers sends each key only to its own service.

## Apple emojis

Zen Stickers does not ship Apple's emoji images. They come from Emojipedia's
image server when you use them. An optional **Apple pack** (a button shown on the
Apple emoji tab) downloads the community build of Apple's emoji font from
[github.com/samuelngs/apple-emoji-ttf](https://github.com/samuelngs/apple-emoji-ttf)
and saves every emoji as a picture on your computer, for instant previews.

The Apple, Samsung, WhatsApp and Facebook designs belong to those companies.
Check that your use is allowed before you publish work that contains them.

## Privacy

Zen Stickers has no account, no analytics and no server of its own. It talks
only to the services you search, and to Adobe's app on your computer. Files are
saved next to your project (or in a folder you choose), and a cache lives in the
same folder as the settings.

## For developers

```
npm install          # one small dev tool (acorn) for the tests
npm test             # offline checks: every script parses, host scripts are ES3, data is sound
npm run test:live    # asks every source for real results (uses your keys if present)
npm run test:app -- ppro     # drives the real panel in Premiere (developer install, no project open)
npm run test:app -- aeft     # the same in After Effects
npm run test:ffmpeg  # downloads ffmpeg to a temp folder and loops a GIF and a WebM
npm run build:zxp    # signed ZXP and the two installers, in dist/
```

A developer install is this folder in `%APPDATA%\Adobe\CEP\extensions\ZenStickers`
(`install.ps1` copies it) with PlayerDebugMode on. The `.debug` file opens DevTools
on ports 8160-8163. It is left out of the ZXP.

| Folder | What |
|---|---|
| `js/` | the panel: `sources.js` (every provider), `emoji.js`, `applepack.js`, `media.js` (downloads, SVG to PNG, upscaling), `panel.js` |
| `host/` | ExtendScript for Premiere (`host-ppro.jsx`) and After Effects (`host-aeft.jsx`) |
| `settings/` | the settings window |
| `data/` | the emoji index (names, keywords, skin tones) and source logos |
| `bin/esrgan/` | Real-ESRGAN for Windows and macOS |
| `tests/`, `tools/` | tests, the ZXP builder, the emoji index builder |

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE): free to use, change and share, but not
for money. Parts made by others keep their own licences, see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
