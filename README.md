# 군생활 삭제 버튼

입대일과 전역일을 넣으면 남은 복무 기간을 보여주고, 커다란 버튼을 누르면 기분 좋은 소리가 나는 단일 페이지 웹 장난감입니다.

**아무것도 실제로 삭제되지 않습니다.**

## 기능

- 입대일 / 전역일 입력 → 진행률(%), 남은 개월·일, D-day, 복무 일수
- 군별 전역일 자동 계산 (육군·해병 18 / 해군 20 / 공군 21개월)
- 삭제 버튼 — 누를 때마다 Web Audio로 합성한 타격음, 연타하면 음이 올라가는 콤보
- **삭제한 일수를 재화로 쓰는 상점** — 검색, 구매, 보유 상태
- **다섯 장소 상점** — 생활관 병사 6명, 체단실 운동 4개, P.X. 보급 5개, 행정반 휴가 3개, 위병소 행동·기념품 5개
- 생활관 병사는 몸·팔·소품이 있는 SVG 캐릭터로 메인 버튼 가장자리를 직접 누르며, 상세 정보와 동작 줄이기를 지원
- **군별 리더보드** — 육군·해병·해군·공군 익명 집계, 누적 / 오늘 두 탭 (개인 순위·닉네임 없음)
- **일수 선물하기** — 보유 일수를 덜어 편지와 함께 링크로 보내면, 받은 사람이 링크에서 수령
- 잔액 · 누적 일수 · 보유 아이템 · 입력값 · 음소거·테마·동작 줄이기를 브라우저에 저장 (`localStorage`)
- 라이트 / 다크 테마, 375px 모바일 대응
- 광고: 데스크톱은 좌우 레일 배너, 모바일은 하단 고정 배너 (AdSense 디스플레이 광고)
- **보상형 광고** — 상점에서 광고를 보면 일수를 받습니다 (H5 Games Ads)

## 구조

| 파일 | 역할 |
| --- | --- |
| `index.html` | 페이지 전체 (마크업·스타일·스크립트) |
| `items.json` | 상점 아이템 정의 — 아이템을 늘릴 때 여기만 고치면 된다 |
| `scripts/shop-engine.js` | v2 상점 효과·직접/자동 생산·오프라인 정산 계산 |
| `scripts/leave-ledger.js` | 휴가 구매 영수증의 로컬 저장·비용/일수 합계·계정 귀속 |
| `scripts/crew-view.js` / `styles/crew-view.css` | 여섯 병사의 SVG 캐릭터·접촉 동작·반응형 배치 |
| `ads.txt` | AdSense 게시자 확인용. 도메인 루트에 그대로 서빙되어야 한다 |
| `privacy.html` | 개인정보처리방침. AdSense 승인 필수 요건이다. **저장 키나 외부로 나가는 요청이 바뀌면 여기도 같이 고쳐야 한다** |
| `admin.html` | 운영자용 UTM 링크 생성기. 비밀번호 게이트는 SHA-256 비교일 뿐인 눈속임 가림막이다 — 정적 사이트라 우회 가능하므로 **민감한 정보를 두면 안 된다.** `noindex` |
| `supabase/board.sql` | 계정 저장·리더보드·휴가 영수증 스키마 — 기존 6인자 동기화 RPC와 휴가 RPC |
| `supabase/gift.sql` | 일수 선물하기 스키마 — `gifts` 테이블 · 함수 3개 |
| `supabase/board_test.sql` | 위 SQL 자체 점검 (assert, 마지막에 rollback) |
| `.github/workflows/keepalive.yml` | Supabase 무료 프로젝트 정지 방지용 주간 핑 |
| `scripts/analytics-helper.js` | 분석 도우미 모듈 (마일스톤 판별 및 세션 페이로드 계산) |
| `scripts/share.js` | 유입 출처(`sid`) 조립·파싱·판정. `index.html`이 classic 스크립트로 로드 |
| `scripts/test-analytics.js` | 분석 이벤트 및 개인정보처리방침 검증 테스트 |
| `scripts/utm.js` | 게시판 채널 표와 UTM URL 조립 — `admin.html`이 import |
| `scripts/test-shop-effects.js` | 상점 아이템 데이터와 v2/legacy 효과 회계 검증 |
| `scripts/test-leave-ledger.js` | 휴가 영수증 저장·재구매·귀속·멱등성 검증 |

