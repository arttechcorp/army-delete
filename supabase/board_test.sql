-- board.sql 자체 점검 스크립트.
-- Supabase SQL Editor 에 붙여 넣고 실행합니다.
-- 통과하면 정상 완료되고, 실패 시 assert 에러가 발생합니다.
-- 마지막에 rollback 되므로 실제 운영 데이터에는 영향을 주지 않습니다.
--
-- user_records.user_id 는 auth.users(id) 를 참조하므로 아무 uuid 나 넣으면
-- 외래키에 막힌다. 그래서 실재하는 계정 셋을 골라 쓴다 (계정이 3개 이상
-- 필요하다). 그 계정들의 기존 기록은 트랜잭션 안에서 지웠다가 rollback 으로
-- 되돌리므로, 운영 데이터는 스크립트가 끝나면 손대기 전과 똑같다.

begin;

do $$
declare
  uids uuid[];
  test_uid  uuid;
  other_uid uuid;
  navy_uid  uuid;
  lb json;
  army_days bigint;
  base_users int;
  base_navy  bigint;
  rec public.user_records%rowtype;
begin
  -- 스키마가 뒤처져 있으면 한참 뒤에 42883 으로 죽는다. 먼저 확인하고 말해준다.
  if to_regprocedure('public.sync_my_record(text, bigint, bigint, text[], bigint, bigint)') is null then
    raise exception 'board.sql 을 먼저 (다시) 적용하세요 — 6인자 sync_my_record 가 없습니다.';
  end if;

  -- 0. 실재하는 계정 셋을 고른다. 외래키 때문에 임의 uuid 는 못 쓴다.
  select array_agg(id) into uids from (select id from auth.users limit 3) t;

  if coalesce(array_length(uids, 1), 0) < 3 then
    raise exception '이 스크립트는 auth.users 에 계정이 3개 이상 필요합니다 (현재 %개).',
      coalesce(array_length(uids, 1), 0);
  end if;

  test_uid := uids[1]; other_uid := uids[2]; navy_uid := uids[3];

  -- 고른 계정의 기존 기록은 비워두고 시작한다. rollback 으로 되돌아간다.
  delete from public.user_records where user_id = any(uids);

  -- 기준값은 지운 "뒤"에 잡는다. 이 스크립트는 운영 데이터가 들어 있는 테이블
  -- 위에서 돌기 때문에 "총 몇 명" 같은 절대값으로 검증하면 안 된다.
  lb := public.leaderboard();
  base_users := (lb ->> 'total_users')::int;
  base_navy  := coalesce((lb -> 'branches' -> 'navy' ->> 'total_days')::bigint, 0);

  -- 1. 테스트 데이터 삽입
  insert into public.user_records (user_id, email, branch, total_days, spent, owned, updated_at)
  values
    (test_uid,  'test1@example.com', 'army', 1500, 300, '{auto-1,boost}', now()),
    (other_uid, 'test2@example.com', 'army', 3500,   0, '{}',             now()),
    (navy_uid,  'test3@example.com', 'navy', 2000,   0, '{}',             now());

  -- 2. leaderboard() 함수 호출 및 결과 검증
  lb := public.leaderboard();

  assert (lb ->> 'total_all')::bigint >= 7000, '전체 총합은 7000 이상이어야 한다';
  assert (lb ->> 'total_users')::int = base_users + 3, '넣은 3명이 참여자 수에 잡혀야 한다';

  army_days := (lb -> 'branches' -> 'army' ->> 'total_days')::bigint;
  assert army_days >= 5000, '육군 총합은 5000 이상이어야 한다';

  assert (lb -> 'branches' -> 'army' ->> 'user_count')::int >= 2, '육군 참여자 수는 2 이상이어야 한다';
  assert (lb -> 'branches' -> 'navy' ->> 'total_days')::bigint >= 2000, '해군 총합은 2000 이상이어야 한다';

  -- 3. 유효하지 않은 branch 체크 제약 검증.
  --    없는 uuid 로 넣으면 외래키에 먼저 걸려 체크 제약을 검증하지 못한다.
  --    이미 있는 행을 갱신해서 제약만 건드린다.
  begin
    update public.user_records set branch = 'spaceforce' where user_id = test_uid;
    assert false, '체크 제약 외의 branch 는 거부되어야 한다';
  exception when check_violation then
    null; -- 기대한 거부
  end;

  -- ── 여기부터는 진짜 sync_my_record() 를 호출한다.
  --    auth.uid() 는 request.jwt.claims 를 읽으므로 그 값을 트랜잭션 로컬로
  --    심어주면 RPC 본체를 그대로 검증할 수 있다 (규칙을 베껴 적지 않는다).
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', test_uid::text, 'email', 'test1@example.com')::text,  -- auth.uid() 대역
    true
  );

  -- 4. 세 값 모두 뒤로 가지 않고, 아이템은 합쳐진다.
  --    기기를 두 대 쓰면 낮은 값이 뒤늦게 올라올 수 있다.
  perform public.sync_my_record('army', 10, 5, '{share-link}', 0, 0);
  select * into rec from public.user_records where user_id = test_uid;

  assert rec.total_days = 1500, '낮은 값이 올라와도 누적 일수는 줄지 않아야 한다';
  assert rec.spent = 300,       '낮은 값이 올라와도 사용액은 줄지 않아야 한다';
  assert rec.owned @> '{auto-1,boost,share-link}'::text[],
    '아이템은 합집합으로 남아야 한다 — 다른 기기의 구매가 사라지면 안 된다';
  assert array_length(rec.owned, 1) = 3, '합집합에 중복이 쌓이면 안 된다';

  -- 5. 소속 미선택(null)으로 동기화해도 이미 고른 소속을 지우지 않는다
  perform public.sync_my_record(null, 1600, 300, '{}', 0, 0);
  select * into rec from public.user_records where user_id = test_uid;

  assert rec.branch = 'army', '소속 없이 동기화해도 기존 소속은 유지돼야 한다';
  assert rec.total_days = 1600, '높은 값은 반영돼야 한다';
  assert array_length(rec.owned, 1) = 3, '빈 배열이 와도 아이템이 지워지면 안 된다';

  -- 6. 소속을 고르지 않은 사람은 리더보드 집계에서 빠진다.
  --    null 을 group by 에 넣으면 json_object_agg 가 null 키로 에러를 낸다.
  update public.user_records set branch = null where user_id = navy_uid;
  lb := public.leaderboard();

  assert coalesce((lb -> 'branches' -> 'navy' ->> 'total_days')::bigint, 0) = base_navy,
    '소속 없는 사람은 군별 집계에 없어야 한다';
  assert (lb ->> 'total_users')::int = base_users + 2,
    '소속 없는 사람은 참여자 수에서도 빠져야 한다';

  -- 7. 아이템 개수 상한 — 클라이언트가 보내는 배열이므로 서버가 자른다
  begin
    perform public.sync_my_record('army', 1600, 300,
      (select array_agg('i' || g) from generate_series(1, 201) g), 0, 0);
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
      'public.sync_my_record(text, bigint, bigint, text[], bigint, bigint)', 'EXECUTE'),
    'sync_my_record 는 authenticated 가 실행할 수 있어야 한다';
  assert has_function_privilege('anon', 'public.leaderboard()', 'EXECUTE'),
    'leaderboard 는 비로그인도 볼 수 있어야 한다';

  -- 10. 아이템을 모르는 옛 2인자 함수가 남아 있으면 안 된다.
  --     남아 있으면 그 경로로 들어온 동기화가 owned 를 통째로 날린다.
  assert to_regprocedure('public.sync_my_record(text, bigint)') is null,
    '옛 2인자 sync_my_record 는 drop 되어야 한다';

  -- 11. 실제 플레이로 불가능한 일수는 거부한다.
  --     greatest() 병합은 되돌릴 수 없어서 한 번 들어오면 영구히 남는다.
  begin
    perform public.sync_my_record('army', 9000000000000000000, 300, '{}', 0, 0);
    assert false, '허용 범위를 벗어난 일수는 거부되어야 한다';
  exception when raise_exception then
    null; -- 기대한 거부
  end;

  begin
    perform public.sync_my_record('army', 1600, 9000000000000000000, '{}', 0, 0);
    assert false, '허용 범위를 벗어난 사용액은 거부되어야 한다';
  exception when raise_exception then
    null; -- 기대한 거부
  end;

  select * into rec from public.user_records where user_id = test_uid;
  assert rec.total_days = 1600, '거부된 값이 반영되면 안 된다';
  assert rec.spent = 300,       '거부된 사용액이 반영되면 안 된다';

  -- 12. 정상 범위의 증가는 그대로 통과해야 한다 (가드가 게임을 막으면 안 된다)
  perform public.sync_my_record('army', 1600 + 500000, 300, '{}', 0, 0);
  select * into rec from public.user_records where user_id = test_uid;
  assert rec.total_days = 1600 + 500000, '정상 범위의 증가는 반영돼야 한다';

  -- 13. gifted 도 단조 증가로 병합된다 (일수·사용액과 같은 규칙)
  perform public.sync_my_record('army', 1600 + 500000, 300, '{}', 800, 0);
  select * into rec from public.user_records where user_id = test_uid;
  assert rec.gifted = 800, '받은 선물이 반영돼야 한다';

  perform public.sync_my_record('army', 1600 + 500000, 300, '{}', 10, 0);
  select * into rec from public.user_records where user_id = test_uid;
  assert rec.gifted = 800, '낮은 값이 올라와도 받은 선물은 줄지 않아야 한다';

  -- 14. 옛 판이 남아 있으면 default 가 있는 새 판과 호출이 모호해진다
  assert to_regprocedure('public.sync_my_record(text, bigint, bigint, text[])') is null,
    '옛 4인자 sync_my_record 는 drop 되어야 한다';
  assert to_regprocedure('public.sync_my_record(text, bigint, bigint, text[], bigint)') is null,
    '옛 5인자 sync_my_record 는 drop 되어야 한다';

  -- 15. 선물은 일수를 새로 만들지 않고 옮기기만 한다.
  --     리더보드가 집계하는 값은 total_days + gifted - sent 다.
  perform public.sync_my_record('army', 1600 + 500000, 300, '{}', 800, 0);
  lb := public.leaderboard();
  army_days := (lb -> 'branches' -> 'army' ->> 'total_days')::bigint;

  -- 받기만 하면 그만큼 오른다
  assert army_days = (select sum(total_days + gifted - sent)
                        from public.user_records where branch = 'army'),
    '군별 합계는 받은 선물을 더하고 보낸 선물을 빼야 한다';

  -- 자기 자신에게 보내고 그대로 받으면 정확히 상쇄된다.
  -- 상쇄되지 않으면 클릭 한 번 없이 순위를 무한히 올릴 수 있다.
  perform public.sync_my_record('army', 1600 + 500000, 300, '{}', 800, 800);
  lb := public.leaderboard();
  assert (lb -> 'branches' -> 'army' ->> 'total_days')::bigint = army_days - 800,
    '보낸 만큼 빠져야 한다 — 자기 선물이면 받은 800 과 정확히 상쇄된다';

  -- 준 것보다 많이 보내도 음수로 새지 않는다 (기기 병합이 어긋난 경우 대비)
  update public.user_records set total_days = 10, gifted = 0, sent = 9999
   where user_id = test_uid;
  lb := public.leaderboard();
  assert (lb -> 'branches' -> 'army' ->> 'total_days')::bigint >= 0,
    '군별 합계는 음수가 되지 않아야 한다';
end $$;

rollback;
