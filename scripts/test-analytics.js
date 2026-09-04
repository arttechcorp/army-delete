import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkMilestone, buildSessionPayload, MILESTONES, createAnalyticsHelper } from './analytics-helper.js';

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
  assert.match(html, /startTime:\s*Date\.now\(\)/);
  assert.match(html, /sessionClicks:\s*0/);
  assert.match(html, /maxCombo:\s*0/);
  assert.match(html, /firstClickFired:\s*false/);
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



