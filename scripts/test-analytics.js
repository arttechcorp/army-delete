import test from 'node:test';
import assert from 'node:assert/strict';
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
