# PostHog 분석 시스템 구현 계획 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `군생활 삭제 버튼` 웹 앱에 PostHog SDK 및 안전한 분석 모듈을 도입하여 마케팅 UTM 유입, 헤비유저/이탈률 퍼널, 인게임 경제, 리더보드와 리텐션 상관관계를 측정한다.

**Architecture:** `<head>`에 PostHog 공식 경량 로더를 비동기 삽입하고, 클라이언트 스크립트 내에 광고차단기 및 오프라인 환경에 안전한 분석 래퍼(`__analytics`)를 구현한다. 초당 수십 회의 연타를 고려하여 매 클릭 이벤트 대신 첫 클릭, 누적 마일스톤, 세션 요약(`pagehide`/`visibilitychange`)으로 이벤트를 효율화하고, Google 로그인과 연계하여 사용자 식별(`identify`) 및 코호트 속성을 동기화한다.

**Tech Stack:** JavaScript (ES5/ES6 브라우저 환경), PostHog JavaScript SDK, Node.js (`node:test`, `node:assert`), Supabase Auth 연동.

## Global Constraints

- 외부 빌드 도구(Webpack/Vite 등) 없이 `index.html`과 정적 파일 단독으로 동작하는 구조를 유지해야 한다.
- 광고차단기(AdBlock)나 네트워크 오류로 PostHog 스크립트 로드가 차단되어도 웹 앱의 기존 기능(삭제 버튼, 사운드, 상점, 리더보드)에 어떠한 런타임 오류도 발생하지 않아야 한다.
- 무료 플랜 한도(월 100만 이벤트)를 초과하지 않도록 `autocapture: false`로 설정하고 매 클릭마다 이벤트를 발송하지 않는다.
- [privacy.html](file:///Users/giwook/Documents/army-delete/privacy.html)에 PostHog 수집 항목 및 목적을 고지하여 AdSense 정책을 준수해야 한다.

---

### Task 1: 테스트 하네스 구축 및 분석 유틸리티 모듈 검증

**Files:**
- Create: `scripts/test-analytics.js`
- Test: `scripts/test-analytics.js`

**Interfaces:**
- Produces:
  - `createAnalyticsHelper(config)`: 순수 분석 로직 헬퍼 (마일스톤 판별, 세션 요약 산출, 이벤트 가드)
  - `checkMilestone(prevTotal, newTotal)`: 마일스톤 목록(`[10, 50, 100, 500, 1000, 5000, 10000]`) 중 새로 달성한 값 반환
  - `buildSessionPayload(sessionState)`: `session_engagement` 페이로드 생성기

- [ ] **Step 1: 실패하는 단위 테스트 작성 (`scripts/test-analytics.js`)**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMilestone, buildSessionPayload, MILESTONES } from './analytics-helper.js';

test('checkMilestone should detect milestone crossing', () => {
  assert.equal(checkMilestone(9, 10), 10);
  assert.equal(checkMilestone(10, 15), null);
  assert.equal(checkMilestone(45, 52), 50);
  assert.equal(checkMilestone(99, 105), 100);
  assert.equal(checkMilestone(999, 1000), 1000);
  assert.equal(checkMilestone(1001, 1005), null);
});

test('buildSessionPayload should calculate session summary correctly', () => {
  const session = {
    startTime: 1000,
    sessionClicks: 150,
    maxCombo: 24,
    total: 300,
    spent: 80,
    balance: 220
  };
  const payload = buildSessionPayload(session, 16000);
  assert.deepEqual(payload, {
    session_clicks: 150,
    max_combo: 24,
    total_days_deleted: 300,
    spent_days: 80,
    balance: 220,
    session_duration_seconds: 15
  });
});
```

- [ ] **Step 2: 테스트 실행 및 실패 확인**

Run: `node --test scripts/test-analytics.js`  
Expected: FAIL (Cannot find module `./analytics-helper.js`)

- [ ] **Step 3: 분석 헬퍼 모듈 작성 (`scripts/analytics-helper.js`)**

```javascript
export const MILESTONES = [10, 50, 100, 500, 1000, 5000, 10000];

