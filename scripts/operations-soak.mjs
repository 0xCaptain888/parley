import assert from 'node:assert/strict';

export function inspectOperationsSoak({ records, build, now = Math.floor(Date.now() / 1000),
  durationSeconds = 86400, maximumGapSeconds = 300 }) {
  assert.ok(build.chainId === 56 && /^0x[0-9a-f]{40}$/i.test(build.contract || '')
    && !/^0x0{40}$/i.test(build.contract), 'Final soak deployment required');
  assert.ok(Number.isSafeInteger(durationSeconds) && durationSeconds >= 3600, 'At least one hour required');
  assert.ok(Number.isSafeInteger(maximumGapSeconds) && maximumGapSeconds >= 120 && maximumGapSeconds <= 600);
  assert.ok(Array.isArray(records) && records.length <= 100000, 'Bounded operational records required');
  const checks = [], jobs = [];
  for (const job of ['resident', 'health', 'stats']) {
    const rows = records.filter(r => r.job === job);
    for (const r of rows) {
      assert.ok(r.chainId === build.chainId && r.contract?.toLowerCase() === build.contract.toLowerCase(),
        'Soak record deployment mismatch');
      assert.ok(Number.isSafeInteger(r.checkedAt) && r.checkedAt <= now && r.checkedAt > 0, 'Invalid soak record time');
      assert.ok(['passed', 'failed'].includes(r.status), 'Invalid soak status');
      assert.equal(r.automaticSigning, false, 'Unexpected signing-capable operational record');
    }
    rows.sort((a, b) => a.checkedAt - b.checkedAt);
    assert.equal(new Set(rows.map(r => r.checkedAt)).size, rows.length, 'Duplicate operational heartbeat');
    const window = rows.filter(r => r.checkedAt >= now - durationSeconds);
    const gap = job === 'stats' ? Math.max(360, maximumGapSeconds) : maximumGapSeconds;
    const points = [now - durationSeconds, ...window.map(r => r.checkedAt), now];
    const largestGap = Math.max(...points.slice(1).map((n, i) => n - points[i]));
    const healthy = window.every(r => r.status === 'passed'
      && (job !== 'health' || (r.health?.status === 'healthy' && r.alert?.status !== 'delivery-failed')));
    const complete = window.length > 0 && largestGap <= gap && rows[0].checkedAt <= now - durationSeconds;
    jobs.push({ job, recordsInWindow: window.length, largestGapSeconds: largestGap, allowedGapSeconds: gap,
      healthy, continuousWindowRecorded: complete });
    checks.push({ code: `${job.toUpperCase()}_WINDOW`, status: healthy && complete ? 'passed' : 'pending-or-failed' });
  }
  return { schemaVersion: 1, status: checks.every(c => c.status === 'passed') ? 'local-window-recorded-needs-review' : 'incomplete',
    chainId: build.chainId, contract: build.contract, windowStart: now - durationSeconds, windowEnd: now,
    durationSeconds, checks, jobs, independentUptimeVerified: false, walletAccess: false, productionRelease: false };
}
