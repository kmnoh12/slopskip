# SlopSkip

SlopSkip은 숏폼 피드에서 페이지에 이미 보이거나 임베디드된 텍스트 신호만 읽어, AI 슬롭 가능성이 높은 콘텐츠를 로컬에서 점수화하고 건너뛰는 Chrome 확장 MVP입니다.

현재 지원 범위:
- TikTok Web: 자동 판정 + 자동 스킵 MVP
- Instagram Reels Web: probe/debug 전용

## 핵심 기능

- 공식 AI 라벨, 캡션, 해시태그, 현재 보이는 댓글, 로컬 creator vote를 기반으로 점수 계산
- English / Korean 로케일 파일과 언어 휴리스틱 기반 규칙 분리
- dry-run 모드와 on-page debug overlay
- creator 로컬 allow/slop 투표
- 외부 서버 전송 없는 local-first 동작

## 설치

1. `npm install`
2. `npm run build`
3. Chrome에서 `chrome://extensions` 열기
4. Developer mode 켜기
5. `C:\Users\kmnoh\slopskip\dist`를 Load unpacked로 불러오기

## 사용법

- TikTok 또는 Instagram Reel 페이지를 연 뒤 popup에서 `Enable`, `Dry-run`, `Debug`를 조정합니다.
- `Mark creator as slop`, `Allow creator`, `Remove creator vote`로 현재 creator에 대한 로컬 투표를 저장할 수 있습니다.
- dry-run에서는 실제 스킵 대신 “would skip” 토스트와 점수 breakdown만 보여줍니다.
- debug mode에서는 현재 platform, active item, creator key, 점수, 매치된 규칙이 오버레이에 표시됩니다.

## 개인정보 / 권한

- 필요한 권한은 `storage`, `https://www.tiktok.com/*`, `https://www.instagram.com/*`입니다.
- 확장은 페이지에 이미 렌더된 텍스트와 페이지 내 임베디드 데이터만 읽습니다.
- creator vote와 설정은 `chrome.storage.local`에만 저장됩니다.
- 외부 서버 전송, OCR, 비디오 프레임 분석, 클라우드 LLM 호출은 MVP에 포함되지 않습니다.

## 문서

- `docs/plan.md`: 실행 계획, 가정, 리스크, tradeoff
- `docs/architecture.md`: 모듈 책임, 데이터 흐름, storage 구조
- `docs/selectors.md`: TikTok/Reels 핵심 선택자와 fallback 전략
- `docs/reels-probe-report.md`: Reels DOM 실측 결과와 feasibility 결론
- `docs/testing.md`: 수동 테스트 매트릭스와 디버깅 체크리스트

## 향후 로드맵

- Reels feed auto-skip 정식 지원
- creator vote import/export
- 커뮤니티 기반 reputation backend
- YouTube Shorts adapter
- 더 많은 언어 규칙 세트
- 선택적 경량 로컬 classifier 또는 meme hashing 보조 신호
