import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { english } from "./src/i18n.mjs";
import { sourceOrder, pageKind, exampleGifts, exampleOffers, exampleActivity } from "./src/presentation.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name));
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const manifest = JSON.parse(read("site/release-manifest.json"));

test("all public assets match the release inventory", () => {
  for (const [name, entry] of Object.entries(manifest.files)) {
    assert.ok(!name.split("/").includes(".."));
    const raw = read("site/" + name);
    assert.equal(hash(raw), entry.sha256, name);
    assert.equal(raw.length, entry.bytes, name);
    assert.equal(entry.mutable, name === "stats.json");
  }
});
test("formal binding and independent frontend provenance are explicit", () => {
  assert.deepEqual(JSON.parse(read("site/config.json")), JSON.parse(read("../deployments/bsc-mainnet.json")));
  assert.equal(manifest.sourceSnapshotSha256, JSON.parse(read("../public-source-manifest.json")).sourceSnapshotSha256);
  assert.equal(manifest.notes.independentReviewInherited, false);
  assert.equal(manifest.notes.productionRelease, false);
  assert.equal(hash(JSON.stringify(manifest.frontendSourceFiles)), manifest.frontendSourceSha256);
  for (const [name, digest] of Object.entries(manifest.frontendSourceFiles))
    assert.equal(hash(read(name)), digest, name);
});
test("published wallet helper retains its exact approved digest", () => {
  assert.equal(hash(read("site/skill/parley.mjs")), "d35db4cd14016d07bb85af252053ad0d98332d1f0a3e4a610cd265c715e6165b");
  for (const line of read("site/skill/SHA256SUMS").toString().trim().split("\n")) {
    const [, digest, name] = /^([a-f0-9]{64})  (SKILL\.md|parley\.mjs|parley\.zip)$/.exec(line);
    assert.equal(hash(read("site/skill/" + name)), digest);
  }
});
test("web and scenes remain read-only", () => {
  for (const name of ["app", "scene", "packet-scene"]) {
    const source = read(`src/${name}.mjs`).toString();
    for (const op of ["createWalletClient(", ".sendTransaction(", ".writeContract(", ".signMessage("])
      assert.ok(!source.includes(op), `${name}: ${op}`);
  }
});
test("gift surfaces omit amounts without inventing random payouts", () => {
  const source = read("src/app.mjs").toString();
  const component = source.slice(source.indexOf("function packetCard("), source.indexOf("const demoPackets"));
  for (const text of ["perShare", "Math.random", "BNB", "USDT", "USDC", "随机", "等额"])
    assert.ok(!component.includes(text), text);
  assert.ok(component.includes("greeting.dataset.untrusted"));
  assert.ok(source.includes("Do not prepare, sign or broadcast a transaction."));
});
test("shared brand, dark favicon and language links remain available", () => {
  const html = read("site/index.html").toString();
  assert.equal((html.match(/src="\/assets\/parley-stamp\.svg"/g) || []).length, 2);
  assert.ok(read("site/assets/parley-favicon.svg").toString().includes("prefers-color-scheme:dark"));
  assert.ok(read("src/app.mjs").toString().includes(".footer-brand"));
  assert.equal(english("接入 Agent"), "Connect Agent");
  assert.equal(english("每个 Agent ID 一份见面礼"), "One gift for each Agent ID");
});
test("motion retains pause, fallback and resource cleanup", () => {
  const source = read("src/packet-scene.mjs").toString();
  for (const safeguard of ["document.hidden", "isPaused()", "webglcontextlost", "renderer.dispose()", "canvas.remove()"])
    assert.ok(source.includes(safeguard), safeguard);
  assert.equal((source.match(/new THREE\.WebGLRenderer/g) || []).length, 1);
  assert.ok(read("site/packets.css").toString().includes("prefers-reduced-motion: reduce"));
});
test("real records lead while empty and unavailable sources retain a separate example section", () => {
  for (const status of ["empty", "unavailable", "available"]) {
    assert.deepEqual(sourceOrder({ count: 0, status }), ["example", "live"]);
    assert.deepEqual(sourceOrder({ count: 2, status }), ["live", "example"]);
  }
  assert.deepEqual(sourceOrder(), ["example", "live"]);
  assert.deepEqual(["/", "/packets", "/p/1", "/board", "/stats", "/docs"].map(pageKind),
    ["overview", "gifts", "gift", "offers", "activity", "guide"]);
});
test("example fixtures have no contract binding, monetary gift amounts or chain evidence", () => {
  const gifts = exampleGifts(1000);
  assert.equal(gifts.length, 3);
  assert.equal(gifts[0].expiry, 8200);
  for (const gift of gifts) {
    for (const field of ["amount", "perShare", "value", "contract", "hash", "block", "transactionHash"])
      assert.ok(!(field in gift), field);
  }
  assert.equal(exampleActivity.days.length, 7);
  assert.equal(exampleOffers.length, 2);
  assert.ok(exampleGifts(1000, true).every(gift => !/[\u3400-\u9fff]/.test(gift.memo)));
});
test("inline examples have no transaction actions and use explicit independent source labels", () => {
  const source = read("src/app.mjs").toString();
  const showcase = source.slice(source.indexOf("function exampleThread("), source.indexOf("const demoPackets"));
  for (const op of ["actionPrompt(", "button(", "navigateLink(", "onboarding("])
    assert.ok(!showcase.includes(op), op);
  assert.doesNotMatch(showcase, /\bread\(/);
  assert.ok(showcase.includes('box.dataset.source = "example"'));
  assert.ok(showcase.includes('live.dataset.source = "live"'));
  assert.ok(showcase.includes("sourceOrder(sourceState)"));
  const card = source.slice(source.indexOf("function packetCard("), source.indexOf("let sourceState"));
  assert.match(card, /if \(example\) actions\.append/);
  assert.match(card, /else actions\.append/);
  assert.ok(card.includes("Fictional example · Not claimable"));
  assert.ok(read("site/showcase.css").toString().includes("prefers-reduced-motion: reduce"));
});
