-- 계정 저장 + 군별 리더보드 스키마.
-- Supabase 대시보드 → SQL Editor 에 이 파일을 통째로 붙여 넣고 실행하면 됩니다.
-- 여러 번 실행해도 안전합니다.

create table if not exists public.user_records (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text,
  branch      text check (branch in ('army','marine','navy','airforce')),
  total_days  bigint not null default 0,
  spent       bigint not null default 0,
  gifted      bigint not null default 0,
  sent        bigint not null default 0,
  owned       text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

-- 이미 배포된 테이블을 위한 이관. 새로 만든 경우엔 아무 일도 하지 않는다.
alter table public.user_records add column if not exists spent bigint not null default 0;
alter table public.user_records add column if not exists owned text[] not null default '{}';
alter table public.user_records add column if not exists gifted bigint not null default 0;
alter table public.user_records add column if not exists sent bigint not null default 0;

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
-- 인자를 늘릴 때마다 옛 판을 지워야 한다. 남겨두면 default 가 있는 새 판과
-- 겹쳐 호출이 모호해지거나, 새 값을 모르는 옛 판으로 흘러들어 값이 날아간다.
drop function if exists public.sync_my_record(text, bigint, bigint, text[]);
drop function if exists public.sync_my_record(text, bigint, bigint, text[], bigint);

-- 동기화 RPC: 본인의 소속·누적 일수·사용액·보유 아이템을 반영 (upsert)
--
-- 세 값 모두 단조 증가한다 — 일수는 클릭·광고·선물수령으로만 늘고, 사용액은
-- 구매·선물발신으로만 늘고, 아이템은 되팔 수 없다. 그래서 병합이 max/max/합집합
-- 으로 끝난다. 기기 두 대에서 무엇이 먼저 도착하든 결과가 같다.
-- p_gifted 에 default 를 준다. PostgREST 는 본문의 인자 "이름"으로 함수를 찾으므로,
-- 아직 옛 코드를 들고 있는 브라우저가 4인자로 불러도 이 함수가 그대로 받는다.
-- (default 없이 5인자로 만들면 배포와 SQL 적용 사이에 동기화가 통째로 실패한다.)
create or replace function public.sync_my_record(
  p_branch     text,
  p_total_days bigint,
  p_spent      bigint,
  p_owned      text[],
  p_gifted     bigint default 0,
  p_sent       bigint default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_prev_days bigint;
  v_prev_net  bigint;
  v_prev_at   timestamptz;
  v_allow     bigint;
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

  -- 일수·사용액 상한. 숫자도 클라이언트가 보내는 값이라 여기서 자른다.
  -- 아래 greatest() 병합은 되돌릴 수 없어서, 한 번 들어온 헛값은 영구히 남고
  -- 리더보드 집계를 통째로 망가뜨린다 (sum() 오버플로까지 간다).
  --
  -- 실제로 가능한 최대 속도: 자동 대원을 전부 사면 약 15.3회/초, 배수는 겹치지
  -- 않고 가장 높은 것 하나만 붙어 3배 — 손클릭까지 더해도 초당 110일 언저리다.
  -- 200일/초로 여유를 두고, 첫 동기화와 기기 병합(로컬+서버 합산) 몫으로
  -- 2천만일을 얹는다. updated_at 은 쓰기가 성공해야 움직이므로, 혹시 정상
  -- 사용자가 걸려도 시간이 지나면 허용치가 따라붙어 저절로 풀린다.
  select total_days, updated_at into v_prev_days, v_prev_at
    from public.user_records where user_id = v_uid;

  v_allow := coalesce(v_prev_days, 0) + 20000000
           + 200 * greatest(extract(epoch from (now() - coalesce(v_prev_at, now())))::bigint, 0);

  if greatest(coalesce(p_total_days, 0), coalesce(p_spent, 0),
              coalesce(p_gifted, 0), coalesce(p_sent, 0)) > v_allow then
    raise exception '기록 값이 허용 범위를 벗어났습니다.';
  end if;

  insert into public.user_records (user_id, email, branch, total_days, spent, gifted, sent, owned, updated_at)
  values (
    v_uid,
    auth.jwt() ->> 'email',
    p_branch,
    greatest(coalesce(p_total_days, 0), 0),
    greatest(coalesce(p_spent, 0), 0),
    greatest(coalesce(p_gifted, 0), 0),
    greatest(coalesce(p_sent, 0), 0),
    coalesce(p_owned, '{}'),
    now()
  )
  on conflict (user_id) do update set
    -- 소속 미선택 상태로 동기화가 와도 이미 고른 소속을 지우지 않는다
    branch     = coalesce(excluded.branch, user_records.branch),
    total_days = greatest(user_records.total_days, excluded.total_days),
    spent      = greatest(user_records.spent, excluded.spent),
    gifted     = greatest(user_records.gifted, excluded.gifted),
    sent       = greatest(user_records.sent, excluded.sent),
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
--
-- 집계하는 값은 total_days 가 아니라 total_days + gifted - sent 다. 선물은
-- 일수를 새로 만들지 않고 사람 사이에서 옮기기만 한다 — 받은 쪽이 늘면 보낸
-- 쪽이 그만큼 줄어야 총합이 보존되고, 자기 자신에게 보내면 정확히 0이 된다.
-- 저장은 세 값 모두 단조 증가라 greatest() 병합이 그대로 성립하고, 빼기는
-- 여기서만 한다. 기기 병합 도중 잠깐 어긋나도 음수로 새지 않게 0 에서 자른다.
create or replace function public.leaderboard()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'total_all', coalesce((select sum(greatest(total_days + gifted - sent, 0))
                             from public.user_records where branch is not null), 0),
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
        select branch, sum(greatest(total_days + gifted - sent, 0)) as s, count(*) as c
        from public.user_records
        where branch is not null
        group by branch
      ) t
    ), '{}'::json)
  );
