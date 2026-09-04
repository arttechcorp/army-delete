-- board.sql 자체 점검 스크립트.
-- Supabase SQL Editor 에 붙여 넣고 실행합니다.
-- 통과하면 정상 완료되고, 실패 시 assert 에러가 발생합니다.
-- 마지막에 rollback 되므로 실제 운영 데이터에는 영향을 주지 않습니다.

begin;

do $$
declare
  test_uid uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  lb json;
  army_days bigint;
begin
  -- 1. 임의 테스트 데이터 삽입
  insert into public.user_records (user_id, email, branch, total_days, updated_at)
  values 
    (test_uid, 'test1@example.com', 'army', 1500, now()),
    ('00000000-0000-0000-0000-000000000002'::uuid, 'test2@example.com', 'army', 3500, now()),
    ('00000000-0000-0000-0000-000000000003'::uuid, 'test3@example.com', 'navy', 2000, now());

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

  -- 4. 누적 일수는 뒤로 가지 않는다 (sync_my_record 의 upsert 규칙)
  --    여러 기기를 쓰면 낮은 값이 뒤늦게 올라올 수 있다.
  insert into public.user_records (user_id, email, branch, total_days, updated_at)
  values (test_uid, 'test1@example.com', 'army', 10, now())
  on conflict (user_id) do update set
    branch = excluded.branch,
    total_days = greatest(user_records.total_days, excluded.total_days),
    updated_at = now();

  assert (select total_days from public.user_records where user_id = test_uid) = 1500,
    '낮은 값이 올라와도 누적 일수는 줄지 않아야 한다';

  -- 5. 테이블 직접 쓰기 권한이 없어야 한다.
  --    열려 있으면 PATCH 한 방으로 위 greatest() 가드가 우회된다.
  assert not has_table_privilege('authenticated', 'public.user_records', 'INSERT'),
    'authenticated 에게 INSERT 권한이 없어야 한다';
  assert not has_table_privilege('authenticated', 'public.user_records', 'UPDATE'),
    'authenticated 에게 UPDATE 권한이 없어야 한다';
  assert not has_table_privilege('authenticated', 'public.user_records', 'DELETE'),
    'authenticated 에게 DELETE 권한이 없어야 한다';
  assert has_table_privilege('authenticated', 'public.user_records', 'SELECT'),
    '본인 레코드 조회용 SELECT 는 남아 있어야 한다';

  -- 6. 쓰기 경로인 RPC 는 여전히 실행 가능해야 한다
  assert has_function_privilege('authenticated', 'public.sync_my_record(text, bigint)', 'EXECUTE'),
    'sync_my_record 는 authenticated 가 실행할 수 있어야 한다';
  assert has_function_privilege('anon', 'public.leaderboard()', 'EXECUTE'),
    'leaderboard 는 비로그인도 볼 수 있어야 한다';
end $$;

rollback;