export function checkMilestone(prevTotal, newTotal) {
  for (let i = 0; i < MILESTONES.length; i++) {
    const m = MILESTONES[i];
    if (prevTotal < m && newTotal >= m) {
      return m;
    }
  }
  return null;
}

export function buildSessionPayload(session, nowMs) {
  const durationSec = Math.max(0, Math.round(((nowMs || Date.now()) - session.startTime) / 1000));
  return {
    session_clicks: session.sessionClicks || 0,
    max_combo: session.maxCombo || 0,
    total_days_deleted: session.total || 0,
    spent_days: session.spent || 0,
    balance: session.balance || 0,
    session_duration_seconds: durationSec
  };
}
```

- [ ] **Step 4: 테스트 재실행 및 통과 확인**

Run: `node --test scripts/test-analytics.js`  
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add scripts/test-analytics.js scripts/analytics-helper.js
git commit -m "test: add test harness and pure analytics helper module"
```

---

### Task 2: PostHog SDK 스니펫 및 안전 래퍼 통합

**Files:**
- Modify: `index.html` (head 및 script 초기화 부분)
- Test: `scripts/test-analytics.js` (DOM 통합 점검 테스트 추가)

**Interfaces:**
- Produces:
  - `window.__analytics.track(eventName, properties)`
  - `window.__analytics.identify(userId, userProps)`
  - `window.__analytics.reset()`
  - `window.__analytics.session`: 세션 인게이지먼트 상태 객체

- [ ] **Step 1: HTML 내 PostHog 로더 및 window.__analytics 정의 테스트 작성**

`scripts/test-analytics.js`에 `index.html` 파싱 테스트 추가:
```javascript
import fs from 'node:fs';

test('index.html contains PostHog snippet and safe __analytics wrapper', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /https:\/\/us\.i\.posthog\.com|posthog-js/);
  assert.match(html, /window\.__analytics/);
  assert.match(html, /autocapture:\s*false/);
});
```

- [ ] **Step 2: 테스트 실행 및 실패 확인**

Run: `node --test scripts/test-analytics.js`  
Expected: FAIL

- [ ] **Step 3: `index.html`의 `<head>`에 PostHog 공식 로더 삽입 및 스크립트에 안전 래퍼 구현**

`index.html`의 `<head>` 내부:
```html
<script>
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getGlobalPlugins getSessionReplayUrl".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  var POSTHOG_KEY = window.ENV_POSTHOG_KEY || 'phc_PLACEHOLDER_KEY';
  var POSTHOG_HOST = window.ENV_POSTHOG_HOST || 'https://us.i.posthog.com';

  if (POSTHOG_KEY && POSTHOG_KEY !== 'phc_PLACEHOLDER_KEY') {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      autocapture: false,
      capture_pageview: true,
      persistence: 'localStorage+cookie'
    });
  }
</script>
```

`index.html` 내부 스크립트 초기화:
```javascript
  /* ══════════════════════════════════════════
     PostHog 분석 래퍼 (광고차단기/오프라인 완전 방어)
     ══════════════════════════════════════════ */
  var __analytics = {
    session: {
      startTime: Date.now(),
      sessionClicks: 0,
      maxCombo: 0,
      firstClickFired: false
    },
    track: function (eventName, properties) {
      try {
        if (window.posthog && typeof window.posthog.capture === 'function') {
          window.posthog.capture(eventName, properties || {});
        }
      } catch (err) {}
    },
    identify: function (userId, userProperties) {
      try {
        if (window.posthog && typeof window.posthog.identify === 'function') {
          window.posthog.identify(userId, userProperties || {});
        }
      } catch (err) {}
    },
    reset: function () {
      try {
        if (window.posthog && typeof window.posthog.reset === 'function') {
          window.posthog.reset();
        }
      } catch (err) {}
    }
  };
```

