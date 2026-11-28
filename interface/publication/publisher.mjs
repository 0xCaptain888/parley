// ../parley-production-activation/closeout/publisher.mjs
import assert4 from "node:assert/strict";
import fs3 from "node:fs";
import path3 from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// ../../outputs/parley-production-activation-2026-11-27-r1/application/scripts/publication-plan.mjs
import assert2 from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ../../outputs/parley-production-activation-2026-11-27-r1/application/scripts/evidence.mjs
import { createHash } from "node:crypto";
var sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// ui-site-release.mjs
import assert from "node:assert/strict";

// repository/interface/site/release-manifest.json
var release_manifest_default = {
  schemaVersion: 1,
  mode: "candidate",
  sourceSnapshotSha256: "91c9ee119c4636c911e0fe08b3dead402fc2dcc3137a930fe650100906696c91",
  frontendSourceSha256: "b8b2f2c90b89683e67408fb5348ce605450c943912af5e5c9237a64b158a9878",
  frontendSourceFiles: {
    "src/abi.json": "fb88d8018ccbfd89027fd6beaecbabc27cb73e8f3ca1b7be87e8544840b4608f",
    "src/app.mjs": "8d0cbbb202078e339fd0ca66955a21d03028f802ae6bb5d57de6d9bee5702bea",
    "src/i18n.mjs": "71936866e10032bc6499e77187337017e42cc267cea0a281cc9d734775fcec8f",
    "src/packet-scene.mjs": "306c76a14fcc7d363f864230168e3ebcb8a51022326b5285eb79716c8d1b4f92",
    "src/presentation.mjs": "f55286752ab08c92cd1dc98aebf86383b5ae2c924825a51c9d1be8689cb25622",
    "src/scene.mjs": "ce8f597e939093a3d12ef27650bd1ec0de42e59b869f737871aafb5db46c50ac",
    "site/index.html": "fc7907ce0735c44752fb2e9641358d54d9e75554355526591a51c0d3a5b2e390",
    "site/design.css": "5f703735ad05c0a70ac6f3cc26dd3bcbe988a4bea52e3fa4bc31f9addb263498",
    "site/motion.css": "9a311721b7e1d509e109f3b305dd7637729f69566b2c444aea31ad6331ecc634",
    "site/packets.css": "379dc82440867f943fc8983d1976fba67cbe98b677398201995d9e3470a0b464",
    "site/showcase.css": "ea7b6d3d25e5795af08e2cb0f72ccc3884d565fe4c278dcb1fd32753773287a8",
    "site/assets/parley-stamp.svg": "954c49a2cbc8c02f86820a064cfb8115a3a1b58b84d3e7819910e0ce0edfae5c",
    "site/assets/parley-favicon.svg": "991e9249f0998d2d9c8a0aa2add783f63fa1d5cc2275f684e08d0532ff95b017"
  },
  config: {
    chainId: 56,
    contract: "0x374499188212a01e3614bc58afe7f71f03a3d22e",
    registry: "0x60b9262456de011f7d15a54cdd8c48baaa8b022f",
    deploymentBlock: 135899375,
    multicall: "0xcA11bde05977b3631167028862bE2a173976CA11",
    rpcs: [
      "https://bsc-dataseed.binance.org",
      "https://bsc-dataseed1.bnbchain.org",
      "https://bsc-rpc.publicnode.com"
    ],
    site: "https://parley-staging.pages.dev",
    resident: "btc123456",
    excluded: [
      "0xb550e4cc7271bdbc722427057003410aec9fc2f4",
      "0xa2c191561397c584ddad75388b5519e4931ef026"
    ],
    tokens: {
      USDT: "0x55d398326f99059fF775485246999027B3197955",
      USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"
    }
  },
  files: {
    _headers: {
      bytes: 708,
      sha256: "645ae04532943bfeb7c087ff7c8c60c68418f5b47ff0d966ddc5641b432d7fd4",
      mutable: false
    },
    _redirects: {
      bytes: 64,
      sha256: "fff3959f96e16f14f73fc1f9c4af521193d511614c602c3bea180f855b289868",
      mutable: false
    },
    "404.html": {
      bytes: 334,
      sha256: "423b4def4463ba1d7ff21879b737a08b0bf3e26f273fad62fda639655a848aae",
      mutable: false
    },
    "assets/app.js": {
      bytes: 239686,
      sha256: "98622960c9bec2584f3e3eeda525274cb01476d5770b5e3b4cc499736ebfa0de",
      mutable: false
    },
    "assets/chunks/ccip-MN2TBC26.js": {
      bytes: 223,
      sha256: "bcc94266eae79cab472322f8d3f9d5671f370a96c55f39f092c6fa1f1fbeb602",
      mutable: false
    },
    "assets/chunks/chunk-4FI2LYRA.js": {
      bytes: 6966,
      sha256: "57e01d5eb7fd37972b2d9c22a6a56e47b9fe3107aae1c68142ced0f443102e0f",
      mutable: false
    },
    "assets/chunks/chunk-I45H275L.js": {
      bytes: 34212,
      sha256: "ba07b08939968b8a4e8c24667acd1d7671ba7dce63f6fccd1b762e476d858187",
      mutable: false
    },
    "assets/chunks/chunk-J24ODOEV.js": {
      bytes: 131442,
      sha256: "42acd0081fc98edf18cab56a744026a9fc1b1d409d8107c1e6ad82e2ae5f60d4",
      mutable: false
    },
    "assets/chunks/chunk-RUMTKLDE.js": {
      bytes: 549613,
      sha256: "3b113c3e0dd414c4cf60d1ebc82dc9aca556990523fdba1ad482e8f396fd475b",
      mutable: false
    },
    "assets/chunks/chunk-VC46IEJQ.js": {
      bytes: 106,
      sha256: "ff9e0dca4365b7b1581e7275f3c6dbcf1474ffb874d81a3375ecf7a835dbaa6f",
      mutable: false
    },
    "assets/chunks/native-KGXVO7P5.js": {
      bytes: 345,
      sha256: "2320f0b418486d8f160e58de6d3e33edb9dfd5ccc2f49521bf642fd28b6b69e0",
      mutable: false
    },
    "assets/chunks/packet-scene-4CR2BRGO.js": {
      bytes: 6291,
      sha256: "190ac2abafbf82c733e63b80bf83446ca1ecfd68c760a2eec6cd932c5a602c3b",
      mutable: false
    },
    "assets/chunks/scene-6L4MKZ2R.js": {
      bytes: 7505,
      sha256: "41c740d413a75b390bcf013c4a5696ea56e5e35851c931c5a7486d8a9de062a9",
      mutable: false
    },
    "assets/chunks/secp256k1-TZ2C2BYN.js": {
      bytes: 219,
      sha256: "73f7e268702082eb47ab3f8224ae1f6c31f94ebc92526bffdc7156f1fbaf6df3",
      mutable: false
    },
    "assets/parley-favicon.svg": {
      bytes: 426,
      sha256: "991e9249f0998d2d9c8a0aa2add783f63fa1d5cc2275f684e08d0532ff95b017",
      mutable: false
    },
    "assets/parley-stamp.svg": {
      bytes: 329,
      sha256: "954c49a2cbc8c02f86820a064cfb8115a3a1b58b84d3e7819910e0ce0edfae5c",
      mutable: false
    },
    "config.json": {
      bytes: 696,
      sha256: "67ca21c006e8b8621d18c8faa50c5993529481a5a4e42a503ef1aa8afed00a12",
      mutable: false
    },
    "demo.webm": {
      bytes: 776148,
      sha256: "8a081419d8a34e038d0fd3006a499d8494da644fb1eec550406a48d2e5d7cdc5",
      mutable: false
    },
    "design.css": {
      bytes: 39512,
      sha256: "5f703735ad05c0a70ac6f3cc26dd3bcbe988a4bea52e3fa4bc31f9addb263498",
      mutable: false
    },
    "index.html": {
      bytes: 4009,
      sha256: "fc7907ce0735c44752fb2e9641358d54d9e75554355526591a51c0d3a5b2e390",
      mutable: false
    },
    "motion.css": {
      bytes: 26323,
      sha256: "9a311721b7e1d509e109f3b305dd7637729f69566b2c444aea31ad6331ecc634",
      mutable: false
    },
    "packets.css": {
      bytes: 6940,
      sha256: "379dc82440867f943fc8983d1976fba67cbe98b677398201995d9e3470a0b464",
      mutable: false
    },
    "showcase.css": {
      bytes: 6893,
      sha256: "ea7b6d3d25e5795af08e2cb0f72ccc3884d565fe4c278dcb1fd32753773287a8",
      mutable: false
    },
    "skill/parley.mjs": {
      bytes: 850227,
      sha256: "d35db4cd14016d07bb85af252053ad0d98332d1f0a3e4a610cd265c715e6165b",
      mutable: false
    },
    "skill/parley.zip": {
      bytes: 179718,
      sha256: "ef713f47398a02c5b267ed2d38e6a6ea581844a0d2d1594d52c029bf7127dc82",
      mutable: false
    },
    "skill/SHA256SUMS": {
      bytes: 229,
      sha256: "1bca5784025b92f833a34ca8bcdc9ba183e1ea22eae52dcd055ae3fd7d14e29f",
      mutable: false
    },
    "skill/SKILL.md": {
      bytes: 12761,
      sha256: "61a42946cfbfccba25910b03163d1dbf0810d4307562a16a44049a362a61efd9",
      mutable: false
    },
    "stats.json": {
      bytes: 790,
      sha256: "54de785471bf4ddd93a747f165cb873b73a79fa65cf62a1723d6e55a1a42a4c4",
      mutable: true
    },
    "style.css": {
      bytes: 12413,
      sha256: "be6a9146645727c10651a362765337cf900a6f062502df36578e3d1411b654f5",
      mutable: false
    }
  },
  notes: {
    scope: "Authorized interface publication; original source snapshot binds the unchanged contract/helper only. Frontend has separate provenance.",
    productionRelease: false,
    independentReviewInherited: false,
    frontendReadOnly: true,
    statistics: "Collector snapshot; freshness checked at display and publication time.",
    demo: "Inline fictional examples are isolated and labeled, never executable or counted as live activity. Legacy demo=1 remains explicitly fictional.",
    packetPresentation: "Gift surfaces omit monetary amounts. Existing contract payouts remain fixed-share, not random."
  }
};

