/* PostHog 코호트·대시보드 셋업 — 이름으로 중복 검사하므로 여러 번 돌려도 안전하다.
   실행: npm run posthog:setup  (키는 .env 의 POSTHOG_PERSONAL_KEY — 커밋 금지) */
const KEY = process.env.POSTHOG_PERSONAL_KEY;
const PROJECT = process.env.POSTHOG_PROJECT_ID || '595220';
const BASE = `https://us.posthog.com/api/projects/${PROJECT}`;
if (!KEY) { console.error('POSTHOG_PERSONAL_KEY 없음'); process.exit(1); }

async function api(path, method = 'GET', body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : null;
}

/* 이름이 같은 게 있으면 재사용한다 — 재실행 시 중복 생성 방지 */
async function ensure(kind, name, payload) {
  const list = await api(`/${kind}/?limit=200`);
  const hit = (list.results || []).find(x => x.name === name && !x.deleted);
  if (hit) { console.log(`  = ${kind} "${name}" 이미 있음 (id ${hit.id})`); return hit; }
  const made = await api(`/${kind}/`, 'POST', { name, ...payload });
  console.log(`  + ${kind} "${name}" 생성 (id ${made.id})`);
  return made;
}

/* insights 전용. ensure() 는 이름이 같으면 그대로 두고 넘어가서 쿼리를 못 고친다.
   재실행으로 기존 인사이트의 쿼리 정의를 갱신할 방법이 필요해 분리했다.
   extra 는 description 등 query 외의 필드를 얹을 선택 인자 (⑮ 의 K 정의 설명용). */
async function ensureInsight(name, query, dashId, extra) {
  const list = await api(`/insights/?limit=200`);
  const hit = (list.results || []).find(x => x.name === name && !x.deleted);
  if (!hit) {
    const made = await api('/insights/', 'POST', { name, query, dashboards: [dashId], ...extra });
    console.log(`  + insights "${name}" 생성 (id ${made.id})`);
    return made;
  }
  // 주의: PostHog 는 저장할 때 쿼리 객체에 기본값을 채워 정규화하므로 이 비교는
  // 정의를 안 바꿔도 거의 항상 다르게 나온다 — 즉 실행할 때마다 전부 PATCH 된다.
  // 스크립트가 정의의 단일 진실 원천이라 결과는 같지만, 두 가지를 알고 있어야 한다:
  // (1) "갱신" 로그가 매번 떠서 진짜 변경을 눈으로 못 가려낸다
  // (2) PostHog UI 에서 손으로 고친 인사이트는 다음 실행에 덮어쓰인다
  // 정확히 비교하려면 PostHog 의 정규화 규칙을 따라가야 해서 과설계다.
  if (JSON.stringify(hit.query) !== JSON.stringify(query)) {
    const updated = await api(`/insights/${hit.id}/`, 'PATCH', { query, ...extra });
    console.log(`  ~ insights "${name}" 갱신 (id ${hit.id})`);
    return updated;
  }
  console.log(`  = insights "${name}" 이미 있음 (id ${hit.id})`);
  return hit;
}

/* session_engagement 이벤트에 실린 total_days_deleted 로 판단한다.
   person property 를 쓰면 identify 가 도는 로그인 유저만 잡혀서 익명이 통째로 빠진다. */
function behavioral(filters) {
  return {
    filters: { properties: { type: 'OR', values: [{ type: 'AND', values: [{
      key: 'session_engagement', type: 'behavioral', value: 'performed_event',
      event_type: 'events', time_value: 90, time_interval: 'day', negation: false,
      event_filters: filters
    }] }] } }
  };
}
const prop = (key, operator, value) => ({ key, value, operator, type: 'event' });