빌드 도구·번들러·애니메이션 라이브러리가 없습니다. `index.html`이 `items.json`과 위의 일반 JavaScript/CSS 모듈을 직접 읽습니다. 외부 요청은 Google Fonts, 광고 SDK, PostHog(분석), `items.json`, 그리고 로그인·리더보드·휴가 영수증 동기화를 켰을 때의 Supabase입니다.

## 재화 모델

버튼 아래 숫자는 두 개이고 역할이 다릅니다.

| 표시 | 뜻 | 구매하면 |
| --- | --- | --- |
| 큰 숫자 `000일 삭제됨` | 쓸 수 있는 **잔액** | 줄어든다 |
| 작은 줄 `누적 삭제된 일수` | 지금까지 누른 **총합** | 줄지 않는다 |

`localStorage`에는 `ad.total`(직접 삭제 누적), `ad.gifted`(받은 일수), `ad.spent`(일반 상점·선물 발신 사용액), `ad.gsent`(선물 발신 누적)를 저장합니다. 휴가 구매는 `ad.spent`에 다시 더하지 않고 `ad.leave.receipt.<operation_id>` 영수증으로 기록하므로, 유효 사용액은 `spent + 휴가 영수증 비용 합계`입니다. 잔액은 `max(0, total + gifted - spent - receiptCost)`로 계산하고, 화면·리더보드의 순누적은 `netTotal = max(0, total + gifted - gsent)`로 계산합니다.

게스트의 휴가 영수증은 `ad.leave.receipt.<operation_id>`에 남고, `ad.leave.guest-id`·`ad.leave.claim.<guest_id>`로 소유 계정을 구분하며, `ad.leave.synced.<operation_id>`로 동기화 완료를 표시합니다. 로그인하면 고유 operation ID 단위로 계정에 동기화됩니다. `ad.leave.wallet-account`는 로그아웃 후에도 남는 지갑의 비용 귀속을 유지합니다. `ad.wallet.<account_id>`는 계정별 지갑·소속 스냅샷이고, `ad.walletOwner`가 바뀌면 다른 탭은 기존 계정으로 쓰지 않고 다시 불러옵니다. 휴가 종류별 숫자만 `max`로 합치지 않아 두 기기에서 각각 산 재구매를 잃지 않습니다. 기존 지갑·선물·아이템의 단조 증가 병합은 유지하되, 휴가 구매는 영수증의 비용과 지급 일수를 합산합니다.

**값을 늘릴 때는 반드시 저장된 값을 다시 읽습니다.** 메모리에 들고 있던 값에 더해서 쓰면, 같은 사이트를 탭 두 개로 열었을 때 한쪽이 누르는 순간 다른 탭이 번 일수가 통째로 사라집니다. `addDays()` 와 `buy()` 가 읽고-더하고-쓰는 순서를 지킵니다. 다른 탭의 변경은 `storage` 이벤트로 화면에 반영됩니다.

탭을 여러 개 열면 자동 대원이 탭마다 돌아 그만큼 빨리 벌립니다. 혼자 하는 장난감이라 막지 않았습니다.

## 아이템 추가하기

판매 카드는 `items.json`의 `items` 배열에 둡니다. 현재 판매 구성은 **23개**입니다. `legacyItems`에는 판매를 종료한 **20개**를 보존하며, 기존 보유자의 효과와 휴가 이관을 위해 코드가 함께 읽습니다. 구아이템을 새 효과로 덮어쓰거나 ID를 재사용하지 마세요.

현재 장소 카테고리는 다음 다섯 개입니다.

```
생활관   체단실   P.X   행정반   위병소
```

`category`는 상점 칩의 `data-cat`과 문자 단위로 같아야 합니다. `id`는 보유 여부와 영수증의 상품 ID로 쓰므로 이미 판매했거나 구매된 카드의 ID를 바꾸지 마세요. `icon`과 `description`은 없어도 동작합니다.

### v2 효과

