# 군생활 삭제 버튼

> **참고**: 본 파일은 `agent.md`와 같은 내용이므로 별도로 열람할 필요가 없습니다.

빌드 도구·프레임워크·의존성 없는 정적 사이트. 기능 설명은 `README.md`에 있다.
여기에는 **고치다 깨먹기 쉬운 지점**만 적는다.

## 브랜치 및 배포 규칙 (중요)

- **`main` 브랜치는 프로덕션 환경으로 바로 자동 배포되는 브랜치입니다.**
- **`main` 브랜치에 커밋 및 푸시는 반드시 사용자의 사전 명시적 허가를 받은 후에만 진행합니다.**
- 모든 개발, 기능 수정, 디버깅 작업 및 일반 커밋·푸시는 항상 `dev` 브랜치에서 진행합니다.

## Commands

```bash
npx serve .            # 로컬 서버. file:// 로 열면 items.json fetch 가 막혀 상점이 빈다
npm test               # 분석 테스트 + 상점 효과 테스트
npm run db:push        # supabase/board.sql 을 Supabase 에 적용
npm run posthog:setup  # 코호트·대시보드 생성 (.env 필요)
```

## 편집 후 반드시: 인라인 스크립트 문법 검사

앱 전체가 `index.html` 한 파일(~2,900줄)이고 로직은 마지막 `<script>` 블록 하나에 다 들어 있다.
**거기서 SyntaxError 가 나면 이벤트 리스너가 하나도 안 붙어 페이지 전체가 죽는다** —
버튼·날짜 계산·리더보드·상점이 한꺼번에 먹통이 되는 증상으로 나타난다.
과거에 머지 충돌 마커가 그대로 커밋돼 프로덕션이 이렇게 죽은 적이 있다.

```bash
sed -n '/^<script>$/,/^<\/script>$/p' index.html | grep -v '^</\?script>$' | node --check /dev/stdin
```

브라우저 콘솔에서는 `__army.selfCheck()` 로 회계·날짜 로직을 확인한다 (`'ok'` 반환).

## 테스트가 index.html 원문을 읽는다

`scripts/test-analytics.js` 는 순수 로직뿐 아니라 `index.html` 과 `privacy.html` 의
**소스 문자열을 정규식으로 검사**한다 (`disable_session_recording`, `maskAllInputs`,
`time_to_reach_seconds`, `total_days_deleted` 등).
분석 관련 코드를 지우거나 리네임하면 테스트가 깨진다 — 의도한 변경이면 테스트도 같이 고칠 것.

## 크로스파일 제약

- **localStorage 키(`ad.*`)나 외부로 나가는 요청이 바뀌면 `privacy.html` 도 같이 고친다.**
  AdSense 승인 요건이고, 테스트도 이걸 검사한다.
- Supabase RPC 는 6인자 `sync_my_record(p_branch, p_total_days, p_spent, p_owned, p_gifted, p_sent)` 다.
  뒤 두 개에 default 가 있어 옛 4·5인자 호출도 받는다 (배포 창 대비). 옛 판들은
  `supabase/board.sql` 에서 drop 됐다 — 남겨두면 호출이 모호해지거나 값이 날아간다.
  **인자를 늘릴 때는 반드시 옛 시그니처를 `drop function` 할 것.**
- **잔액 = `total + gifted - spent`, 누적 삭제 일수 = `netTotal()` = `total + gifted - gsent`** 다.
  선물은 일수를 새로 만들지 않고 옮기기만 한다 — 받은 것만 더하면 자기 자신에게
  선물해 클릭 없이 순위를 무한히 올릴 수 있다. 화면·리더보드·분석에 `total` 을
  그대로 쓰지 말고 `netTotal()` 을 쓸 것. 수령은 `addGifted()`, 발신은 `spent` 와
  `gsent` 를 함께 올린다.
- 선물 발신 키는 **`ad.gsent`** 다. `ad.sent` 는 옛 익명 리더보드가 쓰던 이름이라
  그 시절 값이 남은 브라우저에서 누적이 통째로 깎인다 — 재사용 금지.
- **판매 종료한 아이템(`items.json` 의 `legacyItems`)에는 `effect` 를 남기지 않는다.**
  `ShopEngine.stats()` 는 `data.items` 만 읽는다 — 타입별로 걸러내면 효과 타입이 늘 때마다
  빠뜨린다. 옛 배수(`multiplier`·`senior`)가 `Math.max` 로 신규 효과를 이겨서 상점에서 뭘 사도
  `전체 병사 8 → 8일/회` 처럼 수치가 안 오르던 사고가 여기서 났다. 아이템을 내릴 때는
  `items` → `legacyItems` 로 옮기면서 `effect` 를 통째로 뗀다.
  **보유 기록(`owned`)은 건드리지 않는다** — 지우면 '기존 보유품' 목록이 비고, 서버 `owned` 는
  합집합으로 병합돼(`board.sql` 의 `sync_my_record`) 클라이언트 localStorage 에서 되살아난다.
  예외는 `long-leave` 하나다. 이미 지급한 휴가 영수증이라 회수하지 않는다.
- 서버 검증 변경 시 `supabase/board_test.sql` 도 함께 (assert 후 rollback 하는 자체 점검).
- **`.shop-scrim` 모달을 새로 만들면 스크롤 영역을 `.shop-scroll` 로 감쌀 것.**
  `.shop` 이 `overflow:hidden` 이라 안 감싸면 넘친 부분에 손가락이 닿지 않는다.
  리더보드가 이걸 빠뜨려 로그아웃 버튼이 잘려 있었다.

## 스타일

ES5 문법 (`var`, `function`), 빌드 단계가 없어 트랜스파일이 없다. 주변 코드를 따를 것.
주석은 한국어이고 "왜"를 적는다.
