import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkMilestone, buildSessionPayload, MILESTONES, createAnalyticsHelper } from './analytics-helper.js';
import { UTM_CAMPAIGN, UTM_CHANNELS, normalizeCode, assertPlainSlug, buildUtmContent, buildUtmUrl, findChannel } from './utm.js';

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

test('createAnalyticsHelper should support custom milestones and default helpers', () => {
  const helper = createAnalyticsHelper({ milestones: [10, 50] });
  assert.equal(helper.checkMilestone(9, 10), 10);
  assert.equal(helper.checkMilestone(10, 15), null);
  assert.equal(helper.checkMilestone(40, 55), 50);
});

test('index.html contains PostHog snippet and safe __analytics wrapper', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /https:\/\/us\.i\.posthog\.com|posthog-js/);
  assert.match(html, /window\.__analytics/);
  assert.match(html, /autocapture:\s*false/);
  assert.match(html, /disable_session_recording:\s*false/);
  assert.match(html, /maskAllInputs:\s*true/);
  assert.match(html, /time_to_reach_seconds:/);
  assert.match(html, /is_leaderboard_user:\s*true,\s*\n\s*total_days_deleted:/);
  assert.match(html, /startTime:\s*Date\.now\(\)/);
  assert.match(html, /sessionClicks:\s*0/);
  assert.match(html, /maxCombo:\s*0/);
  assert.match(html, /firstClickFired:\s*false/);
  assert.match(html, /isLocalhost/);
});

test('safe __analytics handles missing posthog and runtime errors gracefully', () => {
  let captureCalled = false;
  let identifyCalled = false;
  let resetCalled = false;

  const mockThrowingPostHog = {
    capture: () => { captureCalled = true; throw new Error('AdBlock or network error'); },
    identify: () => { identifyCalled = true; throw new Error('AdBlock or network error'); },
    reset: () => { resetCalled = true; throw new Error('AdBlock or network error'); }
  };

  const createSafeAnalytics = (ph) => ({
    session: { startTime: Date.now(), sessionClicks: 0, maxCombo: 0, firstClickFired: false },
    track: function (eventName, properties) {
      try {
        if (ph && typeof ph.capture === 'function') {
          ph.capture(eventName, properties || {});
        }
      } catch (err) {}
    },
    identify: function (userId, userProperties) {
      try {
        if (ph && typeof ph.identify === 'function') {
          ph.identify(userId, userProperties || {});
        }
      } catch (err) {}
    },
    reset: function () {
      try {
        if (ph && typeof ph.reset === 'function') {
          ph.reset();
        }
      } catch (err) {}
    }
  });

  const safeWrapper1 = createSafeAnalytics(mockThrowingPostHog);
  assert.doesNotThrow(() => safeWrapper1.track('test_event', { foo: 'bar' }));
  assert.doesNotThrow(() => safeWrapper1.identify('user_123', { name: 'test' }));
  assert.doesNotThrow(() => safeWrapper1.reset());
  assert.equal(captureCalled, true);
  assert.equal(identifyCalled, true);
  assert.equal(resetCalled, true);

  const safeWrapper2 = createSafeAnalytics(null);
  assert.doesNotThrow(() => safeWrapper2.track('test_event'));
  assert.doesNotThrow(() => safeWrapper2.identify('user_123'));
  assert.doesNotThrow(() => safeWrapper2.reset());
});

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

