/*
 * Browserless smoke tests for the shop and its account-free path.
 *
 * The page is deliberately loaded as a fixture rather than as a normal JSDOM
 * document: this keeps Supabase, ad, and analytics script tags out of the
 * test, while still evaluating the real final application IIFE.
 */
'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var test = require('node:test');

var JSDOM;
var VirtualConsole;
var jsdomError = null;
['jsdom', process.env.SHOP_JSDOM_MODULE, '/private/tmp/shop-validation/node_modules/jsdom'].some(function (modulePath) {
  if (!modulePath) return false;
  try {
    var jsdom = require(modulePath);
    JSDOM = jsdom.JSDOM || jsdom;
    VirtualConsole = jsdom.VirtualConsole;
    return true;
  } catch (error) {
    jsdomError = error;
    return false;
  }
});

var ROOT = path.resolve(__dirname, '..');
var ACTIVE_IDS = [
  'rank-pvt', 'rank-pfc', 'rank-cpl', 'rank-squad', 'rank-sgt', 'rank-shorttimer'
];

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms || 0); });
}

async function waitFor(predicate, timeout) {
  var end = Date.now() + (timeout || 1500);
  var lastError;
  while (Date.now() < end) {
    try {
      if (predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await wait(5);
  }
  if (lastError) throw lastError;
  throw new Error('Timed out waiting for UI state');
}

function storageDump(storage) {
  var result = {};
  for (var i = 0; i < storage.length; i += 1) {
    var key = storage.key(i);
    result[key] = storage.getItem(key);
  }
  return result;
}

function inlineAppScript(html) {
  var scripts = [];
  var stripped = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, function (tag) {
    var body = tag.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>\s*$/i, '');
    if (body.trim()) scripts.push(body);
    return '';
  });
  var main = scripts[scripts.length - 1];
  if (!main || main.indexOf('window.__army') === -1) {
    throw new Error('fixture is missing the final application IIFE (window.__army)');
  }
  return { html: stripped, main: main };
}

function makeUser(number) {
  return { id: '00000000-0000-4000-8000-' + String(number).padStart(12, '0'), email: 'user' + number + '@example.com' };
}

function createSupabaseMock(config) {
  config = config || {};
  var current = config.user || null;
  var records = config.records || {};
  var listeners = [];
  var calls = [];
  var pending = [];
  var deferOwner = config.deferSyncOwner || '';
  var rpcHandler = config.rpc;
  var client = {
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: current ? { user: current, access_token: 'token-' + current.id } : null } }); },
      onAuthStateChange: function (listener) { listeners.push(listener); return { data: { subscription: { unsubscribe: function () {} } } }; },
      signInWithOAuth: function () { return Promise.resolve({}); },
      signOut: function () { current = null; return Promise.resolve({}); }
    },
    from: function () {
      var userId = '';
      return {
        select: function () { return this; },
        eq: function (key, value) { assert.equal(key, 'user_id'); userId = value; return this; },
        maybeSingle: function () { calls.push({ name: 'read', owner: userId }); return Promise.resolve({ data: records[userId] || null, error: null }); }
      };
    },
    rpc: function (name, args) {
      var owner = current && current.id;
      calls.push({ name: name, owner: owner, args: args });
      if (rpcHandler) {
        var handled = rpcHandler(name, args, owner);
        if (handled) return Promise.resolve(handled);
      }
      if (name === 'sync_my_record' && owner === deferOwner) {
        return new Promise(function (resolve) { pending.push({ owner: owner, resolve: resolve }); });
      }
      if (name === 'my_leave_purchases') return Promise.resolve({ data: [], error: null });
      if (name === 'sync_leave_purchases') return Promise.resolve({ data: [], error: null });
      if (name === 'leaderboard') return Promise.resolve({ data: { total_all: 0, total_users: 0, branches: {} }, error: null });
      return Promise.resolve({ data: null, error: null });
    }
  };
  return {
    client: client,
    calls: calls,
    emit: function (user) { current = user; listeners.slice().forEach(function (listener) { listener('TOKEN_REFRESHED', user ? { user: user, access_token: 'token-' + user.id } : null); }); },
    pendingSync: function (owner) { return pending.filter(function (entry) { return entry.owner === owner; }); },
    resolveSync: function (owner) { pending.filter(function (entry) { return entry.owner === owner; }).forEach(function (entry) { entry.resolve({ data: null, error: null }); }); pending = pending.filter(function (entry) { return entry.owner !== owner; }); }
  };
}

