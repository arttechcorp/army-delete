/* PGlite가 있을 때만 Supabase SQL을 로컬 임시 DB에서 끝까지 검증한다. */
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var pathToFileURL = require('node:url').pathToFileURL;
var assert = require('node:assert/strict');
var LeaveLedger = require('./leave-ledger.js');

var modulePath = process.argv[2] || process.env.PGLITE_MODULE;
var dataDir = process.argv[3] || process.env.PGLITE_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'army-delete-pglite-'));
if (!modulePath || !path.isAbsolute(modulePath)) {
  throw new Error('PGLITE_MODULE 또는 첫 인자로 PGlite 모듈의 절대 경로를 지정하세요.');
}

function source(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'supabase', name), 'utf8');
}
function memoryStorage() {
  var data = {};
  var storage = { getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem: function (key, value) { data[key] = String(value); },
    key: function (index) { return Object.keys(data)[index] || null; } };
  Object.defineProperty(storage, 'length', { get: function () { return Object.keys(data).length; } });
  return storage;
}
async function assertLeaveContract(db) {
  var account = '00000000-0000-4000-8000-000000000001';
  var ids = ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000103'];
  var index = 0;
  var ledger = LeaveLedger.create({ storage: memoryStorage(), accountId: account, getBalance: function () { return 100000; },
    uuid: function () { return ids[index++]; } });
  var operations = ['leave-annual', 'leave-reward', 'leave-comfort'].map(function (id) { return ledger.purchase(id); })
    .map(function (row) { return { operation_id: row.operation_id, product_id: row.product_id, catalog_version: row.catalog_version }; });
  var claims = JSON.stringify({ sub: account });
  await db.query("select set_config('request.jwt.claims', '" + claims + "', false)");
  var result = await db.query("select * from public.sync_leave_purchases('" + JSON.stringify(operations) + "'::jsonb)");
  assert.equal(ledger.mergeServer(result.rows).synced, 3, 'LeaveLedger와 SQL 가격표가 모두 세 휴가 상품에 합의해야 한다');
  assert.equal(LeaveLedger.CATALOG_VERSION, operations[0].catalog_version, '가격표 버전은 LeaveLedger 영수증에서만 비교한다');
}

async function loadPGlite() {
  try { return require(modulePath).PGlite; }
  catch (requireError) {
    var imported = await import(pathToFileURL(modulePath).href);
    if (imported.PGlite) return imported.PGlite;
    throw requireError;
  }
}

async function main() {
  var PGlite = await loadPGlite();
  var db = new PGlite(dataDir);
  try {
    await db.exec("create schema auth; create table auth.users (id uuid primary key, email text not null);" +
      "insert into auth.users values " +
      "('00000000-0000-4000-8000-000000000001','test1@example.com')," +
      "('00000000-0000-4000-8000-000000000002','test2@example.com')," +
      "('00000000-0000-4000-8000-000000000003','test3@example.com');" +
      "create function auth.uid() returns uuid language sql stable as $$ " +
      "select nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid $$;" +
      "create function auth.jwt() returns jsonb language sql stable as $$ " +
      "select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;" +
      "create role anon nologin; create role authenticated nologin; create role service_role nologin;");
    await db.exec(source('board.sql'));
    await db.exec(source('gift.sql'));
    await db.exec(source('board_test.sql'));
    await db.exec(source('gift_test.sql'));
    await assertLeaveContract(db);
    process.stdout.write('Local PGlite SQL checks passed: board.sql, gift.sql, board_test.sql, gift_test.sql\n');
  } finally {
    await db.close();
  }
}

main().catch(function (error) {
  process.stderr.write((error && error.stack) || String(error));
  process.stderr.write('\n');
  process.exitCode = 1;
});
