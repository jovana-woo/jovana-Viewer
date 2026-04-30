# Jovana Viewer - Release Checklist

## 1) Pre-release metadata
- [ ] `package.json` version updated (e.g. `1.0.1`)
- [ ] author / license info verified
- [ ] `LICENSE.txt` exists and wording is final

## 2) Functional smoke test (Windows)
- [ ] folder open works (jpg/png/webp/gif)
- [ ] zip/cbz open works
- [ ] page navigation works (mouse/keyboard/wheel)
- [ ] fullscreen on/off works
- [ ] reading direction toggle (`우→좌` / `좌→우`) persists after restart
- [ ] single-click zoom / double-click reset works
- [ ] app does not crash during long reading session

## 3) Build
- [ ] run `npm ci` (or `npm install`)
- [ ] run `npm run build:nsis:x64`
- [ ] installer created in `dist/`

## 4) Installer verification on clean PC
- [ ] install succeeds
- [ ] app launches from desktop/start menu
- [ ] open sample folder and sample zip/cbz
- [ ] uninstall succeeds

## 5) Final package
- [ ] keep `dist/*.exe` installer
- [ ] include release notes (what changed)
- [ ] archive test samples + known issues memo