| 타입 | 동작 |
| --- | --- |
| `manual_add` | 체단실 운동의 추가치를 합산해 직접 클릭만 강화 |
| `auto` | 병사가 `intervalMs`마다 버튼을 누름. 활성 병사는 각각 적용 |
| `crew_speed` | 현재·이후 모든 병사의 클릭 속도 `%p` 추가. 실제 간격은 기본 간격 ÷ 속도 |
| `leave` | 영수증을 만들고 정해진 종류·일수를 누적. 여러 번 구매 가능 |
| `share` | 위병소에서 성공한 공유 후 30분 동안 직접·자동 생산에 ×3 |

직접 클릭은 `(1 + 운동 추가치 합계) × 공유 배수`, 병사 1회는 `1 × 공유 배수`로 고정입니다. P.X 음식은 속도만 올리며 `%p`를 합산합니다(3·5·7·9·11·13·15·17·19, 가격순 = 효과순). 광고 보상·휴가 구매·선물은 생산 배수를 적용하지 않습니다.

`offline`(오프라인 정산)과 `roll`(룰렛)은 엔진에 계산이 남아 있지만 현재 이 효과를 가진 판매 중 아이템이 없어 동작하지 않습니다. 다시 내려면 `items`에 해당 `effect`를 가진 카드를 추가하면 됩니다.

`leave` 구매 비용은 `ad.spent`에 다시 넣지 않습니다. 구매 영수증에 비용·종류·지급 일수를 남기고, 잔액 계산 때 영수증 비용을 한 번만 뺍니다. `gift-days`는 `action: "gift"`인 행동 카드라 보유·구매 목록에 들어가지 않고, 발신하려면 로그인해야 합니다.

### 판매 종료 아이템 (`legacyItems`)

**`legacyItems`는 `effect`를 하나도 갖지 않습니다.** 보유 기록만 남고 게임 수치에는 전혀 반영되지 않습니다. `ShopEngine.stats()`가 `data.items`만 읽으므로, 실수로 `effect`를 붙여도 계산에 들어가지 않습니다 — 효과 타입별로 걸러내면 타입이 늘 때마다 빠뜨리기 때문입니다.

과거에는 `multiplier`·`senior` 배수가 `Math.max`로 신규 아이템 효과를 통째로 덮어써서, 옛 유저에게는 상점에서 뭘 사도 수치가 그대로였습니다(`전체 병사 8 → 8일/회`). 같은 규칙으로 자동 병사(하사·중사·상사·제설작전·예초 작업·완전군장 구보), `offline`(국방부 시계), `roll`(포상휴가 룰렛)의 효과도 뗐습니다. 과거 룰렛 당첨분처럼 이미 잔액에 들어간 일수는 회수하지 않습니다.

보유 기록(`owned`)은 지우지 않습니다. '기존 보유품' 목록에 계속 뜨고, 서버 `owned`는 합집합으로 병합되므로 서버에서 지워도 클라이언트 localStorage에서 되살아납니다. 새 상점 목록에는 노출하지 않습니다.

예외는 `long-leave` 하나입니다. 계정별 결정 operation ID를 가진 `legacy-long-leave` 휴가 영수증으로 한 번만 이관하며, 이미 지급된 기록이라 회수하지 않습니다.

### 생활관 병사와 모듈

새 병사는 `rank-pvt`, `rank-pfc`, `rank-cpl`, `rank-squad`, `rank-sgt`, `rank-shorttimer`입니다. `scripts/crew-view.js`가 인라인 SVG 몸·팔·소품을 만들고 `styles/crew-view.css`가 375px 모바일의 위·아래 3명과 넓은 화면의 좌·우 3명을 배치합니다. 자동 지급은 `shop-engine.js`가 결정하고 `CrewView.tick(id, days)`는 최대 두 명의 시각 접촉만 재생합니다. 동작 줄이기(`ad.reducedMotion`) 또는 OS reduced-motion에서는 캐릭터와 결과 숫자를 유지하고 팔 동작을 끕니다.

자동 병사는 소리·햅틱·직접 클릭 콤보를 발생시키지 않습니다. 상점·광고·백그라운드에서는 장식 동작을 재생하지 않으며, 실제 지급과 애니메이션이 서로의 회계를 결정하지 않습니다.

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

