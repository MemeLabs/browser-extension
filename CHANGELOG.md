# Changelog

## 0.1.2 — Firefox background-script crash fix
- Fixed a bug where `ImgurResolver.js` was loaded on Chrome (via `background.js`'s `importScripts()`) but missing from `manifest.json`'s Firefox `background.scripts` array, causing `new ImgurResolver()` to throw `ReferenceError` and crash the entire Firefox background script before it could register its message listener — breaking stream fetching, the update check, and chat image previews on Firefox

## 0.1.1 — update check, chat image previews, header polish
- Added an update check against GitHub Releases (background alarm, twice a day + on startup) — an orange "Update" chip appears in the popup header when a newer tagged version exists, linking through to the release
- Added chat image hover-preview on `chat.strims.gg` — direct image links, single-image `imgur.com/<id>` pages, and `imgur.com/a/`\|`/gallery/` albums (resolved via Open Graph metadata) all show a floating preview on hover; toggleable in Settings → General
- Redesigned the All/Favorites filter as underline tabs (matching the Settings tab-strip style) instead of pill/chip buttons, and fixed a left-edge padding inconsistency (`.filter-row`/`.streams-status` used 4px instead of the 15px gutter everything else aligns to)

## 0.1.0 — Latency Lock merge + feature round
This release merges what used to be two separate extensions — the original Strims Live popup and the standalone *AngelThump Latency Lock* — into one, and adds a round of features on top.

- Folded in the standalone `angelthump-latency-lock-firefox` extension: content scripts (`js/latency/`), background status cache (`LatencyLock.js`), and a settings tab behind a gear icon in the popup (`LatencyPanel.js`) instead of its own separate popup
- Added a tabbed settings panel (General / Latency Lock) with a global back button, replacing the single-purpose settings view
- Favorites migrated from `storage.local` to `storage.sync` (with automatic one-time migration of existing favorites), so they follow you across signed-in browser instances
- Favorites now sort to the top of the channel list; added an All/Favorites filter toggle; both persist across popup opens
- Added real go-live desktop notifications for favorites (previously just a badge-count change), with per-favorite muting
- Added loading/error states with a Retry button (previously failures were silent)
- Added a configurable refresh interval (1–15 min), replacing the hardcoded 2-minute poll
- Added an "Alt" button per stream linking to strims.gg's advanced egress/server picker
- Added a "Feedback & feature requests" link to Settings → General
- Fixed a latent bug where a completely fresh install (no cached streams yet) would throw when rendering, since it assumed `storage.local`'s `streams` key was always an array
- Fixed the copy button's "Copied!" tooltip silently failing (`popper.min.js` was loaded after `bootstrap.min.js`, so Bootstrap's tooltip component disabled itself at load time)
- Made the codebase Firefox-compatible: added `background.scripts` as a fallback for Firefox (which doesn't support MV3 service workers), guarded the Chrome-only `importScripts()` call, added `browser_specific_settings.gecko.id` (required by Firefox for MV3), and fixed an unhandled-promise-rejection bug in Firefox where `chrome.runtime.sendMessage` rejects (unlike Chrome, which silently no-ops) when the popup isn't open to receive it
- Added `content_scripts`, `scripting` permission, and `angelthump.com` host permissions to the manifest; `activeTab` was replaced with `tabs` since the panel needs to look up the AngelThump tab even when it isn't the active one
- Popup body height changed from fixed to `min-height` + auto so the settings panel can grow past the channel list's footprint
- Reworked the stream card layout: title truncates with an ellipsis instead of wrapping and skewing card height, the meta column vertically centers against the thumbnail, and action icons are larger with a hover state

## 0.0.4 — maintenance
- Migrated Manifest V2 → V3 (service worker background, `action` instead of `browser_action`, `activeTab` instead of broad `tabs` permission)
- Rewrote `Strims.js` to use `fetch` instead of jQuery `$.ajax` (jQuery/DOM APIs aren't available in a service worker)
- Removed dead Mixer redirect code (Mixer shut down in 2020)
- Removed unused `declarativeContent`/`notifications` permissions and the redundant `App.js`/jQuery load in the background context
- Removed `html/background.html` (unused MV2 artifact; service workers have no host page) and stray vendored `bootstrap.js` (unminified) / `npm.js` (Grunt CommonJS shim, unused)
- Upgraded vendored libs: jQuery 3.4.1 → 3.7.1, Bootstrap 4.6.2, Popper.js 1.16.1, Clipboard.js 2.0.11 (kept within Bootstrap 4/Popper 1 — Bootstrap 5 would break the `col-xs-*` grid classes and tooltip data-attributes used in `app.html`, so that's a separate follow-up, not a drop-in upgrade)

## 0.0.3
**Updated:**
- Viewer numbers now use `rustlers` (strims.gg's term) from the API
- Fixed clipboard tooltip to hide correctly until pressed again
- Streams now sort by viewer count
- Badge background is now orange-themed
- Shrunk the popup window to about 2 streams worth of height

**New:**
- Favorite button
- Favoriting changes badge behavior to show count of live favorite streams
- Scrollbar styling
- Button to detect if you're on another streaming site and quick-link to its strims.gg embed

## 0.0.2
- Fixed a bug with strim link URL generation
- Added local storage caching of the stream list
- Adjusted refresh interval to two minutes

## 0.0.1
- Initial release
