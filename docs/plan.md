# plan.md

## 목표

SlopSkip MVP는 TikTok Web에서 텍스트 기반 신호만으로 AI 슬롭 가능성이 높은 숏폼을 자동 스킵하고, Instagram Reels는 동일 아키텍처로 확장 가능한지 probe/debug 방식으로 검증하는 것이 목표입니다.

## 실행 계획

1. MV3 기반 확장 구조와 빌드 파이프를 구성한다.
2. 공용 타입, storage schema, i18n 구조를 먼저 고정한다.
3. TikTok active item 탐지, caption/hashtag/comment/AI label 추출을 구현한다.
4. English/Korean locale-aware scoring과 creator vote 우선순위를 구현한다.
5. dry-run, toast, debug overlay, TikTok auto-skip cooldown을 구현한다.
6. popup/options에서 상태 확인과 로컬 설정 제어를 제공한다.
7. Reels probe 어댑터로 읽을 수 있는 DOM 필드를 구조화해 출력한다.
8. selector/테스트/architecture 문서를 정리한다.

## 가정

- TikTok은 live DOM 또는 `__UNIVERSAL_DATA_FOR_REHYDRATION__`에서 현재 아이템 정보 일부를 읽을 수 있다.
- Reels public page에서는 full caption과 creator link가 비교적 읽히지만, 피드형 `/reels/` DOM은 더 불안정할 수 있다.
- MVP는 설명 가능성과 유지보수성을 우선하며, recall보다 false positive 억제를 더 중요하게 본다.

## 리스크

- TikTok selector 또는 JSON 필드 변경
- Instagram 로그인 상태/실험군에 따른 DOM 구조 차이
- 약한 단일 “AI” 토큰이 과잉 점수화될 위험

## 플랫폼 전략

- TikTok: 정식 MVP 지원
- Reels: probe/debug only
- 추가 플랫폼은 adapter 인터페이스 재사용을 전제로 이후 확장

## 로컬라이징 전략

- `_locales/en/messages.json`, `_locales/ko/messages.json` 사용
- UI 문자열과 reason label을 모두 i18n 키로 관리
- UI locale과 별개로 scoring rule은 텍스트별 언어 휴리스틱으로 적용