`index.html`을 브라우저로 열면 대부분 동작하지만, **상점 아이템은 로컬 서버에서만 뜹니다** (`file://`은 `fetch`가 막힙니다). 새 JavaScript/CSS 모듈도 번들하지 않고 HTML에서 직접 로드합니다:

```bash
npx serve .
```

콘솔에서 날짜 계산 함수를 직접 호출할 수 있습니다:

```js
__army.calcService('2026-03-02', '2027-09-01', new Date(2026, 8, 1))
```

## 리더보드

구글 로그인 기반 군별 순누적 총합 집계입니다. 사용자가 로그인하면 `netTotal = max(0, total + gifted - gsent)`가 소속 군의 전력으로 합산됩니다. 일반 사용액과 휴가 영수증 비용은 잔액 계산에만 쓰고 순누적에서는 빼지 않습니다.

### 켜는 법

1. Supabase 프로젝트를 생성합니다.
2. **Supabase 대시보드 → Authentication → Providers → Google** 에서 Google OAuth Client ID 및 Secret을 설정하고 활성화합니다.
   - Redirect URL: `https://<프로젝트>.supabase.co/auth/v1/callback`
   - 사이트 URL (또는 Additional Redirect URLs): `https://<배포도메인>/` 및 로컬 개발용 `http://localhost:3000/`
3. SQL Editor 에 `supabase/board.sql` 을 먼저 붙여 넣고 실행합니다. 이 파일은 기존 `sync_my_record(text, bigint, bigint, text[], bigint, bigint)` 6인자 RPC(마지막 두 인자는 기본값)를 유지하면서 `leave_purchases`, `my_leave_purchases(...)`, `sync_leave_purchases(jsonb)`를 추가합니다.
4. 그 다음 `supabase/gift.sql`을 실행합니다. (검증은 `board_test.sql` → `gift_test.sql` 순서입니다.)
5. `index.html` 안의 프로젝트 연결 정보를 확인합니다.

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
| 집계 기준 | 각 사용자의 순누적 `max(0, ad.total + ad.gifted - ad.gsent)`가 사용자 계정 레코드(`user_records`)로 업서트되며, 소속 군별로 합산됩니다. |
| 군 소속 지연 선택 | 군 소속을 나중에 선택하더라도, 그동안 로컬에서 달성한 누적 삭제 일수 전체가 누락 없이 소속 군에 합산됩니다. |
| 순위 표시 | 육군 / 해병 / 해군 / 공군 4개 군의 총합 삭제 일수, 1위 대비 비율 막대 게이지, 참여 군인 수, 내 기여도 표시. |
| 누적 일수는 줄지 않음 | `sync_my_record()` 가 `greatest(기존, 새값)` 으로 업서트합니다. 기기를 여러 대 쓰다 낮은 값이 뒤늦게 올라와도 서버 기록이 뒤로 가지 않습니다. |
| 쓰기 경로 | **테이블 직접 쓰기는 막혀 있습니다.** `authenticated` 에게 `select` 만 주고 `insert/update/delete` 는 회수합니다. 열어두면 `PATCH /rest/v1/user_records` 한 번으로 위 `greatest()` 가드가 우회됩니다. 쓰기는 `security definer` 인 `sync_my_record()` 로만 들어옵니다. |

### 계정 저장

로그인하면 지갑·선물·보유 아이템(`ad.total` / `ad.spent` / `ad.gifted` / `ad.gsent` / `ad.owned`)과 소속이 계정에 남습니다. 휴가 영수증은 `ad.leave.receipt.<operation_id>`별로 `sync_leave_purchases(jsonb)`에 동기화되고, `my_leave_purchases(...)`가 커서 페이지로 복원합니다. 기기를 바꿔도 이어집니다.

