var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var ShopEngine = require('./shop-engine.js');
var data = JSON.parse(fs.readFileSync('items.json', 'utf8'));
function copyCatalog() { return JSON.parse(JSON.stringify(data)); }

test('catalog keeps 27 active cards and every original id', function () {
  var original = ['blanket-fold', 'rank-pvt', 'rank-pfc', 'rank-cpl', 'rank-sgt', 'rank-ssgt', 'rank-sfc', 'rank-msg', 'seniority', 'work-detail', 'snow-detail', 'mowing', 'full-march', 'choco-pie', 'genie-tv', 'frozen-pizza', 'matdasi', 'bacchus', 'leave-roll', 'long-leave', 'promotion-order', 'mnd-clock', 'early-discharge', 'discharge-cert', 'share-link', 'boot-buddy', 'visitation', 'overnight-pass'];
  assert.equal(ShopEngine.validateCatalog(data), true);
  assert.equal(data.items.length, 27);
  var ids = ShopEngine.allItems(data).map(function (item) { return item.id; });
  assert.equal(new Set(ids).size, ids.length);
  original.forEach(function (id) { assert.ok(ids.indexOf(id) >= 0, id); });
  assert.equal(data.items.filter(function (item) { return item.action === 'gift'; })[0].id, 'gift-days');
});
test('catalog rejects malformed cards before they can reach the shop', function () {
  var bad = copyCatalog();
  bad.items[0].category = '';
  assert.throws(function () { ShopEngine.validateCatalog(bad); }, /invalid (shop item|item category)/);
  bad = copyCatalog();
  bad.items[0].category = '알수없음';
  assert.throws(function () { ShopEngine.validateCatalog(bad); }, /invalid item category/);
  bad = copyCatalog();
  bad.items[0].effect.type = 'unknown';
  assert.throws(function () { ShopEngine.validateCatalog(bad); }, /invalid effect type/);
  bad = copyCatalog();
  bad.items[0].effect.intervalMs = 0;
  assert.throws(function () { ShopEngine.validateCatalog(bad); }, /invalid auto interval/);
  bad = copyCatalog();
  bad.items[0].price = 1.5;
  assert.throws(function () { ShopEngine.validateCatalog(bad); }, /invalid shop item/);
  bad = copyCatalog();
  bad.legacyItems[0].id = bad.items[0].id;
  assert.throws(function () { ShopEngine.validateCatalog(bad); }, /duplicate item id/);
  bad = copyCatalog();
  bad.items = [];
  bad.legacyItems = [];
  assert.throws(function () { ShopEngine.validateCatalog(bad); }, /invalid shop catalog/);
});
test('P.X 음식은 전체 병사 속도만 3~19% 씩 홀수로 올린다', function () {
  // 가격순 = 효과순이어야 한다. 어긋나면 싼 게 더 세지는 사다리가 된다.
  var px = data.items.filter(function (item) { return item.category === 'P.X'; });
  px.forEach(function (item) { assert.equal(item.effect.type, 'crew_speed', item.id); });
  assert.deepEqual(px.map(function (item) { return item.effect.value; }), [3, 5, 7, 9, 11, 13, 15, 17, 19]);
  var prices = px.map(function (item) { return item.price; });
  assert.deepEqual(prices.slice().sort(function (a, b) { return a - b; }), prices);
});
test('new economy adds permanent effects and applies sharing last', function () {
  var s = ShopEngine.stats(data, ['exercise-pushup', 'exercise-dumbbell', 'food-choco', 'food-chicken', 'food-pizza', 'food-noodles', 'rank-pvt'], 0, false);
  assert.equal(s.manualDays, 4);
  assert.equal(s.crewDays, 1);
  assert.equal(s.speedPercent, 124);
  assert.equal(s.autos[0].intervalMs, 13333 / 1.24);
  s = ShopEngine.stats(data, ['exercise-pushup', 'food-choco', 'rank-pvt'], 0, true);
  assert.equal(s.manualDays, 6);
  assert.equal(s.crewDays, 3);
  assert.equal(s.autos[0].days, 3);
  s = ShopEngine.stats(data, ['exercise-pushup', 'exercise-dumbbell', 'exercise-bench', 'exercise-leg', 'rank-pvt'], 0, false);
  assert.equal(s.manualDays, 16);
  assert.equal(s.speedPercent, 100);
});
test('판매 종료된 아이템은 게임 수치에 하나도 반영되지 않는다', function () {
  // 배수(박카스·짬)뿐 아니라 자동 병사·국방부 시계까지 전부다. 예전엔 배수가 Math.max 로
  // 이겨서 옛 유저는 상점에서 뭘 사도 '전체 병사 8 → 8일/회' 처럼 값이 그대로였다.
  var s = ShopEngine.stats(data, ['matdasi', 'seniority', 'bacchus', 'rank-sfc', 'mnd-clock', 'food-feast', 'rank-pvt'], 2, false);
  assert.equal(s.manualDays, 1);
  assert.equal(s.crewDays, 1);
  assert.equal(s.speedPercent, 111);
  assert.equal(s.offlineCapMs, 0, '국방부 시계');
  assert.equal(s.autos.length, 1, '옛 병사는 자동 클릭에 안 낀다');
  assert.equal(s.autos[0].id, 'rank-pvt');
  assert.equal(s.autos[0].intervalMs, 13333 / 1.11);
  // legacyItems 에는 아예 effect 가 없어야 한다 — 엔진이 안 읽더라도 데이터에서 먼저 막는다.
  data.legacyItems.forEach(function (item) { assert.equal(item.effect, undefined, item.id); });
  // 효과만 뺐지 보유 기록은 남는다 — 지우면 '기존 보유품' 표시가 사라진다.
  assert.ok(ShopEngine.allItems(data).some(function (item) { return item.id === 'bacchus'; }));
});
test('offline cap and boost expiry count a crossing tick exactly once', function () {
  // 지금은 offline 효과를 가진 판매 중 아이템이 없다. 다시 낼 때를 대비해 계산만 붙잡아 둔다.
  assert.equal(ShopEngine.stats(data, ['mnd-clock', 'rank-pvt'], 0, true).offlineCapMs, 0);
  var T = 13333;
  var s = { offlineCapMs: 28800000, autos: [{ id: 'rank-pvt', intervalMs: T, baseDays: 1, days: 3 }] };
  assert.equal(ShopEngine.offlineDays(s, 2 * T + 1, T + 1), 4);
  assert.equal(ShopEngine.offlineDays(s, 99 * 3600000, 0), Math.floor(28800000 / T));
  assert.equal(ShopEngine.offlineDays(s, -1, 0), 0);
  assert.equal(ShopEngine.offlineDays(ShopEngine.stats(data, ['rank-pvt'], 0, false), T, 0), 0);
});
test('offline settlement ignores malformed snapshots and always returns an integer', function () {
  var malformed = { offlineCapMs: 10000, autos: [
    { intervalMs: 0, baseDays: 1, days: 3 },
    { intervalMs: 'bad', baseDays: 1, days: 3 },
    { intervalMs: 1000, baseDays: NaN, days: 3 },
    { intervalMs: 1000, baseDays: 1, days: Infinity }
  ] };
  assert.equal(ShopEngine.offlineDays(malformed, 10000, 5000), 0);
  var fractional = { offlineCapMs: 1000.5, autos: [{ intervalMs: 100.5, baseDays: 1.5, days: 4.5 }] };
  var days = ShopEngine.offlineDays(fractional, 1000.5, 500.25);
  assert.ok(Number.isInteger(days));
  assert.ok(days >= 0);
});