// ui-site-release.mjs
var publicFiles = Object.freeze(Object.keys(release_manifest_default.files).sort());
function httpsOrigin(input) {
  const url = new URL(input);
  assert.equal(url.protocol, "https:");
  assert.ok(!url.username && !url.password && !url.search && !url.hash && !url.port);
  assert.equal(url.pathname, "/");
  return url.origin;
}
function validateSiteManifest(manifest) {
  assert.deepEqual(
    { ...manifest, files: { ...manifest.files, "stats.json": release_manifest_default.files["stats.json"] } },
    release_manifest_default,
    "Unapproved interface baseline refused"
  );
  assert.equal(manifest.mode, "candidate");
  assert.equal(manifest.config.site, "https://parley-staging.pages.dev");
  assert.equal(manifest.config.chainId, 56);
  assert.equal(manifest.config.contract.toLowerCase(), "0x374499188212a01e3614bc58afe7f71f03a3d22e");
  assert.equal(manifest.notes.independentReviewInherited, false);
  assert.equal(manifest.notes.frontendReadOnly, true);
  assert.equal(manifest.notes.productionRelease, false);
  for (const [name, entry] of Object.entries(manifest.files)) {
    assert.ok(!name.startsWith("/") && !name.includes("\\") && !name.split("/").some((p) => !p || p === "." || p === ".." || p.startsWith(".")));
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= 20 * 1024 * 1024);
    assert.equal(entry.mutable, name === "stats.json");
  }
}

