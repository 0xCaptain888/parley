import { telegramCommand } from './telegram-alert.mjs';

try {
  console.log(JSON.stringify(await telegramCommand(process.argv.slice(2))));
} catch {
  console.error('TELEGRAM_OPERATION_FAILED_CLOSED');
  process.exitCode = 2;
}
