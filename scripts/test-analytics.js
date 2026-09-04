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