// ../../outputs/parley-production-activation-2026-11-27-r1/application/scripts/publication-plan.mjs
function inspectPublication({
  root,
  manifest,
  snapshotSha256,
  project,
  origin,
  readFile,
  stats = null,
  now = Math.floor(Date.now() / 1e3)
}) {
  validateSiteManifest(manifest);
  assert2.equal(manifest.sourceSnapshotSha256, snapshotSha256, "Cannot publish a stale source bundle");
  assert2.ok(/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$/.test(project), "Explicit Cloudflare Pages project required");
  assert2.equal(httpsOrigin(origin), origin);
  assert2.equal(origin, `https://${project}.pages.dev`, "Project must match the authorized free Pages origin");
  assert2.equal(manifest.config.site, origin, "Bundle origin differs from publication target");
  const entries = {};
  for (const name of publicFiles) {
    const raw = readFile(name);
    assert2.equal(raw.length, manifest.files[name].bytes, `Publication length mismatch: ${name}`);
    assert2.equal(sha256(raw), manifest.files[name].sha256, `Publication digest mismatch: ${name}`);
    entries[name] = raw;
  }
  if (stats !== null) {
    assert2.equal(manifest.mode, "candidate", "Staging cannot publish real metrics");
    assert2.equal(stats.contract?.toLowerCase(), manifest.config.contract.toLowerCase(), "Stats deployment mismatch");
    assert2.ok(Number.isSafeInteger(stats.block) && stats.block >= manifest.config.deploymentBlock);
    assert2.match(stats.blockHash || "", /^0x[0-9a-f]{64}$/i);
    assert2.ok(
      Number.isSafeInteger(stats.updatedAt) && stats.updatedAt <= now && now - stats.updatedAt <= 1200,
      "Only fresh confirmed statistics may be published"
    );
    assert2.deepEqual(stats.excluded.map((a) => a.toLowerCase()).sort(), manifest.config.excluded.map((a) => a.toLowerCase()).sort());
    const keys = [
      "updatedAt",
      "block",
      "blockHash",
      "contract",
      "members",
      "mail",
      "packets",
      "requests",
      "offers",
      "retention",
      "pairs",
      "daily",
      "excluded"
    ];
    assert2.deepEqual(Object.keys(stats).sort(), keys.sort(), "Unknown statistics field refused");
    const template = {
      mail: ["text", "deal"],
      packets: ["created", "claims", "claimsThatOpenedMailbox", "bnb"],
      requests: ["created", "paid"],
      offers: ["created", "settled", "publicCreated"],
      retention: ["secondAction", "repliedAfterClaim", "secondActionMembers", "repliedClaimers", "claimers"]
    };
    for (const [key, fields] of Object.entries(template))
      assert2.deepEqual(Object.keys(stats[key] || {}).sort(), fields.sort(), "Unknown statistics subfield");
    for (const field of ["members", "pairs", ...Object.keys(template)]) {
      const values = typeof stats[field] === "object" ? Object.values(stats[field]) : [stats[field]];
      assert2.ok(values.every((v) => typeof v === "number" ? Number.isFinite(v) && v >= 0 : typeof v === "string" && /^(0|[1-9]\d*)$/.test(v)), "Invalid statistics count");
    }
    assert2.ok(Array.isArray(stats.daily) && stats.daily.length <= 1e4);
    for (const day of stats.daily) {
      assert2.deepEqual(Object.keys(day).sort(), ["date", "newMembers", "activeMembers", "settled"].sort());
      assert2.match(day.date || "", /^\d{4}-\d\d-\d\d$/);
      assert2.ok(["newMembers", "activeMembers", "settled"].every((k) => Number.isSafeInteger(day[k]) && day[k] >= 0));
    }
    entries["stats.json"] = Buffer.from(JSON.stringify(stats, null, 2) + "\n");
  }
  const updated = { ...manifest, files: Object.fromEntries(publicFiles.map((name) => [name, {
    ...manifest.files[name],
    bytes: entries[name].length,
    sha256: sha256(entries[name])
  }])) };
  entries["release-manifest.json"] = Buffer.from(JSON.stringify(updated, null, 2) + "\n");
  const digests = Object.fromEntries(Object.keys(entries).sort().map((name) => [name, sha256(entries[name])]));
  return { report: {
    schemaVersion: 1,
    status: "prepared-not-uploaded",
    project,
    origin,
    sourceSnapshotSha256: snapshotSha256,
    mode: manifest.mode,
    files: digests,
    publicationDigest: sha256(JSON.stringify(digests)),
    statsUpdated: stats !== null,
    requiresProductionGate: manifest.mode === "candidate",
    publicUpload: false,
    productionRelease: false
  }, entries };
}
function writePublication(directory, prepared) {
  assert2.ok(path.isAbsolute(directory) && !fs.existsSync(directory), "New publication directory required");
  fs.mkdirSync(directory, { recursive: true, mode: 448 });
  for (const [name, bytes] of Object.entries(prepared.entries)) {
    assert2.ok([...publicFiles, "release-manifest.json"].includes(name), "Nonpublic file refused");
    const target2 = path.join(directory, name);
    fs.mkdirSync(path.dirname(target2), { recursive: true });
    fs.writeFileSync(target2, bytes, { mode: 384, flag: "wx" });
  }
}

