# Development

Reference info for contributors, packagers, or anyone curious how the extension is put together. If you just want to install and use it, see the [README](../README.md) instead.

## Pre-release checklist

**Load-test the built zip in both Chrome and Firefox before tagging a release — not just Chrome.** The two browsers load the background script two different ways from two independently-maintained lists: Chrome runs `js/background.js` as an MV3 service worker and pulls in its dependencies via `importScripts()` inside that file; Firefox doesn't support MV3 service workers, so it instead loads `manifest.json`'s `background.scripts` array as plain `<script>` tags. Nothing enforces that these two lists match. When they drift (a new `js/objects/*.js` file added to one and not the other), Chrome works fine and Firefox's background script throws a `ReferenceError` and dies silently — which happened in 0.1.1 (`ImgurResolver.js` was missing from `background.scripts`, breaking stream fetching, the update check, and chat previews on Firefox, fixed in 0.1.2). This class of bug is invisible in Chrome-only testing, so it's a mandatory check, not a nice-to-have:

1. Whenever a new file is added to `js/background.js`'s `importScripts()` call, add it to `manifest.json`'s `background.scripts` array in the same commit (order matters for dependency ordering, keep both lists in the same order).
2. Before tagging any release: load the built zip unpacked in Chrome, open its service worker console (`chrome://extensions` → service worker link), confirm no errors.
3. Load the same zip as a temporary add-on in Firefox (`about:debugging#/runtime/this-firefox`), open its background inspector (**Inspect** on the extension's card — this is a persistent console for Firefox's non-worker background page, unlike Chrome's ephemeral service worker), confirm no errors there either.
4. Exercise anything that round-trips through the background message handler (stream list loads, retry button, "Check for updates" if applicable, chat image previews if applicable) in both browsers — a script that merely *loads* without erroring isn't sufficient proof its message listener actually registered.

## Packaging a release

```
npx web-ext build --source-dir . --artifacts-dir web-ext-artifacts \
  --ignore-files "images-source/**" \
  --ignore-files "images-store/**" \
  --ignore-files "screenshots/**" \
  --ignore-files "store-description.txt" \
  --ignore-files "style/bootstrap.css"
```

Produces `web-ext-artifacts/strims_live-<version>.zip` — a zip of just the runtime files (manifest, code, assets, README, license notices), excluding dev-only assets like the `.xcf` source images and Chrome Web Store screenshots. This same zip works for both browsers: unzip it and point either browser's "load unpacked"/"load temporary add-on" flow at the resulting folder. It's also already in the exact format Firefox's AMO signing pipeline expects, if you later want a permanently-installable signed build.

`web-ext-artifacts/` is gitignored — it's a build output, not something to commit.

## Project structure

```
manifest.json              Manifest V3 config — permissions, background, popup, content scripts, Firefox settings
html/app.html               Popup UI markup, stream-card template, and settings panel (General + Latency Lock tabs)
js/app.js                    Popup logic: redirect detection, clipboard, favorite toggling, settings/filter/tab wiring
js/background.js             Background entry point — service worker on Chrome, background script on Firefox
js/objects/App.js            App class — rendering, sorting, filtering, favorites, loading/error status
js/objects/Background.js     Background class — polling loop, badge/storage updates, go-live notifications
js/objects/Strims.js         Strims class — fetches/filters/sorts the live-stream list (fetch API)
js/objects/GeneralPanel.js   General settings tab — version info, refresh interval, favorites list (unfollow/mute)
js/objects/LatencyLock.js    Per-tab controller status cache for the Latency Lock feature
js/objects/LatencyPanel.js   Latency Lock settings-tab logic (tab discovery, controller injection, telemetry)
js/objects/UpdateChecker.js  Checks GitHub Releases for a newer version; stores result for the popup to surface
js/objects/ImgurResolver.js  Resolves an imgur album/gallery URL to a previewable image via its Open Graph tag
js/chat-preview/preview.js   Chat hover-image-preview content script (chat.strims.gg) — delegated hover listener, floating preview
js/latency/bridge.js         Latency Lock content script (isolated world) — relays page↔extension messages
js/latency/page.js           Latency Lock content script (MAIN world) — the actual playback control loop
js/libs/                     Vendored third-party libs (jQuery, Bootstrap, Popper, Clipboard.js)
images/                      Icons and UI assets
THIRD_PARTY_NOTICES.md       MIT attribution for the folded-in Latency Lock code
```

## Permissions

`storage`, `tabs`, `scripting`, `notifications`, `alarms`, and host permissions for `https://strims.gg/*`, `https://*.angelthump.com/*`, `https://api.github.com/*`, and `https://imgur.com/*`. `https://strims.gg/api` is the only strims.gg endpoint ever fetched. `tabs`/`scripting` are needed by the Latency Lock panel to find the AngelThump tab and (re-)inject its content scripts on demand; content scripts on `angelthump.com` run the actual latency-lock loop, and on `chat.strims.gg` run the chat image hover-preview. `notifications` powers the go-live alerts for favorites. `alarms` schedules the periodic update check (see [Changelog](../CHANGELOG.md)); `api.github.com` is queried (read-only, unauthenticated) for the latest release tag of this repo; `imgur.com` is fetched in the background to resolve an album link's cover image for the chat preview feature.

## Known limitations

- Live list only includes streams where `service == "angelthump"` — Twitch/YouTube-hosted strims are not included.
- No LICENSE file currently in the repo for this project's own code (see `THIRD_PARTY_NOTICES.md` for the Latency Lock code's own MIT license).
- Firefox installs are temporary-only until the extension goes through AMO signing (see the [README](../README.md#installation)).