$$;

-- 휴가 구매는 재구매할 수 있어 단순 owned 배열이나 종류별 max 값으로는 병합할 수
-- 없다. operation_id 하나가 비용과 휴가를 함께 보존하는 영수증 한 장이다.
create table if not exists public.leave_purchases (
  operation_id    uuid primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  product_id      text not null,
  catalog_version smallint not null,
  cost            bigint not null check (cost >= 0),
  leave_kind      text not null check (leave_kind in ('annual', 'reward', 'comfort')),
  leave_days      integer not null check (leave_days > 0),
  source          text not null check (source in ('purchase', 'legacy_migration')),
  created_at      timestamptz not null default now()
);

create index if not exists leave_purchases_user_created_idx
  on public.leave_purchases (user_id, created_at, operation_id);

alter table public.leave_purchases enable row level security;

drop policy if exists "leave_purchases_select_own" on public.leave_purchases;
create policy "leave_purchases_select_own"
  on public.leave_purchases
  for select to authenticated
  using (auth.uid() = user_id);

-- 본인 영수증만 커서 페이지로 읽는다. created_at 이 같은 행도 operation_id 로
-- 이어 읽으므로 offset 변화로 한 장을 건너뛰지 않는다.
create or replace function public.my_leave_purchases(
  p_after_created_at timestamptz default null,
  p_after_operation_id uuid default null,
  p_limit integer default 100
)
returns table (
  operation_id uuid,
  product_id text,
  catalog_version smallint,
  cost bigint,
  leave_kind text,
  leave_days integer,
  source text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception '인증이 필요합니다.'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception '페이지 크기는 1~100이어야 합니다.';
  end if;
  if (p_after_created_at is null) <> (p_after_operation_id is null) then
    raise exception '커서 시각과 operation ID를 함께 보내야 합니다.';
  end if;

  return query
    select p.operation_id, p.product_id, p.catalog_version, p.cost,
           p.leave_kind, p.leave_days, p.source, p.created_at
      from public.leave_purchases p
     where p.user_id = v_uid
       and (p_after_created_at is null
         or (p.created_at, p.operation_id) > (p_after_created_at, p_after_operation_id))
     order by p.created_at, p.operation_id
     limit p_limit;
end;
$$;

-- 클라이언트는 operation_id/product_id/catalog_version만 보낸다. 가격, 종류,
-- 일수는 이 함수 안의 가격표에서만 만들어서 변조한 숫자를 회계에 넣지 않는다.
create or replace function public.sync_leave_purchases(p_operations jsonb)
returns table (
  operation_id uuid,
  product_id text,
  catalog_version smallint,
  cost bigint,
  leave_kind text,
  leave_days integer,
  source text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_op uuid;
  v_product text;
  v_version integer;
  v_cost bigint;
  v_kind text;
  v_days integer;
  v_source text;
  v_existing public.leave_purchases%rowtype;
  v_legacy_op uuid;
begin
  if v_uid is null then raise exception '인증이 필요합니다.'; end if;
  if p_operations is null or jsonb_typeof(p_operations) <> 'array' then
    raise exception '휴가 operation 목록은 배열이어야 합니다.';
  end if;
  if jsonb_array_length(p_operations) > 100 then
    raise exception '한 번에 100건까지만 동기화할 수 있습니다.';
  end if;

  for v_item in select value from jsonb_array_elements(p_operations) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception '휴가 operation 형식이 올바르지 않습니다.'; end if;
    -- 숫자 값을 받지 않으므로 같은 operation ID에 다른 가격을 끼워 넣는 API가 없다.
    if v_item ? 'cost' or v_item ? 'leave_kind' or v_item ? 'leave_days' or v_item ? 'source' then
      raise exception '휴가 가격과 종류는 서버가 계산합니다.';
    end if;
    begin
      v_op := (v_item ->> 'operation_id')::uuid;
      v_product := v_item ->> 'product_id';
      v_version := (v_item ->> 'catalog_version')::integer;
    exception when others then
      raise exception '휴가 operation 값이 올바르지 않습니다.';
    end;
    if v_op is null or v_product is null or v_version is null then
      raise exception '휴가 operation 값이 올바르지 않습니다.';
    end if;

    if v_product = 'leave-annual' and v_version = 1 then
      v_cost := 1000; v_kind := 'annual'; v_days := 1; v_source := 'purchase';
    elsif v_product = 'leave-reward' and v_version = 1 then
      v_cost := 2800; v_kind := 'reward'; v_days := 3; v_source := 'purchase';
    elsif v_product = 'leave-comfort' and v_version = 1 then
      v_cost := 4500; v_kind := 'comfort'; v_days := 5; v_source := 'purchase';
    elsif v_product = 'legacy-long-leave' and v_version = 1 then
      -- JS legacyId()와 같은 결정 UUID. 다른 계정/다른 구아이템을 위조할 수 없다.
      v_legacy_op := overlay(overlay(v_uid::text placing '5' from 15 for 1) placing '8' from 20 for 1)::uuid;
      if v_op <> v_legacy_op then raise exception '구 위로휴가 operation ID가 올바르지 않습니다.'; end if;
      if not exists (select 1 from public.user_records
                     where user_id = v_uid and 'long-leave' = any(owned)) then
        raise exception '구 위로휴가 보유 기록이 없습니다.';
      end if;
      v_cost := 0; v_kind := 'comfort'; v_days := 7; v_source := 'legacy_migration';
    else
      raise exception '알 수 없는 휴가 상품 또는 가격표 버전입니다.';
    end if;

    select p.* into v_existing from public.leave_purchases p where p.operation_id = v_op;
    if found then
      if v_existing.user_id <> v_uid or v_existing.product_id <> v_product or
         v_existing.catalog_version <> v_version or v_existing.cost <> v_cost or
         v_existing.leave_kind <> v_kind or v_existing.leave_days <> v_days or v_existing.source <> v_source then
        raise exception '같은 operation ID의 내용 또는 소유자가 다릅니다.';
      end if;
    else
      begin
        insert into public.leave_purchases
          (operation_id, user_id, product_id, catalog_version, cost, leave_kind, leave_days, source)
        values (v_op, v_uid, v_product, v_version, v_cost, v_kind, v_days, v_source);
      exception when unique_violation then
        select p.* into v_existing from public.leave_purchases p where p.operation_id = v_op;
        if not found or v_existing.user_id <> v_uid or v_existing.product_id <> v_product or
           v_existing.catalog_version <> v_version or v_existing.cost <> v_cost or
           v_existing.leave_kind <> v_kind or v_existing.leave_days <> v_days or v_existing.source <> v_source then
          raise exception '같은 operation ID의 내용 또는 소유자가 다릅니다.';
        end if;
      end;
    end if;
  end loop;

  return query
    select p.operation_id, p.product_id, p.catalog_version, p.cost,
           p.leave_kind, p.leave_days, p.source, p.created_at
      from public.leave_purchases p
     where p.user_id = v_uid
       and p.operation_id in (select (value ->> 'operation_id')::uuid from jsonb_array_elements(p_operations))
     order by p.created_at, p.operation_id;
end;
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

revoke all on table public.leave_purchases from public, anon;
grant select on table public.leave_purchases to authenticated;
revoke insert, update, delete on table public.leave_purchases from authenticated;

-- Supabase 는 public 스키마 함수에 대해 anon·authenticated 에게 EXECUTE 를
-- 기본 부여한다. from public 만 회수하면 anon 권한이 남으므로 따로 적는다.
-- (본체의 auth.uid() 검사가 한 겹 더 막지만, 권한으로도 막아둔다.)
revoke all on function public.sync_my_record(text, bigint, bigint, text[], bigint, bigint) from public, anon;
revoke all on function public.leaderboard() from public;
revoke all on function public.sync_leave_purchases(jsonb) from public, anon;
revoke all on function public.my_leave_purchases(timestamptz, uuid, integer) from public, anon;

grant execute on function public.sync_my_record(text, bigint, bigint, text[], bigint, bigint) to authenticated;
grant execute on function public.leaderboard() to anon, authenticated;
grant execute on function public.sync_leave_purchases(jsonb) to authenticated;
grant execute on function public.my_leave_purchases(timestamptz, uuid, integer) to authenticated;
