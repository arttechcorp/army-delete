// 상점 아이템 데이터와 offline(국방부 시계) 회계를 검증한다.
//
// 이 테스트는 index.html 원문에서 함수 소스를 그대로 뽑아 실행한다. 로직을 여기에
// 복붙해 재구현하면 index.html 이 바뀌어도 테스트는 계속 통과해 버려서, 검증하는
// 시늉만 하게 된다. 배포되는 코드 자체를 돌려야 의미가 있다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const data = JSON.parse(fs.readFileSync('items.json', 'utf8'));

/* ── index.html 에서 함수 소스를 뽑아 스텁을 물려 실행한다 ── */

function grab(name) {
  const m = html.match(new RegExp(`^  function ${name}\\b[\\s\\S]*?^  \\}`, 'm'));
  if (!m) throw new Error(`index.html 에서 ${name} 를 못 찾았다 — 리네임했으면 이 테스트도 고칠 것`);
  return m[0];
}

function makeHarness() {
  const code = [
    html.match(/^  function dayDiff.*$/m)[0],
    'parseISO', 'addMonths', 'midnightToday', 'splitMonths', 'calcService',
    'serviceProgress', 'ownedItems', 'boostLeft', 'shareItem',
    'multiplier', 'settleOffline'
  ].map((n, i) => (i === 0 ? n : grab(n))).join('\n');

  const store = {};
  const LS = { start: 'ad.start', end: 'ad.end', seenAt: 'ad.seenAt', boost: 'ad.boostUntil' };
  const startEl = { value: '' }, endEl = { value: '' };
  const state = { granted: 0 };

  const build = new Function('deps', [
    'var LS = deps.LS, startEl = deps.startEl, endEl = deps.endEl;',
    'var load = deps.load, store = deps.store;',
    'var addDays = deps.addDays, showToast = deps.showToast;',
    'var owned = [], items = [], catalog = null;',
    code,
    'return { multiplier: multiplier, settleOffline: settleOffline,',
    '  setState: function (list) { items = list; owned = list.map(function (i) { return i.id; }); } };'
  ].join('\n'));

  const api = build({
    LS, startEl, endEl,
    load: (k) => store[k] || '',
    store: (k, v) => { store[k] = String(v); },
    addDays: (n) => { state.granted += n; },
    showToast: () => {}
  });

  const DAY = 86400000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

  return {
    api, store, state, LS,
    dates(s, e) { startEl.value = s; endEl.value = e; },
    // 진행률 p 인 복무 기간을 만들어 배수를 구한다
    atProgress(p, totalDays = 600) {
      const s = Date.now() - Math.round(p * totalDays) * DAY;
      startEl.value = iso(s);
      endEl.value = iso(s + totalDays * DAY);
      return api.multiplier();
    },
    iso, DAY
  };
}

const SENIOR = { id: 'seniority', effect: { type: 'senior', value: 5 } };
const CLOCK = { id: 'mnd-clock', effect: { type: 'offline', capMs: 28800000 } };
const PVT = { id: 'rank-pvt', effect: { type: 'auto', intervalMs: 13333 } };
const TV = { id: 'genie-tv', effect: { type: 'multiplier', value: 4 } };
const HOUR = 3600000;

/* ── items.json ── */

test('items.json 의 카테고리는 상점 칩과 양방향으로 일치한다', () => {
  const chips = [...html.matchAll(/data-cat="([^"]+)"/g)]
    .map((m) => m[1]).filter((c) => c !== 'all');
  const counts = {};
  for (const it of data.items) counts[it.category] = (counts[it.category] || 0) + 1;

  // 칩에 아이템이 하나도 없으면 빈 칸이 뜨고, 칩 없는 카테고리의 아이템은
  // '전체' 말고는 어디에도 안 뜬다. 오타 한 글자면 바로 이 상태가 된다.
  for (const c of chips) assert.ok(counts[c] > 0, `아이템 0개인 칩: ${c}`);
  for (const c of Object.keys(counts)) assert.ok(chips.includes(c), `칩 없는 카테고리: ${c}`);
});