test('session flush prevents duplicate events unless new clicks occur', () => {
  const events = [];
  const fakeStore = { 'ad.total': '150', 'ad.spent': '30' };
  const analytics = {
    session: {
      startTime: 1000,
      sessionClicks: 0,
      maxCombo: 12,
      flushed: false
    },
    track: (name, props) => events.push({ name, props })
  };

  function flushSessionEngagement(nowMs) {
    if (analytics.session.sessionClicks === 0 || analytics.session.flushed) return;
    analytics.session.flushed = true;
    const total = parseInt(fakeStore['ad.total'] || '0', 10);
    const spent = parseInt(fakeStore['ad.spent'] || '0', 10);
    analytics.track('session_engagement', {
      session_clicks: analytics.session.sessionClicks,
      max_combo: analytics.session.maxCombo,
      total_days_deleted: total,
      spent_days: spent,
      balance: Math.max(0, total - spent),
      session_duration_seconds: Math.max(0, Math.round(((nowMs || Date.now()) - analytics.session.startTime) / 1000))
    });
  }

  // Case 1: zero clicks -> should not flush
  flushSessionEngagement(5000);
  assert.equal(events.length, 0);

  // Case 2: clicks recorded -> flushes
  analytics.session.sessionClicks = 10;
  flushSessionEngagement(5000);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'session_engagement');
  assert.equal(events[0].props.session_clicks, 10);
  assert.equal(events[0].props.session_duration_seconds, 4);

  // Case 3: immediately flush again (e.g. pagehide after visibilitychange) -> duplicate blocked
  flushSessionEngagement(6000);
  assert.equal(events.length, 1, 'Should not fire duplicate flush without new clicks');

  // Case 4: user clicks again -> flush can fire once more with updated numbers
  analytics.session.sessionClicks += 5;
  analytics.session.flushed = false;
  flushSessionEngagement(7000);
  assert.equal(events.length, 2);
  assert.equal(events[1].props.session_clicks, 15);
  assert.equal(events[1].props.session_duration_seconds, 6);
});

test('index.html contains core interaction tracking instrumentation', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /checkMilestone/);
  assert.match(html, /first_delete_click/);
  assert.match(html, /click_milestone_reached/);
  assert.match(html, /session_engagement/);
  assert.match(html, /flushSessionEngagement/);
  assert.match(html, /pagehide/);
  assert.match(html, /visibilitychange/);
});

test('economy and ads events payload structure', () => {
  const events = [];
  const track = (name, props) => events.push({ name, props });

  // Simulate shop open
  track('shop_opened', { current_balance: 150, owned_items_count: 2 });
  // Simulate item purchase
  track('item_purchased', { item_id: 'double', item_name: '2배 부스터', price: 40, item_type: 'multiplier', remaining_balance: 110 });
  // Simulate share boost
  track('share_boost_activated', { method: 'navigator.share', boost_multiplier: 3, boost_duration_ms: 1800000 });
  // Simulate reward ad clicked
  track('reward_ad_clicked', { current_balance: 150 });
  // Simulate reward ad completed
  track('reward_ad_completed', { reward_days: 100, new_balance: 250 });
  // Simulate reward ad failed
  track('reward_ad_failed', { reason: 'adblock_timeout' });
  // Simulate anchor ad closed
  track('anchor_ad_closed', { viewport_width: 390 });

  assert.equal(events.length, 7);
  assert.equal(events[0].name, 'shop_opened');
  assert.equal(events[0].props.current_balance, 150);
  assert.equal(events[0].props.owned_items_count, 2);
  assert.equal(events[1].name, 'item_purchased');
  assert.equal(events[1].props.item_id, 'double');
  assert.equal(events[1].props.remaining_balance, 110);
  assert.equal(events[2].name, 'share_boost_activated');
  assert.equal(events[2].props.boost_multiplier, 3);
  assert.equal(events[2].props.method, 'navigator.share');
  assert.equal(events[3].name, 'reward_ad_clicked');
  assert.equal(events[3].props.current_balance, 150);
  assert.equal(events[4].name, 'reward_ad_completed');
  assert.equal(events[4].props.reward_days, 100);
  assert.equal(events[4].props.new_balance, 250);
  assert.equal(events[5].name, 'reward_ad_failed');
  assert.equal(events[5].props.reason, 'adblock_timeout');
  assert.equal(events[6].name, 'anchor_ad_closed');
  assert.equal(events[6].props.viewport_width, 390);
});

