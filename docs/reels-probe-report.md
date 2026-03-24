# reels-probe-report.md

## 실측 결과

- public reel page에서는 전체 caption이 embedded JSON 또는 meta description에서 읽히는 경우가 있었다.
- creator profile link는 DOM 또는 embedded JSON에서 읽혔다.
- hashtag는 full caption에서 파생 가능했다.
- initial visible comment text는 샘플에 따라 비어 있거나 제한적이었다.
- 안정적인 “official AI label” 경로는 아직 확정되지 않았다.

## 지금 읽을 수 있는 것

- active reel 후보 article
- creator handle / profile path
- full caption 가능성
- hashtag
- 일부 visible body text

## 제한 사항

- `/reels/` 피드형 active container 안정성 미확정
- comment text availability 낮음
- extra interaction이 필요한 DOM과 hidden DOM의 구분이 상태별로 달라질 수 있음

## 결론

Reels는 text-first probe 아키텍처에는 잘 맞지만, full auto-skip을 약속하기에는 아직 근거가 부족합니다. 따라서 MVP에서는 probe/debug only가 맞습니다.
