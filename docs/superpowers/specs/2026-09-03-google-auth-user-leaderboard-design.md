# 구글 로그인 및 사용자 누적 일수 기반 군별 리더보드 개편 설계

작성일: 2026-09-03
상태: 승인됨

## 1. 개요 및 배경

기존 리더보드는 익명 사용자가 소속 군을 선택한 시점부터 발생하는 클릭 증가분(delta, 최대 500)만 실시간 누적하는 구조였습니다.
이로 인해:
1. 군 소속을 나중에 선택한 경우, 그 이전에 로컬에서 달성한 "누적 삭제된 일수(`ad.total`)"가 리더보드에 반영되지 않았습니다.
2. 각 군별 총합 수치가 작게 집계되고, 사용자의 실제 활동량 전체가 반영되지 못했습니다.

본 설계는 **구글 로그인(Supabase Auth)** 을 도입하여:
- 리더보드 열람 시 구글 로그인을 필수로 요구합니다.
- 각 사용자의 로컬 "누적 삭제된 일수(`ad.total`)" 및 군 소속(`ad.branch`)을 사용자 계정 레코드로 안전하게 저장/동기화합니다.
- 리더보드는 등록된 사용자들의 누적 삭제 일수를 군별로 합산(`SUM(total_days)`)하여 표시합니다.
- 큰 숫자를 시원하게 표시하기 위해 리더보드 모달의 크기를 확장하고 가독성을 대폭 개선합니다.

---

## 2. 시스템 아키텍처

```mermaid
flowchart TD
    subgraph Client [브라우저 클라이언트]
        Local[LocalStorage: ad.total, ad.branch]
        AuthModal[리더보드 로그인 게이트]
        BoardView[확장된 군별 리더보드 뷰]
    end

    subgraph Supabase [Supabase 백엔드]
        GoogleAuth[Supabase Auth (Google OAuth)]
        UserTable[public.user_records 테이블]
        RPCLb[public.leaderboard RPC]
    end

    AuthModal -->|1. 구글 OAuth 로그인| GoogleAuth
    GoogleAuth -->|2. JWT 세션 발급| Client
    Client -->|3. ad.total & branch 동기화| UserTable
    BoardView -->|4. 랭킹 조회| RPCLb
    RPCLb -->|5. 군별 SUM & COUNT 집계| UserTable
```

---

## 3. 데이터베이스 및 백엔드 설계 (`supabase/board.sql`)

### (1) 테이블: `public.user_records`
구글 로그인된 각 사용자당 1개 행을 보관합니다.

```sql
create table if not exists public.user_records (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text,
  branch      text not null check (branch in ('army','marine','navy','airforce')),
  total_days  bigint not null default 0,
  updated_at  timestamptz not null default now()
);
```

### (2) RLS (Row Level Security) 정책
사용자 개인정보 보호 및 데이터 무결성을 보장합니다.
- RLS 활성화: `alter table public.user_records enable row level security;`
- **본인 행 조회 (SELECT)**: `auth.uid() = user_id`
- **본인 행 등록 (INSERT)**: `with check (auth.uid() = user_id)`
- **본인 행 수정 (UPDATE)**: `using (auth.uid() = user_id) with check (auth.uid() = user_id)`
- 일반 `anon`이나 타인은 테이블을 직접 조회할 수 없습니다.

### (3) 동기화 RPC: `public.sync_my_record(p_branch text, p_total_days bigint)`
클라이언트가 본인의 군 소속과 누적 일수를 안전하게 업서트하는 함수입니다.
```sql
create or replace function public.sync_my_record(p_branch text, p_total_days bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception '인증이 필요합니다.';
  end if;

  if p_branch not in ('army', 'marine', 'navy', 'airforce') then
    raise exception '올바르지 않은 소속입니다.';
  end if;

  insert into public.user_records (user_id, email, branch, total_days, updated_at)
  values (
    v_uid,
    auth.jwt() ->> 'email',
    p_branch,
    greatest(coalesce(p_total_days, 0), 0),
    now()
  )
  on conflict (user_id) do update set
    branch = excluded.branch,
    total_days = greatest(user_records.total_days, excluded.total_days),
    updated_at = now();
end;
$$;
```