| 항목 | 내용 |
| --- | --- |
| 병합이 단순한 이유 | 기존 지갑 네 값은 **단조 증가**합니다 — 일수는 클릭·광고·선물 수령으로 늘고, 사용액은 일반 구매·선물 발신으로 늘며, 아이템은 되팔 수 없습니다. 이 값은 `max` / `max` / `max` / 합집합으로 병합하고, 휴가 재구매는 별도 operation ID 영수증을 합산합니다. |
| 첫 연결만 합산 | `max` 만 쓰면 그 기기가 **로그인 전에 익명으로 모아둔 일수가 통째로 사라집니다.** 연결한 계정 id 를 `ad.acct` 에 적어두고, 없거나 다를 때만 로컬과 서버를 한 번 더합니다. 재로그인에는 다시 더해지지 않습니다. 잔액이 부풀지 않도록 `total` 과 `spent` 를 **반드시 같이** 더합니다. |
| 불러오기가 먼저 | 로그인 직후 `pullAccount()` → `syncUserRecord()` 순서입니다. 뒤집히면 빈 로컬 상태를 서버에 밀어 넣고 그 다음에 읽어옵니다. 불러온 뒤 `applyEffects()` 를 불러야 아이템 효과가 켜집니다. |
| `sync_my_record` 는 6인자를 유지 | PostgREST 호출 호환성을 위해 `p_branch`, `p_total_days`, `p_spent`, `p_owned`, `p_gifted`, `p_sent` 시그니처를 유지하고 마지막 두 인자에는 기본값을 둡니다. 휴가 영수증은 별도 RPC로 제한된 개수씩 동기화해 지갑 RPC와 섞지 않습니다. |
| 함수 교체 주의 | `sync_my_record` 는 인자가 늘었으므로 `create or replace` 로 못 고칩니다 — 시그니처가 다르면 교체가 아니라 **오버로드**가 생겨서, 아이템을 모르는 옛 2인자 함수가 살아남아 그 경로로 들어온 동기화가 `owned` 를 날립니다. `drop function` 이 먼저입니다. |
| 소속은 선택 사항 | 계정 저장은 소속과 무관하므로 `branch` 가 nullable 입니다. 대신 `leaderboard()` 가 `where branch is not null` 로 미선택자를 집계에서 뺍니다 — `null` 을 `group by` 에 넣으면 `json_object_agg` 가 null 키로 에러를 냅니다. |
| 소속 미선택 동기화 | `branch = coalesce(excluded.branch, user_records.branch)` — 소속을 안 고른 기기에서 동기화가 와도 이미 고른 소속을 지우지 않습니다. |

### 운영

Supabase 무료 프로젝트는 **7일간 요청이 없으면 정지되고 클라이언트에 오류를 반환합니다.**
`.github/workflows/keepalive.yml` 이 주 1회 찔러 타이머를 리셋합니다.

### 검증

- SQL: `supabase/board_test.sql` 실행 (제약 조건, 권한, `leaderboard()` 합산, 계정 병합 검증). `request.jwt.claims` 를 트랜잭션 로컬로 심어 **실제 `sync_my_record()` 를 호출**하므로 규칙을 베껴 적지 않습니다.
  - `user_id` 가 `auth.users` 를 참조해 임의 uuid 를 못 쓰므로, 스크립트가 **실재하는 계정 셋을 골라** 씁니다 (계정 3개 이상 필요). 그 계정들의 기존 기록은 트랜잭션 안에서 지웠다가 `rollback` 으로 되돌립니다.
  - **운영 데이터가 든 테이블 위에서 돌아갑니다.** "총 몇 명" 같은 절대값으로 검증하면 안 되고, 맨 앞에서 기준값을 잡아 증분으로 비교해야 합니다.
- 클라이언트: `window.__army.selfCheck()` (병합 규칙 포함), 리더보드 모달 열람 시 비로그인 구글 로그인 버튼 노출 및 로그인 후 동기화 동작 확인

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

선물 관련 분석에는 성공 여부·방식·일수 같은 경제 상태만 사용합니다. 선물 토큰과 편지 내용은 분석 이벤트나 세션 리플레이 페이로드에 넣지 않습니다.

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
| `gift_opened` | 선물 보내기 모달 오픈 (로그인 상태) | `current_balance` |
| `gift_created` | 선물 생성 완료 (서버가 토큰 발급) | `days`, `message_length`, `share_id`, `root_source` |
| `gift_claimed` | 선물 수령 버튼 클릭 후 서버가 성공을 반환 | `days`, `share_id`(랜딩 시점 sid, 있을 때만), `root_source`(있을 때만) |
| `gift_link_opened` | 선물 링크(`?gift=`)를 열어 수령 화면이 뜸 — 열고 받지 않은 이탈까지 잡는 게 목적 | (없음) |
| `share_link_created` | 공유 링크 생성 — 공유 부스트 아이템 사용 또는 선물 링크 공유·복사 | `kind`(`boost` 또는 `gift`), `share_id`, `root_source`, `generation` |
| `referral_landed` | 공유 링크(`?sid=`)로 랜딩 — `index.html` head 스크립트에서 `posthog.capture()`를 직접 호출한다 (`__analytics` 래퍼를 거치지 않음) | `share_id`, `root_source`, `root_content`, `generation` |

