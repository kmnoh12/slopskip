# SlopSkip

[한국어 README 보기](./README.ko.md)

SlopSkip is a Chrome extension that tries to detect likely AI slop in short-form feeds and skip it locally on your machine.

This project is still an MVP. The current goal is not perfect AI detection. The goal is to build a practical, local-first filter that works well enough on real feeds.

## What It Does

- Scores short-form posts using visible signals such as:
  - official AI labels
  - caption text
  - hashtags
  - comment reactions
  - creator allow/block votes
- Supports English and Korean-focused heuristics
- Runs locally in the browser
- Lets you tune filter strength
- Lets you mark creators as:
  - always filter
  - always allow

## Current Platform Status

- TikTok Web
  - auto scoring
  - auto skip MVP
- Instagram Reels Web
  - reels probe
  - caption/comment signal collection
  - ongoing tuning for auto skip behavior

## Why This Exists

Short-form feeds often contain low-effort AI content that users do not want to keep seeing. Most moderation tools are platform-controlled, opaque, or server-based.

SlopSkip takes a different approach:

- local-first
- user-controlled
- explainable enough to tune
- no cloud OCR or remote LLM dependency in the MVP

## How It Works

At a high level:

1. The content script checks which platform page is open.
2. A platform adapter finds the current active post.
3. Signals are extracted from the page DOM.
4. A scoring function combines those signals into a filter score.
5. If the score passes the threshold, SlopSkip can skip the post.
6. Popup and options pages let the user inspect and tune behavior.

## Features

- Local scoring based on captions, comments, hashtags, and visible labels
- Creator-level allow/block voting
- Adjustable sensitivity
- Debug view for inspecting why a post was scored a certain way
- Reels caption auto-expand option
- Manual revisit pause behavior

## Privacy

SlopSkip is designed to be local-first.

- Settings are stored in `chrome.storage.local`
- Creator votes are stored locally
- The MVP does not send page content to a remote AI service
- No remote OCR pipeline is used in the current MVP

## Permissions

The extension currently uses:

- `storage`
- `https://www.tiktok.com/*`
- `https://www.instagram.com/*`

## Installation

1. Install dependencies:

```bash
npm install
```

2. Build the extension:

```bash
npm run build
```

3. Open Chrome and go to:

```text
chrome://extensions
```

4. Turn on Developer mode
5. Click `Load unpacked`
6. Select:

```text
dist
```

## Development

Build once:

```bash
npm run build
```

Watch mode:

```bash
npm run watch
```

Type check:

```bash
npm run typecheck
```

## Project Structure

- `src/content`
  - content scripts
  - platform adapters
  - scoring
  - skip logic
  - toast/debug UI
- `src/background`
  - background entry
- `src/popup`
  - quick controls
- `src/options`
  - detailed settings
- `src/shared`
  - shared constants, storage helpers, i18n helpers
- `docs`
  - architecture notes
  - selector notes
  - testing notes

## Important Notes

- This is heuristic-based filtering, not guaranteed truth detection.
- False positives and false negatives are both possible.
- Instagram Reels behavior is still being tuned carefully because feed UI state is fragile.
- If you enable automatic caption expansion, it may briefly affect what the user sees.

## Roadmap

- Improve Reels skip stability
- Improve caption and comment signal quality
- Better creator reputation tools
- Better import/export for local preferences
- YouTube Shorts adapter
- More language coverage

## Docs

- `docs/architecture.md`
- `docs/plan.md`
- `docs/selectors.md`
- `docs/reels-probe-report.md`
- `docs/testing.md`

## Language Notes

GitHub does not automatically show a different README based on the visitor's language.

For that reason:

- `README.md` is the English version
- `README.ko.md` is the Korean version
