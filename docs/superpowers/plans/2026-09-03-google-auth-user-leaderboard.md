# 구글 로그인 및 사용자 누적 일수 기반 군별 리더보드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 구글 로그인(Supabase Auth)을 통해 사용자의 로컬 "누적 삭제된 일수(`ad.total`)"를 서버에 동기화하고, 군별로 사용자들의 누적 일수를 총합 집계하는 확장된 리더보드를 구현한다.

**Architecture:** 
- 백엔드는 Supabase Auth(Google OAuth) + Postgres `user_records` 테이블 + `sync_my_record` 및 `leaderboard` RPC로 구성한다.
- 프론트엔드는 `@supabase/supabase-js@2`를 로드하여 세션을 관리하고, 리더보드 클릭 시 미인증 사용자에게 구글 로그인 뷰를, 인증 사용자에게는 680px로 확장된 4개 군 순위 및 내 기여도 뷰를 렌더링한다.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, `@supabase/supabase-js@2`, Supabase (PostgreSQL, RLS, RPC, Auth)

## Global Constraints
- `package.json`이나 별도의 번들러 빌드 없이 단일 `index.html` 기반 구조를 유지한다.
- Google Auth 호출 시 현재 페이지 URL로 깔끔하게 리다이렉트되어 세션을 이어받아야 한다.
- 비로그인 사용자의 기본 플레이(버튼 누르기, 상점, 소리 등)는 전혀 방해받지 않아야 한다.
- 숫자가 커져도(`100,000,000일` 등) 리더보드 레이아웃이 깨지지 않아야 한다.

---

### Task 1: Supabase 스키마 및 RPC 함수 작성 (`supabase/board.sql`, `supabase/board_test.sql`)

**Files:**
- Modify: `supabase/board.sql`
- Modify: `supabase/board_test.sql`

**Interfaces:**
- Produces: 
  - Table: `public.user_records(user_id uuid, email text, branch text, total_days bigint, updated_at timestamptz)`
  - Function: `public.sync_my_record(p_branch text, p_total_days bigint) returns void`
  - Function: `public.leaderboard() returns json`

- [ ] **Step 1: `supabase/board.sql`에 신규 테이블 및 RPC 작성**
  - `user_records` 테이블 정의 (RLS 활성화)
  - `sync_my_record` 함수 (auth.uid() 검증, upsert 시 `greatest` 적용)
  - `leaderboard()` 함수 (전체 합계, 전체 유저 수, 군별 sum/count 집계 반환)
  - 권한 부여 (`revoke all`, `grant execute on function ... to authenticated, anon`)

- [ ] **Step 2: `supabase/board_test.sql` 작성**
  - 가상 auth.uid() 컨텍스트에서 `sync_my_record` 실행 테스트
  - `leaderboard()` 반환 JSON 구조 및 `branches` 합계 확인 assert 작성

- [ ] **Step 3: 커밋**
  ```bash
  git add supabase/board.sql supabase/board_test.sql
  git commit -m "feat(db): 구글 로그인 사용자 기반 user_records 테이블 및 sync/leaderboard RPC 구현"
  ```

---

### Task 2: Supabase JS 라이브러리 및 Google Auth 세션 관리 (`index.html`)

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Supabase project credentials (`SB_URL`, `SB_KEY`)
- Produces: 
  - Global `supabaseClient`
  - Auth state helpers: `currentUser`, `loginWithGoogle()`, `logoutGoogle()`
  - Auth change callback handler

- [ ] **Step 1: `@supabase/supabase-js@2` CDN 스크립트 태그 추가**
  - `<head>` 영역에 `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>` 추가

- [ ] **Step 2: Supabase 클라이언트 초기화 및 인증 함수 구현**
  - `window.supabase.createClient(SB_URL, SB_KEY)` 초기화
  - `signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href.split('#')[0] } })`
  - `signOut()` 구현
  - `supabaseClient.auth.onAuthStateChange` 리스너 등록하여 세션 갱신 시 상태 반영

- [ ] **Step 3: 커밋**
  ```bash
  git add index.html
  git commit -m "feat(auth): Supabase JS 로드 및 구글 OAuth 로그인/로그아웃 핸들러 추가"
  ```

---

### Task 3: 사용자 데이터 동기화 로직 구현 (`index.html`)

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `total`, `branch`, `currentUser`, `sync_my_record`
- Produces: 
  - `syncUserRecord()` 함수