모든 이벤트에는 `first_source`, `root_source`, `root_content`, `generation` 4개 속성이 브라우저별 최초 방문 시 한 번 `register_once`로 고정되어 **공통으로 부착됩니다.** 정의와 자세한 설계는 [`docs/attribution-measurement-design.md`](docs/attribution-measurement-design.md) 참고.

### 사용자 식별 (Identity & Person Properties)

리더보드 로그인 시 Supabase 사용자 ID(UUID)로 `posthog.identify()`가 호출되며, 로그아웃 시 `posthog.reset()`으로 세션 식별이 초기화됩니다.
- **Person Properties**: `branch`(소속 군), `service_status`(복무 상태), `d_day`(남은 일수), `is_leaderboard_user` (`true`)

### UTM 유입 경로 & 대시보드 / 코호트

- **PostHog 자동 캡처의 범위와 한계**: PostHog는 유입 URL의 `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` 및 레퍼러를 **그 파라미터가 실려 있던 `$pageview` 이벤트에만** 자동으로 붙입니다. `first_delete_click`, `click_milestone_reached`, `session_engagement` 같은 행동 이벤트에는 유입 출처가 실리지 않아, 이 자동 캡처만으로는 게시판별 전환율을 비교할 수 없습니다.
- **공통 부착 속성**: 이를 메우기 위해 브라우저별 최초 방문 시 `first_source`, `root_source`, `root_content`, `generation` 4개 속성을 `register_once`로 고정해 **모든 이벤트에** 싣습니다. 공유로 들어온 사람은 `first_source = user_share`지만 `root_source`는 원조 게시판을 그대로 유지합니다 — 이 분리가 없으면 "이 게시판이 만든 확산"을 셀 수 없습니다. 자세한 정의는 [`docs/attribution-measurement-design.md`](docs/attribution-measurement-design.md) 참고.
- **게시판 링크는 `admin.html` 생성기로만 만듭니다.** 손으로 적지 않습니다 — `utm_content` 오타 하나가 같은 게시판을 서로 다른 두 소스로 갈라놓습니다.
- **공유 링크**는 `?sid=` 파라미터로 유입 사슬을 나릅니다. 예: `?sid=dcinside.army_post01.a3f9.1` (원조 소스.원조 콘텐츠.공유자 id.세대)
- **대시보드 인사이트** (`군생활 삭제 — 코어 분석`, `npm run posthog:setup`으로 생성·갱신):

  | 번호 | 이름 | 요약 |
  | --- | --- | --- |
  | ⑨ | 게시판별 신규 유입 | `generation = 0` 유입 수 — 모든 비율의 분모 |
  | ⑩ | 게시판별 핵심 행동 퍼널 | 유입 대비 실제 행동 — 게시판 평가는 유입 수가 아니라 이걸로 |
  | ⑪ | 확산 세대 분포 | `generation` 값 분포 — `1`이 없으면 공유가 작동하지 않는다는 뜻 |
  | ⑫ | 공유 생성 vs 공유 유입 | 두 시계열을 나란히 (같은 사람이 아니라 퍼널 아님) |
  | ⑬ | 선물 발송 퍼널 | 만들어놓고 안 보내는 이탈 |
  | ⑭ | 선물 수령 퍼널 | 열어놓고 안 받는 이탈 |
  | ⑮ | 게시판별 확산 계수 | HogQL, `direct / seeded` |

  판단 기준과 측정되지 않는 값(엄밀한 K₇ 아님 등)은 [`docs/attribution-measurement-design.md`](docs/attribution-measurement-design.md) §5·§6 참고.