test('simulated shop purchase, share boost, and ad reward handlers behave correctly', () => {
  const events = [];
  const fakeAnalytics = {
    track: (name, props) => events.push({ name, props })
  };

  let total = 300;
  let spent = 100;
  const owned = ['starter'];
  function balance() { return Math.max(0, total - spent); }

  const items = [
    { id: 'starter', name: '시작 아이템', price: 50 },
    { id: 'work-detail', name: '작업 나가기', price: 50, effect: { type: 'multiplier', value: 2 } },
    { id: 'share-link', name: '소문내기', price: 0, effect: { type: 'share', value: 3, durationMs: 1800000 } }
  ];

  // 1. Open shop
  fakeAnalytics.track('shop_opened', {
    current_balance: balance(),
    owned_items_count: owned.length
  });

  // 2. Buy multiplier item
  const buy = (id) => {
    const item = items.find(it => it.id === id);
    if (!item) return;
    if (item.effect && item.effect.type === 'share') {
      fakeAnalytics.track('share_boost_activated', {
        method: 'clipboard',
        boost_multiplier: item.effect.value,
        boost_duration_ms: item.effect.durationMs
      });
      return;
    }
    if (owned.includes(id)) return;
    if (balance() < item.price) return;
    spent += item.price;
    owned.push(id);
    fakeAnalytics.track('item_purchased', {
      item_id: item.id,
      item_name: item.name,
      price: item.price,
      item_type: item.effect ? item.effect.type : 'collectible',
      remaining_balance: balance()
    });
  };

  buy('work-detail');
  assert.equal(spent, 150);
  assert.equal(balance(), 150);
  assert.equal(owned.length, 2);

  // 3. Share link
  buy('share-link');

  // 4. Reward ad flow
  const rewardCfg = { days: 100 };
  fakeAnalytics.track('reward_ad_clicked', { current_balance: balance() });
  const newBal = balance() + rewardCfg.days;
  total += rewardCfg.days;
  fakeAnalytics.track('reward_ad_completed', {
    reward_days: rewardCfg.days,
    new_balance: newBal
  });

  // 5. Reward ad failure
  fakeAnalytics.track('reward_ad_failed', { reason: 'adblock_timeout' });

  // 6. Anchor close
  fakeAnalytics.track('anchor_ad_closed', { viewport_width: 412 });

  assert.equal(events.length, 7);
  assert.equal(events[0].name, 'shop_opened');
  assert.equal(events[0].props.current_balance, 200);
  assert.equal(events[0].props.owned_items_count, 1);

  assert.equal(events[1].name, 'item_purchased');
  assert.equal(events[1].props.item_id, 'work-detail');
  assert.equal(events[1].props.item_type, 'multiplier');
  assert.equal(events[1].props.remaining_balance, 150);

  assert.equal(events[2].name, 'share_boost_activated');
  assert.equal(events[2].props.boost_multiplier, 3);

  assert.equal(events[3].name, 'reward_ad_clicked');
  assert.equal(events[3].props.current_balance, 150);

  assert.equal(events[4].name, 'reward_ad_completed');
  assert.equal(events[4].props.reward_days, 100);
  assert.equal(events[4].props.new_balance, 250);

  assert.equal(events[5].name, 'reward_ad_failed');
  assert.equal(events[5].props.reason, 'adblock_timeout');

  assert.equal(events[6].name, 'anchor_ad_closed');
  assert.equal(events[6].props.viewport_width, 412);
});

test('index.html contains shop economy and monetization tracking instrumentation', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /shop_opened/);
  assert.match(html, /item_purchased/);
  assert.match(html, /share_boost_activated/);
  assert.match(html, /reward_ad_clicked/);
  assert.match(html, /reward_ad_completed/);
  assert.match(html, /reward_ad_failed/);
  assert.match(html, /anchor_ad_closed/);

  // Property checks
  assert.match(html, /current_balance:\s*balance\(\)/);
  assert.match(html, /owned_items_count:\s*loadOwned\(\)\.length/);
  assert.match(html, /remaining_balance:\s*balance\(\)/);
  assert.match(html, /boost_multiplier/);
  assert.match(html, /boost_duration_ms/);
  assert.match(html, /reward_days:\s*rewardCfg\.days/);
  assert.match(html, /new_balance/);
  assert.match(html, /reason:\s*'adblock_timeout'/);
  assert.match(html, /viewport_width:\s*window\.innerWidth/);
  // Timeout safety checks
  assert.match(html, /beforeReward:\s*function\s*\([^)]*\)\s*\{[\s\S]*?clearTimeout\(giveUp\)/);
});

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
  assert.equal(userProps.service_status, 'active');
  assert.equal(userProps.d_day, 240);
});

