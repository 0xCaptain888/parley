import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const localEnv = (source = process.env) => {
  const env = { ...source, PARLEY_LONG_FUZZ: '0' };
  for (const name of ['FORK_RPC', 'FORK_BLOCK', 'DEPLOYER_KEY']) delete env[name];
  return env;
};

export function sourceSnapshot(root) {
  const files = [
    'package.json', 'package-lock.json', 'contracts/package.json', 'contracts/package-lock.json',
    'contracts/hardhat.config.js', 'contracts/.solcover.js', '.solhint.json',
    'config/build.json', 'config/source-baseline.json', 'config/deployment-intent.example.json',
    'config/operations.example.json', 'config/submission.example.json', 'skill-template.md',
    'docs/reports/registry-sourcify-2026-11-23.json', 'docs/reports/registry-rpc-2026-11-23.json',
    'helper/build.mjs', 'web/site/index.html', 'web/site/404.html', 'web/site/style.css',
    'web/site/_headers', 'web/site/_redirects',
  ];
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile() && (/\.(sol|[cm]?js|json)$/.test(name)
        || (name.startsWith('operations/') && /\.(sh|service|timer|md)$/.test(name)))) files.push(name);
      else if (entry.isSymbolicLink()) throw new Error(`Symlink in verification inputs: ${name}`);
    }
  }
  for (const dir of ['contracts/contracts', 'contracts/test', 'contracts/helper', 'contracts/scripts', 'helper/src', 'helper/test',
    'scripts', 'resident', 'web/stats', 'web/site/src', 'operations']) walk(dir);
  const hashes = Object.fromEntries([...new Set(files)].sort().map(name =>
    [name, sha256(fs.readFileSync(path.join(root, name)))]));
  return { sha256: sha256(JSON.stringify(hashes)), files: hashes };
}

export function checkBaseline(root, baseline, zip) {
  assert.equal(baseline.version, 1);
  assert.equal(baseline.entries.length, 3);
  return baseline.entries.map(entry => {
    const bytes = fs.readFileSync(path.join(root, entry.file));
    const hash = sha256(bytes);
    assert.equal(hash, entry.currentSha256 || entry.referenceSha256,
      `Unrecorded source change: ${entry.file}`);
    if (zip) {
      const reference = execFileSync('unzip', ['-p', path.resolve(zip), `parley-reference/${entry.entry}`]);
      assert.ok(reference.length, `Empty reference entry: ${entry.entry}`);
      assert.equal(sha256(reference), entry.referenceSha256, `Reference archive mismatch: ${entry.entry}`);
    }
    const modified = hash !== entry.referenceSha256;
    if (modified) {
      assert.ok(entry.change && entry.description && entry.documentation && entry.independentReview);
      assert.ok(fs.existsSync(path.join(root, entry.documentation)), 'Source-change documentation is missing');
    }
    return {
      name: `${modified ? 'documented-change' : 'unchanged'}:${entry.entry}`,
      status: 'passed', file: entry.file, sha256: hash, referenceSha256: entry.referenceSha256,
      ...(modified ? { change: entry.change, independentReview: entry.independentReview } : {}),
    };
  });
}

export function validateScan(scan, metadata, snapshot, raw) {
  assert.equal(scan.success, true, 'Static analysis did not complete');
  assert.ok(Array.isArray(scan.results?.detectors), 'Missing detector results');
  assert.equal(metadata.status, 'completed');
  assert.equal(metadata.snapshotSha256, snapshot.sha256, 'Static scan does not match current sources');
  assert.equal(metadata.reportSha256, sha256(raw), 'Static scan report integrity mismatch');
  assert.ok(new Set([0, 255]).has(metadata.exit), 'Static analyzer process failed');
}