- **코호트 (Cohorts)** — `scripts/posthog-setup.js` 가 실제로 만드는 5개:
  - 헤비 유저 (Heavy Deletors) — 누적 삭제 1000일 이상
  - 라이트 유저 (Casual Deletors) — 누적 삭제 10일 이상 1000일 미만
  - 이탈·찍먹 유저 (Bouncers) — 누적 삭제 10일 미만
  - 리더보드 등록 유저 (Leaderboard Active)
  - 공유로 들어온 유저 (Referred Users) — `first_source = user_share`

### 검증 테스트

```bash
node --test scripts/test-analytics.js scripts/test-shop-effects.js
```



## 일수 선물하기

상점의 위병소에서 `일수 선물하기` 카드를 누르면 선물 창이 열립니다. 메인 화면에 별도 선물 버튼을 두지 않습니다. 보유 일수에서 보내는 값을 덜어 응원 메시지와 함께 링크로 보냅니다. 발신은 로그인이라는 게이트를 통과해야 하고, 받은 사람은 로그인 없이 링크에서 수령합니다. SQL은 `supabase/board.sql`을 먼저 적용한 뒤 `supabase/gift.sql`을 적용하며, 검증은 `supabase/board_test.sql` → `supabase/gift_test.sql` 순서입니다.

| 항목 | 내용 |
| --- | --- |
| 발신은 로그인, 수령은 비로그인 | 이 비대칭이 설계의 중심입니다. 일회성을 "누가 받았나"가 아니라 "이 선물이 이미 열렸나"로 판정하므로 익명 수령으로도 중복이 불가능하고, 링크를 받은 사람에게 로그인을 요구하지 않아도 됩니다 — 퍼지라고 만드는 기능에 가장 비싼 관문을 세우지 않습니다. |
| 잔액 검증은 하지 않음 | 서버는 발신자가 정말 그 일수를 가졌는지 확인하지 않습니다. 게스트 지갑과 휴가 영수증 비용은 브라우저 계산에 남아 있고, 선물 서버는 일회성 링크와 발신 RPC의 기존 계약을 담당합니다. |
| 일회성은 보장함 | 위조 방지가 아니라 **기능의 성립 조건**입니다. 무한히 다시 열리면 받은 사람이 버튼만 눌러 일수를 찍어냅니다. URL 에 일수를 인코딩하는 무백엔드 방식이 제일 싸지만 정확히 여기서 무너져서, 테이블 하나와 함수 셋을 둡니다. |
| 조건부 갱신 한 방 | `update … where token = ? and claimed_at is null returning` — 조회하고 나서 갱신하면 동시에 두 번 눌렸을 때 둘 다 통과합니다. |
| 테이블 직접 접근 없음 | `gifts` 는 `anon`·`authenticated` 모두에게 권한이 없습니다. `update` 가 열려 있으면 `PATCH /rest/v1/gifts` 로 `claimed_at` 을 되돌려 무한 수령이 됩니다. RLS 도 켜 두되 정책을 두지 않아, 권한이 되살아나도 행이 새지 않습니다. |
| 링크 전달 | **링크 복사**와 **공유하기** 두 버튼입니다. `navigator.share` 는 데스크톱에 없고 사용자가 시트를 닫으면 거부로 떨어지므로 복사로 넘어갑니다. `navigator.clipboard` 도 비-https 나 권한 거부 시 조용히 실패하는데, 그때는 입력칸을 선택해 두어 직접 복사할 수 있게 남깁니다. |
| 차감 순서 | `spent` 차감은 **서버가 선물을 만든 뒤에만** 합니다. 먼저 깎고 요청이 실패하면 일수가 증발합니다. 수령도 마찬가지로 RPC 가 성공을 반환한 뒤에만 `addDays()` 합니다. |
| 회계 | **선물은 일수를 새로 만들지 않고 사람 사이에서 옮기기만 합니다.** 발신은 `spent`(잔액용)와 `gsent`(누적용)를 함께 늘리고, 수령은 `gifted`를 늘립니다. 휴가 영수증 비용은 별도 `receiptCost`로 한 번만 뺍니다.<br>· 잔액 = `max(0, total + gifted − spent − receiptCost)`<br>· 누적 삭제한 일수(화면·리더보드) = `max(0, total + gifted − gsent)` |
| 자기 자신에게 선물하기 | **막지 않습니다. 막을 필요가 없습니다.** 보낸 만큼과 받은 만큼이 정확히 상쇄되어 잔액도 누적도 그대로입니다. 받은 것만 더하면 잔액은 제자리인데 누적만 올라 **클릭 한 번 없이 순위를 무한히 올릴 수 있습니다.** `claim_gift` 에서 발신자 여부를 검사하는 방식은 수령이 비로그인이라 시크릿 창 한 번에 뚫립니다 — 규칙으로 막는 대신 이득을 없앴습니다. |
| 저장은 단조, 빼기는 표시할 때만 | `total`·`gifted`·`gsent`는 전부 늘기만 하므로 기존 지갑 RPC의 `greatest()` 병합이 성립합니다. 휴가 구매는 별도 영수증 RPC에서 operation ID로 멱등 처리합니다. 빼기는 잔액과 `leaderboard()`·클라이언트 `netTotal()`을 표시할 때만 합니다. |
| `ad.sent` 를 쓰지 않는 이유 | 그 키는 **옛 익명 리더보드가 "이미 보고한 누적치" 로 쓰던 이름**입니다. 그때 플레이한 브라우저에 값이 남아 있어, 재사용하면 그 숫자가 그대로 누적에서 차감됩니다. 선물 발신은 `ad.gsent` 입니다. |
| 분석 데이터 | 선물 토큰·편지 내용은 PostHog 이벤트와 세션 리플레이에 넣지 않습니다. 링크를 누구에게 공유했는지도 기록하지 않습니다. |
| 메시지 | 200자 상한(입력·서버 양쪽). 남이 쓴 문자열이므로 **`textContent` 로만** 렌더합니다. |
| `revoke ... from public` 만으로는 부족 | Supabase 는 `public` 스키마 함수에 `anon`·`authenticated` EXECUTE 를 **기본 부여**합니다(default privileges). `from public` 만 회수하면 `anon` 에게 남은 명시적 권한이 그대로라, 비로그인도 함수 본체까지 들어옵니다. `create_gift` 와 `sync_my_record` 는 `from public, anon` 으로 적었습니다. 본체의 `auth.uid()` 검사가 한 겹 더 막지만 권한으로도 막습니다. |
| 취소·만료 없음 | 만료를 넣으면 "만료된 선물의 일수는 누구 것인가"라는 반환 경로가 붙는데, 잔액을 검증하지 않는 이상 정직하게 처리할 수 없습니다. |

