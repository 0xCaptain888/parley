import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const p=spawn(process.execPath,[path.join(root,'contracts/node_modules/hardhat/internal/cli/cli.js'),'test','test/fuzz.test.js'],{
  cwd:path.join(root,'contracts'),env:{...process.env,PARLEY_LONG_FUZZ:'1'},stdio:'inherit',
});
p.on('exit',code=>{process.exitCode=code??1;});
