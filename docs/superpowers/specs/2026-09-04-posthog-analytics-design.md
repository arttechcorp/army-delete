# PostHog 분석 시스템 설계 문서 (Design Specification)

## 1. 개요 (Overview)

본 문서는 `군생활 삭제 버튼` 웹 애플리케이션에 **PostHog** 프로덕트 분석 도구를 도입하여, 마케팅 유입 경로(UTM) 파악, 사용자 인게이지먼트(헤비유저/이탈률), 인게임 이코노미(상점/광고), 그리고 **리더보드 참여와 리텐션(재방문율)의 상관관계**를 정량적으로 측정 및 분석하기 위한 설계 사양서입니다.

---

## 2. 핵심 분석 목표 (Key Analytics Goals)

1. **마케팅 채널별 UTM 유입 및 전환율 측정**: 에브리타임, 디시인사이드, 인스타그램, 카카오톡 지인 공유 등 채널별 신규 방문자 수 및 활성 유저 비교.
2. **헤비 유저 비율 및 온보딩 이탈률(Drop-off) 분석**: 첫 방문에서 첫 클릭, 10회 삭제, 상점 오픈, 첫 아이템 구매까지의 퍼널 이탈 지점 규명.
3. **인게임 이코노미(Economy) 및 수익화 최적화**: 아이템별 구매 선호도(배수 vs 자동 대원), H5 보상형 광고 시청 완료율 및 애드블록/로드 실패율 추적.
4. **리더보드와 리텐션의 상관관계 검증**: Google 로그인 및 군 소속 등록 유저(`is_leaderboard_user = true`)와 비로그인 일반 유저 간의 D1/D7/D30 리텐션 커브 비교.

---

## 3. SDK 아키텍처 및 초기화 설정 (Architecture & Initialization)

### 3.1 SDK 로더
* `index.html`의 `<head>` 영역에 PostHog 공식 비동기 스크립트 로더 스니펫 삽입.
* 단일 파일 구조 특성을 살려 환경 설정 변수로 프로젝트 키와 호스트 분리.

```javascript
var POSTHOG_KEY = window.ENV_POSTHOG_KEY || 'phc_PLACEHOLDER_KEY';
var POSTHOG_HOST = window.ENV_POSTHOG_HOST || 'https://us.i.posthog.com';
```

### 3.2 클라이언트 설정값
* `api_host`: `https://us.i.posthog.com` (또는 사용자 리전에 맞는 호스트)
* `autocapture: false`: 불필요한 DOM 전역 클릭 이벤트 수집을 비활성화하여 월간 무료 이벤트 한도(100만 건) 보존.
* `capture_pageview: true`: 첫 페이지 로드 시 페이지뷰 및 URL 내 UTM 파라미터(`$utm_source`, `$utm_medium`, `$utm_campaign`, `$utm_content`, `$utm_term`), `$referrer` 자동 캡처.
* `session_recording: true`: 사용자 인터랙션 세션 리플레이 활성화 (기본 텍스트 및 입력값 마스킹 처리).
* `persistence: 'localStorage+cookie'`: 안정적인 사용자 식별 유지.

---

## 4. 사용자 식별 체계 (Identity & User Properties)

### 4.1 비로그인 사용자 (Anonymous)
* PostHog가 자동 생성하는 브라우저 단위 `distinct_id`로 익명 추적.

### 4.2 로그인 사용자 (Authenticated)
* **트리거**: Google OAuth 로그인 성공 시 (`signInWithGoogle` 후 세션 감지)
* **호출**: `posthog.identify(user.id, user_properties)`
* **병합 효과**: 로그인 전 플레이한 익명 이벤트들과 로그인 후 이벤트가 단일 사용자 프로필로 병합됨.
* **사용자 속성 (User Properties)**:
  * `branch`: 소속 군 (`육군`, `해군`, `공군`, `해병대` 등)
  * `service_status`: 복무 상태 (`before`: 입대 전, `active`: 복무 중, `done`: 전역 완료)
  * `d_day`: 남은 복무 일수 (숫자)
  * `is_leaderboard_user`: `true`
  * `total_days_deleted`: 현재 시점의 누적 삭제 일수 (`ad.total`)

