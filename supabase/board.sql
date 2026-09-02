-- 군별 리더보드 스키마.
-- Supabase 대시보드 → SQL Editor 에 이 파일을 통째로 붙여 넣고 실행하면 된다.
-- 여러 번 실행해도 안전하다.

create table if not exists public.board (
  branch text   not null check (branch in ('army','marine','navy','airforce')),
  day    date   not null,
  n      bigint not null default 0,
  primary key (branch, day)
);

-- 정책을 하나도 만들지 않는다 = anon 이 테이블을 직접 읽거나 쓸 수 없다.
-- 접근은 아래 두 함수(security definer)로만 열린다.
alter table public.board enable row level security;

-- 쓰기. 인증이 없어 누구나 호출할 수 있으므로 clamp 가 유일하면서 필수적인 방어선이다.
create or replace function public.tap(p_branch text, p_delta int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.board (branch, day, n)
  values (
    p_branch,
    (now() at time zone 'Asia/Seoul')::date,
    least(greatest(p_delta, 1), 500)
  )
  on conflict (branch, day) do update set n = board.n + excluded.n;
$$;

-- 읽기. stable 이라 GET /rest/v1/rpc/leaderboard 로 호출할 수 있다.
-- 두 탭(누적·오늘)을 한 번에 준다. 응답은 200바이트 안팎.
create or replace function public.leaderboard()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'total', coalesce((select json_object_agg(branch, s)
                       from (select branch, sum(n) s
                               from public.board
                              group by branch) t), '{}'::json),
    'today', coalesce((select json_object_agg(branch, n)
                         from public.board
                        where day = (now() at time zone 'Asia/Seoul')::date), '{}'::json)
  );
$$;

-- 기본값에 기대지 않고 노출면을 직접 정한다.
revoke all on function public.tap(text, int) from public;
revoke all on function public.leaderboard()  from public;
grant execute on function public.tap(text, int) to anon;
grant execute on function public.leaderboard()  to anon;
