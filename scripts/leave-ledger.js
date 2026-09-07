/* 휴가 구매는 지갑 숫자가 아니라 영수증 합계로 복원한다. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LeaveLedger = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var PREFIX = 'ad.leave.receipt.';
  var SYNC_PREFIX = 'ad.leave.synced.';
  var CLAIM_PREFIX = 'ad.leave.claim.';
  var GUEST_KEY = 'ad.leave.guest-id';
  var WALLET_ACCOUNT_KEY = 'ad.leave.wallet-account';
  var VERSION = 1;
  var CATALOG = {
    'leave-annual': { cost: 1000, kind: 'annual', days: 1 },
    'leave-reward': { cost: 2800, kind: 'reward', days: 3 },
    'leave-comfort': { cost: 4500, kind: 'comfort', days: 5 },
    'legacy-long-leave': { cost: 0, kind: 'comfort', days: 7 }
  };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function fail(message) { throw new Error('LeaveLedger: ' + message); }
  function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function validId(value) { return typeof value === 'string' && UUID.test(value); }
  function safeText(value) { return typeof value === 'string' && value.length <= 200; }
  function clock() { return new Date().toISOString(); }
  function defaultUuid() {
    var bytes, i, hex = [], c = typeof crypto !== 'undefined' && crypto;
    if (c && c.randomUUID) return c.randomUUID();
    if (c && c.getRandomValues) {
      bytes = new Uint8Array(16); c.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      for (i = 0; i < 16; i++) hex.push((bytes[i] + 256).toString(16).slice(1));
      return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
        hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10).join('');
    }
    fail('안전한 operation ID를 만들 수 없습니다.');
  }
  function legacyId(scope) {
    // UUID 모양은 유지하되 계정마다 같은 구휴가 영수증을 가리킨다.
    var v = String(scope).toLowerCase();
    if (!validId(v)) fail('구휴가 계정 ID가 올바르지 않습니다.');
    return v.slice(0, 14) + '5' + v.slice(15, 19) + '8' + v.slice(20);
  }

  function create(options) {
    options = options || {};
    var storage = options.storage;
    var getBalance = options.getBalance;
    var makeUuid = options.uuid || defaultUuid;
    var now = options.now || clock;
    var accountId = options.accountId || null;
    // 로그아웃은 기존 이 브라우저 지갑을 비우지 않는다. 다른 계정으로 바뀔 때만
    // 이 연결을 바꿔 A의 영수증을 B에게 보여주지 않는다.
    var walletAccountId = accountId;
    var lastError = null;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' ||
        typeof storage.key !== 'function' || typeof storage.length !== 'number') fail('storage가 필요합니다.');
    if (typeof getBalance !== 'function') fail('getBalance이 필요합니다.');
    if (accountId !== null && !validId(accountId)) fail('계정 ID가 올바르지 않습니다.');

    function read(key) {
      try { return storage.getItem(key); } catch (e) { fail('저장소를 읽을 수 없습니다.'); }
    }
    function write(key, value) {
      try { storage.setItem(key, value); } catch (e) { fail('저장소에 저장할 수 없습니다.'); }
    }
    function keyAt(i) {
      try { return storage.key(i); } catch (e) { fail('저장소 목록을 읽을 수 없습니다.'); }
    }
    function readWalletAccount() {
      var id = read(WALLET_ACCOUNT_KEY);
      if (id === null) return null;
      if (!validId(id)) fail('지갑 계정 정보가 손상되었습니다.');
      return id;
    }
    function setWalletAccount(id) {
      walletAccountId = id;
      if (id) write(WALLET_ACCOUNT_KEY, id);
    }
    // 새 로그인은 즉시 이 지갑의 scope가 되고, 로그아웃 뒤 새로 열어도 마지막
    // 지갑을 읽어 비용이 되살아난다.
    if (accountId) setWalletAccount(accountId);
    else walletAccountId = readWalletAccount();
    function guestId() {
      var id = read(GUEST_KEY);
      if (id === null) {
        id = makeUuid();
        if (!validId(id)) fail('guest ID가 UUID가 아닙니다.');
        write(GUEST_KEY, id);
      }
      if (!validId(id)) fail('저장된 guest ID가 올바르지 않습니다.');
      return id;
    }
    function newGuestId() {
      var id = makeUuid();
      if (!validId(id)) fail('guest ID가 UUID가 아닙니다.');
      write(GUEST_KEY, id);
      return id;
    }
    function catalog(productId, version) {
      if (version !== VERSION || !own(CATALOG, productId)) fail('알 수 없는 휴가 상품입니다.');
      return CATALOG[productId];
    }
    function validateReceipt(row) {
      var product;
      if (!row || typeof row !== 'object' || !validId(row.operation_id) || !safeText(row.product_id) ||
          row.catalog_version !== VERSION || !safeText(row.created_at)) fail('휴가 영수증이 손상되었습니다.');
      product = catalog(row.product_id, row.catalog_version);
      if (row.account_id !== null && row.account_id !== undefined && !validId(row.account_id)) fail('영수증 계정이 손상되었습니다.');
      if (row.guest_id !== null && row.guest_id !== undefined && !validId(row.guest_id)) fail('영수증 guest 정보가 손상되었습니다.');
      if (row.product_id === 'legacy-long-leave') {
        if (row.source !== 'legacy-long-leave') fail('구휴가 영수증 출처가 손상되었습니다.');
      } else if (row.source !== 'purchase') fail('휴가 영수증 출처가 손상되었습니다.');
      return product;
    }
    function all() {
      var out = [], i, key, raw, row;
      for (i = 0; i < storage.length; i++) {
        key = keyAt(i);
        if (typeof key !== 'string' || key.indexOf(PREFIX) !== 0) continue;
        raw = read(key);
        if (raw === null) fail('휴가 영수증이 사라졌습니다.');
        try { row = JSON.parse(raw); } catch (e) { fail('휴가 영수증 JSON이 손상되었습니다.'); }
        validateReceipt(row);
        if (key !== PREFIX + row.operation_id) fail('휴가 영수증 키가 손상되었습니다.');
        out.push(row);
      }
      return out;
    }
    function claimFor(id) { return read(CLAIM_PREFIX + id); }
    function belongs(row) {
      var claim;
      if (accountId) {
        if (row.account_id === accountId) return true;
        if (!row.account_id && row.guest_id) {
          claim = claimFor(row.guest_id);
          if (claim !== null && !validId(claim)) fail('guest 귀속 정보가 손상되었습니다.');
          return claim === accountId;
        }
        return false;
      }
      if (row.account_id && row.account_id === walletAccountId) return true;
      if (!row.account_id && row.guest_id) {
        claim = claimFor(row.guest_id);
        if (claim !== null && !validId(claim)) fail('guest 귀속 정보가 손상되었습니다.');
        if (claim === walletAccountId) return true;
        return row.guest_id === guestId() && claim === null;
      }
      return false;
    }
    function visible() {
      var rows = all();
      var hasAccountLegacy = walletAccountId && rows.some(function (row) {
        return row.source === 'legacy-long-leave' && row.account_id === walletAccountId;
      });
      return rows.filter(function (row) {
        // guest 구휴가를 계정용 이관 영수증과 동시에 더하면 7일이 두 번 된다.
        return belongs(row) && !(hasAccountLegacy && row.source === 'legacy-long-leave' && !row.account_id);
      });
    }
    function synced(id) {
      var value = read(SYNC_PREFIX + id);
      if (value !== null && value !== '1') fail('휴가 동기화 정보가 손상되었습니다.');
      return value === '1';
    }
    function sameReceipt(a, b) {
      return a.operation_id === b.operation_id && a.product_id === b.product_id &&
        a.catalog_version === b.catalog_version && a.source === b.source;
    }
    function storeReceipt(row) {
      var existing = read(PREFIX + row.operation_id);
      if (existing !== null) {
        try { existing = JSON.parse(existing); } catch (e) { fail('기존 휴가 영수증 JSON이 손상되었습니다.'); }
        validateReceipt(existing);
        if (!sameReceipt(existing, row)) fail('같은 operation ID의 내용이 다릅니다.');
        if (existing.account_id) {
          if (existing.account_id !== row.account_id) fail('같은 operation ID의 계정이 다릅니다.');
        } else if (existing.guest_id) {
          if (row.account_id) {
            if (claimFor(existing.guest_id) !== row.account_id) fail('같은 operation ID의 guest 귀속이 다릅니다.');
          } else if (existing.guest_id !== row.guest_id) fail('같은 operation ID의 guest가 다릅니다.');
        }
        return false;
      }
      write(PREFIX + row.operation_id, JSON.stringify(row));
      return true;
    }
    function setAccount(userId) {
      var rows, id, claimed;
      if (userId !== null && userId !== undefined && !validId(userId)) fail('계정 ID가 올바르지 않습니다.');
      if (!userId) {
        // 새 guest ID를 먼저 저장해야 실패한 로그아웃이 기존 계정 영수증을 숨기지 않는다.
        if (accountId) newGuestId();
        accountId = null;
        return null;
      }
      accountId = userId;
      setWalletAccount(userId);
      id = guestId();
      rows = all();
      if (!rows.some(function (row) { return !row.account_id && row.guest_id === id; })) return accountId;
      claimed = claimFor(id);
      if (claimed !== null && !validId(claimed)) fail('guest 귀속 정보가 손상되었습니다.');
      if (claimed === null) write(CLAIM_PREFIX + id, accountId);
      return accountId;
    }
    function cost() {
      return visible().reduce(function (sum, row) { return sum + validateReceipt(row).cost; }, 0);
    }
    function totals() {
      var result = { annual: 0, reward: 0, comfort: 0, total: 0 };
      visible().forEach(function (row) {
        var product = validateReceipt(row);
        result[product.kind] += product.days;
        result.total += product.days;
      });
      return result;
    }
    function purchase(productId) {
      var product = catalog(productId, VERSION), id = makeUuid(), rawBalance, row;
      if (productId === 'legacy-long-leave') fail('구 위로휴가는 이관으로만 처리합니다.');
      if (!validId(id)) fail('operation ID가 UUID가 아닙니다.');
      rawBalance = Number(getBalance());
      if (!isFinite(rawBalance) || rawBalance < 0) fail('잔액을 확인할 수 없습니다.');
      if (rawBalance < product.cost) fail('잔액이 부족합니다.');
      row = {
        operation_id: id, product_id: productId, catalog_version: VERSION,
        // 로그아웃 뒤에도 마지막 계정 지갑으로 플레이한다. 그 비용을 다음에
        // 로그인한 다른 계정의 guest 영수증으로 바꾸면 지갑과 영수증이 어긋난다.
        account_id: accountId || walletAccountId,
        guest_id: (accountId || walletAccountId) ? null : guestId(),
        source: 'purchase', created_at: String(now())
      };
      validateReceipt(row);
      storeReceipt(row); // 이 한 write가 구매 커밋이다. 비용은 영수증에서만 계산한다.
      return row;
    }
    function initializeLegacy(hasOwnedLongLeave) {
      var scope, row;
      if (!hasOwnedLongLeave) return false;
      scope = accountId || guestId();
      row = {
        operation_id: legacyId(scope), product_id: 'legacy-long-leave', catalog_version: VERSION,
        account_id: accountId, guest_id: accountId ? null : scope,
        source: 'legacy-long-leave', created_at: String(now())
      };
      validateReceipt(row);
      return storeReceipt(row);
    }
    function pending() {
      if (!accountId) return [];
      return visible().filter(function (row) {
        return !synced(row.operation_id) && (row.source === 'purchase' || row.account_id === accountId);
      }).slice(0, 100).map(function (row) {
        return { operation_id: row.operation_id, product_id: row.product_id, catalog_version: row.catalog_version };
      });
    }
    function markSynced(ids) {
      if (Object.prototype.toString.call(ids) !== '[object Array]') fail('동기화 ID 목록이 필요합니다.');
      ids.forEach(function (id) {
        if (!validId(id)) fail('동기화 ID가 UUID가 아닙니다.');
        write(SYNC_PREFIX + id, '1');
      });
    }
    function mergeServer(rows) {
      var added = 0, ids = [];
      if (Object.prototype.toString.call(rows) !== '[object Array]') fail('서버 영수증 목록이 필요합니다.');
      if (!accountId) fail('로그인한 계정에서만 서버 영수증을 병합할 수 있습니다.');
      rows.forEach(function (server) {
        var product, row;
        if (!server || typeof server !== 'object') fail('서버 영수증이 손상되었습니다.');
        product = catalog(server.product_id, server.catalog_version);
        if (Number(server.cost) !== product.cost || server.leave_kind !== product.kind || Number(server.leave_days) !== product.days) {
          fail('서버 휴가 영수증 값이 가격표와 다릅니다.');
        }
        if (server.source !== 'purchase' && server.source !== 'legacy_migration') fail('서버 영수증 출처가 올바르지 않습니다.');
        if ((server.product_id === 'legacy-long-leave') !== (server.source === 'legacy_migration')) {
          fail('서버 영수증 출처와 상품이 맞지 않습니다.');
        }
        row = { operation_id: server.operation_id, product_id: server.product_id, catalog_version: server.catalog_version,
          account_id: accountId, guest_id: null,
          source: server.source === 'legacy_migration' ? 'legacy-long-leave' : 'purchase', created_at: String(server.created_at) };
        validateReceipt(row);
        if (storeReceipt(row)) added++;
        ids.push(row.operation_id);
      });
      markSynced(ids);
      return { added: added, synced: ids.length };
    }
    function receipts() { return visible().slice(); }
    function error() { return lastError; }
    return {
      setAccount: function (id) { try { lastError = null; return setAccount(id); } catch (e) { lastError = e.message; throw e; } },
      purchase: function (id) { try { lastError = null; return purchase(id); } catch (e) { lastError = e.message; throw e; } },
      totals: function () { try { lastError = null; return totals(); } catch (e) { lastError = e.message; throw e; } },
      cost: function () { try { lastError = null; return cost(); } catch (e) { lastError = e.message; throw e; } },
      pending: function () { try { lastError = null; return pending(); } catch (e) { lastError = e.message; throw e; } },
      mergeServer: function (rows) { try { lastError = null; return mergeServer(rows); } catch (e) { lastError = e.message; throw e; } },
      markSynced: function (ids) { try { lastError = null; return markSynced(ids); } catch (e) { lastError = e.message; throw e; } },
      initializeLegacy: function (has) { try { lastError = null; return initializeLegacy(has); } catch (e) { lastError = e.message; throw e; } },
      receipts: function () { try { lastError = null; return receipts(); } catch (e) { lastError = e.message; throw e; } },
      error: error
    };
  }

  return { create: create, CATALOG_VERSION: VERSION };
}));
