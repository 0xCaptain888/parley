import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(root, "site");
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const result = await build({
  entryPoints: [path.join(root, "src/app.mjs")],
  outdir: path.join(site, "assets"),
  entryNames: "app",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  splitting: true,
  metafile: true,
});
const outputs = new Set(
  Object.keys(result.metafile.outputs).map((name) => path.resolve(name)),
);
const chunks = path.join(site, "assets/chunks");
for (const name of fs.readdirSync(chunks)) {
  const file = path.join(chunks, name);
  if (name.endsWith(".js") && !outputs.has(file))
    fs.unlinkSync(file);
}
function inventory(directory, ignore = []) {
  const files = {};
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignore.includes(entry.name)) continue;
    const name = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Symlink refused");
    if (entry.isDirectory()) {
      for (const [child, metadata] of Object.entries(inventory(name, ignore)))
        files[entry.name + "/" + child] = metadata;
    } else {
      const raw = fs.readFileSync(name);
      files[entry.name] = { bytes: raw.length, sha256: hash(raw), mutable: false };
    }
  }
  return files;
}
const sourceFiles = {
  ...Object.fromEntries(Object.entries(inventory(path.join(root, "src"))).map(([name, value]) => ["src/" + name, value.sha256])),
  ...Object.fromEntries(["site/index.html", "site/design.css", "site/motion.css", "site/packets.css",
    "site/assets/parley-stamp.svg", "site/assets/parley-favicon.svg"].map(name => [name, hash(fs.readFileSync(path.join(root, name)))])),
};
const files = inventory(site, ["release-manifest.json"]);
files["stats.json"].mutable = true;
const original = JSON.parse(fs.readFileSync(path.join(root, "../public-source-manifest.json")));
const manifest = {
  schemaVersion: 1,
  mode: "candidate",
  sourceSnapshotSha256: original.sourceSnapshotSha256,
  frontendSourceSha256: hash(JSON.stringify(sourceFiles)),
  frontendSourceFiles: sourceFiles,
  config: JSON.parse(fs.readFileSync(path.join(site, "config.json"))),
  files,
  notes: {
    scope: "Authorized interface publication; original source snapshot binds the unchanged contract/helper only. Frontend has separate provenance.",
    productionRelease: false,
    independentReviewInherited: false,
    frontendReadOnly: true,
    statistics: "Collector snapshot; freshness checked at display and publication time.",
    demo: "Fictional examples are opt-in via demo=1 and are never live acceptance evidence.",
    packetPresentation: "Gift surfaces omit monetary amounts. Existing contract payouts remain fixed-share, not random.",
  },
};
fs.writeFileSync(path.join(site, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Built ${Object.keys(files).length} public files with separate frontend provenance.`);
