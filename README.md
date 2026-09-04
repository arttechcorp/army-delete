# 군생활 삭제 버튼

입대일과 전역일을 넣으면 남은 복무 기간을 보여주고, 커다란 버튼을 누르면 기분 좋은 소리가 나는 단일 페이지 웹 장난감입니다.

**아무것도 실제로 삭제되지 않습니다.**

## 기능

- 입대일 / 전역일 입력 → 진행률(%), 남은 개월·일, D-day, 복무 일수
- 군별 전역일 자동 계산 (육군·해병 18 / 해군 20 / 공군 21개월)
- 삭제 버튼 — 누를 때마다 Web Audio로 합성한 타격음, 연타하면 음이 올라가는 콤보
- **삭제한 일수를 재화로 쓰는 상점** — 검색, 구매, 보유 상태
- **군별 리더보드** — 육군·해병·해군·공군 익명 집계, 누적 / 오늘 두 탭 (개인 순위·닉네임 없음)
- 잔액 · 누적 일수 · 보유 아이템 · 입력값 · 음소거 설정을 브라우저에 저장 (`localStorage`)
- 라이트 / 다크 테마, 375px 모바일 대응
- 광고: 데스크톱은 좌우 레일 배너, 모바일은 하단 고정 배너 (AdSense 디스플레이 광고)
- **보상형 광고** — 상점에서 광고를 보면 일수를 받습니다 (H5 Games Ads)

## 구조

| 파일 | 역할 |
| --- | --- |
| `index.html` | 페이지 전체 (마크업·스타일·스크립트) |
| `items.json` | 상점 아이템 정의 — 아이템을 늘릴 때 여기만 고치면 된다 |
| `ads.txt` | AdSense 게시자 확인용. 도메인 루트에 그대로 서빙되어야 한다 |
| `privacy.html` | 개인정보처리방침. AdSense 승인 필수 요건이다. **저장 키나 외부로 나가는 요청이 바뀌면 여기도 같이 고쳐야 한다** |
| `supabase/board.sql` | 리더보드 스키마 — 테이블 · RLS · 함수 2개 |
| `supabase/board_test.sql` | 위 SQL 자체 점검 (assert, 마지막에 rollback) |
| `.github/workflows/keepalive.yml` | Supabase 무료 프로젝트 정지 방지용 주간 핑 |
| `scripts/analytics-helper.js` | 분석 도우미 모듈 (마일스톤 판별 및 세션 페이로드 계산) |
| `scripts/test-analytics.js` | 분석 이벤트 및 개인정보처리방침 검증 테스트 |

빌드 도구·의존성이 없습니다. 외부 요청은 Google Fonts, 광고 SDK, PostHog(분석), `items.json`,
그리고 리더보드를 켰을 때의 Supabase 뿐입니다.

## 재화 모델

버튼 아래 숫자는 두 개이고 역할이 다릅니다.

| 표시 | 뜻 | 구매하면 |
| --- | --- | --- |
| 큰 숫자 `000일 삭제됨` | 쓸 수 있는 **잔액** | 줄어든다 |
| 작은 줄 `누적 삭제된 일수` | 지금까지 누른 **총합** | 줄지 않는다 |

`localStorage`에는 `ad.total`(누적)과 `ad.spent`(사용액)만 저장하고, 잔액은 둘의 차로 계산합니다. 기록이 구매 때문에 뒤로 가는 일이 없습니다.

## 아이템 추가하기

`items.json`의 `items` 배열에 객체를 하나 더 넣으면 끝입니다. 코드는 건드리지 않아도 됩니다.

```json
{
  "id": "고유-id",
  "name": "화면에 보이는 이름",
  "price": 40,
  "icon": "🍗",
  "category": "식사",
  "description": "한 줄 설명"
}
```

`id`는 보유 여부를 저장하는 키이므로 **한 번 정하면 바꾸지 마세요.** 바꾸면 이미 산 사람의 보유 기록이 끊깁니다. `icon`과 `description`은 없어도 동작합니다(아이콘은 📦로 대체).

### 효과 있는 아이템

