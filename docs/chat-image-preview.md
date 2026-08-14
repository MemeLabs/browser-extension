# Chat image hover-preview — feasibility notes

Investigating whether the extension could add hover-to-preview for
image links posted in strims.gg chat (`https://chat.strims.gg/`).
Source: [MemeLabs/chat-gui](https://github.com/MemeLabs/chat-gui)
(cloned locally to `../chat-gui` for reference, not part of this
extension's own codebase), commit `13fa78f` at time of writing,
`sgg-chat-gui` v2.1.24.

## Where chat lives

- Standalone page at `https://chat.strims.gg/`. It also gets embedded
  as an iframe on `strims.gg` stream pages, same origin/host either
  way, so a content script matching `https://chat.strims.gg/*` with
  `all_frames: true` reaches it in both contexts — same pattern this
  extension already uses for the AngelThump latency-lock content
  scripts (`manifest.json`, `content_scripts`).
- Body class is `embed` when loaded in the iframe context; nothing
  else about the DOM structure changes.

## Message DOM structure

Each chat line is appended to a single scrolling container:

```html
<div class="chat-lines">
  <div class="msg-chat msg-user" data-username="...">
    <time class="time" title="...">09:43</time>
    <a class="user" style="background-image:url(data:...)" ...>username</a>
    <span class="text">
      ... message text, with links formatted inline ...
    </span>
  </div>
  ...
</div>
```

(`assets/chat/js/messages.js:264` — `classes.unshift('msg-chat')`;
`assets/chat/js/formatters.js` renders the `<span class="text">`
contents.)

## How links are currently rendered — the gap

All link formatting goes through `UrlFormatter.format()` in
`assets/chat/js/formatters.js:692-757`. It matches URLs in the raw
message text via `linkregex`, then branches:

- **Known video embeds** (YouTube, Facebook videos, media.ccc.de) —
  matched against a hardcoded `embedSubstitutions` list
  (`formatters.js:600-666`) and rendered as a pair of anchors:
  ```html
  <a class="embed-internallink" href="https://strims.gg/youtube/ID">youtube/ID</a
  ><a class="embed-externallink" href="https://youtube.com/watch?v=ID" ...></a>
  ```
  This is what powers the "Open on strims.gg" video embed you see
  today.
- **Everything else, including image links** — falls through to a
  plain link, no embed/preview of any kind:
  ```html
  <a target="_blank" class="externallink" href="..." rel="nofollow">...</a>
  ```

Confirmed live on `chat.strims.gg` — a message containing
`https://i.gyazo.com/....png` renders as a bare `.externallink`, same
as any other URL. **There is no existing image-preview or embed
system for image links in chat-gui at all** — not something we'd be
duplicating or conflicting with, and not something gated behind a
user setting we'd need to detect. A Twitter/nitter embed existed in
the substitutions list at one point but is currently commented out
(`formatters.js:715-724`).

There's also a `pref-shortenlinks` setting that truncates long URLs
in the middle with an `<span class="ellipsis-hidden">` for the hidden
portion — relevant if a preview feature wants the *full* URL rather
than the truncated display text (read `href`, not `textContent`).

## What a hover-preview content script would look like

Nothing in chat-gui needs to change — this is purely additive from
the extension side, matching the same shape as the existing Latency
Lock content scripts:

1. New content script, `matches: ["https://chat.strims.gg/*"]`,
   `all_frames: true` (to also catch the embedded-in-strims.gg-page
   case), `run_at: document_idle` is fine (no need for
   `document_start` — nothing here needs to race the page's own
   script).
2. Delegate a `mouseenter`/`mouseover` listener on `.chat-lines` for
   `a.externallink` elements (event delegation, since lines are
   appended continuously — attaching one listener per link would leak
   as chat scrolls and prunes old lines).
3. Filter to links whose `href` matches an image extension
   (`.png .jpg .jpeg .gif .webp .apng`) or, better, a small allowlist
   of known direct-image hosts (`i.imgur.com`, `i.gyazo.com`,
   `i.redd.it`, `cdn.discordapp.com/attachments/...`) to avoid
   spamming `<img>` requests at arbitrary URLs that merely *end* in
   something that looks like an extension.
4. On hover, position a floating `<img>` preview near the cursor
   (fixed-position div injected once, reused, `src` swapped per
   hover); hide it on `mouseleave`. Debounce/delay so a fast
   mouse-pass over several links in a burst of messages doesn't fire
   a request per link.
5. No manifest permission changes needed beyond adding
   `https://chat.strims.gg/*` to `host_permissions` and a
   `content_scripts` entry — the preview `<img>` just points its
   `src` at the original image host directly (same as the chat page
   itself would if it rendered a plain `<img>`), no fetch/CORS
   involved.

## NSFW/NSFL/loud/weeb tagging — investigated, not a usable signal

`UrlFormatter` does tag links with `nsfl-link` / `nsfw-link` /
`loud-link` / `weeb-link` classes when the message containing them has
`NSFL`/`NSFW`/`LOUD`/`SPOILER`/`WEEB` as a whole word anywhere in the
text (`formatters.js:698-706`). Visually this is barely noticeable —
easy to miss scrolling past in a live chat — which is why it wasn't
obvious just from watching the page:

| Tag | Rendered as | Color (`common.scss:48-72`) |
|---|---|---|
| NSFW | 1px dashed underline | `#FF0000` red |
| NSFL | 1px dashed underline | `#FFF000` yellow |
| LOUD/SPOILER | 1px dashed underline | `#02C2FF` — identical to a normal link's color |
| WEEB | 1px dashed underline | `#fb91ff` pink |

No icon, no blur, no click-to-reveal — just a thin colored underline
instead of solid (`style.scss:490-501`).

**Important limitation: this is not real metadata about the image.**
It's a keyword the *poster* chose to type somewhere in the same chat
message — there's no server-side classification of the linked
content, so a genuinely NSFW image with no keyword gets no tag at
all, and the tag can be wrong, sarcastic, or simply forgotten. Given
that, gating hover-preview behavior (suppressing/blurring) on these
classes would give a false sense of safety rather than actual
protection — not worth building on. If a preview feature wants
*any* softening for flagged links, it should treat the tag as "the
poster is telling chat something, maybe worth an extra click," not as
a reliable content filter.

## Open questions before building this

- **Host allowlist vs. extension-sniffing**: a strict allowlist is
  safer (avoids previewing e.g. a phishing page whose URL happens to
  end in `.png`) but needs maintaining as new image hosts show up in
  chat; extension-sniffing is more permissive but noisier.
- **Popup vs. content-script scope**: this is entirely a
  `chat.strims.gg` content-script feature — it has no interaction
  with the existing popup, background poller, or Latency Lock code,
  so it'd ship as its own isolated addition (new
  `js/chat-preview/*.js`, its own settings-panel toggle if desired).