- [ ] **Step 1: `syncUserRecord()` 함수 작성**
  - `currentUser`가 있고 `branch`가 설정되어 있을 때 `supabaseClient.rpc('sync_my_record', { p_branch: branch, p_total_days: total })` 호출
  - 성공 시 로컬 `ad.sentTotal` 업데이트
  - 실패 시 에러 핸들링 (네트워크 오류 무시하고 다음 주기에 재시도)

- [ ] **Step 2: 동기화 트리거 연결**
  - 구글 로그인 성공(`SIGNED_IN`) 즉시 `syncUserRecord()` 호출
  - 소속 군 선택(`setBranch`) 시 로그인 상태이면 `syncUserRecord()` 호출
  - 리더보드 열 때(`openLb`) 호출 후 `refreshBoard()` 실행

- [ ] **Step 3: 커밋**
  ```bash
  git add index.html
  git commit -m "feat(sync): 로그인 시 로컬 ad.total 및 branch를 서버 user_records에 동기화"
  ```

---

### Task 4: 리더보드 모달 UI 크기 확장 및 구글 로그인/랭킹 뷰 개편 (`index.html`)

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces:
  - CSS: `.shop.lb-modal` 스타일 (max-width: 680px, 반응형)
  - HTML/JS: 비로그인용 구글 로그인 유도 뷰 (`renderLoginGate()`)
  - HTML/JS: 로그인용 군별 랭킹 뷰 (`renderBoard()`)
  - HTML/JS: 하단 프로필 및 내 기여도 정보 바

- [ ] **Step 1: 리더보드 모달 CSS 확장 및 스타일링**
  - `#lbScrim .shop` 너비를 `max-width: 680px`로 확장
  - 큰 숫자(`lb-val`) 폰트 및 모노스페이스 정렬 스타일 보강
  - 구글 로그인 버튼 전용 CSS 및 SVG 아이콘 추가
  - 내 프로필/기여도 영역(`lb-my-info`) 스타일 추가

- [ ] **Step 2: 비로그인 상태일 때의 `renderLoginGate()` 구현**
  - "구글 계정으로 로그인하고 전우들과 랭킹을 확인하세요" 안내
  - 구글 로그인 버튼 렌더링 및 클릭 이벤트 연결

- [ ] **Step 3: 로그인 상태일 때의 `renderBoard()` 개편**
  - 전체 누적 일수(`total_all`) 및 총 참여 전우 수(`total_users`) 헤더 요약 렌더링
  - 4개 군(육군, 해병, 해군, 공군)의 총합 일수(`total_days`) 및 인원수(`user_count`) 렌더링
  - 1위 대비 비율 막대 게이지 렌더링
  - 하단 내 프로필, 내 소속 군, 내가 기여한 일수(`내 기여: X일`), 로그아웃 버튼 렌더링

- [ ] **Step 4: 커밋**
  ```bash
  git add index.html
  git commit -m "feat(ui): 리더보드 모달 680px 확장, 구글 로그인 게이트 및 랭킹/내기여도 뷰 구현"
  ```

---

### Task 5: 문서 업데이트 및 종합 검증 (`README.md`, `privacy.html`)

**Files:**
- Modify: `README.md`
- Modify: `privacy.html`

- [ ] **Step 1: `README.md` 업데이트**
  - 리더보드 섹션을 "구글 로그인 기반 군별 누적 총합 리더보드"로 갱신
  - 사용자 누적 일수 동기화 방식 및 Supabase Auth 설정 가이드 추가

- [ ] **Step 2: `privacy.html` 업데이트**
  - 구글 OAuth 로그인 시 수집되는 정보(이메일, 군 소속, 누적 삭제 일수)와 보관 목적 명시

- [ ] **Step 3: 최종 검증 (로컬 서버 브라우저 테스트 및 문법/콘솔 검증)**
  - 로컬 서버 구동 확인
  - JS 문법 및 구글 로그인 버튼 렌더링 확인
  - 리더보드 모달 레이아웃 및 닫기/열기 동작 확인

- [ ] **Step 4: 최종 커밋**
  ```bash
  git add README.md privacy.html
  git commit -m "docs: 구글 로그인 리더보드 반영에 따른 README 및 개인정보처리방침 갱신"
  ```
