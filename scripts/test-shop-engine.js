var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var ShopEngine = require('./shop-engine.js');
var data = JSON.parse(fs.readFileSync('items.json', 'utf8'));
function copyCatalog() { return JSON.parse(JSON.stringify(data)); }

test('catalog keeps 23 active cards and every original id', function () {
  var original = ['blanket-fold', 'rank-pvt', 'rank-pfc', 'rank-cpl', 'rank-sgt', 'rank-ssgt', 'rank-sfc', 'rank-msg', 'seniority', 'work-detail', 'snow-detail', 'mowing', 'full-march', 'choco-pie', 'genie-tv', 'frozen-pizza', 'matdasi', 'bacchus', 'leave-roll', 'long-leave', 'promotion-order', 'mnd-clock', 'early-discharge', 'discharge-cert', 'share-link', 'boot-buddy', 'visitation', 'overnight-pass'];
  assert.equal(ShopEngine.validateCatalog(data), true);
  assert.equal(data.items.length, 23);
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
test('new economy adds permanent effects and applies sharing last', function () {
  var s = ShopEngine.stats(data, ['exercise-pushup', 'exercise-dumbbell', 'food-choco', 'food-chicken', 'food-pizza', 'food-noodles', 'rank-pvt'], 0, false);
  assert.equal(s.manualDays, 4);
  assert.equal(s.crewDays, 4);
  assert.equal(s.speedPercent, 130);
  assert.equal(s.autos[0].intervalMs, 13333 / 1.3);
  s = ShopEngine.stats(data, ['exercise-pushup', 'food-choco', 'rank-pvt'], 0, true);
  assert.equal(s.manualDays, 6);
  assert.equal(s.crewDays, 6);
  assert.equal(s.autos[0].days, 6);
  s = ShopEngine.stats(data, ['exercise-pushup', 'exercise-dumbbell', 'exercise-bench', 'exercise-leg', 'food-choco', 'food-chicken', 'food-feast', 'rank-pvt'], 0, false);
  assert.equal(s.manualDays, 16);
  assert.equal(s.crewDays, 8);
});
test('legacy multipliers floor progress and leave legacy auto intervals untouched', function () {
  var s = ShopEngine.stats(data, ['matdasi', 'seniority', 'food-feast', 'rank-pvt', 'rank-sfc'], 2, false);
  assert.equal(s.legacyMultiplier, 6);
  assert.equal(s.manualDays, 6);
  assert.equal(s.crewDays, 6);
  assert.equal(s.autos.filter(function (a) { return a.id === 'rank-pvt'; })[0].days, 6);
  var old = s.autos.filter(function (a) { return a.id === 'rank-sfc'; })[0];
  assert.equal(old.intervalMs, 222);
  assert.equal(old.days, 6);
  assert.equal(old.legacy, true);
  assert.equal(ShopEngine.stats(data, ['seniority'], -1, false).legacyMultiplier, 1);
  [undefined, null, NaN, Infinity, -1].forEach(function (progress) {
    assert.equal(ShopEngine.stats(data, ['seniority'], progress, false).legacyMultiplier, 1);
  });
  assert.equal(ShopEngine.stats(data, ['seniority'], 4, false).legacyMultiplier, 6);
});
test('offline cap and boost expiry count a crossing tick exactly once', function () {
  var s = ShopEngine.stats(data, ['mnd-clock', 'rank-pvt'], 0, true);
  var T = 13333;
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
