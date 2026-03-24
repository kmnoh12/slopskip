# architecture.md

## 모듈 책임

- `src/content`
  - 플랫폼 감지
  - active item 탐지
  - DOM / embedded data 추출
  - scoring
  - auto-skip
  - toast / debug panel
- `src/background`
  - storage migration
  - settings message 처리
- `src/popup`
  - on/off, dry-run, debug, sensitivity
  - 현재 platform / creator / score / vote 표시
- `src/options`
  - threshold override
  - keyword override
  - local state export
- `src/shared`
  - 타입, 상수, storage helper, i18n helper

## 데이터 흐름

1. content script가 현재 hostname으로 adapter를 결정한다.
2. adapter가 active item을 찾고 signal을 추출한다.
3. scoring engine이 locale-aware 규칙과 creator vote를 합쳐 점수를 계산한다.
4. dry-run이면 toast/debug만 출력한다.
5. TikTok이고 실제 skip 조건이면 다음 아이템으로 이동을 요청한다.
6. popup/options는 storage와 content message를 통해 상태를 읽고 수정한다.

## Storage Schema

- `schemaVersion: number`
- `settings`
  - `enabled`
  - `dryRun`
  - `debugMode`
  - `showToast`
  - `sensitivity`
  - `reelsProbeEnabled`
  - `thresholdOverrides`
  - `localeRuleVisibility`
- `creatorVotes: Record<string, "slop" | "allow">`
- `platformFlags`
  - `tiktok.enabled`
  - `reelsProbe.enabled`
- `ruleOverrides`
  - `en`
  - `ko`
  - `default`

## 권한 전략

- `storage`: 로컬 설정/투표 저장
- TikTok / Instagram host permission: content script 실행과 현재 탭 URL 접근
- `scripting`, `activeTab`, `tabs`는 manifest permission에 넣지 않음
