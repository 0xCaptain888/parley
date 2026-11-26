# Bounded OpenClaw Inference Acceptance

This is a generated, dependency-free acceptance runner for the existing pinned
OpenClaw installation. It does not install a runtime or change production config.
Use the dedicated `parley-agent` account and a clean environment.

`--execute-parley-smoke preflight` runs the actual OpenClaw CLI against a local
mock server. It makes zero requests to the real relay and does not load its key.
It validates a private test config, then checks the actual runtime result.

`--execute-parley-smoke run --approve-one-inference` first repeats that local
preflight. Only after success does it reserve an exclusive persistent receipt,
load the existing relay-specific credential and run the live acceptance.

The child gets a fresh HOME, state and empty workspace. Plugins, skills, automatic
context injection, model fallbacks and all tools are disabled. It receives only
a random local gate token, not the relay key. The local gate:

- Binds only 127.0.0.1 on a temporary port.
- Admits one request, synchronously reserving before any asynchronous dispatch.
- Records a durable dispatch reservation before sending to the fixed relay.
- Authenticates the local request and requires the exact synthetic user prompt.
- Recognizes only the pinned runtime's exact fresh GMT+8 timestamp envelope and
  date/timezone-only context message; verifies their date, weekday, timezone and
  three-minute freshness, then strips both before building the relay request.
- Rebuilds the upstream body from an allowlist: no runtime system prompt,
  paths, metadata, skills, business files or previous messages are forwarded.
- Sends exactly the selected model, streaming Responses, no tools, `store:false`
  and `max_output_tokens:512`. No redirects, retries, discovery or compact calls.
- Buffers at most 1 MiB, checks final model/answer/usage, rejects tool events and
  reflected credentials before returning the stream to the child.
- Aborts its upstream connection and closes its local listener on completion.

Tool Search is explicitly disabled as well as Code Mode: the pinned runtime
otherwise adds search/describe/dispatch controls even with a fully denied
business-tool catalog. The mock preflight checks the actual request, not just
the authored configuration. Failure summaries expose only bounded tool names
and fixed refusal codes, never raw provider requests or errors.

This is test-context isolation and tool denial, NOT an OS security sandbox.
The trusted existing runtime runs under the same OS account as the real Agent.
It has no model-exposed tools and receives no real credential; the runner does
not claim to contain malicious runtime code or a compromised operating system.

Private generated state and child diagnostics stay in the dedicated HOME.
Diagnostics contain only the child-side local token and synthetic run; do not
publish them automatically. The main output/report is sanitized. No wallet,
channel, daemon, public port, DNS, firewall or monitor change is included.

The receipt `/var/lib/parley-agent/.openclaw/openclaw-one-shot-report.json`
blocks replay even after a failure. Review it before any separately authorized
recovery; never remove it automatically. Token caps are not a currency guarantee.
Reported usage and model identity are relay claims, not independent billing or
upstream-identity verification.

The runner can be invoked as a normal reviewed file, or as the same
SHA-256-checked module loaded into the existing Node interpreter in memory.
The latter avoids installing or overwriting server-side source files.
The adapter import is an explicit `file:` URL so it also resolves from a `data:`
module; this path is covered by a local no-key, no-network regression test.