### 4.3 로그아웃 (Sign Out)
* **트리거**: `signOutGoogle` 호출 시
* **호출**: `posthog.reset()`으로 세션 및 고유 식별자 초기화 (공용 PC 등 다중 사용자 환경 보호).

---

## 5. 이벤트 및 데이터 스키마 (Event Schema)

> **[최적화 원칙]**  
> 클리커 특성상 버튼 연타(초당 수십 회)가 발생하므로, 매 클릭마다 이벤트를 발송하지 않고 **첫 클릭 / 마일스톤 도달 / 세션 요약(flush)** 방식으로 네트워크 부하 및 이벤트 할당량을 절약합니다.

### 5.1 코어 인터랙션 (Core Play & Engagement)

| 이벤트명 | 발송 시점 | 프로퍼티 (Payload) | 비고 |
| :--- | :--- | :--- | :--- |
| `first_delete_click` | 세션/방문 중 최초로 삭제 버튼 1회 클릭 시 | `start_date`, `end_date`, `service_status`, `d_day` | 신규 유저 활성화(Activation) 핵심 지표 |
| `click_milestone_reached` | 누적 일수(`ad.total`) 마일스톤 달성 시<br>(10, 50, 100, 500, 1,000, 5,000, 10,000일) | `milestone_days`, `current_combo`, `time_to_reach_seconds` | 헤비 유저 여부 및 단계별 도달 속도 파악 |
| `session_engagement` | `pagehide` 및 `visibilitychange` (백그라운드 전환 시) | `session_clicks`, `max_combo`, `total_days_deleted`, `spent_days`, `balance`, `session_duration_seconds` | 1회 방문당 실제 총 플레이 지표 요약 |

### 5.2 이코노미 & 상점 (Economy & Shop)

| 이벤트명 | 발송 시점 | 프로퍼티 (Payload) | 비고 |
| :--- | :--- | :--- | :--- |
| `shop_opened` | 상점 모달 오픈 시 | `current_balance`, `owned_items_count` | 상점 진입율 분석 |
| `item_purchased` | 아이템 구매 성공 시 | `item_id`, `item_name`, `price`, `item_type`(`multiplier`/`auto`), `remaining_balance` | 경제 밸런스 및 인기 아이템 순위 |
| `share_boost_activated` | 무료 공유 부스트 아이템 클릭 시 | `method` (`navigator.share` / `clipboard`), `boost_multiplier`, `boost_duration_ms` | 오가닉 바이럴 전파력 분석 |

### 5.3 광고 & 수익화 퍼널 (Monetization & Ads)

| 이벤트명 | 발송 시점 | 프로퍼티 (Payload) | 비고 |
| :--- | :--- | :--- | :--- |
| `reward_ad_clicked` | 상점 내 "광고 보고 100일 받기" 클릭 시 | `current_balance` | 광고 시청 시도율 |
| `reward_ad_completed` | 광고 시청 완료 콜백(`adViewed`) 호출 시 | `reward_days` (100), `new_balance` | 광고 보상 획득 완료율 |
| `reward_ad_failed` | `beforeReward` 미호출 또는 12초 애드블록 타임아웃 | `reason` (`no_ad`, `adblock_timeout`) | 광고 송출 이슈 및 차단율 파악 |
| `anchor_ad_closed` | 모바일 하단 배너 닫기(X) 버튼 클릭 시 | `viewport_width` | 배너 UX 방해 체감도 분석 |

### 5.4 리더보드 & 인증 (Leaderboard & Auth)

