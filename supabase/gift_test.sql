-- gift.sql 자체 점검 스크립트.
-- Supabase SQL Editor 에 붙여 넣고 실행합니다.
-- 통과하면 정상 완료되고, 실패 시 assert 에러가 발생합니다.
-- 마지막에 rollback 되므로 실제 운영 데이터에는 영향을 주지 않습니다.
--
-- 주의 — gifts.sender_id 는 auth.users(id) 를 참조한다. 아래 uuid 가 없는
-- 프로젝트에서는 create_gift 가 외래키 위반으로 막힌다. 그럴 때는 실재하는
-- 값으로 바꿔서 실행하면 된다.
--   select id from auth.users limit 1;

begin;

do $$
declare
  sender_uid uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  tok  uuid;
  res  json;
  peek json;
begin
  -- auth.uid() 는 request.jwt.claims 를 읽는다. 트랜잭션 로컬로 심어주면
  -- RPC 본체를 그대로 검증할 수 있다 (규칙을 베껴 적지 않는다).
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', sender_uid::text, 'email', 'sender@example.com')::text,
    true
  );

  -- 1. 선물 생성
  tok := public.create_gift(50, '아프고 고된 시간 모두 지나가고 꿈 같은 빛이 다가오리');
  assert tok is not null, 'create_gift 는 토큰을 반환해야 한다';

  -- 2. 미리보기는 수령으로 치지 않는다 — 링크를 열자마자 보여주는 화면이므로
  --    이 시점에 일수가 나가면 안 된다.
  peek := public.peek_gift(tok);
  assert (peek ->> 'days')::int = 50, '미리보기가 일수를 그대로 보여줘야 한다';
  assert (peek ->> 'claimed')::boolean = false, '미리보기는 수령 상태를 바꾸지 않아야 한다';

  -- 3. 첫 수령은 성공한다
  res := public.claim_gift(tok);
  assert (res ->> 'ok')::boolean, '첫 수령은 성공해야 한다';
  assert (res ->> 'days')::int = 50, '보낸 일수가 그대로 와야 한다';

  -- 4. 두 번째 수령은 막힌다. 이게 이 기능의 성립 조건이다 —
  --    무한히 다시 열리면 받은 사람이 버튼만 눌러 일수를 찍어낸다.
  res := public.claim_gift(tok);
  assert not (res ->> 'ok')::boolean, '두 번째 수령은 실패해야 한다';
  assert res ->> 'reason' = 'claimed', '이미 수령된 선물로 구분돼야 한다';

  -- 5. 없는 토큰은 다른 이유로 구분된다 (문구를 다르게 띄우기 위해)
  res := public.claim_gift('00000000-0000-0000-0000-0000000000ff'::uuid);
  assert not (res ->> 'ok')::boolean, '없는 토큰은 실패해야 한다';
  assert res ->> 'reason' = 'missing', '없는 토큰으로 구분돼야 한다';

  -- 6. 0일 이하는 만들 수 없다
  begin
    perform public.create_gift(0, '');
    assert false, '0일 선물은 거부되어야 한다';
  exception when others then
    null; -- 기대한 거부
  end;

  -- 7. 메시지는 200자에서 잘린다 (거부가 아니라 절단 — 링크를 못 만드는 것보다 낫다)
  tok := public.create_gift(1, repeat('가', 500));
  assert char_length((public.peek_gift(tok) ->> 'message')) = 200,
    '메시지는 200자로 잘려야 한다';

  -- 8. 테이블 직접 접근이 없어야 한다.
  --    update 가 열려 있으면 PATCH 로 claimed_at 을 null 로 되돌려 무한 수령이 된다.
  assert not has_table_privilege('anon', 'public.gifts', 'SELECT'),
    'anon 에게 gifts 조회 권한이 없어야 한다';
  assert not has_table_privilege('authenticated', 'public.gifts', 'SELECT'),
    'authenticated 에게도 gifts 조회 권한이 없어야 한다';
  assert not has_table_privilege('authenticated', 'public.gifts', 'UPDATE'),
    'authenticated 에게 gifts 수정 권한이 없어야 한다';
  assert not has_table_privilege('authenticated', 'public.gifts', 'INSERT'),
    'authenticated 에게 gifts 삽입 권한이 없어야 한다';
  assert not has_table_privilege('authenticated', 'public.gifts', 'DELETE'),
    'authenticated 에게 gifts 삭제 권한이 없어야 한다';

  -- 9. 함수 실행 권한 — 발신은 로그인 필요, 수령은 비로그인도 가능
  assert has_function_privilege('authenticated', 'public.create_gift(int, text)', 'EXECUTE'),
    'create_gift 는 로그인한 사람이 부를 수 있어야 한다';
  assert not has_function_privilege('anon', 'public.create_gift(int, text)', 'EXECUTE'),
    'create_gift 를 비로그인이 부를 수 있으면 안 된다';
  assert has_function_privilege('anon', 'public.claim_gift(uuid)', 'EXECUTE'),
    'claim_gift 는 비로그인도 부를 수 있어야 한다 — 링크만 있으면 받는다';
  assert has_function_privilege('anon', 'public.peek_gift(uuid)', 'EXECUTE'),
    'peek_gift 는 비로그인도 부를 수 있어야 한다';
end $$;

rollback;