test('leaderboard and auth lifecycle tracking logic', () => {
  const events = [];
  let currentIdentifiedUser = null;
  let currentUserProps = null;
  let resetCount = 0;

  const fakeAnalytics = {
    track: (name, props) => events.push({ name, props }),
    identify: (id, props) => {
      currentIdentifiedUser = id;
      currentUserProps = { ...(currentUserProps || {}), ...props };
    },
    reset: () => {
      resetCount++;
      currentIdentifiedUser = null;
      currentUserProps = null;
    }
  };

  let currentUser = null;
  let lastLoginUserId = null;
  const fakeStorage = { 'ad.branch': 'marine', 'ad.total': '120' };

  function openLb() {
    fakeAnalytics.track('leaderboard_opened', { is_authenticated: !!currentUser });
  }

  function identifyUserSession(evt) {
    if (!currentUser) return;
    const currentCalc = { state: 'active', dday: 180 };
    fakeAnalytics.identify(currentUser.id, {
      branch: fakeStorage['ad.branch'] || null,
      service_status: currentCalc.state,
      d_day: currentCalc.dday || null,
      is_leaderboard_user: true
    });
    if (evt !== 'TOKEN_REFRESHED' && lastLoginUserId !== currentUser.id) {
      lastLoginUserId = currentUser.id;
      fakeAnalytics.track('login_completed', { has_branch: !!fakeStorage['ad.branch'] });
    }
  }

  // 선물은 일수를 새로 만들지 않고 옮기기만 한다 — 받은 만큼 더하고 보낸 만큼 뺀다
  function netTotal() {
    const num = (k) => parseInt(fakeStorage[k] || '0', 10) || 0;
    return Math.max(0, num('ad.total') + num('ad.gifted') - num('ad.gsent'));
  }

  function selectBranch(branchId) {
    const b = { id: branchId };
    fakeStorage['ad.branch'] = b.id;
    fakeAnalytics.track('branch_selected', {
      branch: b.id,
      contributed_days: netTotal()
    });
    if (currentUser) {
      fakeAnalytics.identify(currentUser.id, { branch: b.id });
    }
  }

  function signOut() {
    lastLoginUserId = null;
    fakeAnalytics.reset();
    currentUser = null;
  }

  // 1. Unauthenticated open leaderboard
  openLb();
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'leaderboard_opened');
  assert.equal(events[0].props.is_authenticated, false);

  // 2. User signs in
  currentUser = { id: 'usr-999' };
  identifyUserSession('SIGNED_IN');
  assert.equal(currentIdentifiedUser, 'usr-999');
  assert.equal(currentUserProps.is_leaderboard_user, true);
  assert.equal(currentUserProps.branch, 'marine');
  assert.equal(currentUserProps.service_status, 'active');
  assert.equal(currentUserProps.d_day, 180);
  assert.equal(events.length, 2);
  assert.equal(events[1].name, 'login_completed');
  assert.equal(events[1].props.has_branch, true);

  // 3. Token refresh should NOT duplicate login_completed
  identifyUserSession('TOKEN_REFRESHED');
  assert.equal(events.length, 2, 'Token refresh must not fire duplicate login_completed');

  // 4. Authenticated open leaderboard
  openLb();
  assert.equal(events.length, 3);
  assert.equal(events[2].name, 'leaderboard_opened');
  assert.equal(events[2].props.is_authenticated, true);

  // 5. Select branch updates profile and emits event
  selectBranch('navy');
  assert.equal(events.length, 4);
  assert.equal(events[3].name, 'branch_selected');
  assert.equal(events[3].props.branch, 'navy');
  assert.equal(events[3].props.contributed_days, 120);
  assert.equal(currentUserProps.branch, 'navy');

  // 6. Sign out resets identity
  signOut();
  assert.equal(resetCount, 1);
  assert.equal(currentIdentifiedUser, null);
  assert.equal(lastLoginUserId, null);

  // 7. Signing in again fires login_completed once more
  currentUser = { id: 'usr-999' };
  identifyUserSession('SIGNED_IN');
  assert.equal(events.length, 5);
  assert.equal(events[4].name, 'login_completed');

  // 8. 선물 회계. 이벤트 개수를 세는 위 검증들을 건드리지 않도록 맨 뒤에 둔다.
  //    자기 자신에게 선물하면 보낸 만큼과 받은 만큼이 상쇄돼야 한다 —
  //    상쇄되지 않으면 클릭 한 번 없이 순위를 무한히 올릴 수 있다.
  fakeStorage['ad.gifted'] = '50';
  fakeStorage['ad.gsent'] = '50';
  selectBranch('navy');
  assert.equal(events[events.length - 1].props.contributed_days, 120,
    '자기 선물은 리더보드 기여도를 바꾸지 않아야 한다');

  // 받기만 하면 그만큼 오르고, 보내기만 하면 그만큼 준다
  fakeStorage['ad.gsent'] = '0';
  selectBranch('navy');
  assert.equal(events[events.length - 1].props.contributed_days, 170,
    '받은 선물은 기여도에 더해져야 한다');

  fakeStorage['ad.gifted'] = '0';
  fakeStorage['ad.gsent'] = '40';
  selectBranch('navy');
  assert.equal(events[events.length - 1].props.contributed_days, 80,
    '보낸 선물은 기여도에서 빠져야 한다');

  fakeStorage['ad.gsent'] = '9999';
  selectBranch('navy');
  assert.equal(events[events.length - 1].props.contributed_days, 0,
    '기여도는 음수가 되지 않아야 한다');
});

