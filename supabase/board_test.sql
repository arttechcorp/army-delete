-- board.sql 자체 점검 스크립트.
-- Supabase SQL Editor 에 붙여 넣고 실행합니다.
-- 통과하면 정상 완료되고, 실패 시 assert 에러가 발생합니다.
-- 마지막에 rollback 되므로 실제 운영 데이터에는 영향을 주지 않습니다.
--
-- 주의 — user_records.user_id 는 auth.users(id) 를 참조한다. 아래 테스트
-- uuid 가 실제로 없는 프로젝트에서는 1번 삽입이 외래키 위반으로 막힌다.
-- 그럴 때는 세 uuid 를 auth.users 에 실재하는 값으로 바꿔서 실행하면 된다.
--   select id from auth.users limit 3;

begin;

do $$
declare
  test_uid  uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  other_uid uuid := '00000000-0000-0000-0000-000000000002'::uuid;
  navy_uid  uuid := '00000000-0000-0000-0000-000000000003'::uuid;
  lb json;
  army_days bigint;
  rec public.user_records%rowtype;
begin
  -- 1. 임의 테스트 데이터 삽입
  insert into public.user_records (user_id, email, branch, total_days, spent, owned, updated_at)
  values
    (test_uid,  'test1@example.com', 'army', 1500, 300, '{auto-1,boost}', now()),
    (other_uid, 'test2@example.com', 'army', 3500,   0, '{}',             now()),
    (navy_uid,  'test3@example.com', 'navy', 2000,   0, '{}',             now());

  -- 2. leaderboard() 함수 호출 및 결과 검증
  lb := public.leaderboard();

  assert (lb ->> 'total_all')::bigint >= 7000, '전체 총합은 7000 이상이어야 한다';
  assert (lb ->> 'total_users')::int >= 3, '전체 유저 수는 3 이상이어야 한다';

  army_days := (lb -> 'branches' -> 'army' ->> 'total_days')::bigint;
  assert army_days >= 5000, '육군 총합은 5000 이상이어야 한다';

  assert (lb -> 'branches' -> 'army' ->> 'user_count')::int >= 2, '육군 참여자 수는 2 이상이어야 한다';
  assert (lb -> 'branches' -> 'navy' ->> 'total_days')::bigint >= 2000, '해군 총합은 2000 이상이어야 한다';

  -- 3. 유효하지 않은 branch 체크 제약 검증
  begin
    insert into public.user_records (user_id, email, branch, total_days)
    values ('00000000-0000-0000-0000-000000000004'::uuid, 'test4@example.com', 'spaceforce', 100);
    assert false, '체크 제약 외의 branch 는 거부되어야 한다';
  exception when check_violation then
    null; -- 기대한 거부
  end;

  -- ── 여기부터는 진짜 sync_my_record() 를 호출한다.
  --    auth.uid() 는 request.jwt.claims 를 읽으므로 그 값을 트랜잭션 로컬로
  --    심어주면 RPC 본체를 그대로 검증할 수 있다 (규칙을 베껴 적지 않는다).
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', test_uid::text, 'email', 'test1@example.com')::text,
    true
  );

  -- 4. 세 값 모두 뒤로 가지 않고, 아이템은 합쳐진다.
  --    기기를 두 대 쓰면 낮은 값이 뒤늦게 올라올 수 있다.
  perform public.sync_my_record('army', 10, 5, '{share-link}');
  select * into rec from public.user_records where user_id = test_uid;

  assert rec.total_days = 1500, '낮은 값이 올라와도 누적 일수는 줄지 않아야 한다';
  assert rec.spent = 300,       '낮은 값이 올라와도 사용액은 줄지 않아야 한다';
  assert rec.owned @> '{auto-1,boost,share-link}'::text[],
    '아이템은 합집합으로 남아야 한다 — 다른 기기의 구매가 사라지면 안 된다';
  assert array_length(rec.owned, 1) = 3, '합집합에 중복이 쌓이면 안 된다';

  -- 5. 소속 미선택(null)으로 동기화해도 이미 고른 소속을 지우지 않는다
  perform public.sync_my_record(null, 1600, 300, '{}');
  select * into rec from public.user_records where user_id = test_uid;

  assert rec.branch = 'army', '소속 없이 동기화해도 기존 소속은 유지돼야 한다';
  assert rec.total_days = 1600, '높은 값은 반영돼야 한다';
  assert array_length(rec.owned, 1) = 3, '빈 배열이 와도 아이템이 지워지면 안 된다';

  -- 6. 소속을 고르지 않은 사람은 리더보드 집계에서 빠진다.
  --    null 을 group by 에 넣으면 json_object_agg 가 null 키로 에러를 낸다.
  update public.user_records set branch = null where user_id = navy_uid;
  lb := public.leaderboard();

  assert lb -> 'branches' -> 'navy' is null, '소속 없는 사람은 군별 집계에 없어야 한다';
  assert (lb ->> 'total_users')::int = 2, '소속 없는 사람은 참여자 수에서도 빠져야 한다';

  -- 7. 아이템 개수 상한 — 클라이언트가 보내는 배열이므로 서버가 자른다
  begin
    perform public.sync_my_record('army', 1600, 300,
      (select array_agg('i' || g) from generate_series(1, 201) g));
    assert false, '아이템 200개를 넘으면 거부되어야 한다';
  exception when raise_exception then
    null; -- 기대한 거부
  end;

  -- 8. 테이블 직접 쓰기 권한이 없어야 한다.
  --    열려 있으면 PATCH 한 방으로 위 greatest() 가드가 우회된다.
  assert not has_table_privilege('authenticated', 'public.user_records', 'INSERT'),
    'authenticated 에게 INSERT 권한이 없어야 한다';
  assert not has_table_privilege('authenticated', 'public.user_records', 'UPDATE'),
    'authenticated 에게 UPDATE 권한이 없어야 한다';
  assert not has_table_privilege('authenticated', 'public.user_records', 'DELETE'),
    'authenticated 에게 DELETE 권한이 없어야 한다';
  assert has_table_privilege('authenticated', 'public.user_records', 'SELECT'),
    '로그인 시 본인 레코드를 불러오는 SELECT 는 남아 있어야 한다';

  -- 9. 쓰기 경로인 RPC 는 여전히 실행 가능해야 한다
  assert has_function_privilege('authenticated',
      'public.sync_my_record(text, bigint, bigint, text[])', 'EXECUTE'),
    'sync_my_record 는 authenticated 가 실행할 수 있어야 한다';
  assert has_function_privilege('anon', 'public.leaderboard()', 'EXECUTE'),
    'leaderboard 는 비로그인도 볼 수 있어야 한다';

  -- 10. 아이템을 모르는 옛 2인자 함수가 남아 있으면 안 된다.
  --     남아 있으면 그 경로로 들어온 동기화가 owned 를 통째로 날린다.
  assert to_regprocedure('public.sync_my_record(text, bigint)') is null,
    '옛 2인자 sync_my_record 는 drop 되어야 한다';
end $$;

rollback;