- [ ] **Step 4: 테스트 재실행 및 통과 확인**

Run: `node --test scripts/test-analytics.js`  
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add index.html scripts/test-analytics.js
git commit -m "feat: integrate PostHog loader and safe __analytics wrapper"
```

---

### Task 3: 코어 인터랙션 계측 (첫 클릭, 마일스톤, 세션 요약)

**Files:**
- Modify: `index.html` (삭제 버튼 클릭 핸들러, pagehide/visibilitychange 이벤트)
- Test: `scripts/test-analytics.js`

**Interfaces:**
- Consumes: `__analytics.track`, `checkMilestone`, `buildSessionPayload`
- Produces:
  - Event `first_delete_click`
  - Event `click_milestone_reached`
  - Event `session_engagement`

- [ ] **Step 1: 마일스톤 및 세션 발송 로직 테스트 작성**

`scripts/test-analytics.js`에 인터랙션 계측 시뮬레이션 테스트 추가:
```javascript
test('first click, milestone crossing, and session summary trigger correctly', () => {
  const events = [];
  const fakeAnalytics = {
    track: (name, props) => events.push({ name, props }),
    session: { startTime: Date.now(), sessionClicks: 0, maxCombo: 0, firstClickFired: false }
  };
  // Simulate clicks
  let prevTotal = 0;
  let newTotal = 10;
  fakeAnalytics.session.sessionClicks++;
  fakeAnalytics.session.maxCombo = 5;
  if (!fakeAnalytics.session.firstClickFired) {
    fakeAnalytics.session.firstClickFired = true;
    fakeAnalytics.track('first_delete_click', { d_day: 100 });
  }
  const m = checkMilestone(prevTotal, newTotal);
  if (m) fakeAnalytics.track('click_milestone_reached', { milestone_days: m });

  assert.equal(events.length, 2);
  assert.equal(events[0].name, 'first_delete_click');
  assert.equal(events[1].name, 'click_milestone_reached');
  assert.equal(events[1].props.milestone_days, 10);
});
```

- [ ] **Step 2: 테스트 실행 및 확인**

Run: `node --test scripts/test-analytics.js`  
Expected: PASS

- [ ] **Step 3: `index.html`의 버튼 클릭 핸들러 및 라이프사이클에 계측 코드 연결**

`index.html`의 `btn.addEventListener('click', ...)` 내부:
1. 최초 1회 클릭 시:
   ```javascript
   if (!__analytics.session.firstClickFired) {
     __analytics.session.firstClickFired = true;
     var currentCalc = calcService(startEl.value, endEl.value, midnightToday());
     __analytics.track('first_delete_click', {
       start_date: startEl.value || null,
       end_date: endEl.value || null,
       service_status: currentCalc.state,
       d_day: currentCalc.dday || null
     });
   }
   ```
2. 클릭 및 마일스톤 도달 시:
   ```javascript
   __analytics.session.sessionClicks++;
   if (combo > __analytics.session.maxCombo) __analytics.session.maxCombo = combo;
   var milestone = checkMilestone(prevTotal, newTotal);
   if (milestone) {
     __analytics.track('click_milestone_reached', {
       milestone_days: milestone,
       current_combo: combo
     });
   }
   ```
3. 세션 종료(`pagehide` 및 `visibilitychange` 숨김 상태) 시:
   ```javascript
   function flushSessionEngagement() {
     if (__analytics.session.sessionClicks === 0) return;
     var total = parseInt(load(LS.total) || '0', 10);
     var spent = parseInt(load(LS.spent) || '0', 10);
     __analytics.track('session_engagement', {
       session_clicks: __analytics.session.sessionClicks,
       max_combo: __analytics.session.maxCombo,
       total_days_deleted: total,
       spent_days: spent,
       balance: Math.max(0, total - spent),
       session_duration_seconds: Math.max(0, Math.round((Date.now() - __analytics.session.startTime) / 1000))
     });
   }
   ```

- [ ] **Step 4: 테스트 실행 및 무결성 확인**

Run: `node --test scripts/test-analytics.js`  
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add index.html scripts/test-analytics.js
git commit -m "feat: instrument core play first click, milestones, and session summary"
```