### 알려진 제약

- **구글 로그인 리디렉션이 쿼리를 지웁니다.** `signInWithGoogle()` 의 `redirectTo` 는 `origin + pathname` 이라 `?gift=` 가 날아갑니다. 수령이 로그인을 요구하지 않으므로 지금은 문제가 되지 않지만, 수령에 로그인을 붙이면 즉시 터집니다.
- 보낸 선물 목록·수령 알림은 없습니다. "내가 보낸 게 수령됐나"를 묻는 사람이 나오면 그때 붙입니다.


### 개편 검증 실행

기본 회귀는 `npm test`로 실행합니다. DOM 통합 테스트와 SQL 테스트의 도구는 앱 런타임에 포함하지 않습니다.

```sh
npm install --prefix /private/tmp/shop-validation jsdom @electric-sql/pglite
SHOP_JSDOM_MODULE=/private/tmp/shop-validation/node_modules/jsdom npm run test:ui
PGLITE_MODULE=/private/tmp/shop-validation/node_modules/@electric-sql/pglite npm run test:sql
```

SQL 러너는 임시 PGlite DB에 인증 역할·테스트 사용자 3명을 만든 뒤 `board.sql`, `gift.sql`, 양쪽 회귀 SQL과 실제 휴가 모듈의 왕복 계약을 검증합니다. 운영 Supabase에 연결하지 않습니다. 실서비스에서는 추가 휴가 RPC를 먼저 적용한 뒤 클라이언트를 배포해야 합니다. 서버 휴가 복원이 실패하면 새 지출을 막고 재시도합니다.
