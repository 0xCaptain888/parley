import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const tokenPattern = /^[1-9]\d{4,19}:[A-Za-z0-9_-]{30,100}$/;

async function request(token, method, body, fetcher) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', redirect: 'error', credentials: 'omit', signal: controller.signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^application\/json\b/i);
    assert.ok(response.body);
    const reader = response.body.getReader(), chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        assert.ok(bytes <= 262144);
        chunks.push(Buffer.from(part.value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(result.ok, true);
    return result.result;
  } finally { clearTimeout(timeout); }
}

export async function discoverTelegramChats(token, {
  fetcher = fetch, now = Math.floor(Date.now() / 1000),
} = {}) {
  try {
    assert.ok(tokenPattern.test(token));
    const webhook = await request(token, 'getWebhookInfo', {}, fetcher);
    assert.equal(typeof webhook?.url, 'string');
    if (webhook.url !== '')
      return { status: 'TELEGRAM_WEBHOOK_PRESENT_NO_CHANGES', candidates: [] };
    // No offset or allowed_updates: do not acknowledge updates or change the filter.
    const updates = await request(token, 'getUpdates', { limit: 100, timeout: 0 }, fetcher);
    assert.ok(Array.isArray(updates) && updates.length <= 100);
    const candidates = new Map();
    for (const update of updates) {
      const message = update?.message;
      if (!message || typeof message.text !== 'string'
        || !/^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(message.text)
        || !Number.isSafeInteger(message.date)
        || message.date > now || now - message.date > 900) continue;
      const chat = message.chat;
      if (!chat || !Number.isSafeInteger(chat.id) || chat.id === 0
        || !['private', 'group', 'supergroup', 'channel'].includes(chat.type)) continue;
      candidates.set(String(chat.id), { chatId: String(chat.id), type: chat.type });
    }
    return {
      status: candidates.size ? 'TELEGRAM_CHAT_CANDIDATES' : 'TELEGRAM_NO_RECENT_START',
      candidates: [...candidates.values()],
    };
  } catch {
    // Transport exceptions may include the token-bearing URL.
    throw new Error('TELEGRAM_DISCOVERY_FAILED_CLOSED');
  }
}

export async function discoveryCommand(args, stdin = process.stdin, options) {
  try {
    assert.deepEqual(args, ['--approve-readonly-chat-discovery']);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of stdin) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      assert.ok(bytes <= 128);
      chunks.push(buffer);
    }
    return await discoverTelegramChats(Buffer.concat(chunks).toString('utf8'), options);
  } catch {
    throw new Error('TELEGRAM_DISCOVERY_FAILED_CLOSED');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await discoveryCommand(process.argv.slice(2))));
  } catch {
    console.error('TELEGRAM_DISCOVERY_FAILED_CLOSED');
    process.exitCode = 2;
  }
}
