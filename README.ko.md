# SlopSkip

[Read this README in English](./README.md)

SlopSkip은 숏폼 피드에서 AI 슬롭으로 보이는 콘텐츠를 로컬에서 감지하고 넘기기 위해 만든 크롬 확장 프로그램입니다.

아직 완성형 제품은 아니고 MVP 단계입니다. 목표는 "완벽한 AI 판별"이 아니라, 실제 피드에서 쓸 만한 사용자 주도형 로컬 필터를 만드는 것입니다.

## 이 프로젝트가 하는 일

- 다음 같은 신호를 모아서 게시물을 점수화합니다.
  - 공식 AI 라벨
  - 캡션 텍스트
  - 해시태그
  - 댓글 반응
  - 크리에이터 허용/차단 투표
- 영어와 한국어 중심 규칙을 사용합니다.
- 브라우저 안에서 로컬로 동작합니다.
- 차단 강도를 조절할 수 있습니다.
- 크리에이터별로 다음처럼 저장할 수 있습니다.
  - 항상 차단
  - 항상 허용

## 현재 지원 상태

- TikTok Web
  - 자동 점수 계산
  - 자동 스킵 MVP
- Instagram Reels Web
  - 릴스 프로브
  - 캡션/댓글 신호 수집
  - 자동 스킵 안정화 진행 중

## 왜 만들었나

숏폼 피드에는 저품질 AI 콘텐츠가 많이 섞여 있고, 사용자는 이걸 계속 보고 싶지 않을 수 있습니다. 그런데 대부분의 제어권은 플랫폼에 있고, 내부 기준도 잘 보이지 않습니다.

SlopSkip은 다음 방향을 목표로 합니다.

- 로컬 우선
- 사용자가 직접 제어 가능
- 어느 정도 설명 가능한 판정
- MVP 단계에서는 원격 OCR, 원격 LLM 의존 없음

## 동작 방식

큰 흐름은 이렇습니다.

1. content script가 현재 열린 플랫폼을 확인합니다.
2. 플랫폼 어댑터가 현재 활성 게시물을 찾습니다.
3. 페이지 DOM에서 신호를 추출합니다.
4. 점수 계산기가 신호를 합쳐 최종 점수를 만듭니다.
5. 점수가 임계값을 넘으면 게시물을 넘깁니다.
6. popup/options에서 동작을 확인하고 조절할 수 있습니다.

## 주요 기능

- 캡션, 댓글, 해시태그, 라벨 기반 로컬 점수 계산
- 크리에이터 허용/차단 투표
- 민감도 조절
- 왜 차단됐는지 보는 디버그 보기
- 릴스 캡션 더보기 자동 누르기 옵션
- 다시 본 게시물 일시 정지 동작

## 개인정보 / 프라이버시

SlopSkip은 로컬 우선 방식으로 설계되어 있습니다.

- 설정은 `chrome.storage.local`에 저장됩니다.
- 크리에이터 투표도 로컬에 저장됩니다.
- MVP 단계에서는 페이지 내용을 외부 AI 서비스로 보내지 않습니다.
- 원격 OCR 파이프라인을 사용하지 않습니다.

## 권한

현재 사용하는 권한은 다음과 같습니다.

- `storage`
- `https://www.tiktok.com/*`
- `https://www.instagram.com/*`

## 설치 방법

1. 의존성 설치

```bash
npm install
```

2. 빌드

```bash
npm run build
```

3. Chrome에서 아래 주소로 이동

```text
chrome://extensions
```

4. 개발자 모드 켜기
5. `압축해제된 확장 프로그램을 로드합니다` 클릭
6. 아래 폴더 선택

```text
dist
```

## 개발 명령어

1회 빌드:

```bash
npm run build
```

감시 모드:

```bash
npm run watch
```

타입 체크:

```bash
npm run typecheck
```

## 폴더 구조

- `src/content`
  - content script
  - 플랫폼 어댑터
  - 점수 계산
  - 스킵 로직
  - toast/debug UI
- `src/background`
  - background 진입점
- `src/popup`
  - 빠른 설정 UI
- `src/options`
  - 상세 설정 UI
- `src/shared`
  - 상수, storage helper, i18n helper
- `docs`
  - 구조 문서
  - selector 문서
  - 테스트 메모

## 중요한 점

- 이 프로젝트는 휴리스틱 기반 필터입니다.
- 100% 진실 판별기가 아닙니다.
- 오탐과 미탐이 모두 가능합니다.
- Instagram Reels는 UI 상태가 예민해서 자동 스킵을 특히 조심해서 다듬는 중입니다.
- 캡션 더보기 자동 누르기를 켜면 화면에 잠깐 영향이 갈 수 있습니다.

## 로드맵

- Reels 자동 스킵 안정화
- 캡션/댓글 신호 품질 개선
- 크리에이터 평판 기능 보강
- 로컬 설정 import/export 개선
- YouTube Shorts 어댑터
- 더 많은 언어 지원

## 문서

- `docs/architecture.md`
- `docs/plan.md`
- `docs/selectors.md`
- `docs/reels-probe-report.md`
- `docs/testing.md`

## 언어 안내

GitHub는 방문자 언어에 따라 README를 자동으로 바꿔 보여주지 않습니다.

그래서 이 저장소는 다음 방식으로 구성했습니다.

- `README.md`: 영어 버전
- `README.ko.md`: 한국어 버전