test('기존 아이템 id 는 보존된다 — 바뀌면 산 사람의 보유 기록이 끊긴다', () => {
  const ids = data.items.concat(data.legacyItems || []).map((i) => i.id);
  for (const id of ['long-leave', 'early-discharge', 'share-link', 'work-detail', 'genie-tv',
    'rank-pvt', 'rank-pfc', 'rank-cpl', 'rank-sgt', 'rank-ssgt', 'rank-sfc', 'rank-msg']) {
    assert.ok(ids.includes(id), `사라진 id: ${id}`);
  }
  assert.equal(new Set(ids).size, ids.length, 'id 중복');
});

test('모든 아이템이 필수 필드를 갖는다', () => {
  for (const it of data.items) {
    assert.ok(it.id && it.name && it.category, `필드 누락: ${it.id}`);
    assert.ok(Number.isInteger(it.price) && it.price >= 0, `가격 이상: ${it.id}`);
  }
});

/* ── 삭제된 옛 아이템 ── */

test('legacyItems 는 effect 를 하나도 갖지 않는다', () => {
  // 판매 종료한 아이템은 보유 기록만 남기고 게임에는 영향을 주지 않는다. 하나라도
  // 되살아나면 옛 유저 화면이 다시 '전체 병사 8 → 8일/회' 처럼 굳는다.
  for (const it of data.legacyItems || []) {
    assert.equal(it.effect, undefined, `판매 종료 아이템에 효과 잔존: ${it.id}`);
  }
  for (const it of data.items) {
    const t = it.effect && it.effect.type;
    assert.ok(!['multiplier', 'senior', 'crew_power'].includes(t), `폐기된 효과 타입: ${it.id}`);
  }
});

test('카탈로그를 못 받은 비상 경로도 옛 배수를 무시한다', () => {
  // items.json 에서 빼도 이 경로가 effect 를 직접 읽던 시절엔 배수가 되살아났다.
  const h = makeHarness();
  h.api.setState([SENIOR, TV]);
  assert.equal(h.atProgress(0.10), 1);
  assert.equal(h.atProgress(1.00), 1, '말년이어도 그대로');
  h.dates('', '');
  assert.equal(h.api.multiplier(), 1, '날짜 미입력');
});

/* ── offline (국방부 시계) ── */

function offline(list, seenAgoMs) {
  const h = makeHarness();
  h.dates('', '');                     // 짬 영향 배제 → 배수 ×1
  if (seenAgoMs !== null) h.store[h.LS.seenAt] = String(Date.now() - seenAgoMs);
  h.api.setState(list);
  h.api.settleOffline();
  return { days: h.state.granted, seenAt: h.store[h.LS.seenAt] };
}

test('offline: 지급 조건이 안 되면 한 일도 안 준다', () => {
  assert.equal(offline([PVT], 4 * HOUR).days, 0, '국방부 시계 미보유');
  assert.equal(offline([PVT, CLOCK], null).days, 0, '첫 방문 — 기준 시각이 없다');
  assert.equal(offline([CLOCK], 4 * HOUR).days, 0, '자동 대원이 없다');
});

test('offline: 기기 시계를 앞으로 돌려도 이득이 없다', () => {
  // 경과가 음수가 되는 경우. 막지 않으면 무한 획득 벡터가 된다.
  assert.equal(offline([PVT, CLOCK], -5 * HOUR).days, 0);
});

test('offline: 캡(8시간)이 1회 이득을 제한한다', () => {
  const four = offline([PVT, CLOCK], 4 * HOUR).days;
  const hundred = offline([PVT, CLOCK], 100 * HOUR).days;

  assert.equal(four, Math.floor(4 * HOUR / 13333));
  assert.equal(hundred, Math.floor(8 * HOUR / 13333), '100시간이어도 8시간치');
  assert.ok(hundred < four * 3, '캡이 실제로 이득을 자른다');
});

test('offline: 기준 시각은 지급 여부와 무관하게 갱신된다', () => {
  // 갱신하지 않으면 새로고침만으로 같은 구간을 반복 수급할 수 있다.
  for (const list of [[PVT, CLOCK], [PVT]]) {
    const { seenAt } = offline(list, 100 * HOUR);
    assert.ok(seenAt, 'seenAt 이 안 남았다');
    assert.ok(Date.now() - parseInt(seenAt, 10) < 5000, 'seenAt 이 현재로 안 갱신됐다');
  }
});