`effect`를 붙이면 실제로 동작합니다. 없으면 보유만 되는 수집용 아이템입니다.

```json
"effect": { "type": "multiplier", "value": 2 }
"effect": { "type": "auto", "intervalMs": 167 }
"effect": { "type": "share", "value": 3, "durationMs": 1800000 }
```

| 타입 | 동작 | 겹칠 때 |
| --- | --- | --- |
| `multiplier` | 한 번 누를 때 올라가는 일수가 `value`배 | **가장 높은 것 하나만** 적용 (2배+3배 = 3배) |
| `auto` | `intervalMs`마다 알아서 버튼을 누름 | **전부 적용** — 산 만큼 대원이 늘어난다 |
| `share` | 링크를 공유하면 `durationMs` 동안 `value`배 | `multiplier` 와 같은 취급 — 높은 쪽 하나만 |

`share` 는 사는 아이템이 아니라 누르는 아이템입니다. 값을 치르지 않고, 보유 목록에도
들어가지 않으며, 끝나면 다시 누를 수 있습니다. `price` 는 무시되고 화면에 "무료"로 뜹니다.
`navigator.share` 가 있으면 공유창을, 없거나 취소하면 링크를 클립보드에 복사합니다 —
**정말 공유했는지는 확인할 방법이 없어서 둘 중 하나만 되면 지급합니다.**
끝나는 시각은 `ad.boostUntil` 에 저장해 새로고침해도 이어집니다.

자동 대원은 버튼 옆(좁은 화면에서는 아래)에 정사각형으로 표시되고, 누를 때마다 반짝입니다. 배수는 자동 클릭에도 똑같이 적용됩니다.

**자동 클릭에는 소리가 나지 않습니다.** 7계급을 모두 모으면 초당 약 10회라 소음이 됩니다. 버튼 눌림 애니메이션은 130ms 간격으로 제한해, 눌린 채로 멈춘 것처럼 보이지 않게 했습니다.

브라우저는 백그라운드 탭의 타이머를 초당 1회 수준으로 늦춥니다. 다른 탭을 보는 동안에는 자동 대원이 느려집니다.

### 알아둘 점

- **입력창 글자는 터치 기기에서 16px 미만이면 안 됩니다.** iOS Safari가 그런 입력창에 포커스가 갈 때 페이지를 강제로 확대하고 배율을 되돌리지 않습니다. 상점을 열었다 닫으면 본문이 확대된 채로 남아 두 화면 배율이 어긋납니다. `@media (pointer: coarse)` 블록에서 16px로 올려두었고, **이 블록은 스타일시트 맨 끝에 있어야 합니다** — 특정도가 같아 순서가 곧 우선순위입니다.
- **상점을 열 때 터치 기기에서는 검색창에 포커스를 주지 않습니다.** 키보드가 튀어 올라와 상점을 가립니다. 대신 닫기 버튼에 포커스를 둬서 Esc와 스크린리더가 계속 동작합니다.
- `items.json`은 `fetch`로 읽습니다. **`index.html`을 파일로 직접 열면(`file://`) 브라우저가 로컬 fetch를 막아 목록이 안 뜹니다.** 배포된 주소나 로컬 서버(`npx serve` 등)에서 확인하세요. 상점에 그 이유가 표시됩니다.
- 페이지 안에 `<script type="application/json" id="shopItemsInline">`이 있으면 `fetch` 대신 그쪽을 먼저 씁니다. 파일을 같이 올릴 수 없는 환경(단일 HTML 배포 등)을 위한 경로입니다.

## 광고 설정

광고 자리는 3곳입니다.

| 자리 | 크기 | 노출 조건 |
| --- | --- | --- |
| 좌측 레일 | 160×600 | 뷰포트 960px 이상 |
| 우측 레일 | 160×600 | 뷰포트 960px 이상 |
| 하단 고정 배너 | 320×100 | 뷰포트 960px 미만 |

**광고는 켜져 있습니다.** 게시자 ID `ca-pub-8694678185722423`.

