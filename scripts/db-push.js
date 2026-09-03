const fs = require('fs');
const https = require('https');
const path = require('path');

// .env 파싱 함수 (외부 패키지 설치 없이 동작)
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      env[key] = val;
    }
  }
  return env;
}

const env = loadEnv();
const projectRef = process.env.SUPABASE_PROJECT_REF || env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;

if (!projectRef || !accessToken) {
  console.error('\x1b[31m[오류] .env 파일에 SUPABASE_PROJECT_REF 및 SUPABASE_ACCESS_TOKEN이 필요합니다.\x1b[0m');
  console.error('(.env.example 파일을 참고하여 .env 파일을 작성해 주세요)');
  process.exit(1);
}

const sqlPath = path.resolve(__dirname, '..', 'supabase', 'board.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('\x1b[31m[오류] supabase/board.sql 파일을 찾을 수 없습니다.\x1b[0m');
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');
console.log(`\x1b[36m[DB 마이그레이션] 프로젝트(${projectRef})에 supabase/board.sql을 실행 중...\x1b[0m`);

const data = JSON.stringify({ query: sql });

const options = {
  hostname: 'api.supabase.com',
  port: 443,
  path: `/v1/projects/${projectRef}/database/query`,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log('\x1b[32m[성공] DB 스키마가 성공적으로 원격 Supabase에 반영되었습니다!\x1b[0m');
    } else {
      console.error(`\x1b[31m[실패] HTTP ${res.statusCode}: ${body}\x1b[0m`);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error('\x1b[31m[네트워크 오류]\x1b[0m', err.message);
  process.exit(1);
});

req.write(data);
req.end();