export function validateAuditBinding(binding, audit, snapshot, raw, context) {
  assert.equal(binding.snapshotSha256, snapshot.sha256, 'Audit binding does not match current sources');
  assert.equal(binding.reportSha256, sha256(raw), 'Independent audit report integrity mismatch');
  assert.equal(audit.independentAudit, 'completed', 'Independent audit is not completed');
  assert.equal(audit.snapshotSha256, snapshot.sha256, 'Independent audit covers different inputs');
  assert.equal(audit.sourceHash, snapshot.files['contracts/contracts/Parley.sol'],
    'Independent audit covers different contract source');
  assert.ok(audit.completedAt && Number.isFinite(Date.parse(audit.completedAt)));
  assert.ok(Array.isArray(audit.reviewers) && audit.reviewers.length > 0
    && audit.reviewers.every(r => typeof r === 'string' && r.trim())
    && new Set(audit.reviewers).size === audit.reviewers.length,
  'Independent reviewer identities are required');
  assert.equal(audit.schemaVersion, 2, 'A per-finding audit (schema 2) is required');
  assert.equal(audit.independenceDeclared, true, 'Independent review declaration is required');
  assert.equal(audit.releaseDecision, 'approve', 'Independent release approval is required');
  assert.deepEqual(audit.unresolvedIssues, [], 'Unresolved audit issues block release');
  assert.ok(context?.scan && context.scanMetadata && context.scanRaw && context.compilerBuildSha256
    && context.verificationReportSha256 && context.readEvidence, 'Current audit evidence context is required');
  validateScan(context.scan, context.scanMetadata, snapshot, context.scanRaw);
  assert.equal(context.scanMetadata.compilerBuildSha256, context.compilerBuildSha256,
    'Scan compiler differs from current compiler');
  assert.equal(audit.compilerBuildSha256, context.compilerBuildSha256, 'Audit covers different compiler inputs');
  assert.equal(audit.scanReportSha256, sha256(context.scanRaw), 'Audit covers a different static scan');
  assert.equal(audit.verificationReportSha256, context.verificationReportSha256,
    'Audit covers different local verification');
  const completed = Date.parse(audit.completedAt);
  assert.ok(Number.isFinite(context.reviewNotBefore), 'Current evidence completion date is required');
  assert.ok(completed >= context.reviewNotBefore, 'Audit predates its evidence');
  const validateReview = (review, impact) => {
    assert.ok(['false-positive', 'mitigated', 'accepted-risk'].includes(review.disposition),
      'Every audit item needs a closed disposition');
    assert.ok(!(review.disposition === 'accepted-risk' && ['High', 'Medium'].includes(impact)),
      'Accepted High/Medium risks block release');
    assert.ok(typeof review.rationale === 'string' && review.rationale.trim().length >= 30,
      'Every audit item needs a substantive rationale');
    assert.ok(audit.reviewers.includes(review.reviewedBy), 'Unknown item reviewer');
    const reviewed = Date.parse(review.reviewedAt);
    assert.ok(Number.isFinite(reviewed) && reviewed >= context.reviewNotBefore && reviewed <= completed,
      'Invalid item review date');
    assert.ok(Array.isArray(review.evidence) && review.evidence.length > 0, 'Item evidence is required');
    for (const ref of review.evidence) {
      assert.ok(typeof ref.path === 'string' && !path.isAbsolute(ref.path)
        && ref.path.split(/[\\/]/).every(part => part && part !== '.' && part !== '..')
        && !ref.path.includes('\\'), 'Evidence must use a contained relative path');
      assert.match(ref.sha256 || '', /^[0-9a-f]{64}$/, 'Invalid item evidence hash');
      assert.equal(sha256(context.readEvidence(ref.path)), ref.sha256, 'Item evidence integrity mismatch');
    }
  };
  const detectors = context.scan.results.detectors;
  assert.ok(new Set(detectors.map(d => d.id)).size === detectors.length, 'Duplicate scan finding');
  assert.ok(Array.isArray(audit.findings) && audit.findings.length === detectors.length,
    'Every scan finding must be independently reviewed');
  const byId = new Map(audit.findings.map(f => [f.id, f]));
  assert.equal(byId.size, detectors.length, 'Duplicate audit finding');
  for (const d of detectors) {
    const review = byId.get(d.id);
    assert.ok(review, `Missing audit finding: ${d.id}`);
    assert.equal(review.detector, d.check, 'Audit detector mismatch');
    assert.equal(review.originalImpact, d.impact, 'Audit cannot override scan severity');
    assert.equal(review.originalConfidence, d.confidence, 'Audit confidence mismatch');
    validateReview(review, d.impact);
  }
  assert.ok(Array.isArray(audit.observations), 'Separate observations must be reviewed');
  const observations = new Map(audit.observations.map(o => [o.id, o]));
  assert.equal(observations.size, audit.observations.length, 'Duplicate audit observation');
  assert.deepEqual([...observations.keys()].sort(), [...context.observationIds].sort(),
    'Every separate security observation must be independently reviewed');
  for (const review of observations.values()) validateReview(review, 'Medium');
}

export function readContainedEvidence(root, relative) {
  assert.ok(typeof relative === 'string' && !path.isAbsolute(relative)
    && !relative.includes('\\') && relative.split('/').every(p => p && p !== '.' && p !== '..'),
  'Evidence must use a contained relative path');
  const file = fs.realpathSync(path.join(root, relative));
  const base = fs.realpathSync(root) + path.sep;
  assert.ok(file.startsWith(base), 'Evidence symlink escapes project');
  return fs.readFileSync(file);
}
