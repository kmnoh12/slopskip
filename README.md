<div align="center">

# SlopSkip

**A local-first Chrome extension that skips likely AI slop in short-form feeds.**

[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](./manifest.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](./tsconfig.json)
[![Local first](https://img.shields.io/badge/privacy-local--first-2E7D32)](#privacy)
[![Tests](https://img.shields.io/badge/tests-npm%20test-0F766E)](#development)

[한국어](./README.ko.md) · [Install](#quick-start) · [Features](#features) · [Development](#development) · [Docs](#documentation)

</div>

---

SlopSkip watches supported short-form feeds, scores the active post using visible page signals, and can automatically move past posts that cross your threshold. It is built for people who want a practical, explainable, user-controlled filter—not a remote AI judge.

> **Status:** MVP / active tuning. TikTok Web and Instagram Reels Web are supported, with Reels receiving the most reliability work.

## Table of Contents

- [Why SlopSkip](#why-slopskip)
- [Features](#features)
- [Platform Support](#platform-support)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Privacy](#privacy)
- [Development](#development)
- [Project Layout](#project-layout)
- [Reliability Notes](#reliability-notes)
- [Limitations](#limitations)
- [Documentation](#documentation)

## Why SlopSkip

Short-form platforms give users limited control over low-effort AI content. SlopSkip takes the opposite approach:

- **Local-first:** preferences and learned signals stay in your browser.
- **Inspectable:** optional debug UI shows how a score was produced.
- **Tunable:** thresholds, creator choices, and custom phrases are editable.
- **Recoverable:** import/export, reset, undo, and manual revisit behavior reduce risk.
- **No remote AI dependency:** the MVP does not send page content to an external LLM or OCR service.

## Features

| Area | What you get |
| --- | --- |
| Feed filtering | Scores the current post and can auto-skip when the score crosses your threshold. |
| Reels support | Uses caption/comment collection, active reel detection, skip retries, and transition confirmation. |
| User control | Choose filter strength, pause on manual revisit, and mark creators as allow/filter. |
| Custom rules | Add English, Korean, or shared keyword rules from detailed settings. |
| Explainability | Popup reason chips and an optional debug panel show score sources and skip breadcrumbs. |
| Local data tools | View, copy, download, import, reset, clear, or undo local preferences. |
| Stability hardening | Handles extension reloads, stale content scripts, route exits, storage races, and long sessions. |

## Platform Support

| Platform | Status | Notes |
| --- | --- | --- |
| TikTok Web | MVP | Scores visible posts and attempts automatic skipping. |
| Instagram Reels Web | Active tuning | Reads labels, captions, comments, hashtags, creator signals, and uses multiple skip fallbacks. |
| YouTube Shorts | Planned | Not implemented yet. |

## Quick Start

```bash
npm install
npm run build
```

Then load the extension in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `dist` folder.
5. Refresh any open TikTok or Instagram tabs after rebuilding.

## Usage

1. Open TikTok Web or Instagram Reels Web.
2. Click the SlopSkip extension icon.
3. Turn **Auto-filter** on.
4. Pick a filter strength.
5. Optional: enable **Show reasons** to inspect scoring.
6. Use creator actions to always allow or more aggressively filter the current creator.

For deeper tuning, open **Detailed settings** from the popup.

## How It Works

```text
Supported page
  → platform adapter finds active post
  → visible signals are extracted
  → scoring engine combines heuristics + local rules + feedback
  → threshold check decides whether to skip
  → popup/options/debug UI explain and tune the behavior
```

Signals currently include:

- official AI labels or disclosure text
- captions and hashtags
- comment reactions around AI/fake/slop/render/CGI cues
- Korean and English phrase patterns
- contradiction signals such as “not AI”
- creator allow/filter votes
- learned local phrase scores
- custom keyword lists

## Privacy

SlopSkip is designed to keep control local.

- Settings are stored in `chrome.storage.local`.
- Creator choices and learned phrase scores stay in the browser.
- Custom keyword rules stay in the browser.
- Page content is not sent to a remote AI service in the MVP.
- No remote OCR or remote LLM pipeline is used in the MVP.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `storage` | Save local settings, creator choices, learned phrase scores, and custom rules. |
| `https://www.tiktok.com/*` | Read visible feed signals and attempt skip interactions on TikTok Web. |
| `https://www.instagram.com/*` | Read visible Reels signals and attempt skip interactions on Instagram Web. |

## Development

```bash
npm install
npm run build
npm run watch
npm run typecheck
npm test
```

| Command | Purpose |
| --- | --- |
| `npm run build` | Builds the Chrome extension into `dist`. |
| `npm run watch` | Rebuilds during development. |
| `npm run typecheck` | Runs TypeScript checks. |
| `npm run test:scoring` | Runs scoring smoke tests. |
| `npm run test:storage` | Runs storage migration and consistency tests. |
| `npm test` | Runs typecheck, scoring tests, and storage tests. |

## Project Layout

```text
src/background      background message handling
src/content         content script, adapters, scoring, skip logic, debug UI
src/options         detailed settings dashboard
src/popup           quick controls popup
src/shared          constants, types, storage, i18n, shared UI helpers
scripts             build and smoke-test scripts
docs                architecture, selectors, Reels probe, and testing notes
_locales            Chrome i18n messages
public              extension assets copied into dist
```

## Reliability Notes

SlopSkip includes safeguards for messy real-world feed behavior:

- extension-context invalidation cleanup after reloads
- stale content-script instance detection
- Reels transition confirmation and retry scheduling
- fallback skip tactics for Reels controls, keyboard, wheel, and scroll
- storage write serialization to avoid lost local updates
- delayed reads so UI does not observe stale state mid-write
- route-exit cleanup so scores and debug panels do not linger outside supported pages
- capped in-memory item tracking for long browsing sessions
- import sanitization for thresholds, rules, votes, and learned scores

## Limitations

- Heuristics can produce false positives and false negatives.
- Platform DOM changes can break selectors or skip behavior.
- Reels transitions can fail when Instagram intercepts scroll or key events.
- Comment collection depends on what the current page UI exposes.
- SlopSkip is a personal filtering tool, not a moderation system or truth detector.

## Documentation

- [`docs/architecture.md`](./docs/architecture.md)
- [`docs/plan.md`](./docs/plan.md)
- [`docs/selectors.md`](./docs/selectors.md)
- [`docs/reels-probe-report.md`](./docs/reels-probe-report.md)
- [`docs/testing.md`](./docs/testing.md)

## Contributing

This repository is early-stage and intentionally compact. Before sending a change:

1. Keep filtering behavior explainable and user-controlled.
2. Prefer local-first storage and avoid remote content processing.
3. Run `npm test` and `npm run build`.
4. Document user-visible behavior changes in this README or `docs/`.

## License

No license file is currently included. If you plan to reuse or redistribute this project, open an issue or add a license first.
