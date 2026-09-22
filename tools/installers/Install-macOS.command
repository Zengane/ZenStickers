#!/bin/sh
# Installs Zen Stickers for the current macOS user.
# It unpacks the .zxp next to this file into
# ~/Library/Application Support/Adobe/CEP/extensions/ZenStickers.
# No Creative Cloud sign-in, no admin password and no Adobe installer are needed.

DIR="$(cd "$(dirname "$0")" && pwd)"
echo ""
echo " Zen Stickers installer"
echo " ----------------------"
echo ""

if pgrep -xq "Adobe Premiere Pro" || pgrep -xq "After Effects"; then
  echo " Please quit Premiere Pro and After Effects first, then run this again."
  exit 1
fi

ZXP="$(ls -t "$DIR"/ZenStickers*.zxp 2>/dev/null | head -n 1)"
if [ -z "$ZXP" ]; then
  echo " No ZenStickers .zxp file next to this installer. Put both files in the same folder."
  exit 1
fi

DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/ZenStickers"
echo " Installing $(basename "$ZXP")"
rm -rf "$DEST"
mkdir -p "$DEST"
if ! unzip -oq "$ZXP" -d "$DEST" || [ ! -f "$DEST/CSXS/manifest.xml" ]; then
  echo " The .zxp file looks damaged. Download it again."
  exit 1
fi
# Files from the internet carry a quarantine mark that can stop the upscaler from running.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
chmod +x "$DEST/bin/esrgan/mac/realesrgan-ncnn-vulkan" 2>/dev/null

echo " Installed to $DEST"
echo ""
echo " Done. Start Premiere Pro or After Effects, then choose"
echo " Window > Extensions > Zen Stickers."
echo ""
echo " If the panel stays blank, run \"Fix-blank-panel-macOS.command\"."
