/* 상점의 표시와 지급이 같은 계산을 쓰도록 화면 밖으로 분리한 순수 함수다. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ShopEngine = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var TYPES = { auto: 1, share: 1, manual_add: 1, crew_power: 1, crew_speed: 1,
    leave: 1, multiplier: 1, senior: 1, offline: 1, roll: 1 };
  var ACTIVE_CATEGORIES = { '생활관': 1, '체단실': 1, 'P.X': 1, '행정반': 1, '위병소': 1 };
  function positiveInteger(n) { return typeof n === 'number' && isFinite(n) && n > 0 && Math.floor(n) === n; }
  function clamp(n, low, high) { return Math.max(low, Math.min(high, n)); }
  function ownSet(owned) {
    var set = {};
    (owned || []).forEach(function (id) { if (typeof id === 'string') set[id] = true; });
    return set;
  }
  function validateItem(item, legacy) {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name ||
        typeof item.category !== 'string' || !item.category || typeof item.description !== 'string' ||
        !positiveInteger(item.price + 1)) throw new Error('invalid shop item');
    if (!ACTIVE_CATEGORIES[item.category] && !(legacy && item.category === '연병장')) throw new Error('invalid item category: ' + item.id);
    if (item.action && item.action !== 'gift') throw new Error('invalid item action: ' + item.id);
    if (!item.effect) return;
    var effect = item.effect;
    if (!TYPES[effect.type]) throw new Error('invalid effect type: ' + item.id);
    if (effect.type === 'auto' && !positiveInteger(effect.intervalMs)) throw new Error('invalid auto interval: ' + item.id);
    if ((effect.type === 'manual_add' || effect.type === 'crew_power' || effect.type === 'crew_speed' ||
         effect.type === 'multiplier' || effect.type === 'senior') && !positiveInteger(effect.value)) throw new Error('invalid effect value: ' + item.id);
    if (effect.type === 'share' && (!positiveInteger(effect.value) || !positiveInteger(effect.durationMs))) throw new Error('invalid share effect: ' + item.id);
    if (effect.type === 'leave' && (!/^(annual|reward|comfort)$/.test(effect.kind) || !positiveInteger(effect.days))) throw new Error('invalid leave effect: ' + item.id);
    if (effect.type === 'offline' && !positiveInteger(effect.capMs)) throw new Error('invalid offline cap: ' + item.id);
    if (effect.type === 'roll' && (!Array.isArray(effect.table) || !effect.table.length)) throw new Error('invalid roll effect: ' + item.id);
  }
  function validateCatalog(data) {
    if (!data || data.version !== 2 || !Array.isArray(data.items) || !Array.isArray(data.legacyItems) ||
        !data.items.length && !data.legacyItems.length) throw new Error('invalid shop catalog');
    var ids = {};
    data.items.forEach(function (item) {
      validateItem(item, false);
      if (ids[item.id]) throw new Error('duplicate item id: ' + item.id);
      ids[item.id] = true;
    });
    data.legacyItems.forEach(function (item) {
      validateItem(item, true);
      if (ids[item.id]) throw new Error('duplicate item id: ' + item.id);
      ids[item.id] = true;
    });
    return true;
  }
  function allItems(data) { validateCatalog(data); return data.items.concat(data.legacyItems); }
  function stats(data, owned, progress, boosted) {
    validateCatalog(data);
    var active = data.items, legacy = data.legacyItems, set = ownSet(owned), p = Number(progress);
    var manualAdd = 0, crewPower = 0, speedPercent = 100, legacyMultiplier = 1, shareMultiplier = 1;
    if (!isFinite(p)) p = 0;
    p = clamp(p, 0, 1);
    active.concat(legacy).forEach(function (item) {
      var effect = item.effect;
      if (!set[item.id] || !effect) return;
      if (effect.type === 'manual_add') manualAdd += effect.value;
      else if (effect.type === 'crew_power') crewPower += effect.value;
      else if (effect.type === 'crew_speed') speedPercent += effect.value;
      else if (effect.type === 'multiplier') legacyMultiplier = Math.max(legacyMultiplier, effect.value);
      else if (effect.type === 'senior') legacyMultiplier = Math.max(legacyMultiplier, Math.floor(1 + p * effect.value));
    });
    active.forEach(function (item) {
      if (item.effect && item.effect.type === 'share') shareMultiplier = boosted ? item.effect.value : 1;
    });
    var manualBase = Math.max(1 + manualAdd, legacyMultiplier);
    var crewBase = Math.max(1 + crewPower, legacyMultiplier);
    var autos = [];
    function addAutos(list, legacyAuto) {
      list.forEach(function (item) {
        var effect = item.effect;
        if (!set[item.id] || !effect || effect.type !== 'auto') return;
        var baseDays = legacyAuto ? legacyMultiplier : crewBase;
        autos.push({ id: item.id, name: item.name, intervalMs: legacyAuto ? effect.intervalMs : effect.intervalMs / (speedPercent / 100),
          days: baseDays * shareMultiplier, legacy: legacyAuto, baseDays: baseDays });
      });
    }
    addAutos(active, false);
    addAutos(legacy, true);
    var autoPerSecond = 0, offlineCapMs = 0;
    autos.forEach(function (auto) { autoPerSecond += auto.days * 1000 / auto.intervalMs; });
    legacy.forEach(function (item) {
      if (set[item.id] && item.effect && item.effect.type === 'offline') offlineCapMs = Math.max(offlineCapMs, item.effect.capMs);
    });
    return { manualDays: manualBase * shareMultiplier, crewDays: crewBase * shareMultiplier, speedPercent: speedPercent,
      autoPerSecond: autoPerSecond, autos: autos, legacyMultiplier: legacyMultiplier, shareMultiplier: shareMultiplier, offlineCapMs: offlineCapMs };
  }
  function offlineDays(snapshot, elapsedMs, boostRemainingMs) {
    if (!snapshot || !Array.isArray(snapshot.autos)) return 0;
    var cap = Number(snapshot.offlineCapMs), elapsed = Number(elapsedMs), remaining = Number(boostRemainingMs), total = 0;
    if (!(cap > 0) || !isFinite(cap)) return 0;
    if (!isFinite(elapsed)) elapsed = 0;
    if (!isFinite(remaining)) remaining = 0;
    elapsed = clamp(elapsed, 0, cap);
    remaining = clamp(remaining, 0, elapsed);
    snapshot.autos.forEach(function (auto) {
      var interval = Number(auto.intervalMs), base = Number(auto.baseDays), boosted = Number(auto.days);
      if (!(interval > 0) || !(base > 0) || !(boosted > 0) ||
          !isFinite(interval) || !isFinite(base) || !isFinite(boosted)) return;
      var ticks = Math.floor(elapsed / interval);
      var boostedTicks = Math.floor(remaining / interval);
      total += boostedTicks * boosted + (ticks - boostedTicks) * base;
    });
    return Math.floor(total);
  }
  return { validateCatalog: validateCatalog, allItems: allItems, stats: stats, offlineDays: offlineDays };
}));