// ../parley-production-activation/closeout/archive.mjs
import assert3 from "node:assert/strict";
import fs2 from "node:fs";
import path2 from "node:path";
import { createHash as createHash2 } from "node:crypto";
import { fileURLToPath } from "node:url";
var binding = Object.freeze({
  chainId: 56,
  contract: "0x374499188212a01e3614bc58afe7f71f03a3d22e",
  sourceSnapshotSha256: "91c9ee119c4636c911e0fe08b3dead402fc2dcc3137a930fe650100906696c91"
});
var sha2562 = (bytes) => createHash2("sha256").update(bytes).digest("hex");
var scenarios = [
  ["Identity baseline", "chain-prerequisites-resident-start-network.json"],
  ["Operator mailbox", "resident-mailbox-completion.json"],
  ["Public packet", "public-packet-settlement-verification.json"],
  ["Participant claim and mailbox", "participant-B-packet-claim-chain.json"],
  ["Duplicate claim rejection", "participant-B-message-verification.json"],
  ["Zero-postage message", "participant-B-message-chain-read.json"],
  ["Manual acknowledgment", "manual-ack-live-r1-ack.json", "manual-ack-live-r1-ack-verification.json"],
  ["Block and unblock", "participant-B-block-verification.json", "participant-B-blocked-rejection-report.json", "participant-B-unblock-verification.json"],
  ["Postage requirement", "participant-B-postage-required-rejection-report.json", "participant-B-stamped-message-verification.json"],
  ["Postage release", "operator-stamp-reply-verification.json"],
  ["Payment request", "participant-B-payment-request-verification.json", "participant-B-payment-request-approval-preview-report.json"],
  ["Exact approval and payment", "participant-B-request-approval-verification.json", "participant-B-request-payment-verification.json"],
  ["Directed offer", "directed-offer-verification.json"],
  ["Counteroffer and original refund", "participant-B-counteroffer-verification.json", "participant-B-counteroffer-refund-trace.json"],
  ["Counteroffer acceptance", "accept-counteroffer-4-settlement-verification.json", "accept-counteroffer-4-settlement.json"],
  ["Public board and cancellation", "public-board-settlement-verification.json", "board-1-cancel-settlement.json"],
  ["Untrusted message boundary", "operator-injection-test-r1-verification.json", "participant-B-injection-read-report.json"],
  ["Local policy rejection", "participant-B-policy-rejection-report.json", "participant-B-policy-retest-consent-report.json"],
  ["Pause, claim while paused and recovery", "step19-functional-completion.json", "step19-replacement-packet-chain-verification.json", "guardian-pause-r2-verification.json", "step19-participant-claim-verification.json", "guardian-resume-r2-verification.json"],
  ["Explorer decoded input and source match", "step-20-browser-observation.json", "step-20-bscscan-decoded-input.jpg"]
];
var supplements = [
  "participation/EXECUTION-PROGRESS.md",
  "participation/acceptance.json",
  "participation/participant-A-consent.json",
  "participation/participant-B-consent.json",
  "participant-B-message-chain.json",
  "participant-B-stamped-message-chain.json",
  "participant-B-request-approval-chain.json",
  "participant-B-request-payment-chain.json",
  "participant-B-counteroffer-chain.json",
  "operator-stamp-reply-chain-verification.json",
  "directed-offer-chain-verification.json",
  "manual-ack-live-r1-read-verification.json",
  "guardian-pause-r1-verification.json",
  "guardian-resume-r1-verification.json",
  "step19-packet-refund-settlement.json",
  "delivery-status.json"
];
function safeName(name) {
  assert3.ok(typeof name === "string" && /^[a-zA-Z0-9_./-]+$/.test(name) && !path2.isAbsolute(name) && !name.split("/").some((p) => ["", ".", ".."].includes(p)), "Unsafe archive path");
  return name;
}
function readEvidence(root, name) {
  safeName(name);
  for (let p = path2.join(root, name); p !== path2.dirname(root); p = path2.dirname(p)) {
    const stat2 = fs2.lstatSync(p);
    assert3.ok(!stat2.isSymbolicLink(), "Evidence symlink refused");
    if (p === root) break;
  }
  const stat = fs2.statSync(path2.join(root, name));
  assert3.ok(stat.isFile() && stat.size > 0 && stat.size <= 16 * 1024 * 1024, "Invalid evidence file");
  const bytes = fs2.readFileSync(path2.join(root, name));
  if (name.endsWith(".json")) {
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (/^(botToken|apiKey|accessToken|refreshToken|privateKey|mnemonic|password|secret)$/i.test(key))
          assert3.ok(child === null || child === false || child === "[REDACTED]", "Secret field refused");
        visit(child);
      }
    };
    visit(JSON.parse(bytes));
  }
  return bytes;
}
function verifyArchive(directory) {
  const index = JSON.parse(readEvidence(directory, "index.json"));
  assert3.equal(index.schemaVersion, 1);
  assert3.deepEqual(index.binding, binding);
  assert3.equal(index.scenarios.length, 20);
  assert3.deepEqual(index.scenarios.map((s) => s.step), Array.from({ length: 20 }, (_, i) => i + 1));
  assert3.equal(index.formalOrderedValidatorPassed, false);
  assert3.equal(index.publicationAuthorized, false);
  assert3.equal(index.newTransactions, 0);
  assert3.equal(new Set(index.files.map((f) => f.path)).size, index.files.length);
  const byName = new Map(index.files.map((f) => [f.path, f]));
  for (const file of index.files) {
    const bytes = readEvidence(directory, file.path);
    assert3.equal(bytes.length, file.bytes, `Evidence size changed: ${file.path}`);
    assert3.equal(sha2562(bytes), file.sha256, `Evidence hash changed: ${file.path}`);
  }
  for (const s of index.scenarios) {
    assert3.equal(s.status, "functional-record-archived");
    assert3.ok(s.evidence.length > 0);
    for (const ref of s.evidence) assert3.deepEqual(ref, byName.get(ref.path), "Scenario reference missing");
  }
  const completion = JSON.parse(readEvidence(directory, "evidence/step19-functional-completion.json"));
  assert3.equal(completion.functionalStep19Passed, true);
  for (const ref of completion.evidence)
    assert3.equal(byName.get(`evidence/${ref.path}`)?.sha256, ref.sha256, "Step 19 linked evidence changed");
  return {
    status: "verified-private-archive",
    files: index.files.length,
    scenarios: 20,
    indexSha256: sha2562(fs2.readFileSync(path2.join(directory, "index.json"))),
    formalOrderedValidatorPassed: false,
    newTransactions: 0
  };
}
function createArchive(source, directory, now = (/* @__PURE__ */ new Date()).toISOString()) {
  assert3.ok(path2.isAbsolute(source) && path2.isAbsolute(directory) && !fs2.existsSync(directory));
  const names = [.../* @__PURE__ */ new Set([
    ...scenarios.flatMap((s) => s.slice(1)),
    ...supplements.filter((n) => fs2.existsSync(path2.join(source, n)))
  ])].sort();
  fs2.mkdirSync(directory, { recursive: true, mode: 448 });
  const files = names.map((name) => {
    const bytes = readEvidence(source, name), target2 = path2.join(directory, "evidence", name);
    fs2.mkdirSync(path2.dirname(target2), { recursive: true, mode: 448 });
    fs2.writeFileSync(target2, bytes, { flag: "wx", mode: 384 });
    return { path: `evidence/${name}`, bytes: bytes.length, sha256: sha2562(bytes) };
  });
  const index = {
    schemaVersion: 1,
    archivedAt: now,
    binding,
    visibility: "private-local-only",
    publicationAuthorized: false,
    formalOrderedValidatorPassed: false,
    newTransactions: 0,
    provenance: {
      chain: "Existing canonical transaction and event verification; no new chain verification implied by copying.",
      participant: "Participant B reports are attributed, not independent access to participant host or wallet.",
      historical: "Original failed attempts and RPC historical-state limitations retained."
    },
    formalBlockers: [
      "Actual retests did not follow the original global canonical transaction order.",
      "Some original participant helper outputs and guardian preview/consent metadata were not obtained.",
      "Public identity and screenshot consent has not been supplied; archive must not be published."
    ],
    scenarios: scenarios.map(([title, ...refs], i) => ({
      step: i + 1,
      title,
      status: "functional-record-archived",
      participantReportUsed: [5, 8, 9, 11, 12, 14, 17, 18, 19].includes(i + 1),
      evidence: refs.map((n) => files.find((f) => f.path === `evidence/${n}`))
    })),
    files
  };
  fs2.writeFileSync(path2.join(directory, "index.json"), JSON.stringify(index, null, 2) + "\n", { flag: "wx", mode: 384 });
  return verifyArchive(directory);
}
if (process.argv[1] && path2.basename(process.argv[1]) === "archive.mjs" && path2.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, source, directory] = process.argv.slice(2);
  assert3.ok(["create", "verify"].includes(mode));
  console.log(JSON.stringify(mode === "create" ? createArchive(source, directory) : verifyArchive(source), null, 2));
}