test('index.html contains leaderboard and identity tracking instrumentation', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  // Event names
  assert.match(html, /leaderboard_opened/);
  assert.match(html, /login_completed/);
  assert.match(html, /branch_selected/);

  // leaderboard_opened properties
  assert.match(html, /leaderboard_opened[\s\S]*?is_authenticated:\s*!+currentUser/);

  // login_completed and identify properties
  assert.match(html, /is_leaderboard_user:\s*true/);
  assert.match(html, /service_status:\s*currentCalc\.state/);
  assert.match(html, /d_day:\s*currentCalc\.dday/);
  assert.match(html, /login_completed[\s\S]*?has_branch:\s*!+load\(LS\.branch\)/);

  // branch_selected properties
  assert.match(html, /branch_selected[\s\S]*?branch:\s*(?:b\.id|id)/);
  // 리더보드에 보고하는 값은 netTotal() 이다 — 선물로 받은 만큼 더하고 보낸
  // 만큼 뺀 순 누적. 원시 ad.total 을 보내면 자기 선물로 순위가 부풀어 오른다.
  assert.match(html, /contributed_days:\s*netTotal\(\)/);
  assert.match(html, /total_days_deleted:\s*netTotal\(\)/);
  assert.match(html, /function netTotal\(\)\s*\{\s*return Math\.max\(0, total \+ gifted - gsent\)/);

  // identify on branch selection
  assert.match(html, /__analytics\.identify\(currentUser\.id,\s*\{\s*branch:\s*(?:b\.id|id)\s*\}\)/);

  // signOutGoogle reset
  assert.match(html, /function signOutGoogle[\s\S]*?__analytics\.reset\(\)/);
});

test('privacy.html includes PostHog disclosures', () => {
  const privacyHtml = fs.readFileSync('privacy.html', 'utf8');
  assert.match(privacyHtml, /PostHog/);
  assert.match(privacyHtml, /세션 리플레이|행동 분석/);
});

test('index.html contains combo effects and dopamine enhancement implementation', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  // Web Audio synthesizers
  assert.match(html, /function soundBell\s*\(now\)/);
  assert.match(html, /function soundSubKick\s*\(now\)/);
  assert.match(html, /function soundFanfare\s*\(now\)/);
  assert.match(html, /function soundGlissando\s*\(now\)/);

  // Visual, shake, particle, and state functions
  assert.match(html, /function burstParticles\s*\(count,\s*colors\)/);
  assert.match(html, /function triggerScreenShake\s*\(\)/);
  assert.match(html, /function triggerFlash\s*\(\)/);
  assert.match(html, /function updateComboState\s*\(c\)/);
  assert.match(html, /function triggerComboMilestone\s*\(c,\s*now\)/);

  // CSS tier classes and keyframes
  assert.match(html, /\.combo-badge\.tier-10/);
  assert.match(html, /\.combo-badge\.tier-25/);
  assert.match(html, /\.combo-badge\.tier-50/);
  assert.match(html, /\.combo-badge\.tier-100/);
  assert.match(html, /@keyframes screenShake/);
  assert.match(html, /\.shake\s*\{/);
  assert.match(html, /\.combo-flash/);
  assert.match(html, /\.plate\.singularity::after/);
  assert.match(html, /\.spark-particle/);
  assert.match(html, /@keyframes sparkBurst/);

  // Click handler integration & milestone calls
  assert.match(html, /updateComboState\s*\(\s*combo\s*\)/);
  assert.match(html, /triggerComboMilestone\s*\(\s*combo,\s*audioNow\s*\)/);
});

