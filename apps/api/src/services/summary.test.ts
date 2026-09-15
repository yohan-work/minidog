import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SUMMARY_DEFAULTS } from '@minidog/types';
import { dueSummary, isValidTimeZone, localTime, summaryText } from './summary';

// 2026-09-14 is a Monday. 00:30 UTC is 09:30 in Seoul.
const MONDAY_0930_SEOUL = Date.UTC(2026, 8, 14, 0, 30);
const seoul = { ...SUMMARY_DEFAULTS, enabled: true, webhookUrl: 'https://ntfy.sh/x', hour: 9, timeZone: 'Asia/Seoul' };

test('local time follows the chosen zone', () => {
  assert.deepEqual(localTime(MONDAY_0930_SEOUL, 'Asia/Seoul'), { date: '2026-09-14', hour: 9, weekday: 'Mon' });
  assert.deepEqual(localTime(MONDAY_0930_SEOUL, 'UTC'), { date: '2026-09-14', hour: 0, weekday: 'Mon' });
  assert.equal(isValidTimeZone('Asia/Seoul'), true);
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
});

test('a summary is due once a day, from the chosen hour', () => {
  assert.deepEqual(dueSummary(seoul, null, MONDAY_0930_SEOUL), { date: '2026-09-14', days: 1 });
  assert.equal(dueSummary(seoul, '2026-09-14', MONDAY_0930_SEOUL), null);
  assert.equal(dueSummary({ ...seoul, hour: 10 }, null, MONDAY_0930_SEOUL), null);
  // Missed at 09:00 while asleep: still sent later that day.
  assert.deepEqual(dueSummary(seoul, '2026-09-13', MONDAY_0930_SEOUL + 8 * 3_600_000), { date: '2026-09-14', days: 1 });
  assert.deepEqual(dueSummary({ ...seoul, weekly: true }, null, MONDAY_0930_SEOUL), { date: '2026-09-14', days: 7 });
  assert.equal(dueSummary({ ...seoul, enabled: false }, null, MONDAY_0930_SEOUL), null);
  assert.equal(dueSummary({ ...seoul, webhookUrl: '' }, null, MONDAY_0930_SEOUL), null);
});

test('the text lists monitors, alerts and time not measured', () => {
  const text = summaryText({
    days: 1,
    now: MONDAY_0930_SEOUL,
    timeZone: 'Asia/Seoul',
    monitors: [
      { name: 'example.com', checks: 1440, failures: 0, avgLatencyMs: 281.4, p95LatencyMs: 410, sslExpiresAt: MONDAY_0930_SEOUL + 59.5 * 86_400_000 },
      { name: 'api', checks: 1440, failures: 1, avgLatencyMs: 1234, p95LatencyMs: null, sslExpiresAt: null },
      { name: 'new', checks: 0, failures: 0, avgLatencyMs: null, p95LatencyMs: null, sslExpiresAt: null },
      { name: 'once', checks: 1, failures: 0, avgLatencyMs: 90, p95LatencyMs: null, sslExpiresAt: null },
      { name: 'old-cert', checks: 2, failures: 2, avgLatencyMs: null, p95LatencyMs: null, sslExpiresAt: MONDAY_0930_SEOUL - 3 * 86_400_000 },
      { name: 'last-day', checks: 2, failures: 0, avgLatencyMs: null, p95LatencyMs: null, sslExpiresAt: MONDAY_0930_SEOUL + 5 * 3_600_000 },
    ],
    alertChanges: 3,
    criticalChanges: 1,
    gaps: [
      { from: 0, to: 110 * 60_000, reason: 'asleep' },
      { from: 200 * 60_000, to: 220 * 60_000, reason: 'stopped' },
    ],
  });
  assert.equal(
    text,
    [
      'minidog daily summary · Mon, Sep 14 (last 24 h)',
      '• example.com — 100% up (1,440 checks) · avg 281 ms · p95 410 ms · SSL 59 days',
      '• api — 99.9% up (1 of 1,440 failed) · avg 1.23 s',
      '• new — no checks',
      '• once — 100% up (1 check) · avg 90 ms',
      '• old-cert — 0.0% up (2 of 2 failed) · SSL EXPIRED',
      '• last-day — 100% up (2 checks) · SSL expires today',
      'Alerts: 3 state changes (1 into critical)',
      'Not measured: 2 h 10 min (asleep 1 h 50 min, stopped 20 min)',
    ].join('\n'),
  );
});

test('a quiet week reads briefly', () => {
  const text = summaryText({ days: 7, now: MONDAY_0930_SEOUL, timeZone: 'Asia/Seoul', monitors: [], alertChanges: 0, criticalChanges: 0, gaps: [] });
  assert.equal(text, 'minidog weekly summary · Mon, Sep 14 (last 7 days)\nNo synthetic monitors are running.\nAlerts: no state changes');
});
