# Third-party notices

Zen Stickers itself is under the PolyForm Noncommercial License 1.0.0 (see `LICENSE`).
The parts below belong to other people and keep their own licences.

## Shipped inside Zen Stickers

| Part | Where | Licence |
|---|---|---|
| Real-ESRGAN ncnn Vulkan (upscaler program and `realesrgan-x4plus-anime` model), by Xintao Wang | `bin/esrgan/` | BSD 3-Clause, see `bin/esrgan/LICENSE.txt` |
| `vcomp140.dll` (Microsoft OpenMP runtime, shipped with the Real-ESRGAN Windows build) | `bin/esrgan/` | Microsoft Visual C++ Redistributable licence |
| Emoji names, keywords and groups, from emojibase-data 17 by Miles Johnson | `data/emoji-index.json` | MIT |
| Unicode emoji names, from emoji-datasource by Cal Henderson | `data/emoji-index.json` | MIT |
| Iconify icon names for emoji sets (Noto, Twemoji, OpenMoji, Fluent) | `data/emoji-index.json` | MIT (Iconify data) |
| Brand logos of the sources, from Simple Icons | `data/logos.json` | CC0 1.0. The brands themselves are trademarks of their owners. |
| Adobe CSInterface.js | `js/CSInterface.js` | Adobe's CEP Resources licence |

## Fetched from the internet while you use it (not shipped)

Every search result, picture, GIF, video, icon and emoji is downloaded from its
own service when you ask for it. You are responsible for following each
service's terms and each file's licence.

| Service | Terms to read |
|---|---|
| GIPHY | developers.giphy.com/docs/api (needs "Powered by GIPHY", shown in the panel) |
| KLIPY | klipy.com (API terms) |
| Google Images | opened in your own web browser; most pictures there are copyrighted, check each one |
| Unsplash | unsplash.com/license and the API guidelines (downloads are reported, as required) |
| Pexels | pexels.com/license |
| Pixabay | pixabay.com/service/license-summary |
| Flickr | each photo has its own licence; Zen Stickers writes it in a `(credit).txt` file |
| Wikimedia Commons, Openverse | each file has its own licence; written in a `(credit).txt` file |
| Iconify | each icon set has its own licence (shown at icon-sets.iconify.design) |
| 7TV, BetterTTV, FrankerFaceZ, Twitch (via api.ivr.fi), emoji.gg | emotes belong to their creators |
| Google Noto Emoji | Apache 2.0 |
| Twemoji | CC BY 4.0, graphics by Twitter, Inc and other contributors |
| OpenMoji | CC BY-SA 4.0 |
| Microsoft Fluent Emoji | MIT |
| Apple, Samsung, WhatsApp, Facebook emojis (via Emojipedia's image server) | the designs belong to Apple, Samsung, WhatsApp and Meta; not licensed for reuse |
| FFmpeg (downloaded on Windows when a loop first needs it, if not already installed) | LGPL 2.1 or later; build from github.com/BtbN/FFmpeg-Builds; source at ffmpeg.org |
| Optional Apple pack (github.com/samuelngs/apple-emoji-ttf) | downloaded only when you press the button; the designs belong to Apple |
