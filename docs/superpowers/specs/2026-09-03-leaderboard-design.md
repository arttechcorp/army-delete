# 군별 리더보드 설계

작성일: 2026-09-03
상태: 승인 대기

## 목적

`index.html` 하나로 끝나던 단일 페이지 장난감에, 방문자 전체가 함께 밀어 올리는
**군별 익명 집계 리더보드**를 붙인다. 개인 순위·닉네임·로그인은 만들지 않는다.

## 확정된 제품 결정

| 항목 | 결정 | 근거 |
| --- | --- | --- |
| 순위 단위 | 육군 / 해병 / 해군 / 공군 4팀 | 개인 식별을 만들지 않기로 함. 닉네임·계정·개인정보 0 |
| 탭 | 누적 총합, 오늘 총합 | 누적은 성취, 오늘은 재방문 동기 |
| 줄 세우기 | 단순 총합 (인당 평균 아님) | "우리 군이 직접 밀어줬다"는 감각을 우선 |
| 일간 경계 | KST 자정 | 국내 사용자 전용 서비스 |
| 백엔드 | Supabase (Postgres + PostgREST) | 아래 참조 |

## 백엔드 선택 근거

검증한 사실:

- **Vercel Hobby는 AdSense 사이트를 금지한다.** Fair Use 정책이 광고 수익화를
  commercial로 분류한다. 이 사이트엔 이미 AdSense가 붙어 있으므로, 호스팅을
  옮겨야 할 가능성이 상존한다.
  <https://vercel.com/docs/limits/fair-use-guidelines>
- **Upstash Redis안은 서버 함수를 강제한다.** 쓰기 토큰을 브라우저에 노출하면
  누구나 데이터를 날릴 수 있어, Redis는 반드시 서버 뒤에 있어야 한다. 즉 함수를
  실행할 수 있는 호스트에 종속된다. 무료 티어는 월 500K 커맨드 / 30일 무활동 시
  아카이브. <https://upstash.com/pricing/redis>
- **Firestore는 이 용도에 부적합하다.** 단일 문서 지속 쓰기 상한이 1회/초이고,
  공식 권장 해법이 샤드 카운터다. 카운터 하나에 그만한 복잡도를 들일 이유가 없다.
  <https://firebase.google.com/docs/firestore/solutions/counters>
- **Firebase RTDB는 성능상 가능하다** (인스턴스 전체 1,000 writes/sec, 경로별
  상한 없음). 다만 SDK 번들을 지고 보안 규칙 문법을 배워야 한다.
  <https://firebase.google.com/docs/database/usage/limits>
- **Supabase 무료 티어**: DB 500MB, 월 egress 5GB, **7일간 활동이 없으면 프로젝트가
  정지되고 클라이언트에 오류를 반환**한다. 들어오는 API 요청이 타이머를 리셋한다.
  <https://supabase.com/docs/guides/platform/free-project-pausing>

Supabase를 택한 이유는 셋이다.

1. **호스트 독립적.** 정적 파일 + 브라우저에서 PostgREST 호출이라, Vercel에 남든
   AdSense 정책 때문에 다른 곳으로 옮기든 설계가 그대로 유효하다.
2. **서버 파일이 0개.** 입력 검증(clamp)이 SQL 함수 안에서 끝나므로 서버리스 함수를
   새로 만들 필요가 없다. 빌드 도구·의존성 없는 현재 구조가 유지된다.
3. 대시보드에서 숫자를 눈으로 확인할 수 있다.

감수하는 것: 7일 무활동 정지. GitHub Actions 주간 cron 핑으로 막는다.

## 데이터 모델

테이블 하나로 두 탭을 모두 만든다.

```sql
create table board (
  branch text not null check (branch in ('army','marine','navy','airforce')),
  day    date not null,
  n      bigint not null default 0,
  primary key (branch, day)
);
alter table board enable row level security;   -- 정책 없음 = anon 직접 접근 불가
```

- **오늘 탭** = `day = 오늘(KST)` 인 행
- **누적 탭** = branch별 `sum(n)`
- 행 증가량은 하루 4행. 3년이 지나도 5천 행 미만이라 별도 롤업이 필요 없다.

## API

`security definer` 함수 두 개만 anon에 노출한다. 테이블 자체는 RLS로 잠근다.

### 쓰기 — `tap(p_branch text, p_delta int)`

```sql
create function tap(p_branch text, p_delta int) returns void
language sql security definer as $$
  insert into board (branch, day, n)
  values (
    p_branch,
    (now() at time zone 'Asia/Seoul')::date,
    least(greatest(p_delta, 1), 500)
  )
  on conflict (branch, day) do update set n = board.n + excluded.n;
$$;
```

- `p_branch`가 화이트리스트 밖이면 테이블 CHECK 제약이 거부한다.
- `p_delta`는 **1~500으로 clamp**한다. 인증이 없어 누구나 호출할 수 있으므로,
  이 clamp가 유일하면서 필수적인 방어선이다.

### 읽기 — `leaderboard()`

`stable`로 선언해 `GET /rest/v1/rpc/leaderboard`로 호출 가능하게 한다. 두 탭을 한 번에
JSON으로 반환한다.

