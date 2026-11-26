import { run } from './app.mjs';
import { stringify } from './calls.mjs';
import { abi } from './chain.mjs';
import { decodeFailure } from './errors.mjs';
import { englishError } from './i18n.mjs';
import { watch } from './watch.mjs';

const config = __PARLEY_CONFIG__;
const args = process.argv.slice(2);
if (args.includes('--help') || !args.length) {
  console.log(stringify({ ok: true, command: 'help', configured: !!config.contract, chainId: config.chainId,
    commands: ['status', 'open', 'key rotate', 'packet create|claim|refund|show|list',
      'inbox', 'read <index>', 'ack <index|all>', 'send --to <name> --text <text>',
      'request create|pay|decline|cancel|list', 'offer create|accept|decline|cancel|counter|show|board',
      'contact allow|block|unblock <name>', 'postage set <BNB>', 'stamp reclaim <name>', 'withdraw',
      'policy show|set', 'result <txHash> [--plan <planId>]', 'watch [--interval 15] [--once]',
      'deal start --to <name> --side sell|buy --asset-token <token> --asset-amount <n> --unit <token> --target <n> --floor <n>|--ceiling <n>',
      'deal next <thread> [--with-postage]'],
    required: '--from <your BSC Agentic Wallet address>', options: ['--rpc <url>', '--home <directory>', '--lang zh|en'],
    warning: '脚本不发送交易。每笔调用必须经官方钱包预览、展示风险、用户逐笔确认。' }));
} else {
  try {
    if (args[0] === 'watch') {
      const controller = new AbortController();
      process.once('SIGINT', () => controller.abort());
      process.once('SIGTERM', () => controller.abort());
      await watch(args, config, row => console.log(stringify(row)), controller.signal);
    } else console.log(stringify(await run(args, config)));
  }
  catch (error) {
    const decoded = decodeFailure(error, abi);
    const e = args[args.indexOf('--lang')+1]==='en'?englishError(decoded):decoded;
    console.log(stringify({ ok: false, command: args[0], code: e.code, reason: e.reason, ...(e.hint ? { hint: e.hint } : {}) }));
    process.exitCode = e.usage ? 2 : 1;
  }
}