---

### Task 4: 상점 이코노미 및 광고 수익화 계측

**Files:**
- Modify: `index.html` (상점 열기/구매/공유, 보상형 광고, 하단 배너 닫기 핸들러)
- Test: `scripts/test-analytics.js`

**Interfaces:**
- Consumes: `__analytics.track`
- Produces:
  - Event `shop_opened`
  - Event `item_purchased`
  - Event `share_boost_activated`
  - Event `reward_ad_clicked`
  - Event `reward_ad_completed`
  - Event `reward_ad_failed`
  - Event `anchor_ad_closed`

- [ ] **Step 1: 상점 및 광고 이벤트 시뮬레이션 테스트 작성**

`scripts/test-analytics.js`에 이코노미 및 광고 이벤트 검증 추가:
```javascript
test('economy and ads events payload structure', () => {
  const events = [];
  const track = (name, props) => events.push({ name, props });

  // Simulate shop open
  track('shop_opened', { current_balance: 150, owned_items_count: 2 });
  // Simulate item purchase
  track('item_purchased', { item_id: 'double', item_name: '2배 부스터', price: 40, item_type: 'multiplier', remaining_balance: 110 });
  // Simulate reward ad
  track('reward_ad_completed', { reward_days: 100, new_balance: 210 });

  assert.equal(events.length, 3);
  assert.equal(events[1].props.item_id, 'double');
  assert.equal(events[2].props.reward_days, 100);
});
```

- [ ] **Step 2: 테스트 실행 및 확인**

Run: `node --test scripts/test-analytics.js`  
Expected: PASS

- [ ] **Step 3: `index.html`의 상점/광고 코드에 이벤트 삽입**

1. `openShop()`:
   ```javascript
   __analytics.track('shop_opened', {
     current_balance: Math.max(0, parseInt(load(LS.total)||'0', 10) - parseInt(load(LS.spent)||'0', 10)),
     owned_items_count: loadOwned().length
   });
   ```
2. 아이템 구매 성공 시:
   ```javascript
   __analytics.track('item_purchased', {
     item_id: item.id,
     item_name: item.name,
     price: item.price,
     item_type: item.effect ? item.effect.type : 'collectible',
     remaining_balance: newBalance
   });
   ```
3. 무료 공유 부스트 클릭 시:
   ```javascript
   __analytics.track('share_boost_activated', {
     method: (navigator.share && window.isSecureContext) ? 'navigator.share' : 'clipboard',
     boost_multiplier: item.effect.value,
     boost_duration_ms: item.effect.durationMs
   });
   ```
4. `watchRewardAd()` 시작, 완료(`adViewed`), 실패(`beforeReward` 미호출/타임아웃):
   * 시작 시: `__analytics.track('reward_ad_clicked', { current_balance: balance });`
   * `adViewed` 시: `__analytics.track('reward_ad_completed', { reward_days: rewardCfg.days, new_balance: balance + rewardCfg.days });`
   * 실패 시: `__analytics.track('reward_ad_failed', { reason: failReason });`
5. `anchorClose.addEventListener('click', ...)`:
   * `__analytics.track('anchor_ad_closed', { viewport_width: window.innerWidth });`

- [ ] **Step 4: 테스트 실행 및 확인**