```sql
create function leaderboard() returns json
language sql stable security definer as $$
  select json_build_object(
    'total', coalesce((select json_object_agg(branch, s)
                       from (select branch, sum(n) s from public.board group by branch) t),
                      '{}'::json),
    'today', coalesce((select json_object_agg(branch, n)
                       from public.board
                       where day = (now() at time zone 'Asia/Seoul')::date),
                      '{}'::json)
  );
$$;
```

grant는 명시한다 — `revoke all on function ... from public` 후 `grant execute`를
`anon`에만 준다. Supabase 기본값에 기대지 않는다.

응답은 200바이트 안팎이다. 월 5GB egress 안에서 걱정할 규모가 아니다.

## 클라이언트

### 소속 선택

현재 프리셋은 `육군 18 / 해군 20 / 공군 21` 3개이고 해병이 육군 버튼에 묶여 있다.
**`해병 18`을 4번째 버튼으로 분리**하고, 선택값을 `localStorage`의 `lb.branch`에
저장한다. 복무 개월수 계산은 기존과 동일(해병 18개월).

소속이 선택되지 않은 동안에는 전송하지 않고 로컬에 delta만 쌓는다.

### 전송 배칭

클릭마다 요청을 보내지 않는다.

- `lb.sent` — 지금까지 서버에 보고한 누적치를 `localStorage`에 저장
- `delta = ad.total - lb.sent`
- **10초마다**, 그리고 **`pagehide` 시 `navigator.sendBeacon`으로** delta > 0 이면
  `POST /rest/v1/rpc/tap` 1회
- 성공했을 때만 `lb.sent`를 전진시킨다. 실패하면 다음 주기에 자연히 재시도된다.

연타 1000번이 요청 1~2건으로 줄어든다.

**기존 누적치는 반영하지 않는다.** 소속을 처음 고르는 시점에 `lb.sent = ad.total`로
초기화한다. 이유: 기존 사용자의 누적치를 한 번에 밀어 넣으면 clamp 500에 걸려
조용히 잘리고, 잘리지 않도록 예외를 두면 그 경로가 그대로 치팅 통로가 된다.
리더보드는 도입 시점부터 함께 쌓는다.

### 읽기

리더보드 모달이 열려 있는 동안에만 폴링한다 — 열 때 1회 + 15초 간격. 닫으면 멈춘다.

### UI

기존 상점 모달(`shop-scrim`) 패턴을 그대로 재사용한다. `상점 들어가기` 옆에
`리더보드` 버튼을 두고, 모달 안에 탭 2개와 막대 4줄을 그린다. 새 디자인 언어를
도입하지 않는다.

## 운영

### 정지 방지

`.github/workflows/keepalive.yml` — 주 1회 `GET /rest/v1/rpc/leaderboard`에 curl 한 번.
7일 무활동 정지 타이머를 리셋한다.

### 비밀값

Supabase anon key는 **공개되도록 설계된 값**이므로 `index.html`에 그대로 넣는다.
service_role key는 절대 클라이언트에 넣지 않는다. 테이블이 RLS로 잠겨 있고
노출면이 함수 둘 뿐이라 anon key로 할 수 있는 일은 clamp된 증가와 조회가 전부다.

## 개인정보

이것이 이 프로젝트의 **첫 외부 전송**이다.

- 나가는 데이터: `{소속, 정수}` 뿐. 입대일·전역일·상점 구매 내역은 전송하지 않는다.
- 모달 하단에 안내 한 줄을 넣는다.
- `README.md`의 "외부 전송 없음" 문구와 외부 요청 목록을 수정한다.

## 치팅

팀 익명 집계라 개인이 얻는 것이 없어 동기가 약하다. **delta 상한 500만으로 간다.**
IP 레이트리밋(`request.headers` 파싱)은 실제 남용이 관측되면 그때 추가한다.

## 검증

비자명한 로직은 둘뿐이라 각각 하나씩만 남긴다.

1. `supabase/board_test.sql` — `do $$ ... assert ... $$` 블록. clamp 하한/상한,
   화이트리스트 밖 branch 거부, 같은 날 두 번 호출 시 합산을 확인한다.
2. 클라이언트 delta 회계(`ad.total - lb.sent`, 실패 시 미전진)의 `assert` 자체 점검.

## 파일

| 파일 | 변경 |
| --- | --- |
| `supabase/board.sql` | 신규 — 테이블·RLS·함수 2개 |
| `supabase/board_test.sql` | 신규 — SQL assert 점검 |
| `index.html` | 리더보드 버튼·모달·전송 로직, 해병 프리셋 분리 |
| `.github/workflows/keepalive.yml` | 신규 — 주간 핑 |
| `README.md` | 외부 전송 문구 수정, 리더보드 항목 추가 |

## 사용자 작업 (내가 할 수 없는 것)

1. Supabase 프로젝트 생성 후 `board.sql` 실행
2. 프로젝트 URL과 anon key 전달

## 알려진 위험

- **Vercel Hobby + AdSense는 정책 위반이다.** 리더보드와 무관하게 이미 존재하는
  문제이며 이 설계로 악화되지도, 해결되지도 않는다. 이 설계는 호스트 독립적이라
  이전 시 재작업이 필요 없다.
- Supabase 무료 프로젝트는 장기 정지 상태가 이어지면 삭제될 수 있다. 주간 핑이
  실패하면 알아채지 못할 수 있으므로, 워크플로 실패 알림을 켜두는 것이 좋다.