function installMocks(window, items, authMock) {
  var reduced = false;
  var clipboard = { fail: false, writes: [] };
  var fetchCalls = [];
  var media = {};

  window.matchMedia = function (query) {
    var isReduced = query.indexOf('prefers-reduced-motion') !== -1;
    var record = media[query] || {
      matches: isReduced ? reduced : false,
      listeners: []
    };
    record.matches = isReduced ? reduced : record.matches;
    record.addEventListener = function (name, listener) {
      if (name === 'change') record.listeners.push(listener);
    };
    record.removeEventListener = function (name, listener) {
      if (name !== 'change') return;
      record.listeners = record.listeners.filter(function (entry) { return entry !== listener; });
    };
    record.addListener = record.addEventListener;
    record.removeListener = record.removeEventListener;
    media[query] = record;
    return record;
  };
  window.__setReducedMedia = function (value) {
    reduced = Boolean(value);
    Object.keys(media).forEach(function (query) {
      if (query.indexOf('prefers-reduced-motion') === -1) return;
      media[query].matches = reduced;
      media[query].listeners.slice().forEach(function (listener) { listener({ matches: reduced }); });
    });
  };

  window.scrollTo = function () {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  if (window.HTMLMediaElement) {
    window.HTMLMediaElement.prototype.load = function () {};
    window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    window.HTMLMediaElement.prototype.pause = function () {};
  }
  window.fetch = function (url) {
    fetchCalls.push(String(url));
    if (String(url).indexOf('items.json') === -1) {
      return Promise.reject(new Error('unexpected network request: ' + url));
    }
    return Promise.resolve({
      ok: true,
      json: function () { return Promise.resolve(items); }
    });
  };

  var locks = {
    request: function (name, callback) {
      assert.equal(name, 'army-shop-spend-v2');
      return Promise.resolve().then(callback);
    }
  };
  Object.defineProperty(window.navigator, 'locks', { configurable: true, value: locks });
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: function (text) {
        clipboard.writes.push(text);
        return clipboard.fail ? Promise.reject(new Error('clipboard denied')) : Promise.resolve();
      }
    }
  });

  function AudioContextStub() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
  }
  AudioContextStub.prototype.resume = function () { return Promise.resolve(); };
  AudioContextStub.prototype.close = function () { return Promise.resolve(); };
  AudioContextStub.prototype.createOscillator = function () {
    return {
      frequency: { value: 0, setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} },
      connect: function () {}, disconnect: function () {}, start: function () {}, stop: function () {}
    };
  };
  AudioContextStub.prototype.createGain = function () {
    return {
      gain: { value: 1, setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} },
      connect: function () {}, disconnect: function () {}
    };
  };
  AudioContextStub.prototype.createBiquadFilter = function () {
    return {
      type: '',
      frequency: { value: 0, setValueAtTime: function () {} },
      Q: { value: 0, setValueAtTime: function () {} },
      connect: function () {}, disconnect: function () {}
    };
  };
  AudioContextStub.prototype.createBuffer = function (channels, length) {
    return { getChannelData: function () { return new Float32Array(length); } };
  };
  AudioContextStub.prototype.createBufferSource = function () {
    return {
      buffer: null,
      connect: function () {}, disconnect: function () {}, start: function () {}, stop: function () {}
    };
  };
  window.AudioContext = AudioContextStub;
  window.webkitAudioContext = AudioContextStub;
  if (authMock) window.supabase = { createClient: function () { return authMock.client; } };

  return { clipboard: clipboard, fetchCalls: fetchCalls, auth: authMock };
}

