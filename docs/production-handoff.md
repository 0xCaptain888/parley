# Production Handoff

2026-11-26. These tools implement preparation and evidence recording. They do
not assert a formal deployment, successful real-user acceptance or public launch.

## Deployment Parameters

```sh
npm run check:deployment-inputs -- --intent /absolute/private/deployment-intent.json
```

The report lists all missing/invalid fields and cross-field conflicts, instead
of stopping after the first empty amount. No postage, cap or Gas budget is
selected automatically. Completed input still needs operator approval and a
fresh live Gas estimate. `prepare:deployment` uses the same validation.

## Private Participation Kit

The participants input must contain exactly A and B, each with only `handle`
and `wallet`. Historical names/addresses identify candidates, not consent.

```sh
npm run prepare:participation -- --intent /absolute/private/deployment-intent.json --participants /absolute/private/participants.json --output /absolute/new/private-kit
```

This produces a current-source pending acceptance record, twenty empty step
patches, separate consent templates, submission input, interview questions and
growth-evidence fields. Files are mode 0600 in a mode-0700 directory. Nothing
is uploaded. No status is marked passed, no answers or metrics are invented,
and identity/screenshot publication consent stays false.

After a genuine final deployment, regenerate the kit against that deployment;
do not copy historical passed evidence to a new source or contract. Obtain both
participants' actual consent and retain hashed contained evidence. The source
snapshot now includes cloud installation scripts, timers and wallet guards;
earlier snapshots remain historical rather than being relabeled current.

## Real Acceptance Session

```sh
npm run prepare:acceptance-session -- --record /absolute/private/acceptance.json
npm run record:acceptance -- --record /absolute/private/acceptance.json --patch /absolute/private/steps/01.json --output /absolute/private/acceptance-next.json
```

The session shows prerequisites and only the next unfinished original step.
Run the actual operation with its real participant, preserving every separate
official preview, human consent, receipt and outcome. A template is not evidence.
Only then fill the patch's status/time/reviewer/evidence. Evidence references
use project-contained relative paths and SHA-256 digests; keep private evidence
outside the public static tree.

Recording validates the original step, order, evidence bytes, participant and
transaction binding. Read-only steps cannot contain transactions. Rejections
must produce no calls and preserve the policy digest. The previous record is
not overwritten; the new record contains its predecessor's digest. Existing
output files are refused. Recording does not execute anything or authenticate
a participant's independence, the truth of a note or the origin of a consent.

Run structural and canonical chain checks after recording actual steps:

```sh
npm run check:acceptance -- --record /absolute/private/acceptance-next.json
npm run check:acceptance-chain -- --record /absolute/private/acceptance-next.json --rpc https://bsc-rpc.publicnode.com
```

Neither command changes release gates. Independent review is still required.

## Wallet And Business Host

`operations/agent/KEYRING.md` documents new-keyring setup and existing-keyring
private unlock recovery. The guarded wallet preflight now supports BSC lock
checks and allowlists nested settings/address fields. No direct-wallet
fallback is permitted by this wrapper. Real keyring, fresh-login and business
acceptance must be performed on the actual cloud host, not inferred from tests.

```sh
npm run prepare:business-runtime -- /absolute/new/runtime-output
```

The package contains four self-contained jobs plus a first-install-only
runtime installer. It does not install or start a service locally or remotely.
Review the exact archive hash before cloud installation. Follow
`operations/business/README.md` and the existing `prepare:resident-linux`
workflow for final configuration and separately approved service activation.

No trial address, example budget, stale reference price or global transaction
authorization may be substituted for the final operator inputs.

## Publication And Operations

Use the existing source-bound site preparation/publication workflow only after
its verification prerequisites. Public upload remains an explicit action.
Staging is not a production release and continues to reject transactions while
the final contract is null.

Real 24-hour logs, delivered operational alerts, incident ownership and actual
growth/interviews must be supplied. `prepare:submission` validates their hashed
evidence index but never fabricates users, submits forms or publishes personal
data. Keep the private kit, credentials, mail and interview notes out of every
public archive.
