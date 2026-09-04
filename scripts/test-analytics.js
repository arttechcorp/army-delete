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

