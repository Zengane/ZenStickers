# How to publish Zen Stickers on GitHub

This is for you (the maintainer). It keeps your computer's details and your
email out of the public project.

## What is already safe

- The code has no paths from your computer, no user name and no API keys.
  `npm test` checks this every time ("the repository holds nothing personal").
- Your keys live in `%APPDATA%\Zengane\Zen Stickers\settings.json`, outside this folder.
- The signing certificate and its password live in `%APPDATA%\Zengane\signing\`,
  outside this folder. `.gitignore` also blocks `*.p12` and password files.
- `.gitignore` keeps out `_build/` (fonts, test data), `dist/` (the ZXP) and `node_modules/`.

## One time: make your email private

Git writes a name and an email into every save ("commit"). Anyone can read them.

1. Make a GitHub account with the name you want to show, for example **Zengane**.
2. On GitHub, go to **Settings > Emails**.
3. Turn on **Keep my email addresses private**.
4. Turn on **Block command line pushes that expose my email**.
5. Copy the address GitHub shows there. It looks like
   `12345678+Zengane@users.noreply.github.com`. That is your public email from now on.

## One time: put the project on GitHub

The easiest tool is **GitHub Desktop** (desktop.github.com).

1. Install GitHub Desktop and sign in.
2. **File > Options > Git**: set **Name** to `Zengane` and **Email** to the
   `...@users.noreply.github.com` address. Save.
3. **File > Add local repository**, pick this folder (`ZenStickers`), click
   **Add repository**. (The folder is already set up as a repository, with the name
   `Zengane` and no email. Git refuses to save until an email is set, so your real
   email cannot slip in by accident.)
   Using the command line instead? Run this once in the folder:
   `git config user.email "12345678+Zengane@users.noreply.github.com"` (your address).
4. Look at the list of changed files on the left. It must **not** show `_build`,
   `dist`, `node_modules`, any `.p12`, or any `settings.json`. If one shows, stop and ask.
5. Write "First release" in the summary box and click **Commit to main**.
6. Click **Publish repository**. **Untick "Keep this code private"** so everyone can
   see it. Click **Publish**.

A small extra: every commit also records your time zone (for example +02:00).
Most people do not mind. If you do, ask for help before the first commit.

## Every release

1. Change the version number in three places (the tests check they match):
   - `CSXS/manifest.xml` (`ExtensionBundleVersion` and both `Version=`)
   - `host/host-ppro.jsx` and `host/host-aeft.jsx` (`BUILD = "zs-... x.y.z"`)
2. Run the tests:
   ```
   npm test
   ```
3. Build the installer:
   ```
   npm run build:zxp
   ```
   This makes, in `dist/`: `ZenStickers-x.y.z.zxp`, `Install-Windows.cmd`,
   `Install-macOS.command`, `Fix-blank-panel-Windows.cmd` and
   `Fix-blank-panel-macOS.command`.
4. Commit and push (GitHub Desktop: **Commit to main**, then **Push origin**).
5. Publish the release with its files:
   ```
   npm run release
   ```
   It uses the GitHub sign-in Git already has, makes release `vX.Y.Z` with the five
   files from `dist/`, and replaces them if the release already exists.
   Add `-- --delete-old v1.5.2` to remove an older release.

## Keep these safe (never upload them)

- `%APPDATA%\Zengane\signing\zenstickers.p12` and `zenstickers-password.txt`.
  Every update must be signed with the same certificate. Copy them to a USB stick
  or a password manager.

## If a user reports "the panel is blank"

Adobe's own note (Known Issue 2024) says a ZXP can fail its signature check when
installed by some installers. Two fixes for the user:
- start Premiere or After Effects once with "Run as administrator", or
- turn on PlayerDebugMode (Windows: registry key
  `HKEY_CURRENT_USER\Software\Adobe\CSXS.12`, string `PlayerDebugMode` = `1`;
  macOS: `defaults write com.adobe.CSXS.12 PlayerDebugMode 1`).