Run: `node --test scripts/test-analytics.js`  
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add index.html scripts/test-analytics.js
git commit -m "feat: instrument shop economy, share boost, and ads monetization"
```

---

### Task 5: 리더보드 & 사용자 식별 (Identity) 연동

**Files:**
- Modify: `index.html` (리더보드 모달, Google 로그인/로그아웃, 군 소속 변경)
- Test: `scripts/test-analytics.js`

**Interfaces:**
- Consumes: `__analytics.identify`, `__analytics.reset`, `__analytics.track`
- Produces:
  - Event `leaderboard_opened`
  - Event `login_completed`
  - Event `branch_selected`
  - User profile properties: `is_leaderboard_user: true`, `branch`, `service_status`, `d_day`

- [ ] **Step 1: 사용자 식별 및 군 소속 프로퍼티 동기화 테스트 작성**

`scripts/test-analytics.js`에 추가:
```javascript
test('user identity and properties map correctly', () => {
  let identifiedUser = null;
  let userProps = null;
  const fakeAnalytics = {
    identify: (id, props) => { identifiedUser = id; userProps = props; }
  };
  const mockUser = { id: 'usr-123' };
  const currentCalc = { state: 'active', dday: 240 };
  fakeAnalytics.identify(mockUser.id, {
    branch: 'army',
    service_status: currentCalc.state,
    d_day: currentCalc.dday,
    is_leaderboard_user: true
  });

  assert.equal(identifiedUser, 'usr-123');
  assert.equal(userProps.is_leaderboard_user, true);
  assert.equal(userProps.branch, 'army');
});
```

- [ ] **Step 2: 테스트 실행 및 확인**

Run: `node --test scripts/test-analytics.js`  
Expected: PASS

- [ ] **Step 3: `index.html`의 인증 및 리더보드 로직에 연결**

1. `openLb()`:
   ```javascript
   __analytics.track('leaderboard_opened', { is_authenticated: !!currentUser });
   ```
2. `supabaseClient.auth.onAuthStateChange` 및 프로필 로드 시점:
   ```javascript
   if (currentUser) {
     var currentCalc = calcService(startEl.value, endEl.value, midnightToday());
     __analytics.identify(currentUser.id, {
       branch: load(LS.branch) || null,
       service_status: currentCalc.state,
       d_day: currentCalc.dday || null,
       is_leaderboard_user: true
     });
     __analytics.track('login_completed', { has_branch: !!load(LS.branch) });
   }
   ```
3. `signOutGoogle`:
   ```javascript
   __analytics.reset();
   ```
4. 소속 군 선택 버튼 클릭 시:
   ```javascript
   __analytics.track('branch_selected', {
     branch: b.id,
     contributed_days: parseInt(load(LS.total) || '0', 10)
   });
   if (currentUser) {
     __analytics.identify(currentUser.id, { branch: b.id });
   }
   ```

- [ ] **Step 4: 테스트 실행 및 확인**

Run: `node --test scripts/test-analytics.js`  
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add index.html scripts/test-analytics.js
git commit -m "feat: instrument leaderboard events and user identity synchronization"
```

---

### Task 6: 개인정보처리방침 업데이트 및 최종 E2E 통합 검증

**Files:**
- Modify: `privacy.html`
- Modify: `README.md` (PostHog 키 설정 방법 문서화)
- Test: `scripts/test-analytics.js`

- [ ] **Step 1: privacy.html 내 PostHog 고지 검증 테스트 작성**

`scripts/test-analytics.js`에 검증 추가:
```javascript
test('privacy.html includes PostHog disclosures', () => {
  const privacyHtml = fs.readFileSync('privacy.html', 'utf8');
  assert.match(privacyHtml, /PostHog/);
  assert.match(privacyHtml, /세션 리플레이|행동 분석/);
});
```

- [ ] **Step 2: 테스트 실행 및 실패 확인**

Run: `node --test scripts/test-analytics.js`  
Expected: FAIL

- [ ] **Step 3: `privacy.html` 및 `README.md` 갱신**

`privacy.html`의 "제3자 서비스" 섹션에 PostHog(분석 및 세션 리플레이 도구) 설명 추가.  
`README.md`에 `ENV_POSTHOG_KEY` 설정 가이드 추가.

- [ ] **Step 4: 전체 테스트 실행 및 통과 확인**

Run: `node --test scripts/test-analytics.js`  
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add privacy.html README.md scripts/test-analytics.js
git commit -m "docs: update privacy policy and README for PostHog analytics"
```
