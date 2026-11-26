# Selected Third-Party Relay

User-selected endpoint: `https://api.apikey.fan`.
User-confirmed exact model: `gpt-6.1-sol`.

This is not direct OpenAI Platform or ChatGPT/Codex OAuth. Use only a dedicated
relay key. Do not import official-provider credentials, wallet sessions or local
Codex auth. Operator trust and the relay's actual upstream model identity are not
verified by an API response or a model name.

## Current State

The adapter is prepared locally. It has not been uploaded or run on the server,
and no paid call or secret entry is authorized by confirming a model's spelling.
`openai-responses` is a candidate dialect that must pass the real relay probe;
there is no automatic fallback to Completions, another model, provider or account.

## Explicit Approvals

Before upload/run, explain and obtain action-time approval for the new scripts.
Before key entry, explain the destination and storage: a relay-specific key
goes to the user's Aliyun server, never into chat or command arguments, and is
stored at `/var/lib/parley-agent/.openclaw/relay-api-key`, mode 0600.

The file is not encrypted at rest. The dedicated OS account and root can read it.
SecretRef keeps the literal out of the authored main config but is not an OS
sandbox or proof that an Agent cannot access a file. Review tool confinement
before enabling a model-driven Agent with credentials. Terminal recording by a
cloud console is outside this adapter's control; prefer a trusted direct SSH
terminal for entering secrets if console input retention is uncertain.

Before `probe`, obtain approval to send this relay key and synthetic test data to
`https://api.apikey.fan/v1/models` and `/v1/responses`. Maximum: one catalog GET
and three inference POSTs, each requesting at most 512 output tokens. The key
must be scoped/limited at the relay. Token caps are not a monetary hard limit;
the relay's pricing, charging behavior and available account credit remain
operator-controlled. Do not promise a currency cap or free testing.
Each outgoing inference body is also capped at 8192 bytes, including replayed
test output. Reported token usage is checked but is not independent billing proof.

There are no redirects, retries, parallel calls or real external tool execution.
The only test tool echoes a synthetic nonce locally. Failures stop the test.
A pre-existing report (including an empty interrupted receipt) blocks replay
until an operator inspects it. No automatic deletion or credential rotation.

## Operator Sequence After Approval

Install reviewed public adapter files root-owned and not group/world-writable.
Use a clean environment, not the root user's or a developer's credential context:

```sh
sudo -u parley-agent env -i HOME=/var/lib/parley-agent \
  PATH=/opt/parley-runtime/bin:/usr/bin:/bin \
  bash /opt/parley-agent-host/enter-relay-key.sh --approve-private-storage
```

The user enters the key at the hidden prompt. Do not observe or capture that
entry. Neither shell history nor Node arguments contain the value.
Exclusive creation refuses an existing credential.

After separate test approval:

```sh
sudo -u parley-agent env -i HOME=/var/lib/parley-agent \
  PATH=/opt/parley-runtime/bin:/usr/bin:/bin \
  node /opt/parley-agent-host/relay.mjs probe --approve-relay-tests
```

Success creates a sanitized receipt at
`/var/lib/parley-agent/.openclaw/relay-probe-report.json`. It proves direct relay
API behavior, not OpenClaw inference, actual upstream identity or business flow.
Do not print raw responses, raw error bodies, request headers or credential files.

Only after success, generate the public config patch:

```sh
sudo -u parley-agent env -i HOME=/var/lib/parley-agent \
  PATH=/opt/parley-runtime/bin:/usr/bin:/bin \
  node /opt/parley-agent-host/relay.mjs write-plan
sudo /opt/parley-agent-host/bin/parley-agent config patch \
  --file /var/lib/parley-agent/.openclaw/parley-relay.patch.json --dry-run --json
sudo /opt/parley-agent-host/bin/parley-agent config patch \
  --file /var/lib/parley-agent/.openclaw/parley-relay.patch.json
sudo /opt/parley-agent-host/bin/parley-agent config validate --json
```

Use OpenClaw's validated patch writer to preserve unrelated configuration.
The patch deliberately clears default model fallbacks to avoid switching billing
routes; inspect existing defaults before applying it. It does not remove other
provider records, agent-specific overrides or session pins. Inspect those before
declaring the entire host relay-only. No gateway, wallet, channel or tool policy
is enabled or relaxed by the patch.
The model's 512-token output setting is an acceptance-stage operating cap, not a
claim about the native model capacity or the eventual production configuration.

## Next Acceptance Layer

Verify the effective model/runtime and SecretRef resolution on the actual host,
then perform a separately approved bounded OpenClaw inference test. Use a clean
test workspace with no user documents, wallet sessions or secrets and tools
explicitly denied; don't send the real workspace to the relay merely for a
connectivity test. Inspect the actual runtime's request count and output limits
before promising a bounded test. Direct HTTP probe success is not that result.

Continue wallet and production business acceptance only under their own review
and per-transaction approvals. The previous 15/15 host bootstrap remains a
separate layer.
