-- 일수 선물하기 스키마.
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여 넣고 실행하면 됩니다.
-- 여러 번 실행해도 안전합니다. board.sql 을 먼저 적용해야 합니다.
--
-- 서버가 보장하는 것은 단 하나 — "한 링크는 한 번만 열린다".
-- 발신자가 정말 그 일수를 가졌는지는 검증하지 않는다. 이 앱의 잔액은
-- localStorage 에만 있고 서버로 넘어오는 값은 전부 클라이언트가 주장하는
-- 값이라 검증할 방법이 없다. 선물에만 방어선을 세우는 건 의미가 없다.
-- 반면 일회성은 위조 방지가 아니라 기능의 성립 조건이다 — 링크를 무한히
-- 다시 열 수 있으면 받은 사람이 버튼만 눌러 일수를 찍어낸다.

create table if not exists public.gifts (
  token       uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references auth.users(id) on delete cascade,
  days        int  not null check (days > 0 and days <= 1000000),
  message     text not null default '' check (char_length(message) <= 200),
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz            -- null 이면 미수령. 일회성의 전부다.
);

create index if not exists gifts_sender_idx on public.gifts (sender_id, created_at desc);

alter table public.gifts enable row level security;

-- 정책은 두지 않는다. 테이블 직접 접근은 아래에서 전부 회수하고, 읽기·쓰기
-- 모두 security definer 함수로만 들어온다. RLS 를 켜 둔 채 정책이 없으면
-- 혹시 권한이 되살아나도 행이 한 줄도 새지 않는다.

-- 선물 만들기. 로그인한 사람만 부를 수 있다.
create or replace function public.create_gift(p_days int, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_token uuid;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if p_days is null or p_days <= 0 then
    raise exception '선물할 일수를 확인해 주세요.';
  end if;

  insert into public.gifts (sender_id, days, message)
  values (v_uid, p_days, left(coalesce(p_message, ''), 200))
  returning token into v_token;

  return v_token;
end;
$$;

-- 편지 미리보기. 수령하지 않고 내용만 본다 — 링크를 열자마자 보여줘야 하고,
-- 그 시점에 일수가 나가면 안 된다. 발신자를 알려주지 않는다.
create or replace function public.peek_gift(p_token uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'days', days,
    'message', message,
    'claimed', claimed_at is not null
  )
  from public.gifts
  where token = p_token;
$$;

-- 수령. 로그인을 요구하지 않는다 — 일회성은 "누가 받았나"가 아니라
-- "이 선물이 이미 열렸나"로 판정하면 되고, 링크를 받은 사람에게 로그인을
-- 요구하면 대부분 거기서 이탈한다.
create or replace function public.claim_gift(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int;
  v_msg  text;
begin
  -- 조회하고 나서 갱신하면 동시에 두 번 눌렸을 때 둘 다 통과한다.
  -- 조건부 갱신 한 방이어야 한 번만 열린다.
  update public.gifts
     set claimed_at = now()
   where token = p_token
     and claimed_at is null
  returning days, message into v_days, v_msg;

  if v_days is null then
    -- 이미 수령됐는지, 없는 토큰인지 구분해서 알려준다
    if exists (select 1 from public.gifts where token = p_token) then
      return json_build_object('ok', false, 'reason', 'claimed');
    end if;
    return json_build_object('ok', false, 'reason', 'missing');
  end if;

  return json_build_object('ok', true, 'days', v_days, 'message', v_msg);
end;
$$;

-- 권한 부여
-- 테이블 직접 접근은 아무에게도 주지 않는다. update 가 열려 있으면
-- PATCH /rest/v1/gifts 로 claimed_at 을 null 로 되돌려 무한 수령이 된다.
revoke all on table public.gifts from public, anon, authenticated;

-- Supabase 는 public 스키마 함수에 대해 anon·authenticated 에게 EXECUTE 를
-- 기본 부여한다 (alter default privileges). 그래서 from public 만 회수하면
-- anon 에게 남아 있는 명시적 권한이 그대로다 — anon 을 따로 적어야 한다.
revoke all on function public.create_gift(int, text) from public, anon;
revoke all on function public.peek_gift(uuid)        from public;
revoke all on function public.claim_gift(uuid)       from public;

grant execute on function public.create_gift(int, text) to authenticated;
grant execute on function public.peek_gift(uuid)        to anon, authenticated;
grant execute on function public.claim_gift(uuid)       to anon, authenticated;