async function main() {
  console.log(`project ${PROJECT}`);

  const heavy = await ensure('cohorts', '헤비 유저 (Heavy Deletors)',
    behavioral([prop('total_days_deleted', 'gte', '1000')]));
  const casual = await ensure('cohorts', '라이트 유저 (Casual Deletors)',
    behavioral([prop('total_days_deleted', 'gte', '10'), prop('total_days_deleted', 'lt', '1000')]));
  const bouncer = await ensure('cohorts', '이탈·찍먹 유저 (Bouncers)',
    behavioral([prop('total_days_deleted', 'lt', '10')]));
  const lb = await ensure('cohorts', '리더보드 등록 유저 (Leaderboard Active)', {
    filters: { properties: { type: 'OR', values: [{ type: 'AND', values: [
      { key: 'is_leaderboard_user', value: ['true'], operator: 'exact', type: 'person' }
    ] }] } }
  });
  const referred = await ensure('cohorts', '공유로 들어온 유저 (Referred Users)',
    behavioral([prop('first_source', 'exact', 'user_share')]));

  const dash = await ensure('dashboards', '군생활 삭제 — 코어 분석', {
    description: 'docs/superpowers/specs/2026-09-04-posthog-analytics-design.md §6.2'
  });

  const range = { date_from: '-30d' };
  const ev = (event, extra) => ({ kind: 'EventsNode', event, ...extra });
  const viz = source => ({ kind: 'InsightVizNode', source });

  const insights = [
    ['① 유입 채널별 방문 (UTM)', viz({
      kind: 'TrendsQuery', dateRange: range, interval: 'day',
      series: [ev('$pageview', { math: 'dau' })],
      breakdownFilter: { breakdown: '$utm_source', breakdown_type: 'event' }
    })],
    ['② 채널별 첫 클릭 전환', viz({
      kind: 'TrendsQuery', dateRange: range, interval: 'day',
      series: [ev('first_delete_click', { math: 'dau' })],
      // 원래 "② 게시판별 첫 클릭 전환"으로 개명하고 싶었지만, 이름을 바꾸면
      // ensureInsight 가 다른 이름으로 보고 새로 만들어버려 옛 인사이트("② 채널별
      // 첫 클릭 전환")가 대시보드에 그대로 남는다. 그래서 이름은 옛 이름 그대로
      // 두고 쿼리만 갱신한다 — ensureInsight 의 PATCH 경로가 처리한다.
      // $utm_source 는 PostHog 가 그 파라미터가 붙어 있던 $pageview 에만 붙이고
      // 클릭 이벤트에는 안 실려서 계속 빈 차트였다. register_once 로 모든 이벤트에
      // 실리는 root_source 로 바꾼다.
      breakdownFilter: { breakdown: 'root_source', breakdown_type: 'event' }
    })],
    ['③ 온보딩 퍼널', viz({
      kind: 'FunnelsQuery', dateRange: range,
      series: [ev('$pageview'), ev('first_delete_click'), ev('click_milestone_reached'), ev('shop_opened'), ev('item_purchased')],
      funnelsFilter: { funnelVizType: 'steps', funnelWindowInterval: 7, funnelWindowIntervalUnit: 'day' }
    })],
    ['④ 리텐션 — 리더보드 등록 유저', viz({
      kind: 'RetentionQuery', dateRange: range,
      properties: [{ key: 'id', value: lb.id, type: 'cohort' }],
      retentionFilter: {
        period: 'Day', totalIntervals: 30, retentionType: 'retention_first_time',
        targetEntity: { id: '$pageview', type: 'events' },
        returningEntity: { id: '$pageview', type: 'events' }
      }
    })],
    ['⑤ 리텐션 — 전체 유저 (비교군)', viz({
      kind: 'RetentionQuery', dateRange: range,
      retentionFilter: {
        period: 'Day', totalIntervals: 30, retentionType: 'retention_first_time',
        targetEntity: { id: '$pageview', type: 'events' },
        returningEntity: { id: '$pageview', type: 'events' }
      }
    })],
    ['⑥ 아이템별 판매량', viz({
      kind: 'TrendsQuery', dateRange: range, interval: 'week',
      series: [ev('item_purchased', { math: 'total' })],
      breakdownFilter: { breakdown: 'item_name', breakdown_type: 'event' }
    })],
    ['⑦ 보상형 광고 퍼널', viz({
      kind: 'FunnelsQuery', dateRange: range,
      series: [ev('shop_opened'), ev('reward_ad_clicked'), ev('reward_ad_completed')],
      funnelsFilter: { funnelVizType: 'steps', funnelWindowInterval: 1, funnelWindowIntervalUnit: 'hour' }
    })],
    ['⑧ 세션 인게이지먼트 (클릭수 평균)', viz({
      kind: 'TrendsQuery', dateRange: range, interval: 'day',
      series: [ev('session_engagement', { math: 'avg', math_property: 'session_clicks' })]
    })],
    ['⑨ 게시판별 신규 유입', viz({
      kind: 'TrendsQuery', dateRange: range, interval: 'day',
      series: [ev('$pageview', { math: 'dau' })],
      breakdownFilter: { breakdown: 'root_content', breakdown_type: 'event' },
      // generation 0 = 게시판에서 직접 들어온 사람만. 확산 계수의 분모라 공유로
      // 유입된 사람(1 이상)까지 섞으면 분모가 부풀어 K 가 실제보다 작게 나온다.
      properties: [prop('generation', 'exact', [0])]
    })],
    ['⑩ 게시판별 핵심 행동 퍼널', viz({
      kind: 'FunnelsQuery', dateRange: range,
      series: [ev('$pageview'), ev('first_delete_click'), ev('click_milestone_reached')],
      breakdownFilter: { breakdown: 'root_content', breakdown_type: 'event' },
      funnelsFilter: { funnelVizType: 'steps', funnelWindowInterval: 1, funnelWindowIntervalUnit: 'day' }
    })],
    ['⑪ 확산 세대 분포', viz({
      kind: 'TrendsQuery', dateRange: range, interval: 'week',
      series: [ev('$pageview', { math: 'dau' })],
      // 0 만 있고 1 이 없으면 확산이 전혀 안 일어난 것 — 공유 기능 자체를 점검해야 한다.
      breakdownFilter: { breakdown: 'generation', breakdown_type: 'event' }
    })],
    ['⑫ 공유 생성 vs 공유 유입', viz({
      kind: 'TrendsQuery', dateRange: range, interval: 'day',
      // 퍼널로 만들면 안 된다: 링크를 만드는 사람과 그 링크로 들어오는 사람은
      // 서로 다른 person 이라 PostHog 퍼널의 "동일 유저가 스텝을 순서대로 밟는다"는
      // 전제가 성립하지 않는다. 두 계열을 나란히 놓는 트렌드로 본다.
      series: [
        ev('share_link_created', { math: 'total' }),
        ev('referral_landed', { math: 'total' })
      ]
    })],
    ['⑬ 선물 발송 퍼널 (보내는 사람)', viz({
      kind: 'FunnelsQuery', dateRange: range,
      // gift_created 와 share_link_created 는 같은 사람(보내는 사람)이 순서대로
      // 밟는 스텝이라 퍼널이 성립한다 — ⑫와 달리 person 이 갈리지 않는다.
      series: [ev('gift_created'), ev('share_link_created', { properties: [prop('kind', 'exact', ['gift'])] })],
      funnelsFilter: { funnelVizType: 'steps', funnelWindowInterval: 1, funnelWindowIntervalUnit: 'hour' }
    })],
    ['⑭ 선물 수령 퍼널 (받는 사람)', viz({
      kind: 'FunnelsQuery', dateRange: range,
      series: [ev('gift_link_opened'), ev('gift_claimed')],
      funnelsFilter: { funnelVizType: 'steps', funnelWindowInterval: 1, funnelWindowIntervalUnit: 'day' }
    })],
    ['⑮ 게시판별 확산 계수 (기간 내 K)', {
      kind: 'DataTableNode',
      source: {
        kind: 'HogQLQuery',
        // k_direct 는 "각 유저 유입 시점부터 7일 창"을 재는 엄밀한 K₇ 이 아니라
        // 조회 기간(최근 30일) 전체를 뭉뚱그린 누적 비율이다. 그래서 이름에
        // K₇ 을 쓰지 않고 "(기간 내 K)"로 표기한다 — description 에도 명시.
        query: `
          SELECT
            properties.root_content AS root_content,
            count(DISTINCT if(toInt(properties.generation) = 0, person_id, NULL)) AS seeded,
            count(DISTINCT if(toInt(properties.generation) = 1, person_id, NULL)) AS direct,
            count(DISTINCT if(toInt(properties.generation) >= 2, person_id, NULL)) AS indirect,
            round(
              count(DISTINCT if(toInt(properties.generation) = 1, person_id, NULL))
              / nullif(count(DISTINCT if(toInt(properties.generation) = 0, person_id, NULL)), 0),
              3
            ) AS k_direct
          FROM events
          WHERE event = '$pageview'
            -- 속성이 없던 배포 이전 이벤트를 걸러낸다. HogQL 에서 null != 'direct' 는
            -- 참으로 평가돼 옛 이벤트가 전부 통과하고 이름 없는 쓰레기 행이 생긴다.
            AND isNotNull(properties.root_content)
            AND properties.root_content != ''
            AND properties.root_source != 'direct'
            AND timestamp >= now() - INTERVAL 30 DAY
          GROUP BY root_content
          ORDER BY seeded DESC
        `
      }
    }, {
      // 인사이트 description 에도 K₇ 아님을 명시 — 코드 주석과 이중으로 남긴다.
      description: '주의: 엄밀한 K₇(유저별 유입 후 7일 창)이 아니라 조회 기간(최근 30일) ' +
        '전체를 뭉뚱그린 누적 direct/seeded 비율이다. 세대별 유입 시점이 서로 다른데도 ' +
        '같은 기준일로 자른 값이라 K₇ 과 수치가 다를 수 있다.'
    }]
  ];

  for (const [name, query, extra] of insights) {
    await ensureInsight(name, query, dash.id, extra);
  }

  console.log(`\n대시보드: https://us.posthog.com/project/${PROJECT}/dashboard/${dash.id}`);
  console.log(`코호트: heavy=${heavy.id} casual=${casual.id} bouncer=${bouncer.id} leaderboard=${lb.id} referred=${referred.id}`);
}
main().catch(e => { console.error('실패:', e.message); process.exit(1); });