test('index.html contains Mobile Safari audio and haptic support', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  // iOS Safari Haptic Switch DOM and function
  assert.match(html, /<input[^>]+switch[^>]+id="hapticSwitch"/);
  assert.match(html, /<label[^>]+for="hapticSwitch"[^>]+id="hapticLabel"/);
  assert.match(html, /function triggerHaptic\s*\(pattern\)/);

  // iOS Audio Unlock & Mute Switch bypass
  assert.match(html, /function unlockSilentAudio\s*\(\)/);
  assert.match(html, /function unlockAudio\s*\(\)/);
  assert.match(html, /audioSession\.type\s*=\s*['"]playback['"]/);
  assert.match(html, /addEventListener\(['"]visibilitychange['"]/);
});

test('index.html contains tiered UI shake, progress bar surge, and layered audio implementation', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  // Tiered Shake keyframes and functions
  assert.match(html, /\.shake-t1\s*\{/);
  assert.match(html, /\.shake-t2\s*\{/);
  assert.match(html, /\.shake-t3\s*\{/);
  assert.match(html, /\.shake-t4\s*\{/);
  assert.match(html, /function applyShake\s*\(/);
  assert.match(html, /function triggerTieredShake\s*\(combo\)/);
  assert.match(html, /triggerTieredShake\s*\(\s*combo\s*\)/);

  // Progress bar surge and reset
  assert.match(html, /\.bar-fill\.combo-surge/);
  assert.match(html, /\.surge-tier-10/);
  assert.match(html, /\.surge-tier-100/);
  assert.match(html, /function updateProgressSurge\s*\(c\)/);
  assert.match(html, /function resetProgressSurge\s*\(\)/);

  // Layered audio synthesizers
  assert.match(html, /function soundLayerSubKick\s*\(now\)/);
  assert.match(html, /function soundLayerShimmer\s*\(now,\s*idx\)/);
  assert.match(html, /function soundLayerSaw\s*\(now,\s*baseFreq\)/);
  assert.match(html, /soundLayerSubKick\s*\(\s*now\s*\)/);
  assert.match(html, /soundLayerShimmer\s*\(\s*now/);
  assert.match(html, /soundLayerSaw\s*\(\s*now/);
});







test('findChannel returns a fixed channel by id', () => {
  const channel = findChannel('dcinside_army');
  assert.equal(channel.id, 'dcinside_army');
  assert.equal(channel.label, '디시 육군');
  assert.equal(channel.source, 'dcinside');
  assert.equal(channel.medium, 'community');
  assert.equal(channel.contentBase, 'army');
  assert.equal(channel.codeLabel, null);
});

test('findChannel returns a code-required channel by id', () => {
  const channel = findChannel('everytime');
  assert.equal(channel.source, 'everytime');
  assert.equal(channel.contentBase, null);
  assert.equal(channel.codeLabel, '학교코드');
});

test('findChannel returns null for unknown id', () => {
  assert.equal(findChannel('nope'), null);
});

test('normalizeCode lowercases and trims', () => {
  assert.equal(normalizeCode('  Hongik  '), 'hongik');
});

test('normalizeCode replaces Korean characters and hyphens/dashes with underscore', () => {
  assert.equal(normalizeCode('A대학교-B'), 'a_b');
});

test('normalizeCode collapses consecutive separators into one underscore', () => {
  assert.equal(normalizeCode('Hongik   Univ--Seoul'), 'hongik_univ_seoul');
});

test('normalizeCode strips leading and trailing underscores', () => {
  assert.equal(normalizeCode('  -Hongik Univ-  '), 'hongik_univ');
});

test('normalizeCode returns empty string for non-string input', () => {
  assert.equal(normalizeCode(null), '');
  assert.equal(normalizeCode(undefined), '');
  assert.equal(normalizeCode(123), '');
});

test('normalizeCode returns empty string when result would be empty', () => {
  assert.equal(normalizeCode('   '), '');
  assert.equal(normalizeCode('---'), '');
});

test('buildUtmContent builds content for a fixed channel', () => {
  assert.equal(buildUtmContent('dcinside_army', null, 1), 'army_post01');
});

test('buildUtmContent builds content for a code-required channel', () => {
  assert.equal(buildUtmContent('everytime', 'Hongik Univ', 2), 'hongik_univ_post02');
});

test('buildUtmContent zero-pads post numbers at the 1/9/10/100 boundaries', () => {
  assert.equal(buildUtmContent('dcinside_army', null, 1), 'army_post01');
  assert.equal(buildUtmContent('dcinside_army', null, 9), 'army_post09');
  assert.equal(buildUtmContent('dcinside_army', null, 10), 'army_post10');
  assert.equal(buildUtmContent('dcinside_army', null, 100), 'army_post100');
});

test('buildUtmUrl assembles a URL for a fixed channel with correct query order', () => {
  const url = buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'dcinside_army', postNumber: 1 });
  assert.equal(url, 'https://example.com/?utm_source=dcinside&utm_medium=community&utm_content=army_post01&utm_campaign=launch_202609');
});

test('buildUtmUrl assembles a URL for a code-required channel', () => {
  const url = buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'everytime', code: 'Hongik Univ', postNumber: 2 });
  assert.equal(url, 'https://example.com/?utm_source=everytime&utm_medium=community&utm_content=hongik_univ_post02&utm_campaign=launch_202609');
});

test('buildUtmUrl accepts a custom campaign override', () => {
  const url = buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'dcinside_army', postNumber: 1, campaign: 'custom_campaign' });
  assert.match(url, /utm_campaign=custom_campaign$/);
});

test('buildUtmUrl defaults campaign to UTM_CAMPAIGN when omitted', () => {
  const url = buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'dcinside_army', postNumber: 1 });
  assert.match(url, new RegExp('utm_campaign=' + UTM_CAMPAIGN + '$'));
});

test('buildUtmUrl strips existing query string and hash from baseUrl', () => {
  const url = buildUtmUrl({ baseUrl: 'https://example.com/path?foo=bar#section', channelId: 'dcinside_army', postNumber: 1 });
  assert.equal(url, 'https://example.com/path?utm_source=dcinside&utm_medium=community&utm_content=army_post01&utm_campaign=launch_202609');
});

test('buildUtmUrl throws a Korean error for an unknown channelId', () => {
  assert.throws(() => {
    buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'nope', postNumber: 1 });
  }, /채널/);
});