| 자리 | 슬롯 ID | AdSense 단위 이름 |
| --- | --- | --- |
| 좌측 레일 | `5518200303` | ad_slot |
| 우측 레일 | `9040361546` | ad_horazontal_2 |
| 하단 배너 | `1545014900` | ad_vertical_ |

자리마다 단위가 달라 보고서에서 따로 볼 수 있습니다.

**단위 이름이 배치와 어긋나 있습니다** — `ad_vertical_`이 가로 배너에, `ad_horazontal_2`가 세로 레일에 들어가 있습니다. 셋 다 반응형(`auto`) 단위라 이름은 송출에 아무 영향이 없습니다. 헷갈리면 AdSense에서 이름만 바꾸세요. 슬롯 ID는 그대로 둬야 합니다.

단위는 반응형(`auto`)으로 만들어졌지만 여기서는 **고정 크기**로 씁니다 — `<ins>`에 width/height를 주고 `data-ad-format`을 빼면 그 크기로 요청합니다. 레일 160×600, 하단 320×100은 이 레이아웃에 맞춰진 값입니다.

실제로 광고가 나오려면 AdSense에서 **이 도메인이 승인**되어야 합니다. 승인 전에는 요청이 `unfilled`로 돌아오고 3초 뒤 점선 플레이스홀더로 바뀝니다.

승인 심사에는 세 가지가 사이트에 실제로 떠 있어야 합니다 — 페이지 안의 AdSense 로더, 도메인 루트의 `ads.txt`, 그리고 `privacy.html`(광고 쿠키 사용을 고지하는 개인정보처리방침, 푸터에서 링크됨). 저장 키나 외부 요청이 바뀌면 `privacy.html`도 같이 고쳐야 합니다.

### 알아둘 점

- **`push({})`는 대상을 고를 수 없습니다.** 문서 순서상 아직 안 채운 첫 `<ins>`를 채웁니다. 그래서 `initAds()`가 지금 안 쓰는 자리의 `<ins>`를 **먼저 DOM에서 걷어냅니다** — 안 그러면 모바일에서 한 번뿐인 push가 숨겨진 좌측 레일로 가고(폭 0 오류) 하단 배너는 끝내 비어 있습니다.
- **로더가 `async`라 `initAds()` 시점에 `window.adsbygoogle`은 없는 게 정상입니다.** 이걸 "SDK 없음"으로 판정하면 광고가 영영 안 뜹니다. 배열에 push해두면 SDK가 도착해 처리합니다. SDK 유무는 스크립트 태그로만 가릅니다.
- **채워졌는지는 `data-ad-status`로 봅니다.** `<ins>`는 CSS로 높이가 잡혀 있어 `offsetHeight`로는 판별되지 않습니다.
- **같은 `<ins>`에 두 번 push할 수 없습니다.** 그래서 창 크기를 바꿔도 다시 채우지 않습니다. 페이지 로드 시점 기준 한 번만 결정됩니다.
- 데스크톱 레일은 뷰포트가 960px 이상일 때만 뜹니다. 트래픽 대부분이 모바일이면 실질 노출은 하단 배너에서 나옵니다.
- 하단 고정 배너는 Google **Auto ads의 앵커 광고**를 켜는 쪽이 정책상 더 안전한 경로입니다. 지금은 직접 구현하되 닫기(×) 버튼을 달아뒀습니다.
- AdSense는 광고 시청을 유도하거나 보상하는 문구를 금지합니다. **레일·하단 배너에는** 관련 UI 카피를 추가하지 마세요. 아래 보상형 광고만 예외입니다.

## 보상형 광고 (H5 Games Ads)

상점 맨 위에 "광고 보고 100일 받기" 줄이 있습니다. 세 포맷 중 eCPM이 가장 높고, **AdSense가 광고 시청에 대한 보상을 허용하는 유일한 포맷**입니다 — 일반 광고에서 금지된 유도 문구가 여기서는 포맷의 일부입니다.

보상액은 `items.json` 최상위에서 조정합니다. 코드 수정은 필요 없습니다.

```json
"reward": { "days": 100, "cooldownSec": 300 }
```

