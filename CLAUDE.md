# 군생활 삭제 버튼

빌드 도구·프레임워크·의존성 없는 정적 사이트. 기능 설명은 `README.md`에 있다.
여기에는 **고치다 깨먹기 쉬운 지점**만 적는다.

## Commands

```bash
npx serve .            # 로컬 서버. file:// 로 열면 items.json fetch 가 막혀 상점이 빈다
npm test               # node --test scripts/test-analytics.js
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
- 서버 검증 변경 시 `supabase/board_test.sql` 도 함께 (assert 후 rollback 하는 자체 점검).

## 스타일

ES5 문법 (`var`, `function`), 빌드 단계가 없어 트랜스파일이 없다. 주변 코드를 따를 것.
주석은 한국어이고 "왜"를 적는다.
