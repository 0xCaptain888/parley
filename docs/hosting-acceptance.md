# Static Hosting Preparation and Acceptance

Implements the public artifact/hosting checks from specification sections 8, 9, 12 and 14. Local packaging and a point-in-time HTTP probe are not public release, clean-machine installation, wallet acceptance, uptime or user adoption evidence.

## Prepare a Staging Bundle

After full verification, a current Slither scan and the implementation-side security summary:

```sh
npm run prepare:site
```

Default staging requires `contract: null`, no deployment block and `stats.json: null`. Its helper cannot construct transactions. The command rebuilds from the current source, checks the rebuilt Skill against the full-verification manifest, and exports a new timestamped directory under `docs/reports/site-bundle-*/`.

Only 14 explicitly allowlisted files enter `site/`: HTML/CSS including a standalone 404 page, bundled browser JS, stamp image, fictional interface video, public configuration/statistics, four Skill download files and host routing/header files. `release-manifest.json` records the source snapshot and every public file's bytes/SHA256. `site.zip` contains exactly those 15 files. Source directories, private state, `.env`, wallet data and dependencies are not copied.

Unexpected public configuration fields, credential-bearing/query/path RPC endpoints, configuration drift, changed Skill downloads, escaping symlinks and changed files during copying fail closed. Public RPCs must use HTTPS origins without credentials. Authenticated statistics RPCs belong in private environment configuration, never in browser configuration.

The prepared bundle is local only. No hosting provider login, upload, DNS change, domain purchase or external publication is performed.

## Configured Candidate

Once the separately authorized final deployment and public configuration exist:

```sh
npm run prepare:site -- --candidate
```

This still prepares a local candidate, not a production release. It requires a real nonzero BSC contract address, canonical HTTPS site origin, positive deployment block, resident handle and disclosed exclusions. Preparation does not close external gates or authorize uploading.

Candidate packaging intentionally does not require the final publication check: the clean-machine gate needs real downloadable artifacts before the final release can be approved. Any authorized pre-release hosting/Skill download test must be clearly separated from a production announcement. After independent review, real-wallet and 20-step acceptance, actual clean-machine installation and all other evidence, run the existing `npm run check:release` before approving production publication. Never use a staging package, candidate label or HTTP success to bypass that command.

## Host Configuration

Upload only the contents of the prepared `site/` directory to an explicitly approved static host. Adapt `_headers` and `_redirects` to the provider's actual configuration format if necessary; their presence in the ZIP does not prove the host applies them.

Required behavior:

- Serve all six routes as the same build's HTML, including direct navigation to `/p/1`, `/board`, `/stats` and `/docs`.
- Keep Skill downloads on the exact canonical HTTPS origin; serve Markdown as `text/markdown`, JavaScript as JavaScript and ZIP as a ZIP, not a fallback HTML page.
- Apply `nosniff`, `no-referrer`, the supplied CSP and one-year HSTS. Revalidate configuration and Skill downloads; do not cache old deployment metadata as immutable.
- Deny sensitive/private paths with 403/404/410. Do not make a blanket SPA rewrite return 200 for `.env`, repository metadata or private state.
- Serve `release-manifest.json`. Refresh real statistics separately; never replace an RPC outage with fictional metrics.

## Read-Only HTTP Check

After an explicit hosting decision and actual HTTPS deployment:

```sh
npm run check:hosting -- https://ACTUAL-ORIGIN docs/reports/site-bundle-ACTUAL/site/release-manifest.json
```

The origin must be a credential-free HTTPS root on the default port, not a local/literal-IP target. This CLI is not an HTTP proxy or a DNS-pinning/SSRF security boundary; run it only against the operator's intended public origin.

The checker performs 24 GET probes: 11 public assets, the manifest, six routes, five private-path denials and an unknown-page check against the exact 404 artifact hash. It refuses redirects except the exact `/index.html` 308 canonicalization to `/`; the root still requires the exact HTML hash and security headers. It also rejects partial responses, mismatched bytes/content types/configuration, missing security headers, unsafe duplicate CSP directives and unbounded responses. No cookies, credentials or wallet data are sent.

On Cloudflare Pages, keep the top-level `404.html` to disable implicit blanket SPA fallback. The five explicit app rewrites target `/`, not `/index.html`, to avoid a platform canonicalization redirect. Unknown/private URLs must be 404 rather than successful app HTML. This is routing hardening, not a substitute for the bundle's private-file exclusion. Always validate these rules on the actual provider after upload.

Candidate statistics are the sole mutable public file. They must name the same contract and exclusions, carry a valid block/hash anchor, and be at most 20 minutes old. This is an HTTP freshness/configuration check, not a proof of chain completeness, finality or genuine users. The statistics collector's chain-bound evidence must be evaluated separately.

Reports contain sanitized pass/fail checks, no response bodies or raw transport exceptions. Failure reports are retained. Neither success nor failure changes release flags. A successful result explicitly retains `cleanMachineSkillInstall: false` and `productionRelease: false`.

## Remaining External Acceptance

For repeatable local CSP/rendering checks, start the loopback development server on port 4207 with the default unconfigured build, then run `npm run test:hosting-browser`. It checks six routes at desktop/mobile widths, rejects external requests, snapshots source/public-asset hashes, and saves screenshots plus a timestamped report. This local policy injection does not prove a remote provider actually sends the headers. The existing `npm run test:browser` separately covers bilingual UI and actual local-chain fixtures.

Still required: actual provider/DNS/HTTPS configuration; official Skill installation on a clean machine from the real URL with download hashes and logs; desktop/mobile browser/rendering checks against that origin; independent review; real-wallet/20-step acceptance; statistics scheduling, monitoring and resident staffing; and user-approved publication.

The bundled 30-second video is a labelled fictional interface demo. It is not the required real two-wallet submission video.
