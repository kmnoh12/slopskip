# testing.md

## TikTok 테스트 매트릭스

- official AI label present
- explicit AI disclosure in caption
- AI hashtags only
- weak single AI token only
- strong English anti-slop comments
- strong Korean anti-slop comments
- comments absent
- locally blocked creator
- locally allowed creator
- mixed-language caption/comments
- repeated same comments
- fast scroll race condition
- skip cooldown
- dry-run only

## Reels probe 테스트 매트릭스

- active reel candidate detection
- creator extraction
- full caption extraction
- collapsed caption full-DOM availability
- hashtag extraction
- visible comments extraction
- visible AI text extraction
- debug overlay / console logging quality

## False Positive 체크리스트

- “not ai”, “AI 아님” 같은 반대 신호
- 농담/비꼼 댓글
- 단독 “AI” 토큰만 있는 경우
- allow 처리한 creator
- 댓글이 전혀 없는 일반 영상

## False Negative 체크리스트

- 공식 AI 라벨만 있고 캡션/댓글은 약한 경우
- 캡션은 약하지만 댓글 반응이 강한 경우
- 영문 캡션 + 한글 댓글 혼합
- 보이지는 않지만 DOM엔 전체 caption이 남아 있는 경우

## 디버깅 체크리스트

- popup에서 dry-run / debug 상태 확인
- on-page debug panel 필드 확인
- creator vote가 점수에 즉시 반영되는지 확인
- skip 이후 item id가 바뀌는지 확인
- selector가 깨진 경우 fallback JSON이 작동하는지 확인
