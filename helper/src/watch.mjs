import { run } from './app.mjs';
import { parseArgs, integer } from './normalize.mjs';

export async function watch(argv, config, emit, signal) {
  const { options } = parseArgs(argv);
  const interval = integer(options.interval ?? '15', 5, 3600) * 1000;
  let next;
  do {
    const snapshot = await run(argv, config, { watchFrom: next });
    const items = snapshot.summary.items;
    if (items.length || options.once) emit(snapshot);
    if (items.length) next = items.at(-1).index + 1;
    else next = snapshot.summary.acked;
    if (options.once || signal?.aborted) break;
    await new Promise(resolve => {
      const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, interval);
      signal?.addEventListener('abort', done, { once: true });
    });
  } while (!signal?.aborted);
}
