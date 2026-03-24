# selectors.md

## TikTok 핵심 선택자

- `article[id^="one-column-item-"]`
- `[data-e2e="recommend-list-item-container"]`
- `section[id^="media-card-"]`
- `[data-e2e="feed-video"]`
- creator link fallback: `a[href^="/@"]`
- comment fallback: `[data-e2e="comment-item"]`

## TikTok fallback 데이터

- `__UNIVERSAL_DATA_FOR_REHYDRATION__`
- `itemInfo.itemStruct.desc`
- `itemInfo.itemStruct.textExtra`
- `itemInfo.itemStruct.author`
- `itemInfo.itemStruct.IsAigc`
- `itemInfo.itemStruct.aigcLabelType`
- `itemInfo.itemStruct.AIGCDescription`

## TikTok fragility notes

- `/foryou`는 공개 HTML dump에서 카드 DOM이 약했고, 실제 런타임 hydration을 전제로 해야 한다.
- 어떤 필드는 visible DOM보다 rehydration JSON이 더 안정적일 수 있다.
- comment DOM은 페이지 상태에 따라 전혀 없을 수 있다.

## Instagram Reels probe 선택자

- `main article`
- `article[role='presentation']`
- `article`
- creator link fallback: `/username/` 형태 프로필 링크
- caption fallback: `meta[name="description"]`, embedded JSON script

## Reels fragility notes

- public reel page와 `/reels/` feed UI는 구조가 다를 수 있다.
- visible comments는 count만 있고 text가 비어 있을 수 있다.
- caption expansion이 hidden DOM인지 추가 주입인지 상태별 검증이 더 필요하다.
