import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flag = process.argv.indexOf('--config');
const file = flag >= 0 ? path.resolve(process.argv[flag + 1]) : path.join(root, 'config/build.json');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
if (config.chainId === 56 && config.contract && (!config.site || !config.site.startsWith('https://')))
  throw new Error('Mainnet build requires an HTTPS site URL.');
for (const dir of ['helper/dist', 'skill', 'web/site/skill', 'web/site/assets']) fs.mkdirSync(path.join(root, dir), { recursive: true });
await build({
  entryPoints: [path.join(root, 'helper/src/cli.mjs')], outfile: path.join(root, 'helper/dist/parley.mjs'),
  bundle: true, platform: 'node', target: 'node20', format: 'esm', minify: false,
  define: { __PARLEY_CONFIG__: JSON.stringify(config) }, legalComments: 'inline',
  banner: { js: '#!/usr/bin/env node\n// Parley v1.0: read-only helper. Never signs or broadcasts.' },
});
fs.copyFileSync(path.join(root, 'helper/dist/parley.mjs'), path.join(root, 'skill/parley.mjs'));
let skill = fs.readFileSync(path.join(root, 'skill-template.md'), 'utf8');
const origin = config.site || 'https://UNCONFIGURED.invalid';
skill = skill.replaceAll('https://YOUR_DOMAIN', origin);
skill += `\n## Deployment\n\n${config.contract ? `Chain: ${config.chainId}. Contract: \`${config.contract}\`.` : '**NOT DEPLOYED. This development build cannot construct transactions.**'}\n`;
skill += '\n## Additional safety and recovery\n\nNever execute an entry with `simulated: false`. After an approval confirms, rerun the original helper command. Always pass the returned `planId` to `result --plan <id>` when more than one plan is pending. A result marked pending is not a payment.\n\nMailbox keys are not wallet keys. Back up the local state directory privately; missing mailbox keys prevent reading old mail but do not remove withdrawal rights. `key rotate` retains prior keys and activates the staged key only after on-chain registration. Ciphertexts are public and have no forward secrecy.\n\nFor BSC, use the `data.addresses[]` item whose `binanceChainId` stringifies to `"56"`. Read current official wallet documentation if CLI fields differ. Never resolve another name for display.\n\nAll P0 commands and the optional P1 `watch` and bounded `deal` commands are listed by `node parley.mjs --help`. Every negotiation step still requires individual preview and confirmation. Local test evidence is not real-wallet acceptance.\n';
fs.writeFileSync(path.join(root, 'skill/SKILL.md'), skill);
const zip = path.join(root, 'skill/parley.zip');
fs.rmSync(zip, { force: true });
// Stable timestamps, entry order and no extra metadata make local release builds reproducible.
for (const name of ['SKILL.md', 'parley.mjs']) fs.utimesSync(path.join(root, 'skill', name), 0, 0);
execFileSync('zip', ['-X', '-q', zip, 'SKILL.md', 'parley.mjs'], { cwd: path.join(root, 'skill') });
const names = ['SKILL.md', 'parley.mjs', 'parley.zip'];
const sums = names.map(name => `${createHash('sha256').update(fs.readFileSync(path.join(root, 'skill', name))).digest('hex')}  ${name}`).join('\n') + '\n';
fs.writeFileSync(path.join(root, 'skill/SHA256SUMS'), sums);
for (const name of [...names, 'SHA256SUMS']) fs.copyFileSync(path.join(root, 'skill', name), path.join(root, 'web/site/skill', name));
fs.writeFileSync(path.join(root, 'web/site/config.json'), JSON.stringify(config, null, 2) + '\n');
if(!config.contract)fs.writeFileSync(path.join(root,'web/site/stats.json'),'null\n');
await build({ entryPoints: [path.join(root, 'web/site/src/app.mjs')], outfile: path.join(root, 'web/site/assets/app.js'),
  bundle: true, platform: 'browser', target: 'es2022', format: 'esm', minify: true });
console.log(`Built ${config.contract ? `chain ${config.chainId}` : 'UNCONFIGURED development'} release.\n${sums}`);
