#!/bin/sh
# Only needed if the Zen Stickers panel opens but stays blank.
# Adobe's own advice for that (Known Issue 2024): turn on "PlayerDebugMode", which
# makes Premiere Pro and After Effects load extensions without checking their
# signature. It is set for the current macOS user only.
# To undo it later: run this file from Terminal with the word "undo".

if [ "$1" = "undo" ]; then
  for V in 9 10 11 12 13; do defaults delete "com.adobe.CSXS.$V" PlayerDebugMode 2>/dev/null; done
  echo "PlayerDebugMode is off again."
  exit 0
fi

echo "This turns on Adobe's PlayerDebugMode for your macOS user."
echo "Premiere Pro and After Effects will then load panels without checking their signature."
echo "Only do this if the Zen Stickers panel stays blank."
printf "Turn it on? (y/n) "
read ANSWER
case "$ANSWER" in
  y|Y|yes|YES) ;;
  *) echo "Nothing changed."; exit 0 ;;
esac
for V in 9 10 11 12 13; do defaults write "com.adobe.CSXS.$V" PlayerDebugMode 1; done
echo "Done. Restart Premiere Pro or After Effects."