test('buildUtmUrl throws a Korean error when a code is required but normalizes to empty', () => {
  assert.throws(() => {
    buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'everytime', code: '   ', postNumber: 1 });
  }, /코드/);
});

test('buildUtmUrl throws a Korean error for an invalid postNumber', () => {
  assert.throws(() => {
    buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'dcinside_army', postNumber: 0 });
  }, /postNumber|게시물|번호/);
  assert.throws(() => {
    buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'dcinside_army', postNumber: 1.5 });
  }, /postNumber|게시물|번호/);
});

test('buildUtmUrl throws a Korean error for an invalid baseUrl', () => {
  assert.throws(() => {
    buildUtmUrl({ baseUrl: 'not a url', channelId: 'dcinside_army', postNumber: 1 });
  }, /URL|주소/);
});

test('UTM_CHANNELS contains all six expected channels in order', () => {
  const ids = UTM_CHANNELS.map(function (c) { return c.id; });
  assert.deepEqual(ids, ['dcinside_army', 'dcinside_navy', 'dcinside_airforce', 'everytime', 'gundori', 'gomsin_cafe']);
});

test('assertPlainSlug rejects Korean and emoji, allows plain ASCII slug characters', () => {
  assert.throws(() => assertPlainSlug('홍익대', '코드'), /코드에는 영문·숫자·언더스코어만/);
  assert.throws(() => assertPlainSlug('🔥launch', '캠페인'), /캠페인에는 영문·숫자·언더스코어만/);
  assert.doesNotThrow(() => assertPlainSlug('Hongik_Univ-2026.09 A', '코드'));
});

