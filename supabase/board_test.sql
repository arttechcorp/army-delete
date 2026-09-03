-- board.sql 자체 점검. SQL Editor 에 붙여 넣고 실행한다.
-- 통과하면 조용히 끝나고, 깨지면 assert 메시지와 함께 에러가 난다.
-- 마지막에 rollback 하므로 실제 집계는 건드리지 않는다.
begin;

do $$
declare
  d    date   := (now() at time zone 'Asia/Seoul')::date;
  base bigint;
  cur  bigint;
begin
  select coalesce(n, 0) into base from public.board where branch = 'army' and day = d;
  base := coalesce(base, 0);

  perform public.tap('army', 5);
  perform public.tap('army', 3);
  select n into cur from public.board where branch = 'army' and day = d;
  assert cur - base = 8, '같은 날 두 번 호출하면 합산되어야 한다';

  perform public.tap('army', 99999);
  select n into cur from public.board where branch = 'army' and day = d;
  assert cur - base = 508, 'delta 는 상한 500 으로 잘려야 한다';

  perform public.tap('army', -7);
  select n into cur from public.board where branch = 'army' and day = d;
  assert cur - base = 509, 'delta 는 하한 1 로 올라가야 한다';

  begin
    perform public.tap('공군', 1);
    assert false, '화이트리스트 밖 branch 는 거부되어야 한다';
  exception when check_violation then
    null;   -- 기대한 거부
  end;

  assert (public.leaderboard() -> 'today' ->> 'army') is not null,
         'leaderboard() 의 today 에 army 가 있어야 한다';
end $$;

rollback;