async function createApp(seed, authMock, url) {
  if (!JSDOM) throw new Error('JSDOM unavailable: ' + (jsdomError && jsdomError.message));
  var page = inlineAppScript(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  var items = JSON.parse(fs.readFileSync(path.join(ROOT, 'items.json'), 'utf8'));
  var virtualConsole = VirtualConsole ? new VirtualConsole() : undefined;
  if (virtualConsole) virtualConsole.on('jsdomError', function (error) {
    if (!/Not implemented: navigation/.test(error && error.message)) throw error;
  });
  var dom = new JSDOM(page.html, {
    url: url || 'http://army-delete.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: virtualConsole
  });
  var mocks = installMocks(dom.window, items, authMock);
  Object.keys(seed || {}).forEach(function (key) {
    dom.window.localStorage.setItem(key, String(seed[key]));
  });

  try {
    dom.window.eval(fs.readFileSync(path.join(ROOT, 'scripts/shop-engine.js'), 'utf8'));
    dom.window.eval(fs.readFileSync(path.join(ROOT, 'scripts/leave-ledger.js'), 'utf8'));
    dom.window.eval(fs.readFileSync(path.join(ROOT, 'scripts/crew-view.js'), 'utf8'));
    dom.window.eval(page.main);
    await waitFor(function () { return dom.window.__army && dom.window.ShopEngine && dom.window.LeaveLedger; });
  } catch (error) {
    dom.window.close();
    throw error;
  }
  return { dom: dom, window: dom.window, clipboard: mocks.clipboard, fetchCalls: mocks.fetchCalls, auth: mocks.auth };
}

async function openShop(app) {
  var document = app.window.document;
  document.getElementById('shopOpen').click();
  await waitFor(function () { return document.querySelectorAll('#shopBody .item').length === 23; });
}

async function buy(app, id) {
  var button = app.window.document.querySelector('#shopBody [data-id="' + id + '"]');
  assert.ok(button, 'missing shop button: ' + id);
  assert.equal(button.disabled, false, 'shop button unexpectedly disabled: ' + id);
  button.click();
  await wait(25);
}

function closeApp(app) {
  if (app && app.window) app.window.close();
}

if (!JSDOM) {
  test('shop UI JSDOM prerequisite', function () {
    assert.fail('JSDOM is required: install it with `npm install --prefix /private/tmp/shop-validation jsdom` or set SHOP_JSDOM_MODULE to its absolute module path. ' + (jsdomError && jsdomError.message));
  });
} else {
  test('loads the real app fixture and renders all 23 active shop cards', async function () {
    var app = await createApp({ 'ad.total': '10000' });
    try {
      await openShop(app);
      assert.equal(app.window.document.querySelectorAll('#shopBody .item').length, 23);
      assert.ok(app.fetchCalls.some(function (url) { return url.indexOf('items.json') !== -1; }));
      assert.ok(app.fetchCalls.every(function (url) { return url.indexOf('supabase') === -1; }));
      assert.equal(typeof app.window.__army.selfCheck, 'function');
    } finally { closeApp(app); }
  });

  test('purchases exercise, food, and auto crew effects through UI clicks', async function () {
    var app = await createApp({ 'ad.total': '10000' });
    try {
      await openShop(app);
      await buy(app, 'exercise-pushup');
      assert.match(app.window.document.getElementById('manualStat').textContent, /2일\/회/);
      await buy(app, 'food-choco');
      await buy(app, 'rank-pvt');
      assert.equal(app.window.document.querySelectorAll('#crew .crew-view__unit').length, 1);
      assert.equal(app.window.document.querySelector('#crew [data-id="rank-pvt"] .crew-view__details').textContent.includes('일\/회'), true);
      assert.match(app.window.document.getElementById('autoStat').textContent, /병사 자동/);
    } finally { closeApp(app); }
  });

  test('records repeated leave purchases and restores receipt totals after reload', async function () {
    var app = await createApp({ 'ad.total': '10000' });
    var saved;
    try {
      await openShop(app);
      await buy(app, 'leave-annual');
      await buy(app, 'leave-annual');
      assert.equal(app.window.document.getElementById('leaveTotal').textContent, '2');
      assert.equal(app.window.document.getElementById('balanceNum').textContent, '8,000');
      assert.equal(app.window.document.getElementById('totalNum').textContent, '10,000');
      saved = storageDump(app.window.localStorage);
    } finally { closeApp(app); }

    var reloaded = await createApp(saved);
    try {
      await openShop(reloaded);
      assert.equal(reloaded.window.document.getElementById('leaveTotal').textContent, '2');
      assert.equal(reloaded.window.document.getElementById('balanceNum').textContent, '8,000');
      assert.equal(reloaded.window.document.querySelectorAll('[data-id="leave-annual"]').length, 1);
    } finally { closeApp(reloaded); }
  });

  test('gift card closes the shop, shows the guest gate, and returns to the gate category', async function () {
    var app = await createApp({ 'ad.total': '10000' });
    try {
      await openShop(app);
      await buy(app, 'gift-days');
      var document = app.window.document;
      assert.equal(document.getElementById('shopScrim').classList.contains('on'), false);
      assert.equal(document.getElementById('giftScrim').classList.contains('on'), true);
      assert.equal(document.getElementById('giftGate').classList.contains('on'), true);
      assert.equal(document.getElementById('giftLogin').hidden, true);
      document.getElementById('giftClose').click();
      await waitFor(function () {
        return document.getElementById('shopScrim').classList.contains('on') &&
          document.querySelector('#shopChips [data-cat="위병소"]').classList.contains('active');
      });
    } finally { closeApp(app); }
  });

  test('does not grant a share boost when clipboard fails, then grants after success', async function () {
    var app = await createApp({ 'ad.total': '10000' });
    try {
      await openShop(app);
      Object.defineProperty(app.window.navigator, 'share', { configurable: true, value: function () { return Promise.reject({ name: 'AbortError' }); } });
      await buy(app, 'share-link');
      await wait(20);
      assert.equal(app.window.localStorage.getItem('ad.boostUntil'), null);
      assert.equal(app.clipboard.writes.length, 0);
      delete app.window.navigator.share;
      app.clipboard.fail = true;
      await buy(app, 'share-link');
      await wait(20);
      assert.equal(app.window.localStorage.getItem('ad.boostUntil'), null);
      app.clipboard.fail = false;
      await buy(app, 'share-link');
      await waitFor(function () { return Number(app.window.localStorage.getItem('ad.boostUntil')) > Date.now(); });
      assert.ok(app.clipboard.writes.length >= 2);
    } finally { closeApp(app); }
  });

  test('renders the six active crew ids and responds to reduced-motion toggle', async function () {
    var owned = JSON.stringify(ACTIVE_IDS);
    var app = await createApp({ 'ad.total': '50000', 'ad.owned': owned, 'ad.reducedMotion': '1' });
    try {
      await waitFor(function () { return app.window.document.querySelectorAll('#crew .crew-view__unit').length === 6; });
      var units = Array.prototype.map.call(app.window.document.querySelectorAll('#crew .crew-view__unit'), function (unit) {
        return unit.getAttribute('data-id');
      });
      assert.deepEqual(units, ACTIVE_IDS);
      var motion = app.window.document.getElementById('motionBtn');
      assert.equal(motion.getAttribute('aria-pressed'), 'true');
      assert.equal(app.window.document.querySelector('#crew .crew-view__layer').classList.contains('is-reduced'), true);
      app.window.__setReducedMedia(false);
      assert.equal(motion.getAttribute('aria-pressed'), 'true');
      app.window.document.querySelector('#crew [data-id="rank-pvt"]').click();
      assert.match(app.window.document.querySelector('#crew [data-id="rank-pvt"] .crew-view__details').textContent, /초마다|일\/회/);
    } finally { closeApp(app); }
  });

  test('CrewView reaches the resized button perimeter using the rendered avatar geometry', async function () {
    var app = await createApp({});
    try {
      var document = app.window.document;
      var stage = document.createElement('div');
      var container = document.createElement('div');
      var button = document.createElement('button');
      stage.appendChild(container);
      stage.appendChild(button);
      document.body.appendChild(stage);
      var view = app.window.CrewView.create({ container: container, button: button, stage: stage });
      view.render([{ id: 'rank-pvt', name: '기하 이병', intervalMs: 1000, days: 1 }]);

      var unit = container.querySelector('.crew-view__unit');
      var svg = unit.querySelector('svg.cv-avatar');
      function rect(left, top, width, height) {
        return { left: left, top: top, width: width, height: height, right: left + width, bottom: top + height };
      }
      button.getBoundingClientRect = function () { return rect(50, 200, 100, 100); };
      unit.getBoundingClientRect = function () { return rect(360, 80, 100, 100); };
      svg.getBoundingClientRect = function () { return rect(340, 50, 140, 151.2); };

      app.window.dispatchEvent(new app.window.Event('resize'));
      await waitFor(function () {
        return Number(unit.querySelector('.cv-contact-hand').getAttribute('cx')) < 0;
      });

      var hand = unit.querySelector('.cv-contact-hand');
      var cx = Number(hand.getAttribute('cx'));
      var cy = Number(hand.getAttribute('cy'));
      var contactX = 340 + cx / 100 * 140;
      var contactY = 50 + cy / 108 * 151.2;
      var dx = 410 - 100;
      var dy = 130 - 250;
      var distance = Math.sqrt(dx * dx + dy * dy);
      assert.notEqual(cx, 50);
      assert.notEqual(cy, 100);
      assert.ok(Math.abs(Math.hypot(contactX - 100, contactY - 250) - 52) < 0.02);
      assert.ok((contactX - 100) * dx + (contactY - 250) * dy > 0);

      view.tick('rank-pvt', 1);
      assert.equal(unit.classList.contains('is-ticking'), true);
      view.destroy();
      await wait(25);
    } finally { closeApp(app); }
  });

  test('corrupt leave receipts block leave purchases and show the stop message', async function () {
    var app = await createApp({ 'ad.total': '10000', 'ad.leave.receipt.corrupt': '{bad' });
    try {
      await openShop(app);
      var document = app.window.document;
      var leaveButton = document.querySelector('[data-id="leave-annual"]');
      assert.ok(leaveButton);
      assert.equal(leaveButton.disabled, true);
      assert.match(document.getElementById('shopNotice').textContent, /휴가|기록|구매/);
    } finally { closeApp(app); }
  });

  test('hydrates an authenticated account before its first purchase sync', async function () {
    var user = makeUser(11);
    var auth = createSupabaseMock({ user: user, records: {} });
    auth.client.from = function () {
      var userId = '';
      return {
        select: function () { return this; },
        eq: function (key, value) { assert.equal(key, 'user_id'); userId = value; return this; },
        maybeSingle: function () {
          auth.calls.push({ name: 'read', owner: userId });
          return Promise.resolve({ data: { total_days: 900, spent: 100, gifted: 0, sent: 0, owned: [], branch: 'army' }, error: null });
        }
      };
    };
    var app = await createApp({ 'ad.total': '100', 'ad.spent': '10' }, auth);
    try {
      await waitFor(function () { return app.window.localStorage.getItem('ad.acct') === user.id && auth.calls.some(function (call) { return call.name === 'sync_my_record'; }); });
      assert.equal(app.window.localStorage.getItem('ad.total'), '1000');
      assert.equal(app.window.localStorage.getItem('ad.spent'), '110');
      assert.equal(app.window.localStorage.getItem('ad.branch'), 'army');
      assert.deepEqual(auth.calls.slice(0, 2).map(function (call) { return call.name; }), ['read', 'sync_my_record']);
      await openShop(app);
      await buy(app, 'exercise-pushup');
      await waitFor(function () { return auth.calls.filter(function (call) { return call.name === 'sync_my_record'; }).length === 2; });
      var purchaseSync = auth.calls.filter(function (call) { return call.name === 'sync_my_record'; })[1];
      assert.equal(purchaseSync.args.p_total_days, 1000);
      assert.equal(purchaseSync.args.p_spent, 260);
    } finally { closeApp(app); }
  });

  test('switching A to B keeps branch and wallet snapshots isolated', async function () {
    var userA = makeUser(21), userB = makeUser(22);
    var auth = createSupabaseMock({ user: userA, records: {} });
    auth.client.from = function () {
      var userId = '';
      return {
        select: function () { return this; },
        eq: function (key, value) { userId = value; return this; },
        maybeSingle: function () {
          var rows = {};
          rows[userA.id] = { total_days: 100, spent: 0, gifted: 0, sent: 0, owned: [], branch: 'army' };
          rows[userB.id] = { total_days: 300, spent: 0, gifted: 0, sent: 0, owned: [], branch: 'navy' };
          auth.calls.push({ name: 'read', owner: userId });
          return Promise.resolve({ data: rows[userId], error: null });
        }
      };
    };
    var app = await createApp({ 'ad.total': '50' }, auth);
    try {
      await waitFor(function () { return app.window.localStorage.getItem('ad.acct') === userA.id; });
      auth.emit(userB);
      await waitFor(function () { return app.window.localStorage.getItem('ad.acct') === userB.id; });
      var savedA = JSON.parse(app.window.localStorage.getItem('ad.wallet.' + userA.id));
      assert.equal(savedA.total, 150);
      assert.equal(savedA.branch, 'army');
      assert.equal(app.window.localStorage.getItem('ad.total'), '300');
      assert.equal(app.window.localStorage.getItem('ad.branch'), 'navy');
      assert.equal(app.window.localStorage.getItem('ad.walletOwner'), userB.id);
    } finally { closeApp(app); }
  });

  test('a changed cross-tab wallet owner blocks writes from the stale tab', async function () {
    var userA = makeUser(31), userB = makeUser(32);
    var auth = createSupabaseMock({ user: userA, records: {} });
    auth.client.from = function () {
      return { select: function () { return this; }, eq: function () { return this; }, maybeSingle: function () { return Promise.resolve({ data: { total_days: 10, spent: 0, gifted: 0, sent: 0, owned: [], branch: null }, error: null }); } };
    };
    var app = await createApp({}, auth);
    try {
      await waitFor(function () { return app.window.localStorage.getItem('ad.acct') === userA.id; });
      var before = app.window.localStorage.getItem('ad.total');
      var beforeSyncs = auth.calls.filter(function (call) { return call.name === 'sync_my_record'; }).length;
      app.window.localStorage.setItem('ad.walletOwner', userB.id);
      app.window.document.getElementById('deleteBtn').click();
      await wait(20);
      assert.equal(app.window.localStorage.getItem('ad.total'), before);
      assert.equal(auth.calls.filter(function (call) { return call.name === 'sync_my_record'; }).length, beforeSyncs);
    } finally { closeApp(app); }
  });

  test('a resolved stale A sync cannot make B look synchronized', async function () {
    var userA = makeUser(41), userB = makeUser(42);
    var rows = {};
    rows[userA.id] = { total_days: 10, spent: 0, gifted: 0, sent: 0, owned: [], branch: null };
    rows[userB.id] = { total_days: 10, spent: 0, gifted: 0, sent: 0, owned: [], branch: null };
    var auth = createSupabaseMock({ user: userA, records: rows, deferSyncOwner: userA.id });
    var app = await createApp({}, auth);
    try {
      await waitFor(function () { return app.window.localStorage.getItem('ad.walletOwner') === userA.id && auth.pendingSync(userA.id).length === 1; });
      auth.emit(userB);
      await waitFor(function () { return app.window.localStorage.getItem('ad.acct') === userB.id; });
      auth.resolveSync(userA.id);
      await wait(20);
      app.window.document.getElementById('lbOpen').click();
      await waitFor(function () { return auth.calls.some(function (call) { return call.name === 'sync_my_record' && call.owner === userB.id; }); });
      await wait(20);
      app.window.document.getElementById('lbClose').click();
    } finally { closeApp(app); }
  });

  test('gift validation includes leave cost and a failed send never charges the sender', async function () {
    var user = makeUser(51);
    var receiptId = '00000000-0000-4000-8000-000000000151';
    var receipt = { operation_id: receiptId, product_id: 'leave-annual', catalog_version: 1,
      account_id: user.id, guest_id: null, source: 'purchase', created_at: '2026-09-07T00:00:00.000Z' };
    var auth = createSupabaseMock({ user: user, records: {} });
    auth.client.from = function () {
      return { select: function () { return this; }, eq: function () { return this; }, maybeSingle: function () {
        return Promise.resolve({ data: { total_days: 1100, spent: 0, gifted: 0, sent: 0, owned: [], branch: null }, error: null });
      } };
    };
    var seed = {};
    seed['ad.leave.receipt.' + receiptId] = JSON.stringify(receipt);
    seed['ad.leave.synced.' + receiptId] = '1';
    var app = await createApp(seed, auth);
    try {
      await waitFor(function () { return app.window.localStorage.getItem('ad.acct') === user.id && app.window.document.getElementById('balanceNum').textContent === '100'; });
      await openShop(app);
      await buy(app, 'gift-days');
      var document = app.window.document;
      assert.equal(document.getElementById('giftStep1').classList.contains('on'), true);
      document.getElementById('giftDays').value = '-50';
      document.getElementById('giftNext').click();
      assert.match(document.getElementById('giftErr').textContent, /1~1,000,000|정수/);
      document.getElementById('giftDays').value = '101';
      document.getElementById('giftNext').click();
      assert.match(document.getElementById('giftErr').textContent, /보유한 일수\(100일\)/);
      document.getElementById('giftDays').value = '100';
      document.getElementById('giftNext').click();
      assert.equal(document.getElementById('giftStep2').classList.contains('on'), true);
      document.getElementById('giftSend').click();
      await waitFor(function () { return auth.calls.some(function (call) { return call.name === 'create_gift'; }); });
      assert.match(document.getElementById('giftErr2').textContent, /만들지 못했습니다/);
      assert.equal(Number(app.window.localStorage.getItem('ad.spent') || 0), 0);
      assert.equal(Number(app.window.localStorage.getItem('ad.gsent') || 0), 0);
      assert.equal(auth.calls.filter(function (call) { return call.name === 'create_gift'; }).length, 1);
    } finally { closeApp(app); }
  });

  test('a successful gift charges once and preserves its link until the user starts another gift', async function () {
    var user = makeUser(61), token = '00000000-0000-4000-8000-000000000261';
    var auth = createSupabaseMock({ user: user, records: {}, rpc: function (name) {
      if (name === 'create_gift') return { data: token, error: null };
    } });
    auth.client.from = function () {
      return { select: function () { return this; }, eq: function () { return this; }, maybeSingle: function () {
        return Promise.resolve({ data: { total_days: 500, spent: 0, gifted: 0, sent: 0, owned: [], branch: null }, error: null });
      } };
    };
    var app = await createApp({}, auth);
    try {
      await waitFor(function () { return app.window.localStorage.getItem('ad.acct') === user.id; });
      await openShop(app);
      await buy(app, 'gift-days');
      var document = app.window.document;
      document.getElementById('giftDays').value = '100';
      document.getElementById('giftNext').click();
      document.getElementById('giftSend').click();
      await waitFor(function () { return document.getElementById('giftShare').classList.contains('on'); });
      var link = document.getElementById('giftUrl').value;
      assert.match(link, /gift=00000000-0000-4000-8000-000000000261/);
      assert.equal(Number(app.window.localStorage.getItem('ad.spent')), 100);
      assert.equal(Number(app.window.localStorage.getItem('ad.gsent')), 100);
      assert.equal(auth.calls.filter(function (call) { return call.name === 'create_gift'; }).length, 1);
      document.getElementById('giftClose').click();
      await waitFor(function () { return document.getElementById('shopScrim').classList.contains('on') && document.querySelector('#shopChips [data-cat="위병소"]').classList.contains('active'); });
      await buy(app, 'gift-days');
      assert.equal(document.getElementById('giftShare').classList.contains('on'), true);
      assert.equal(document.getElementById('giftUrl').value, link);
      assert.equal(auth.calls.filter(function (call) { return call.name === 'create_gift'; }).length, 1);
      Array.prototype.filter.call(document.querySelectorAll('#giftShare .gift-chip'), function (button) { return button.textContent === '새 선물 만들기'; })[0].click();
      assert.equal(document.getElementById('giftStep1').classList.contains('on'), true);
      assert.equal(auth.calls.filter(function (call) { return call.name === 'create_gift'; }).length, 1);
    } finally { closeApp(app); }
  });

  test('an external gift claim needs no login and closes back to the main page', async function () {
    var token = '00000000-0000-4000-8000-000000000361';
    var auth = createSupabaseMock({ rpc: function (name) {
      if (name === 'peek_gift') return { data: { days: 77, message: '같이 전역하자', claimed: false }, error: null };
      if (name === 'claim_gift') return { data: { ok: true, days: 77, message: '같이 전역하자' }, error: null };
    } });
    var app = await createApp({}, auth, 'http://army-delete.test/?gift=' + token);
    try {
      var document = app.window.document;
      await waitFor(function () { return document.getElementById('giftClaim').classList.contains('on') && document.getElementById('claimBtn').disabled === false; });
      assert.equal(document.getElementById('giftGate').classList.contains('on'), false);
      document.getElementById('claimBtn').click();
      await waitFor(function () { return Number(app.window.localStorage.getItem('ad.gifted')) === 77; });
      assert.equal(Number(app.window.localStorage.getItem('ad.total') || 0), 0);
      document.getElementById('giftClose').click();
      assert.equal(document.getElementById('giftScrim').classList.contains('on'), false);
      assert.equal(document.getElementById('shopScrim').classList.contains('on'), false);
      assert.equal(app.window.location.search, '');
    } finally { closeApp(app); }
  });
}