### 활성화 (디스플레이 광고와 별개 절차)

**받아서 붙일 코드 스니펫이 따로 없습니다.** 디스플레이 광고와 같은 `adsbygoogle.js` 로더를 그대로 쓰고, 광고 단위 ID도 없습니다 — 자리 이름은 코드에서 `name: 'shop-reward'` 로 직접 정합니다.

대신 **`adBreak` / `adConfig` 별칭을 직접 선언해야 합니다.** 로더가 만들어 주지 않습니다:

```html
<script>
  window.adsbygoogle = window.adsbygoogle || [];
  window.adBreak = window.adConfig = function (o) { window.adsbygoogle.push(o); };
</script>
```

이게 없으면 H5가 승인돼도 `typeof window.adBreak !== 'function'` 이라 보상형 광고가 영영 호출되지 않습니다. `index.html` 의 로더 바로 아래에 있습니다.

남은 절차는 AdSense 계정에서 **H5 Games Ads를 신청·승인**받는 것뿐입니다. 이 사이트가 "HTML5 게임"으로 인정될지는 Google이 정합니다 — 클리커 장난감이라 경계선에 있습니다.

개발용 플레이스홀더 모달은 **`localhost` 에서만** 뜹니다(`isDevHost()`). 별칭이 항상 정의되어 있어 SDK 유무로는 가를 수 없고, 배포본에서 그 경로를 타면 광고 없이 일수가 나가버립니다. 로컬에서는 전체 흐름(지급·중도 이탈·쿨다운)을 그대로 확인할 수 있습니다.

### 구현에서 틀리기 쉬운 곳

- **보상은 `adViewed`에서만 지급합니다.** `adBreakDone`은 성공·실패 무관하게 호출되므로 거기서 지급하면 광고를 닫아도 보상이 나갑니다.
- **`beforeReward`가 호출되지 않으면 줄 광고가 없다는 뜻입니다.** 이 경우를 별도 상태로 처리해 "지금은 볼 수 있는 광고가 없습니다"를 표시합니다.
- **보상에 배수를 곱하지 않습니다.** `addDays(rewardCfg.days)`로 고정액을 줍니다. 3배 아이템으로 광고 보상까지 늘어나면 경제가 무너집니다.
- 광고가 뜬 동안 `AudioContext`를 멈추고 자동 대원 타이머도 정지합니다. 뒤에서 잔액이 오르면 보상 체감이 사라지고 소리가 광고와 겹칩니다.
- 쿨다운 시각은 `ad.rewardAt`에 저장해 새로고침으로 우회되지 않습니다.
- **콜백이 아예 안 올 수 있습니다.** 광고차단기가 로더를 막으면 큐를 비우는 주체가 없어 `adBreakDone`조차 오지 않습니다. 12초 타임아웃으로 버튼을 풀어줍니다 — 보상은 주지 않습니다.

### 정책

버튼을 눌러야만 광고가 나옵니다. 자동 트리거는 금지이고, 광고 시청이 진행의 유일한 수단이 되어서도 안 됩니다 — 눌러서 버는 경로가 계속 주력으로 남아야 합니다.

## 커스터마이징

| 대상 | 위치 |
| --- | --- |
| 레일이 나타나는 폭 | `@media (min-width:960px)` 와 `initAds()` 의 `matchMedia` — 두 곳을 같이 고쳐야 한다 |
| 광고 네트워크 교체 | `initAds()` 함수 하나만 수정 |
| 상점 아이템 | `items.json` — 코드 수정 불필요 |
| 광고 보상액 · 쿨다운 | `items.json` 의 `reward` — 코드 수정 불필요 |
| 콤보 유지 시간 | `COMBO_RESET_MS` (기본 1200ms) |
| 음계 | `SCALE` 배열 (C 메이저 펜타토닉) |
| 색상 | `:root` 의 CSS 변수 |

## 로컬에서 열기

`index.html`을 브라우저로 열면 대부분 동작하지만, **상점 아이템은 로컬 서버에서만 뜹니다** (`file://`은 `fetch`가 막힙니다):

