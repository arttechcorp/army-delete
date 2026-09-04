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

-- RLS 활성화: 본인 레코드만 직접 읽기/쓰기 가능
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
grant select, insert, update on table public.user_records to authenticated;

revoke all on function public.sync_my_record(text, bigint) from public;
revoke all on function public.leaderboard() from public;

grant execute on function public.sync_my_record(text, bigint) to authenticated;
grant execute on function public.leaderboard() to anon, authenticated;
