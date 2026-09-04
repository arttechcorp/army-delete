-- 군별 리더보드 (구글 로그인 및 사용자 누적 일수 기반) 스키마.
-- Supabase 대시보드 → SQL Editor 에 이 파일을 통째로 붙여 넣고 실행하면 됩니다.
-- 여러 번 실행해도 안전합니다.

create table if not exists public.user_records (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text,
  branch      text not null check (branch in ('army','marine','navy','airforce')),
  total_days  bigint not null default 0,
  updated_at  timestamptz not null default now()
);

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

-- 동기화 RPC: 본인의 군 소속과 누적 일수를 안전하게 반영 (upsert)
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

-- 읽기 RPC: stable 함수로 선언하여 GET 또는 POST 호출 가능
-- 전체 누적 일수 총합, 참여자 수, 군별 sum/count 집계를 한 번에 JSON으로 반환
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

-- 권한 부여
revoke all on table public.user_records from public, anon;

-- 테이블 직접 쓰기는 주지 않는다. insert/update 를 열어두면 클라이언트가
-- PATCH /rest/v1/user_records 로 total_days 를 직접 써서 위 upsert 의
-- greatest() 가드를 그냥 우회한다 (낮은 값으로 되돌리거나 임의값 주입).
-- 쓰기는 security definer 인 sync_my_record() 로만 들어온다.
-- 읽기는 본인 레코드 조회용으로 남겨둔다 — RLS 가 남의 행을 막는다.
grant select on table public.user_records to authenticated;
revoke insert, update, delete on table public.user_records from authenticated;

revoke all on function public.sync_my_record(text, bigint) from public;
revoke all on function public.leaderboard() from public;

grant execute on function public.sync_my_record(text, bigint) to authenticated;
grant execute on function public.leaderboard() to anon, authenticated;