```bash
npx serve .
```

콘솔에서 날짜 계산 함수를 직접 호출할 수 있습니다:

```js
__army.calcService('2026-03-02', '2027-09-01', new Date(2026, 8, 1))
```

## 리더보드

구글 로그인 기반 군별 누적 총합 집계입니다.
사용자가 로그인하면 브라우저에 기록된 "누적 삭제된 일수(`ad.total`)" 전체가 소속 군의 전력으로 합산(`SUM(total_days)`)됩니다.

### 켜는 법

1. Supabase 프로젝트를 생성합니다.
2. **Supabase 대시보드 → Authentication → Providers → Google** 에서 Google OAuth Client ID 및 Secret을 설정하고 활성화합니다.
   - Redirect URL: `https://<프로젝트>.supabase.co/auth/v1/callback`
   - 사이트 URL (또는 Additional Redirect URLs): `https://<배포도메인>/` 및 로컬 개발용 `http://localhost:3000/`
3. SQL Editor 에 `supabase/board.sql` 을 붙여 넣고 실행합니다. (검증하려면 이어서 `supabase/board_test.sql`)
4. `index.html` 안의 프로젝트 연결 정보를 확인합니다.

```js
var SB_URL = 'https://<프로젝트>.supabase.co';
var SB_KEY = 'sb_publishable_...';
```

`publishable key` (`anon key`)는 클라이언트에 공개되도록 설계된 값입니다.
보안은 PostgreSQL RLS(Row Level Security) 및 `security definer` RPC 함수가 담당합니다.
`secret key` (`service_role key`)는 절대 클라이언트에 넣지 마세요.

### 동작

| 항목 | 내용 |
| --- | --- |
| 접근 제한 | 리더보드를 확인하려면 **Google 계정 로그인**이 필요합니다 (비로그인 상태에서는 플레이만 가능). |
| 집계 기준 | 각 사용자의 로컬 "누적 삭제된 일수(`ad.total`)"가 사용자 계정 레코드(`user_records`)로 업서트되며, 소속 군별로 전체 합산(`SUM`)됩니다. |
| 군 소속 지연 선택 | 군 소속을 나중에 선택하더라도, 그동안 로컬에서 달성한 누적 삭제 일수 전체가 누락 없이 소속 군에 합산됩니다. |
| 순위 표시 | 육군 / 해병 / 해군 / 공군 4개 군의 총합 삭제 일수, 1위 대비 비율 막대 게이지, 참여 군인 수, 내 기여도 표시. |

### 운영

Supabase 무료 프로젝트는 **7일간 요청이 없으면 정지되고 클라이언트에 오류를 반환합니다.**
`.github/workflows/keepalive.yml` 이 주 1회 찔러 타이머를 리셋합니다.

### 검증

- SQL: `supabase/board_test.sql` 실행 (테이블 제약 조건, RLS 및 `leaderboard()` 합산 검증)
- 클라이언트: 리더보드 모달 열람 시 비로그인 구글 로그인 버튼 노출 및 로그인 후 동기화 동작 확인

## 분석 (PostHog Analytics)

사용자 인터랙션 분석, 리텐션 코호트 분석, 광고/상점 경제 흐름 파악 및 세션 리플레이를 위해 PostHog가 연동되어 있습니다. AdBlock 차단 환경이나 네트워크 오류 시에도 메인 서비스는 전혀 중단되지 않도록 안전 래퍼(`__analytics`)로 격리되어 있습니다.

### API Key 설정 방법

PostHog 프로젝트 생성 후 발급받은 Project API Key를 다음 두 가지 방법 중 하나로 설정할 수 있습니다.

1. **전역 변수 주입 방식 (권장 - 환경별 분기 시)**:
   HTML 로더 앞단이나 배포 환경 스크립트에서 `window.ENV_POSTHOG_KEY`와 `window.ENV_POSTHOG_HOST`(선택, 기본: `https://us.i.posthog.com`)를 선언합니다.
   ```html
   <script>
     window.ENV_POSTHOG_KEY = 'phc_실제_프로젝트_키';
     window.ENV_POSTHOG_HOST = 'https://us.i.posthog.com'; // 또는 EU 호스트
   </script>
   ```

