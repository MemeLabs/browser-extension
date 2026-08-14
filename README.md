# strims-live-extension

Browser extension (Chrome & Firefox, Manifest V3) that shows which [strims.gg](https://strims.gg) channels are currently live, lets you favorite and get notified about channels, and includes a playback latency lock for AngelThump streams.

It doesn't stream or host any video itself — it's a lightweight listing/navigation layer on top of the strims.gg API, plus a client-side playback controller for AngelThump.

## Screenshots

| Live channel list | Settings — General | Settings — Latency Lock |
| --- | --- | --- |
| ![Popup showing the live channel list, All/Favorites filter, and Alt button](screenshots/popup-main.png) | ![Settings panel General tab with refresh interval and favorites list](screenshots/popup-settings-general.png) | ![Settings panel Latency Lock tab with delay slider and telemetry](screenshots/popup-settings-latency.png) |

## Installation

There's no build step for development — all dependencies (jQuery, Bootstrap, Popper, Clipboard.js) are vendored under `js/libs/`. You can either clone this repo directly, or download the packaged zip from the [Releases page](../../releases) (or build one yourself — see [Packaging a release](docs/development.md#packaging-a-release) in the dev docs).

### Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the extension folder (where `manifest.json` lives) — either your local clone, or the folder you unzipped the release package into
4. That's it — unpacked extensions in developer mode persist across restarts, no further steps needed

### Firefox

**Quick test (temporary — gets removed on restart):**

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `manifest.json` inside the extension folder

Firefox removes it as soon as you close the browser, and you'll need to repeat these steps next launch. This is fine for a quick look, not for regular use.

**Permanent install (survives restarts):**

Stock/release Firefox hard-locks extension signature enforcement — no setting will get an unsigned extension to persist there. A permanent install needs either the extension to be signed by Mozilla (via [addons.mozilla.org](https://addons.mozilla.org), even for self-distribution outside their store — not done for this release yet), or a Firefox channel that allows disabling signature enforcement:

1. **Check your channel first**: open `about:support` → "Application Basics" → look at the **Name** field. Only **Firefox Developer Edition**, **Firefox Nightly**, and **Firefox ESR** can disable signature enforcement — regular "Firefox" and "Firefox Beta" cannot, no matter what you set below. If you're on regular Firefox, install [Firefox Developer Edition](https://www.mozilla.org/en-US/firefox/developer/) alongside it — it's a separate application with its own profile, it won't touch or replace your existing Firefox install.
2. In that channel, open `about:config`, search for `xpinstall.signatures.required`, and set it to `false`. Restart the browser.
3. Go to `about:addons` → gear icon (⚙) → **"Install Add-on From File..."** → select the packaged `.zip` (see [Packaging a release](docs/development.md#packaging-a-release) in the dev docs, or grab it from a GitHub Release). **Note:** `about:debugging`'s "Load Temporary Add-on" is *always* temporary regardless of this setting — you must install via `about:addons` to get a persistent install.

## Features

- **Live channel list** — popup shows currently live strims.gg streams (AngelThump-hosted), favorites sorted first, then by viewer count.
- **All / Favorites filter** — toggle the list between everything live and just your favorites.
- **Auto-refresh** — background service worker polls `https://strims.gg/api` on a configurable interval (default 2 minutes).
- **Toolbar badge** — live-stream count (orange); switches to your live-favorites count once you have favorites.
- **Favorites** — synced across devices via `storage.sync`; manage and unfollow them from Settings → General, including per-favorite notification muting.
- **Go-live notifications** — a desktop notification when a favorited channel goes live (skips channels you've muted); click it to open the stream.
- **Copy link** — one-click copy of a stream's strims.gg URL, with a "Copied!" tooltip.
- **Alt egress button** — opens strims.gg's advanced egress/server picker for that stream (`strims.gg/advanced/https://stream.batperson.com/{channel}`).
- **Cross-site redirect** — if the active tab is a Twitch live channel/VOD or YouTube video/playlist, an "Open on Strims" button rewrites the tab to the matching strims.gg route.
- **Latency Lock** (Settings → Latency Lock tab) — folded in from the standalone *AngelThump Latency Lock* extension. Locks AngelThump stream playback to a configurable 9–60s delay behind live by seeking, pausing to build a buffer reserve, tuning hls.js's own catch-up settings, and blocking the player's native forward-jumps back to the live edge. Runs as a content script on `angelthump.com` (including the `player.angelthump.com` iframe strims.gg embeds), independent of the strims.gg API polling above.
- **Loading/error states** — the popup shows "Loading…" on first open and a "Couldn't load streams — Retry" state on failure, instead of going silently blank.
- **Feedback link** — Settings → General links out to file an issue or feature request on GitHub.
- **Chat image hover-preview** — on `chat.strims.gg` (including when it's embedded in a strims.gg stream page), hovering a link to a direct image file, a single-image `imgur.com/<id>` page, or an `imgur.com/a/<id>`/`imgur.com/gallery/<id>` album shows a floating preview near the cursor. Album covers are resolved via their Open Graph metadata (a background fetch, since imgur has no public JSON endpoint for this without an API key). Toggle it off in Settings → General ("Preview image links on hover in chat"). See [`docs/chat-image-preview.md`](docs/chat-image-preview.md) for the investigation into why this doesn't already exist in strims.gg's own chat client ([chat-gui](https://github.com/MemeLabs/chat-gui)).

## Developer docs

Packaging a release, project structure, permissions, and known limitations have moved to [`docs/development.md`](docs/development.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full itemized history.
