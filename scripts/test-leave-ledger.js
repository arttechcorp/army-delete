const test = require('node:test');
const assert = require('node:assert/strict');
const LeaveLedger = require('./leave-ledger.js');

function MemoryStorage() {
  this.data = Object.create(null);
  this.failWrite = false;
}
Object.defineProperty(MemoryStorage.prototype, 'length', { get() { return Object.keys(this.data).length; } });
MemoryStorage.prototype.getItem = function (key) { return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null; };
MemoryStorage.prototype.setItem = function (key, value) { if (this.failWrite) throw new Error('quota'); this.data[key] = String(value); };
MemoryStorage.prototype.key = function (index) { return Object.keys(this.data)[index] || null; };

function ids(start) {
  let n = start || 0;
  return function () { n += 1; return '00000000-0000-4000-8000-' + String(n).padStart(12, '0'); };
}
function account(n) { return '11111111-1111-4111-8111-' + String(n).padStart(12, '0'); }
function ledger(storage, accountId, balance, uuidStart) {
  let api;
  api = LeaveLedger.create({ storage, accountId: accountId || null, getBalance: () => balance - api.cost(), uuid: ids(uuidStart), now: () => '2026-09-07T00:00:00.000Z' });
  return api;
}
function serverRow(receipt) {
  const cfg = { 'leave-annual': [1000, 'annual', 1], 'leave-reward': [2800, 'reward', 3], 'leave-comfort': [4500, 'comfort', 5], 'legacy-long-leave': [0, 'comfort', 7] }[receipt.product_id];
  return { operation_id: receipt.operation_id, product_id: receipt.product_id, catalog_version: 1,
    cost: cfg[0], leave_kind: cfg[1], leave_days: cfg[2], created_at: receipt.created_at,
    source: receipt.source === 'legacy-long-leave' ? 'legacy_migration' : 'purchase' };
}

test('세 상품은 영수증 비용과 종류별 휴가 합계로만 계산한다', () => {
  const s = new MemoryStorage(); const l = ledger(s, account(1), 10000);
  l.purchase('leave-annual'); l.purchase('leave-reward'); l.purchase('leave-comfort');
  assert.deepEqual(l.totals(), { annual: 1, reward: 3, comfort: 5, total: 9 });
  assert.equal(l.cost(), 8300);
  assert.throws(() => l.purchase('leave-reward'), /잔액이 부족/);
});

test('저장 실패면 영수증도 비용도 바뀌지 않는다', () => {
  const s = new MemoryStorage(); const l = ledger(s, account(1), 10000);
  s.failWrite = true;
  assert.throws(() => l.purchase('leave-annual'), /저장소에 저장/);
  s.failWrite = false;
  assert.equal(l.cost(), 0);
  assert.equal(l.receipts().length, 0);
});

test('손상된 영수증은 조용히 버리지 않고 구매를 막는다', () => {
  const s = new MemoryStorage(); const l = ledger(s, account(1), 10000);
  s.setItem('ad.leave.receipt.00000000-0000-4000-8000-000000000001', '{bad');
  assert.throws(() => l.purchase('leave-annual'), /JSON이 손상/);
  assert.equal(Object.keys(s.data).filter((key) => key.indexOf('ad.leave.receipt.') === 0).length, 1);
});

test('guest 영수증은 최초 연결 계정에만 귀속되고 계정 전환에 재수입되지 않는다', () => {
  const s = new MemoryStorage(); const guest = ledger(s, null, 10000);
  guest.purchase('leave-annual');
  const firstGuest = s.getItem('ad.leave.guest-id');
  assert.equal(guest.totals().total, 1);
  guest.setAccount(account(1));
  assert.equal(guest.totals().total, 1);
  guest.setAccount(account(2));
  assert.equal(guest.totals().total, 0);
  guest.setAccount(null);
  assert.equal(guest.totals().total, 0);
  assert.equal(s.getItem('ad.leave.claim.' + firstGuest), account(1));
});

test('guest 구매는 A claim 뒤 로그아웃·새로고침에도 비용이 남고 B 전환에는 숨는다', () => {
  const s = new MemoryStorage(); const guest = ledger(s, null, 10000);
  guest.purchase('leave-annual');
  guest.setAccount(account(1));
  guest.setAccount(null);
  assert.equal(guest.cost(), 1000);
  assert.deepEqual(guest.pending(), [], '로그아웃 상태에서는 동기화하지 않는다');
  const reloaded = ledger(s, null, 10000);
  assert.equal(reloaded.cost(), 1000, '재시작해도 마지막 지갑 scope를 복원한다');
  reloaded.setAccount(account(2));
  assert.equal(reloaded.cost(), 0, '다른 계정에는 A가 claim한 guest 영수증을 보이지 않는다');
});

test('로그아웃 뒤 A 지갑으로 산 휴가는 B에게 옮겨가지 않고 A로 돌아온다', () => {
  const s = new MemoryStorage(); const a = ledger(s, account(1), 10000);
  a.setAccount(null);
  a.purchase('leave-annual');
  assert.equal(a.cost(), 1000);
  assert.deepEqual(a.pending(), [], '로그아웃 상태에서는 A 영수증도 동기화하지 않는다');
  a.setAccount(account(2));
  assert.equal(a.cost(), 0, 'B 지갑은 A가 로그아웃 중 산 비용을 갖지 않는다');
  a.setAccount(account(1));
  assert.equal(a.cost(), 1000, 'A로 돌아오면 같은 지갑 비용을 다시 본다');
});