2. **`index.html` 직접 수정 방식**:
   `index.html` 상단의 `POSTHOG_KEY` 기본값을 수정합니다.
   ```js
   var POSTHOG_KEY = window.ENV_POSTHOG_KEY || 'phc_실제_프로젝트_키';
   ```

*참고: 키가 플레이스홀더(`phc_PLACEHOLDER_KEY`) 상태이거나 설정되지 않으면 PostHog SDK는 초기화되지 않으며, `__analytics` 래퍼가 모든 호출을 no-op으로 안전하게 무시합니다.*

### 수집 이벤트 목록

| 이벤트명 | 트리거 조건 | 주요 속성 (Properties) |
| --- | --- | --- |
| `first_delete_click` | 해당 세션에서 삭제 버튼 첫 클릭 | `d_day` |
| `click_milestone_reached` | 누적 클릭 마일스톤 달성 (10, 50, 100, 500, 1000 ...) | `milestone_days` |
| `session_engagement` | 탭 전환(`visibilitychange`) 또는 창 종료(`pagehide`) | `session_clicks`, `max_combo`, `total_days_deleted`, `spent_days`, `balance`, `session_duration_seconds` |
| `shop_opened` | 상점 모달 오픈 | `current_balance`, `owned_items_count` |
| `item_purchased` | 상점 아이템 구매 | `item_id`, `item_name`, `price`, `item_type`, `remaining_balance` |
| `share_boost_activated` | 링크 공유 배수 부스트 발동 | `method`, `boost_multiplier`, `boost_duration_ms` |
| `reward_ad_clicked` | 보상형 광고 시청 버튼 클릭 | `current_balance` |
| `reward_ad_completed` | 보상형 광고 시청 완료 및 보상 수령 | `reward_days`, `new_balance` |
| `reward_ad_failed` | 보상형 광고 오류 또는 애드블록 타임아웃 | `reason` |
| `anchor_ad_closed` | 하단 앵커 광고 닫기(×) 클릭 | `viewport_width` |
| `leaderboard_opened` | 리더보드 모달 오픈 | `is_authenticated` |
| `login_completed` | Google 계정 로그인 완료 | `has_branch` |
| `branch_selected` | 군 소속 선택 (육군/해병/해군/공군) | `branch`, `contributed_days` |

### 사용자 식별 (Identity & Person Properties)

리더보드 로그인 시 Supabase 사용자 ID(UUID)로 `posthog.identify()`가 호출되며, 로그아웃 시 `posthog.reset()`으로 세션 식별이 초기화됩니다.
- **Person Properties**: `branch`(소속 군), `service_status`(복무 상태), `d_day`(남은 일수), `is_leaderboard_user` (`true`)

### UTM 유입 경로 & 대시보드 / 코호트

- **UTM 분석**: PostHog 기본 기능을 통해 유입 URL의 `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` 및 레퍼러가 자동 캡처됩니다.
- **코호트 (Cohorts)**:
  - 로그인 유저 vs 비로그인 플레이어
  - 소속 군별 코호트 (육군, 해병, 해군, 공군)
  - 하이 인게이지먼트 유저 (1000일 이상 삭제 또는 세션 내 100회 이상 클릭)
  - 과금/보상형 광고 유저 (보상형 광고 1회 이상 완료)
- **대시보드 권장 구성**:
  - **Funnel 분석**: 메인 유입 → 첫 클릭(`first_delete_click`) → 상점 열람(`shop_opened`) → 보상형 광고(`reward_ad_completed`) 또는 아이템 구매(`item_purchased`)
  - **리텐션(Retention)**: UTM 캠페인별 재방문율 및 세션 참여 지속 시간(`session_duration_seconds`)
  - **세션 리플레이(Session Replay)**: 인터랙션 지연 분석 및 UI 이상 현상 감지 (민감 정보는 자동 마스킹 처리됨)

### 검증 테스트

```bash
node --test scripts/test-analytics.js
```


