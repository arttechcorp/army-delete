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
end $$;

rollback;
