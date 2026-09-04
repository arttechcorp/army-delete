-- 계정 저장 + 군별 리더보드 스키마.
-- Supabase 대시보드 → SQL Editor 에 이 파일을 통째로 붙여 넣고 실행하면 됩니다.
-- 여러 번 실행해도 안전합니다.

create table if not exists public.user_records (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text,
  branch      text check (branch in ('army','marine','navy','airforce')),
  total_days  bigint not null default 0,
  spent       bigint not null default 0,
  owned       text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

-- 이미 배포된 테이블을 위한 이관. 새로 만든 경우엔 아무 일도 하지 않는다.
alter table public.user_records add column if not exists spent bigint not null default 0;
alter table public.user_records add column if not exists owned text[] not null default '{}';

-- 소속은 리더보드 참가용이지 계정 저장의 조건이 아니다. 소속을 고르지 않은
-- 사람도 일수와 아이템은 저장돼야 하므로 null 을 허용한다.
-- (check 는 null 에 대해 null 을 반환하고, CHECK 는 false 일 때만 막으므로
--  기존 제약을 건드릴 필요가 없다.)
alter table public.user_records alter column branch drop not null;

-- RLS 활성화: 본인 레코드만 접근 가능.
-- 쓰기 정책은 남겨두되 아래에서 테이블 DML 권한을 회수하므로 실제 쓰기는
-- sync_my_record() 로만 들어온다. 권한을 되살릴 일이 생겨도 이 정책이
-- 남의 레코드를 건드리는 것만은 계속 막는다.
alter table public.user_records enable row level security;

drop policy if exists "user_records_select_own" on public.user_records;
create policy "user_records_select_own"
  on public.user_records
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_records_insert_own" on public.user_records;
create policy "user_records_insert_own"
  on public.user_records
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_records_update_own" on public.user_records;
create policy "user_records_update_own"
  on public.user_records
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 인자가 늘었으므로 create or replace 로는 못 고친다 — 시그니처가 다르면
-- 교체가 아니라 오버로드가 생겨서, 아이템을 모르는 옛 2인자 함수가 그대로
-- 살아남는다. 반드시 먼저 지운다.
drop function if exists public.sync_my_record(text, bigint);

-- 동기화 RPC: 본인의 소속·누적 일수·사용액·보유 아이템을 반영 (upsert)
--
-- 세 값 모두 단조 증가한다 — 일수는 클릭·광고·선물수령으로만 늘고, 사용액은
-- 구매·선물발신으로만 늘고, 아이템은 되팔 수 없다. 그래서 병합이 max/max/합집합
-- 으로 끝난다. 기기 두 대에서 무엇이 먼저 도착하든 결과가 같다.
create or replace function public.sync_my_record(
  p_branch     text,
  p_total_days bigint,
  p_spent      bigint,
  p_owned      text[]
)
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

  -- 소속 미선택(null)은 허용한다. 값이 있다면 아는 소속이어야 한다.
  if p_branch is not null and p_branch not in ('army', 'marine', 'navy', 'airforce') then
    raise exception '올바르지 않은 소속입니다.';
  end if;

  -- 아이템 개수 상한. 클라이언트가 보내는 배열이므로 크기를 여기서 자른다.
  if coalesce(array_length(p_owned, 1), 0) > 200 then
    raise exception '보유 아이템이 너무 많습니다.';
  end if;

  insert into public.user_records (user_id, email, branch, total_days, spent, owned, updated_at)
  values (
    v_uid,
    auth.jwt() ->> 'email',
    p_branch,
    greatest(coalesce(p_total_days, 0), 0),
    greatest(coalesce(p_spent, 0), 0),
    coalesce(p_owned, '{}'),
    now()
  )
  on conflict (user_id) do update set
    -- 소속 미선택 상태로 동기화가 와도 이미 고른 소속을 지우지 않는다
    branch     = coalesce(excluded.branch, user_records.branch),
    total_days = greatest(user_records.total_days, excluded.total_days),
    spent      = greatest(user_records.spent, excluded.spent),
    owned      = array(select distinct unnest(user_records.owned || excluded.owned)),
    updated_at = now();
end;
$$;

-- 읽기 RPC: stable 함수로 선언하여 GET 또는 POST 호출 가능
-- 전체 누적 일수 총합, 참여자 수, 군별 sum/count 집계를 한 번에 JSON으로 반환
--
-- 소속을 고르지 않은 사람은 모든 집계에서 뺀다. 소속 null 을 group by 에
-- 넣으면 json_object_agg 가 null 키로 에러를 내고, 총합만 포함시키면
-- 총합과 군별 합이 어긋난다. 리더보드에 참가하지 않은 것으로 본다.
create or replace function public.leaderboard()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'total_all', coalesce((select sum(total_days) from public.user_records where branch is not null), 0),
    'total_users', coalesce((select count(*) from public.user_records where branch is not null), 0),
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
        where branch is not null
        group by branch
      ) t
    ), '{}'::json)
  );
$$;

-- 권한 부여
revoke all on table public.user_records from public, anon;

-- 테이블 직접 쓰기는 주지 않는다. insert/update 를 열어두면 클라이언트가
-- PATCH /rest/v1/user_records 로 total_days 를 직접 써서 위 upsert 의
-- greatest() 가드를 그냥 우회한다 (낮은 값으로 되돌리거나 임의값 주입).
-- 쓰기는 security definer 인 sync_my_record() 로만 들어온다.
-- 읽기는 로그인 시 본인 레코드를 불러오는 데 쓴다 — RLS 가 남의 행을 막는다.
grant select on table public.user_records to authenticated;
revoke insert, update, delete on table public.user_records from authenticated;

revoke all on function public.sync_my_record(text, bigint, bigint, text[]) from public;
revoke all on function public.leaderboard() from public;

grant execute on function public.sync_my_record(text, bigint, bigint, text[]) to authenticated;
grant execute on function public.leaderboard() to anon, authenticated;