| 이벤트명 | 발송 시점 | 프로퍼티 (Payload) | 비고 |
| :--- | :--- | :--- | :--- |
| `leaderboard_opened` | 리더보드 모달 열람 시 | `is_authenticated` (로그인 여부) | 리더보드 관심도 측정 |
| `login_completed` | Google 로그인 인증 완료 시 | `has_branch` (군 소속 기등록 여부) | 가입/로그인 전환율 |
| `branch_selected` | 소속 군(육/해/공/해병) 버튼 클릭 시 | `branch`, `contributed_days` | 군별 사용자 선호 및 전력 기여도 |

---

## 6. 대시보드 인사이트 및 코호트 설정 사양 (Dashboard & Insights)

### 6.1 코호트 정의 (Cohorts)
1. **헤비 유저 (Heavy Deletors)**:
   * 조건: `total_days_deleted >= 1000` OR `owned_items_count >= 3`
2. **라이트 유저 (Casual Deletors)**:
   * 조건: `total_days_deleted` 10 ~ 999
3. **이탈/찍먹 유저 (Bouncers)**:
   * 조건: `total_days_deleted < 10`
4. **리더보드 등록 유저 (Leaderboard Active)**:
   * 조건: `is_leaderboard_user = true`

### 6.2 핵심 대시보드 구성 (Dashboard Views)
1. **마케팅 유입 분석 (Acquisition Trends)**:
   * 차트: Trends (Event: `$pageview` 및 `first_delete_click`, Breakdown by `$utm_source`, `$utm_medium`, `$utm_campaign`)
   * 산출물: 채널별 유입 점유율 및 첫 클릭 전환율 랭킹.
2. **온보딩 & 코어 퍼널 (Onboarding Funnel)**:
   * 단계: `$pageview` → `first_delete_click` → `click_milestone_reached(10)` → `shop_opened` → `item_purchased`
   * 산출물: 단계별 이탈률(Drop-off Rate) 및 전환 소요 시간.
3. **리더보드 리텐션 분석 (Leaderboard vs Retention)**:
   * 차트: Retention Insight (D1, D7, D14, D30)
   * 비교: `Leaderboard Active` 코호트 vs `Non-Leaderboard` 코호트의 재방문율 비교.
4. **이코노미 & 광고 퍼널**:
   * 차트 1: 아이템별 누적 판매량 (`item_purchased` breakdown by `item_name`)
   * 차트 2: 보상형 광고 퍼널 (`shop_opened` → `reward_ad_clicked` → `reward_ad_completed`)

---

## 7. 개인정보처리방침 및 규정 준수 (Privacy & Compliance)

* `privacy.html` 내 "제3자 서비스 및 쿠키" 섹션에 PostHog 관련 내용 추가:
  * 서비스 제공자: PostHog, Inc.
  * 수집 목적: 사용자 행동 분석, 서비스 개선 및 오류 디버깅 (세션 리플레이)
  * 수집 항목: 접속 환경 정보(기기, 브라우저, OS), 이용 기록, 익명 식별자, UTM 매개변수
  * 데이터 보존 기간 및 세션 리플레이 마스킹 정책 명시.

---

## 8. 구현 검증 계획 (Verification Plan)

1. **로컬 환경 격리 검증**: 로컬(`localhost`) 실행 시 디버그 로그(`posthog.debug()`)를 통해 각 이벤트와 프로퍼티가 정상적으로 포맷팅되어 나가는지 확인.
2. **UTM 파라미터 파싱 검증**: `?utm_source=test&utm_medium=banner&utm_campaign=launch` 파라미터를 붙여 접속 시 `$pageview` 이벤트 프로퍼티에 정확히 캡처되는지 확인.
3. **마일스톤 최적화 검증**: 100회 클릭 시 100개의 이벤트가 발송되지 않고 지정된 마일스톤(10, 50, 100) 및 세션 종료 시점에만 발송되는지 이벤트 수 카운트 확인.
4. **로그인 연동 및 프로퍼티 동기화 검증**: Google 로그인 시 `identify` 및 `is_leaderboard_user: true` 등록 여부 확인.
