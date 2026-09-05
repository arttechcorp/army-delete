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
      breakdownFilter: { breakdown: '$utm_source', breakdown_type: 'event' }
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
    })]
  ];

  for (const [name, query] of insights) {
    await ensure('insights', name, { query, dashboards: [dash.id] });
  }

  console.log(`\n대시보드: https://us.posthog.com/project/${PROJECT}/dashboard/${dash.id}`);
  console.log(`코호트: heavy=${heavy.id} casual=${casual.id} bouncer=${bouncer.id} leaderboard=${lb.id}`);
}
main().catch(e => { console.error('실패:', e.message); process.exit(1); });
