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
  const startTime = (session && session.startTime) ? session.startTime : (nowMs || Date.now());
  const durationSec = Math.max(0, Math.round(((nowMs || Date.now()) - startTime) / 1000));
  return {
    session_clicks: (session && session.sessionClicks) || 0,
    max_combo: (session && session.maxCombo) || 0,
    total_days_deleted: (session && session.total) || 0,
    spent_days: (session && session.spent) || 0,
    balance: (session && session.balance) || 0,
    session_duration_seconds: durationSec
  };
}

export function createAnalyticsHelper(config = {}) {
  const milestones = config.milestones || MILESTONES;
  return {
    milestones,
    checkMilestone: (prevTotal, newTotal) => {
      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i];
        if (prevTotal < m && newTotal >= m) {
          return m;
        }
      }
      return null;
    },
    buildSessionPayload: (session, nowMs) => buildSessionPayload(session, nowMs)
  };
}