// ../parley-production-activation/closeout/publisher.mjs
var target = Object.freeze({
  accountId: "1d467133217d2828cc677d7e8b5d1306",
  project: "parley-staging",
  origin: "https://parley-staging.pages.dev",
  wranglerVersion: "4.169.0"
});
var json = (dir, name) => JSON.parse(readEvidence(dir, name));
var credentialDirectory = "/run/credentials/parley-stats-publication.service";
function systemdCredentialMetadata(file, stat, directory, filesystemType, configuredDirectory) {
  return configuredDirectory === credentialDirectory && ["statistics.json", "cloudflare-token"].some((name) => file === path3.join(credentialDirectory, name)) && stat.uid === 0 && (stat.mode & 511) === 288 && directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === 0 && (directory.mode & 511) === 360 && filesystemType === 16914836;
}
function privateDir(dir) {
  assert4.ok(path3.isAbsolute(dir), "Absolute private directory required");
  for (let p = dir; p !== path3.dirname(p); p = path3.dirname(p))
    assert4.ok(!fs3.lstatSync(p).isSymbolicLink(), "Symlink path refused");
  const stat = fs3.statSync(dir);
  assert4.ok(stat.isDirectory() && stat.uid === process.getuid() && !(stat.mode & 63), "Private owned directory required");
}
function privateInput(file, maximum) {
  assert4.ok(path3.isAbsolute(file));
  for (let p = file; p !== path3.dirname(p); p = path3.dirname(p))
    assert4.ok(!fs3.lstatSync(p).isSymbolicLink(), "Credential symlink refused");
  const fd = fs3.openSync(file, fs3.constants.O_RDONLY | fs3.constants.O_NOFOLLOW);
  try {
    const stat = fs3.fstatSync(fd);
    const systemdInput = path3.dirname(file) === credentialDirectory && systemdCredentialMetadata(
      file,
      stat,
      fs3.lstatSync(credentialDirectory),
      fs3.statfsSync(credentialDirectory).type,
      process.env.CREDENTIALS_DIRECTORY
    );
    assert4.ok(stat.isFile() && stat.nlink === 1 && (!(stat.mode & 63) || systemdInput) && stat.size > 0 && stat.size <= maximum, "Private bounded input required");
    const raw = fs3.readFileSync(fd);
    assert4.ok(raw.length <= maximum);
    return raw;
  } finally {
    fs3.closeSync(fd);
  }
}
function save(file, value, exclusive = true) {
  const fd = fs3.openSync(file, exclusive ? "wx" : "w", 384);
  try {
    fs3.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fs3.fsyncSync(fd);
  } finally {
    fs3.closeSync(fd);
  }
  const directory = fs3.openSync(path3.dirname(file), "r");
  try {
    fs3.fsyncSync(directory);
  } finally {
    fs3.closeSync(directory);
  }
}
function candidate({ baseline, stats, previous = null, now = Math.floor(Date.now() / 1e3) }) {
  const manifest = json(baseline, "release-manifest.json");
  assert4.equal(manifest.config.chainId, binding.chainId);
  assert4.equal(manifest.config.contract.toLowerCase(), binding.contract);
  assert4.equal(manifest.sourceSnapshotSha256, binding.sourceSnapshotSha256);
  const prepared = inspectPublication({
    root: baseline,
    manifest,
    snapshotSha256: binding.sourceSnapshotSha256,
    project: target.project,
    origin: target.origin,
    readFile: (name) => readEvidence(baseline, name),
    stats,
    now
  });
  for (const [name, raw] of Object.entries(prepared.entries)) {
    if (!["stats.json", "release-manifest.json"].includes(name))
      assert4.equal(sha2562(raw), manifest.files[name].sha256, "Non-statistics change refused");
  }
  if (previous) {
    assert4.equal(previous.chainId, binding.chainId);
    assert4.equal(previous.contract, binding.contract);
    assert4.ok(
      stats.block >= previous.statisticsBlock && stats.updatedAt >= previous.statisticsUpdatedAt,
      "Statistics rollback refused"
    );
    if (stats.block === previous.statisticsBlock)
      assert4.equal(stats.blockHash, previous.statisticsBlockHash, "Published block hash changed; manual reconciliation required");
  }
  return prepared;
}
async function canonical(stats, rpc = "https://bsc-rpc.publicnode.com", fetcher = fetch) {
  const call = async (method, params) => {
    const response = await fetcher(rpc, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(2e4),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
    assert4.equal(response.status, 200);
    const data = await response.json();
    assert4.ok(data?.jsonrpc === "2.0" && data.id === 1 && !data.error, "RPC verification failed");
    return data.result;
  };
  assert4.equal(await call("eth_chainId", []), "0x38");
  const [head, block] = await Promise.all([
    call("eth_blockNumber", []),
    call("eth_getBlockByNumber", [`0x${stats.block.toString(16)}`, false])
  ]);
  assert4.equal(block?.number, `0x${stats.block.toString(16)}`);
  assert4.equal(block?.hash?.toLowerCase(), stats.blockHash.toLowerCase(), "Noncanonical statistics refused");
  assert4.ok(BigInt(head) - BigInt(stats.block) >= 12n, "Twelve confirmations required");
  const timestamp = Number(BigInt(block.timestamp));
  assert4.ok(Number.isSafeInteger(timestamp) && timestamp <= stats.updatedAt + 30 && stats.updatedAt - timestamp <= 1800, "Statistics anchor too old");
}
async function verifyPublic(prepared, fetcher = fetch, timeoutMs = 2e4) {
  for (const name of ["stats.json", "release-manifest.json"]) {
    const response = await fetcher(`${target.origin}/${name}?publication=${prepared.report.publicationDigest}`, {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs)
    });
    assert4.equal(response.status, 200);
    assert4.match(response.headers.get("content-type") || "", /^application\/json\b/i);
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      for (; ; ) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        assert4.ok(size <= 131072, "Oversized public response");
        chunks.push(Buffer.from(part.value));
      }
    } finally {
      await reader.cancel().catch(() => {
      });
    }
    const raw = Buffer.concat(chunks);
    assert4.equal(sha2562(raw), prepared.report.files[name], `Public readback mismatch: ${name}`);
  }
}
async function verifyPublicEventually(prepared, fetcher = fetch, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await verifyPublic(prepared, fetcher, 7e3);
    } catch (error) {
      if (attempt === 2) throw error;
      await pause(2e3);
    }
  }
}
async function publish({
  state,
  baseline,
  statsFile,
  tokenFile,
  wrangler,
  execute = false,
  now = Math.floor(Date.now() / 1e3),
  checkCanonical = canonical,
  readback = verifyPublicEventually,
  run = spawnSync
}) {
  privateDir(state);
  const lock = path3.join(state, "publisher.lock");
  const fd = fs3.openSync(lock, "wx", 384);
  try {
    const pending = path3.join(state, "pending.json");
    assert4.ok(!fs3.existsSync(pending), "Unresolved publication attempt; inspect remote deployment before retry");
    const stats = JSON.parse(privateInput(statsFile, 131072));
    const previous = fs3.existsSync(path3.join(state, "last-success.json")) ? json(state, "last-success.json") : null;
    const prepared = candidate({ baseline, stats, previous, now });
    await checkCanonical(stats);
    if (previous?.publicationDigest === prepared.report.publicationDigest)
      return { status: "unchanged", publicationDigest: previous.publicationDigest, publicUpload: false };
    const report = {
      schemaVersion: 1,
      checkedAt: now,
      chainId: binding.chainId,
      contract: binding.contract,
      sourceSnapshotSha256: binding.sourceSnapshotSha256,
      project: target.project,
      origin: target.origin,
      publicationDigest: prepared.report.publicationDigest,
      statisticsBlock: stats.block,
      statisticsBlockHash: stats.blockHash,
      statisticsUpdatedAt: stats.updatedAt,
      changedFilesAllowed: ["stats.json", "release-manifest.json"],
      automaticSigning: false,
      walletAccess: false,
      productionRelease: false
    };
    if (!execute) return { ...report, status: "validated-not-uploaded", publicUpload: false };
    assert4.ok(path3.isAbsolute(wrangler) && fs3.statSync(wrangler).isFile(), "Pinned Wrangler entry point required");
    const versionFile = path3.resolve(path3.dirname(wrangler), "../package.json");
    assert4.equal(JSON.parse(fs3.readFileSync(versionFile)).version, target.wranglerVersion, "Wrangler version mismatch");
    const token = privateInput(tokenFile, 256).toString("utf8").trim();
    assert4.match(token, /^[A-Za-z0-9_-]{20,200}$/, "Invalid publication token");
    const site = path3.join(state, `candidate-${randomUUID()}`);
    writePublication(site, prepared);
    save(pending, { ...report, status: "attempt-reserved", candidateDirectory: path3.basename(site) });
    let failureStage = "deployment";
    try {
      const result = run(process.execPath, [
        wrangler,
        "pages",
        "deploy",
        site,
        "--project-name",
        target.project,
        "--branch",
        "main",
        "--commit-dirty=true"
      ], {
        encoding: "utf8",
        timeout: 18e4,
        maxBuffer: 1024 * 1024,
        cwd: state,
        env: {
          PATH: path3.dirname(process.execPath) + ":/usr/bin:/bin",
          HOME: state,
          CI: "1",
          CLOUDFLARE_API_TOKEN: token,
          CLOUDFLARE_ACCOUNT_ID: target.accountId,
          WRANGLER_SEND_METRICS: "false",
          WRANGLER_CACHE_DIR: path3.join(state, "wrangler-cache")
        }
      });
      assert4.ok(!result.error && result.status === 0, "Deployment result uncertain");
      failureStage = "public-readback";
      await readback(prepared);
      const success = { ...report, status: "published-and-readback-verified", publicUpload: true };
      save(path3.join(state, `success-${randomUUID()}.json`), success);
      const temp = path3.join(state, `last-success-${randomUUID()}.tmp`);
      save(temp, success);
      fs3.renameSync(temp, path3.join(state, "last-success.json"));
      fs3.unlinkSync(pending);
      fs3.rmSync(site, { recursive: true });
      return success;
    } catch {
      return { ...report, status: "uncertain-manual-reconciliation-required", failureStage, publicUpload: null };
    }
  } finally {
    fs3.closeSync(fd);
    fs3.unlinkSync(lock);
  }
}
if (process.argv[1] && path3.basename(process.argv[1]) === "publisher.mjs" && path3.resolve(process.argv[1]) === fileURLToPath2(import.meta.url)) {
  try {
    const [mode, ...extra] = process.argv.slice(2);
    assert4.ok(["--validate-only", "--publish-authorized-statistics"].includes(mode) && !extra.length);
    const credentials = process.env.CREDENTIALS_DIRECTORY || "/run/credentials/parley-stats-publication.service";
    const result = await publish({
      // systemd DynamicUser exposes StateDirectory through a root-managed private-directory link.
      state: fs3.realpathSync(process.env.STATE_DIRECTORY || "/var/lib/parley-stats-publication"),
      baseline: "/opt/parley-stats-publication/site",
      statsFile: path3.join(credentials, "statistics.json"),
      tokenFile: path3.join(credentials, "cloudflare-token"),
      wrangler: "/opt/parley-stats-publication/node_modules/wrangler/bin/wrangler.js",
      execute: mode === "--publish-authorized-statistics"
    });
    console.log(JSON.stringify(result));
    if (result.status === "uncertain-manual-reconciliation-required") process.exitCode = 2;
  } catch {
    console.error("PARLEY_STATISTICS_PUBLICATION_BLOCKED");
    process.exitCode = 2;
  }
}
export {
  candidate,
  canonical,
  publish,
  systemdCredentialMetadata,
  target,
  verifyPublic,
  verifyPublicEventually
};