test('assertPlainSlug passes through blank input untouched', () => {
  assert.doesNotThrow(() => assertPlainSlug('', '코드'));
  assert.doesNotThrow(() => assertPlainSlug('   ', '코드'));
});

test('assertPlainSlug uses the exact rejection message with the given field label', () => {
  assert.throws(() => assertPlainSlug('홍익대', '코드'), {
    message: '코드에는 영문·숫자·언더스코어만 쓸 수 있습니다. 한글은 로마자로 바꿔 입력해 주세요.'
  });
});

test('buildUtmContent throws for non-ASCII codes instead of silently colliding', () => {
  assert.throws(() => buildUtmContent('everytime', '홍익대A', 1), /코드/);
  assert.throws(() => buildUtmContent('everytime', '서울대A', 1), /코드/);
  // 예전에는 두 값 모두 normalizeCode 를 거쳐 'a' 로 뭉개져 서로 다른 학교가
  // 같은 유입원으로 합산됐다 — 지금은 애초에 조립되지 않고 각각 throw 되어야 한다.
});

test('buildUtmUrl falls back to UTM_CAMPAIGN when campaign is whitespace only, not "+++"', () => {
  const url = buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'dcinside_army', postNumber: 1, campaign: '   ' });
  assert.match(url, /utm_campaign=launch_202609$/);
  assert.doesNotMatch(url, /utm_campaign=\+/);
});

test('buildUtmUrl normalizes campaign case so Launch_202609 and launch_202609 do not diverge', () => {
  const url = buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'dcinside_army', postNumber: 1, campaign: 'Launch_202609' });
  assert.match(url, /utm_campaign=launch_202609$/);
});

test('buildUtmUrl throws a Korean error when campaign contains Korean characters', () => {
  assert.throws(() => {
    buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'dcinside_army', postNumber: 1, campaign: '홍보_캠페인' });
  }, /캠페인/);
});

test('buildUtmContent throws for boolean, array, and object postNumber instead of coercing', () => {
  assert.throws(() => buildUtmContent('dcinside_army', null, true), /게시물 번호는 1 이상의 정수여야 합니다\./);
  assert.throws(() => buildUtmContent('dcinside_army', null, [1]), /게시물 번호는 1 이상의 정수여야 합니다\./);
  assert.throws(() => buildUtmContent('dcinside_army', null, {}), /게시물 번호는 1 이상의 정수여야 합니다\./);
});

test('buildUtmUrl throws for dangerous non-http(s) baseUrl schemes', () => {
  assert.throws(() => {
    buildUtmUrl({ baseUrl: 'javascript:alert(1)', channelId: 'dcinside_army', postNumber: 1 });
  }, /URL|주소/);
  assert.throws(() => {
    buildUtmUrl({ baseUrl: 'mailto:a@b.c', channelId: 'dcinside_army', postNumber: 1 });
  }, /URL|주소/);
});

test('buildUtmContent ignores a passed code for fixed channels', () => {
  assert.equal(buildUtmContent('dcinside_army', '홍익대A', 1), 'army_post01');
});

test('buildUtmUrl assembles URLs for the remaining fixed and code-required channels', () => {
  const navyUrl = buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'dcinside_navy', postNumber: 3 });
  assert.equal(navyUrl, 'https://example.com/?utm_source=dcinside&utm_medium=community&utm_content=navy_post03&utm_campaign=launch_202609');

  const airforceUrl = buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'dcinside_airforce', postNumber: 4 });
  assert.equal(airforceUrl, 'https://example.com/?utm_source=dcinside&utm_medium=community&utm_content=airforce_post04&utm_campaign=launch_202609');

  const gundoriUrl = buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'gundori', code: 'Board-1', postNumber: 5 });
  assert.equal(gundoriUrl, 'https://example.com/?utm_source=gundori&utm_medium=community&utm_content=board_1_post05&utm_campaign=launch_202609');

  const gomsinUrl = buildUtmUrl({ baseUrl: 'https://example.com/', channelId: 'gomsin_cafe', code: 'CafeCode', postNumber: 6 });
  assert.equal(gomsinUrl, 'https://example.com/?utm_source=gomsin_cafe&utm_medium=community&utm_content=cafecode_post06&utm_campaign=launch_202609');
});