### (4) 리더보드 집계 RPC: `public.leaderboard()`
등록된 모든 사용자의 누적 일수 총합, 참여자 수, 군별 집계를 산출하여 반환합니다.
```sql
create or replace function public.leaderboard()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'total_all', coalesce((select sum(total_days) from public.user_records), 0),
    'total_users', coalesce((select count(*) from public.user_records), 0),
    'branches', coalesce((
      select json_object_agg(
        branch,
        json_build_object(
          'total_days', s,
          'user_count', c
        )
      )
      from (
        select branch, sum(total_days) as s, count(*) as c
        from public.user_records
        group by branch
      ) t
    ), '{}'::json)
  );
$$;
```

---

## 4. 프론트엔드 클라이언트 구현 설계 (`index.html`)

### (1) 라이브러리 및 인증 클라이언트
- Supabase 공식 브라우저 라이브러리 `@supabase/supabase-js@2` CDN 추가.
- `window.supabaseClient = supabase.createClient(SB_URL, SB_KEY)` 초기화.
- 구글 로그인 실행:
  ```javascript
  supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  ```
- 세션 리스너: `supabaseClient.auth.onAuthStateChange(function(event, session) { ... })`

### (2) 사용자 데이터 동기화
- 로그인 상태일 때:
  - 리더보드 모달 열 때
  - 소속 군 버튼을 누를 때
  - 누적 일수(`ad.total`) 증가 후 디바운스(10초 주기)
  `sync_my_record`를 호출하여 서버에 반영.
- 비로그인 상태일 때:
  - 브라우저 로컬 스토리지에만 누적 보관.
  - 로그인 성공 시 로컬의 `ad.total`과 `ad.branch`를 즉시 `sync_my_record`로 전송하여 서버에 합산.

### (3) 리더보드 모달 크기 및 UI 개편
- 모달 너비: `max-width: 680px`로 확대 (기존 560px).
- **비로그인 뷰**:
  - 일러스트/아이콘 + "구글 계정으로 로그인하고 군별 랭킹을 확인하세요" 안내문
  - 공식 Google 브랜딩 스타일의 "Google 계정으로 계속하기" 로그인 버튼
- **로그인 완료 뷰**:
  - **헤더 요약**: 전체 군 통합 삭제 일수 및 총 참여 전우 수
  - **군별 랭킹 리스트 (1~4위)**:
    - 1위 배지 및 하이라이트
    - 군별 마크/이름 (육군 / 해병 / 해군 / 공군)
    - 시각적 막대 게이지 (1위 대비 비율)
    - 참여 전우 수 (예: `128명 참여`)
    - 큼직한 모노스페이스 볼드 숫자 (예: `1,280,450일`)
    - 내 소속 군 행에 `mine` 스타일 적용
  - **하단 내 정보 바**:
    - 로그인 이메일, 내 소속 군, 내가 기여한 누적 일수
    - 로그아웃 버튼 (로그아웃 시 비로그인 뷰로 즉시 전환)

---

## 5. 단계별 검증 계획

1. **SQL 검증 (`supabase/board.sql`, `supabase/board_test.sql`)**:
   - `sync_my_record` 권한 검증 및 upsert 로직 테스트
   - `leaderboard()`의 군별 합산(`sum`) 및 참여자 수(`count`) 반환 검증
2. **클라이언트 인증 흐름 검증**:
   - 비로그인 상태에서 리더보드 클릭 시 구글 로그인 뷰 노출 확인
   - 로그인 완료 시 세션 복원 및 리더보드 렌더링 확인
   - 로그아웃 클릭 시 상태 초기화 확인
3. **데이터 동기화 및 집계 검증**:
   - 군 선택이 늦더라도 로컬의 `ad.total` 전체가 유실 없이 전달되는지 확인
   - 큰 자릿수(수백만~수십억 단위) 렌더링 시 레이아웃 깨짐 없는지 확인