test('서로 다른 기기의 영수증은 operation ID 합집합으로 합쳐진다', () => {
  const a = ledger(new MemoryStorage(), account(1), 10000);
  const b = ledger(new MemoryStorage(), account(1), 10000, 100);
  const aReceipt = a.purchase('leave-annual');
  const bReceipt = b.purchase('leave-reward');
  a.mergeServer([serverRow(aReceipt), serverRow(bReceipt)]);
  b.mergeServer([serverRow(aReceipt), serverRow(bReceipt)]);
  assert.deepEqual(a.totals(), { annual: 1, reward: 3, comfort: 0, total: 4 });
  assert.deepEqual(b.totals(), { annual: 1, reward: 3, comfort: 0, total: 4 });
});

test('같은 operation ID 재시도는 한 번의 영수증으로 남고 sync 상태는 별도다', () => {
  const s = new MemoryStorage(); const l = ledger(s, account(1), 10000);
  const receipt = l.purchase('leave-annual');
  const before = s.getItem('ad.leave.receipt.' + receipt.operation_id);
  l.markSynced([receipt.operation_id]);
  assert.equal(l.pending().length, 0);
  assert.equal(s.getItem('ad.leave.receipt.' + receipt.operation_id), before);
  l.mergeServer([serverRow(receipt)]);
  assert.equal(l.totals().total, 1);
});

test('서버 병합은 가격표와 출처가 맞는 영수증만 받는다', () => {
  const l = ledger(new MemoryStorage(), account(1), 10000);
  const receipt = l.purchase('leave-annual'); const row = serverRow(receipt);
  row.cost = 1;
  assert.throws(() => l.mergeServer([row]), /가격표와 다릅니다/);
  row.cost = 1000; row.source = 'legacy_migration';
  assert.throws(() => l.mergeServer([row]), /출처와 상품이 맞지 않습니다/);
});

test('서버 병합은 같은 operation ID가 다른 로컬 계정에 있으면 중단한다', () => {
  const s = new MemoryStorage(); const a = ledger(s, account(1), 10000);
  const receipt = a.purchase('leave-annual');
  const b = ledger(s, account(2), 10000);
  assert.throws(() => b.mergeServer([serverRow(receipt)]), /계정이 다릅니다/);
});

test('구 위로휴가는 계정별 결정 UUID 한 건으로 comfort 7일만 이관한다', () => {
  const s = new MemoryStorage(); const l = ledger(s, account(1), 10000);
  assert.equal(l.initializeLegacy(true), true);
  assert.equal(l.initializeLegacy(true), false);
  assert.deepEqual(l.totals(), { annual: 0, reward: 0, comfort: 7, total: 7 });
  const op = l.receipts()[0].operation_id;
  assert.match(op, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(l.pending(), [{ operation_id: op, product_id: 'legacy-long-leave', catalog_version: 1 }]);
  assert.throws(() => l.purchase('legacy-long-leave'), /이관으로만 처리/);
});

test('guest 구 위로휴가는 로그인 계정 이관과 겹쳐 두 번 세지 않는다', () => {
  const s = new MemoryStorage(); const l = ledger(s, null, 10000);
  assert.equal(l.initializeLegacy(true), true);
  const guestOp = l.receipts()[0].operation_id;
  l.setAccount(account(1));
  assert.equal(l.initializeLegacy(true), true, '서버 보유 확인 뒤 계정용 영수증을 만든다');
  assert.equal(l.initializeLegacy(true), false, '같은 계정의 재시도는 한 장이다');
  assert.equal(l.totals().total, 7);
  assert.equal(l.pending().length, 1, 'guest 구휴가는 서버에 보내지 않는다');
  assert.notEqual(l.pending()[0].operation_id, guestOp);
  l.setAccount(null);
  assert.equal(l.totals().total, 7, '로그아웃 뒤에도 guest와 계정 이관분을 함께 더하면 안 된다');
  assert.equal(ledger(s, null, 10000).totals().total, 7, '새로고침 뒤에도 이관 중복이 없어야 한다');
});

test('개인정보 관련 저장 키는 영수증, guest 귀속, 동기화 상태로 한정된다', () => {
  const s = new MemoryStorage(); const l = ledger(s, null, 10000);
  const receipt = l.purchase('leave-annual');
  l.setAccount(account(1)); l.markSynced([receipt.operation_id]);
  assert.deepEqual(Object.keys(s.data).sort().map((key) => key.replace(/^[^.]+\.[^.]+\./, 'ad.leave.')), [
    'ad.leave.claim.' + s.getItem('ad.leave.guest-id'),
    'ad.leave.guest-id',
    'ad.leave.receipt.' + receipt.operation_id,
    'ad.leave.synced.' + receipt.operation_id,
    'ad.leave.wallet-account'
  ].sort());
});
