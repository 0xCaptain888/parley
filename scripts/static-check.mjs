import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const r=spawnSync(path.join(root,'node_modules/.bin/solhint'),
  ['--disc','--noPoster','-c','../.solhint.json','-f','json','contracts/Parley.sol'],{cwd:path.join(root,'contracts'),encoding:'utf8'});
let entries;
try{entries=JSON.parse(r.stdout);}catch{throw new Error(`Solhint did not return JSON: ${r.stderr}`);}
const messages=entries.filter(e=>e.ruleId);
const errors=messages.filter(e=>String(e.severity).toLowerCase()==='error');
fs.mkdirSync(path.join(root,'docs/reports'),{recursive:true});
fs.writeFileSync(path.join(root,'docs/reports/solhint.json'),JSON.stringify(entries,null,2)+'\n');
console.log(JSON.stringify({tool:'solhint',errors:errors.length,warnings:messages.length-errors.length,errorDetails:errors},null,2));
process.exitCode=errors.length?1:0;
