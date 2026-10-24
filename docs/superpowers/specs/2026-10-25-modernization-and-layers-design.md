# zigbee2mqtt-exporter — modernization, layers, unit tests, CI

Status: implemented (2026-10-25)
Date: 2026-10-25
Branch: `feature/modernize-exporter`

## Intent

The exporter is two files and about 100 lines: one Express route that opens a
Zigbee2MQTT websocket on every scrape and emits `zigbee2mqtt_last_seen`, plus
listen/error plumbing. It has no tests, no seams, and tooling that no longer
matches the rest of the stack.

Modernize it to the stack used by `../agent-test` (pnpm, ESM, TypeScript,
Fastify, Vitest, ESLint flat config, Prettier), give the one piece of real
logic a testable shape, cover it with unit tests, make CI run those tests, and
publish a signed multi-arch image on tag push.

**The HTTP contract does not change** except where a listed bug fix requires
it.

## Goals

- Same `/metrics` metric, labels, and units; same port and path.
- The WebSocket parsing and the "wait until every device reported" state
  machine become pure functions with unit tests, no socket needed.
- Fastify replaces Express; `morgan` is dropped in favour of Fastify's logger.
- pnpm everywhere: local, CI, Docker. `package-lock.json` is replaced by
  `pnpm-lock.yaml`.
- Every dependency is updated to its latest compatible version or removed.
- CI runs lint, typecheck, tests and coverage on every push and PR; the
  Docker publish workflow depends on it.
- The bugs listed below are fixed, each with a test that fails before the fix.

## Non-goals

- No new metrics, labels, endpoints, or query parameters.
- No caching of snapshots, no connection reuse across scrapes, no retry or
  backoff, no `/health`. The exporter stays stateless per scrape.
- No change of data source. The exporter keeps reading the Zigbee2MQTT
  websocket API (`ZIGBEE2MQTT_WS`). `mqtt.techtales.io` is used read-only by
  one opt-in test, never by the running service.
- No `home-ops` change. Port, path and metric name stay put, so the deployed
  `DeviceNotSeen` alert keeps working untouched.

## Anti-goals

- Indirection without a reason: no DI container, no interfaces with a single
  implementation, no `controllers/services/repositories` triple for one route.
- Tests that need a broker, network, or `sleep` to pass.
- A rewrite that also changes the numbers on the dashboard.

## Constraints and verified facts

Deployment contract, from `../home-ops/kubernetes/main/apps/home-automation/
zigbee2mqtt/app/`:

| Fact | Value |
| --- | --- |
| Shape | sidecar in the Zigbee2MQTT pod |
| Port | 3000 (`PORT`, default 3000) |
| Path | `/metrics`, scrape interval 5m, `scrapeTimeout` 15s |
| Metric | `zigbee2mqtt_last_seen{device="<friendly_name>"}` seconds |
| Consumer | `DeviceNotSeen` alert: `> 60*60*24` for 10m |
| Source | `ZIGBEE2MQTT_WS=ws://127.0.0.1:8080/api` |
| Last seen | `ZIGBEE2MQTT_CONFIG_ADVANCED_LAST_SEEN: ISO_8601` (enabled) |

Payload facts, read 2026-10-25 from the live broker `mqtt.techtales.io:1883`
(retained `zigbee2mqtt/bridge/devices`, read-only, 130 devices):

- Each entry carries `type` (`"Coordinator"` for the coordinator) and
  `friendly_name`, and has **no** `last_seen` field.
- The coordinator's `friendly_name` happens to be `"Coordinator"` today, which
  is why the old name comparison worked; it is not guaranteed. Filtering is
  therefore on `type`, not on the name, so renaming the coordinator cannot
  deadlock the exporter.
- Assumption worth recording: Zigbee2MQTT 2.14.x replays, on every websocket
  connection, the retained topics and then one state message per
  non-coordinator device including `last_seen`. That is what makes a scrape
  complete in milliseconds. It is verified for the payload shapes above but
  not for the replay order from this machine (the frontend is behind SSO), so
  the collector buffers device messages that arrive before `bridge/devices`
  instead of relying on the order.

Versions checked against the npm registry on 2026-10-25:

| Package | Now | Target |
| --- | --- | --- |
| fastify | — | 5.12.7 |
| ws | 8.22.0 | 8.22.0 (current) |
| @types/ws | 8.18.2 | 8.18.2 (current) |
| @types/node | 24.19.2 | 24.19.2 (matches Node 24 runtime) |
| typescript | 5.9.3 | 6.0.3 |
| vitest / @vitest/coverage-v8 | — | 5.0.5 |
| vite (non-optional peer of vitest 5; pnpm does not install peers) | — | 8.3.5 |
| eslint | 9.39.5 | 10.13.0 |
| @typescript-eslint/* | 8.72.0 | 8.72.0 (current) |
| prettier | 3.9.10 | 3.9.10 (current) |
| tsx | — | 4.23.15 |
| eslint-config-prettier | 10.1.8 | 10.1.8 (current) |
| mqtt (dev only, opt-in test) | — | 5.16.1 |
| express, morgan, @types/express, @types/morgan, eslint-plugin-import | present | removed |

TypeScript is deliberately held at 6.0.3, not the 7.0.2 `latest`:
`@typescript-eslint@8.72.0` declares `typescript: >=4.8.4 <6.1.0`. Taking TS 7
would either break linting or force a lint rewrite, which is a new problem, not
a modernization. Revisit when typescript-eslint supports TS 7.

pnpm 12.15.0, pinned via `packageManager` and `.mise.toml`. Node stays 24.22.1
(Dockerfile, `.nvmrc`, latest 24.x).

## Architecture

Layers, one direction only: `http -> infrastructure -> application -> domain`.
`domain` imports nothing. `application` imports `domain` only. `infrastructure`
may import `application` and `domain`. `http` wires everything. Nothing imports
`http`.

```
src/
  domain/
    device.ts                       # Device, COORDINATOR_NAME, lastSeenSeconds()
  application/
    last-seen-collector.ts          # pure state machine over Zigbee2MQTT messages
    device-source.ts                # port: DeviceSource { collect(): Promise<LastSeen> }
  infrastructure/
    z2m-websocket-source.ts         # ws adapter implementing DeviceSource
    message-parsing.ts              # defensive parse of websocket frames
    prometheus.ts                   # LastSeen -> text exposition body
  http/
    metrics-route.ts                # registers GET /metrics
  config.ts                         # env -> Config, validated at boot
  app.ts                            # buildApp({ source }) -> FastifyInstance
  index.ts                          # bootstrap, listen, signal handling
```

Supporting types:

- `LastSeen = ReadonlyMap<string, number>` — friendly name to epoch ms.
- `CollectResult` — the port's outcome, so the route can tell a dead socket
  from a quiet device:

  ```ts
  type CollectResult =
    | { ok: true; lastSeen: LastSeen }
    | { ok: false; reason: 'timeout' | 'source-error'; message: string }
  ```

- `DeviceSource.collect(): Promise<CollectResult>` — resolves when every non-
  coordinator device has reported, or fails as above.
- `SocketLike` — the `on("message" | "error" | "close", ...)` and `close()`
  members the adapter uses, so a fake socket drives every branch.
- `Logger` — `{ warn, error }` only, injected into the adapter so it can speak
  without reaching for Fastify's logger or `console` directly. `index.ts`
  supplies a `console`-backed default; tests supply a spy.

`createLastSeenCollector()` is the heart, pure and synchronous:

```
collector.handle({ topic, payload }) ->
  | { status: "collecting" }
  | { status: "complete", lastSeen: LastSeen }
```

It owns: `bridge/devices` seeds the device list minus `Coordinator`; a message
whose topic matches a known device records `last_seen`; completion once every
seeded device has reported; unknown topics ignored.

The adapter owns the socket lifecycle: open on `collect()`, feed messages into
the collector, settle exactly once (complete, socket error, socket closed
before completion, or deadline), and close the socket on every exit path.

## Resolved ambiguities

Questions the design left open, and the call made on each. Every one is
asserted by a test.

1. **Device message with no usable `last_seen`** (Zigbee2MQTT publishes one
   only when `advanced.last_seen` is enabled; `home-ops` sets
   `ZIGBEE2MQTT_CONFIG_ADVANCED_LAST_SEEN: ISO_8601`, so it is on in
   production, but a device that has never reported since start can still send
   a state message without it). The device counts as reported — otherwise a
   peer misconfiguration would turn every scrape into a deadline failure — but
   its sample is omitted from the exposition and a warning names the device.
   `NaN` is never emitted: it parses cleanly, compares false against the alert
   threshold, and silently disables `DeviceNotSeen` for that device while the
   scrape stays green.
2. **Malformed frame**: parsed defensively, logged at `warn`, ignored. It does
   not settle the scrape; the deadline remains the backstop.
3. **Socket closes before completion** (Zigbee2MQTT restarting): settles as
   `source-error` → `500`. A reachable-but-vanished source is a failure, not
   the quiet-device case the deadline exists for. Today this hangs.
4. **Second `bridge/devices` mid-scrape**: reconciled, not reset — timestamps
   are kept for devices still listed, new devices are added, removed devices
   dropped, and completion is recomputed over the new expected set. A reset
   would turn a nearly complete scrape into a timeout whenever a device joins.
5. **Failure channel**: `CollectResult` above; the route maps `timeout` to
   `504` and `source-error` to `500`. `SCRAPE_DEADLINE_MS` flows config →
   source factory → adapter, so the port stays free of configuration.
6. **Logging from the adapter**: injected `Logger` port, defaulted in
   `index.ts` to `console.warn`/`console.error`. No direct `pino` import.
7. **Pre-commit lint hook**: `tyriis/pre-commit-npm` runs `npm run lint` and
   cannot be repointed, so it is replaced with `repo: local` hooks running
   `pnpm run lint` and `pnpm test`. The other hook repos stay.

## Bug fixes included

Each one is a behaviour bug found while reading the current code, fixed here
with a regression test.

| # | Bug | Fix |
| --- | --- | --- |
| B1 | After a socket error the code sends 500 but never settles; a later completing message calls `res.send` again → `ERR_HTTP_HEADERS_SENT`. | Single settlement guard; the request is answered exactly once. |
| B2 | Error path never calls `ws.close()`; the socket and its listeners leak until the peer goes away. | Close in `finally` on every exit path. |
| B3 | No deadline. A device that never reports holds the request until Prometheus' 15s `scrapeTimeout` fails the whole scrape, losing every device, not just the stuck one. | `SCRAPE_DEADLINE_MS`, default 10000 (below the 15s timeout), answer `504` and close the socket. |
| B4 | `JSON.parse` inside the `message` handler throws on a malformed frame → uncaught exception, process exits. | Defensive parse; malformed frames are logged and ignored. |
| B5 | Label values are interpolated raw; a friendly name containing `"`, `\` or a newline produces invalid exposition. | Escape `\`, `"`, `\n` per the text format. |
| B6 | Body has no trailing newline; the text format requires the last line to end with LF. | Append `\n`. |
| B7 | `PORT` and `ZIGBEE2MQTT_WS` are unvalidated; a bad value fails at first scrape, not at boot. | Validate at startup, exit non-zero with a clear message. |
| B8 | `msg.payload.map(...)` on `bridge/devices` throws if the payload is not an array. | Shape guard; unexpected payloads ignored and logged. |
| B9 | CI signs with `cosign-release: v1.13.6` (cosign is v3.x) and the deprecated `COSIGN_EXPERIMENTAL`. | `sigstore/cosign-installer@v4.1.2`, cosign v3 keyless, `cosign sign --yes` on the pushed digest. |
| B10 | The Docker workflow publishes on tag without ever running the test suite. | `docker-build.yaml` requires the `ci` workflow to pass first. |
| B11 | A socket that closes before completion is ignored (`close` handler is empty), so the request waits for a device that will never report. | `close` before completion settles as a source error → `500`. |

Deliberately not fixed, and documented in the README: one websocket per scrape
instead of a shared connection with a cache. It is a design choice with a
different failure profile, not a defect.

## Behaviour contract

Preserved, and asserted by tests:

1. Body shape, after the B5/B6 fixes:

   ```
   # HELP zigbee2mqtt_last_seen Device last seen in seconds
   # TYPE zigbee2mqtt_last_seen gauge
   zigbee2mqtt_last_seen{device="lamp"} 12.345
   ```

   Help/type lines first, then one sample per device in insertion order,
   seconds as `(now - last_seen) / 1000`, terminated by a newline.
2. `Content-Type: text/plain` (Fastify adds `; charset=utf-8`).
3. `Coordinator` never appears in output.
4. Device messages arriving before `bridge/devices` are buffered and replayed
   once the seed lands, rather than dropped as today. The replay order is not
   contractual, and dropping a state message silently loses a device's
   timestamp.
5. Source failure before completion yields `500 Internal Server Error`, as
   does a socket closed before completion; a deadline expiry yields `504`; a
   payload that yields no devices is a valid `200` with just the header lines.
6. `PORT` defaults to 3000; `ZIGBEE2MQTT_WS` defaults to
   `ws://127.0.0.1:8080/api`; `SCRAPE_DEADLINE_MS` defaults to 10000. `PORT`
   is a TCP port number; the accidental unix-socket-path support Express gave
   `PORT` is dropped and noted in the README.

## Testing

Unit tests live next to their subject as `*.test.ts`, run with Vitest, and
never touch the network.

| Test file | Covers |
| --- | --- |
| `domain/device.test.ts` | seconds math, sub-second values, clock skew |
| `application/last-seen-collector.test.ts` | seed filtering, pre-seed messages ignored, duplicate reports, completion, re-seed, unknown topics, bad payload shape (B8) |
| `infrastructure/message-parsing.test.ts` | valid frame, malformed JSON, non-object frames (B4) |
| `infrastructure/prometheus.test.ts` | exact body, empty snapshot, escaping (B5), trailing newline (B6) |
| `infrastructure/z2m-websocket-source.test.ts` | fake socket: resolve on completion, close exactly once, single settlement after error (B1), socket closed on error (B2), deadline → timeout result (B3), close before completion → source error (B11), malformed frame ignored (B4) |
| `http/metrics-route.test.ts` | `app.inject()` 200 body/type, 500 on failure, 504 on deadline |
| `config.test.ts` | defaults, overrides, invalid port, invalid URL (B7) |

Coverage thresholds 100 for lines/functions/branches/statements, excluding
`src/index.ts` (process bootstrap). CI fails below that.

One opt-in integration test, `integration/zigbee2mqtt-broker.test.ts`:

- Runs only with `RUN_LIVE_INTEGRATION=1`; skipped otherwise and in CI.
- Connects to `mqtt.techtales.io:1883` **read-only**, subscribes
  `zigbee2mqtt/bridge/devices`, takes the retained payload.
- Feeds that real payload through the collector and asserts at least one
  non-coordinator device is seeded.
- Never publishes. If no payload arrives within 10s, it skips rather than
  fails, so a flaky LAN cannot redden the suite.

Purpose: prove the parser survives real Zigbee2MQTT payloads.

## Tooling changes

- `package.json`: `"type": "module"`, pnpm, `imports` map (`#root/*` → `src` in
  development, `dist` otherwise), scripts `build`, `dev`, `start`, `test`,
  `test:coverage`, `typecheck`, `lint`, `format`.
- `tsconfig.json`: `module`/`moduleResolution` `nodenext`, target ES2025,
  `rootDir src`, `outDir dist`, `paths` for `#root/*`, `declaration`,
  `sourceMap`, strict.
- `eslint.config.js` (flat, replacing `.eslintrc.js`), mirroring
  `../agent-test`: recommended + recommended-type-checked,
  `explicit-function-return-type`, `no-console` warning with `warn`/`error`
  allowed.
- `vitest.config.ts` with the `#root` alias and coverage thresholds.
- Prettier config copied from `../agent-test` (no semicolons, single quotes).
- `.mise.toml` pinning Node and pnpm; `.nvmrc` kept.
- Pre-commit: the `tyriis/pre-commit-npm` repo (hard-wired to `npm run lint`)
  is replaced by `repo: local` hooks running `pnpm run lint` and `pnpm test`.
  The yaml/markdown/secret checks and the mega-linter workflow stay — they are
  current and not part of the rewritten code. No lefthook: it would fight
  `pre-commit install` over `.git/hooks`.
- `Dockerfile`: pnpm multi-stage build. Builder installs with
  `pnpm install --frozen-lockfile` and runs `pnpm build`; runtime installs
  production deps only, runs `node dist/index.js` as user `node`. Still
  `node:24.22.1-alpine`.
- `README.md`: purpose, env vars, endpoints, dev commands, known behaviour.
- Version `0.2.7` → `0.3.0`.

## CI and image publishing

New `.github/workflows/ci.yaml`:

- Triggers: `pull_request`, `push` to `main`, and `workflow_call` (so the
  publish workflow can require it).
- `concurrency` with `cancel-in-progress` on the ref.
- Step order `actions/checkout@v7.0.1` → `pnpm/action-setup@v6.1.0` (no
  `version:` input; it reads `packageManager` from `package.json`, and v6.1.0
  is the first release with pnpm 12 support) → `actions/setup-node@v7.1.0`
  with `node-version: 24` and `cache: pnpm` (setup-node's pnpm cache needs
  pnpm already on PATH, hence the order).
- Steps: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test:coverage`, upload the coverage report as an artifact, `pnpm build`,
  and a no-push `docker/build-push-action` smoke build to prove the image
  builds before a tag exists.

`docker-build.yaml`, rewritten:

- Triggers: `push` tags `v*.*.*` and `v*.*.*-*`.
- `needs: ci` (the reusable job above) so an image is never published from a
  red tree.
- `docker/metadata-action@v6.2.0` for semver tags and `latest`.
- `docker/build-push-action@v7.4.0`, platforms `linux/amd64,linux/arm64`,
  `provenance: true`, `sbom: true`, GitHub Actions layer cache.
- `sigstore/cosign-installer@v4.1.2` with `cosign-release: v3.1.4` (the
  installer's own default is the older v3.0.6), then
  `cosign sign --yes --bundle ${RUNNER_TEMP}/signature.sigstore.json <image>@<digest>`,
  uploading the bundle as an artifact. `--yes` is required: without it cosign
  v3 prompts for the privacy statement and fails on a TTY-less runner.
  `COSIGN_EXPERIMENTAL` is dropped — keyless signing has not needed it since
  cosign v2.
- Permissions stay minimal: `contents: read`, `packages: write`,
  `id-token: write`.

## Migration steps

1. Tooling scaffold: package.json, tsconfig, eslint/prettier/vitest configs,
   mise, pnpm lockfile; delete `.eslintrc.js` and `package-lock.json`.
2. `domain` + `application` with their tests.
3. `infrastructure` (parsing, adapter, formatter) with their tests.
4. `http`, `config`, `app`, `index` with tests; delete `src/app.ts` and
   `src/server.ts`.
5. Opt-in broker test.
6. CI workflows, Dockerfile, pre-commit, README, version bump.
7. Verify: `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` at 100%,
   `pnpm build`, `docker build`, and a side-by-side `/metrics` compare against
   v0.2.7 output for the same fixture.

## Decisions I made (reject any)

1. TypeScript 6.0.3 rather than 7.0.2 — toolchain compatibility.
2. Pre-commit stays, lefthook is not added — two hook managers conflict.
3. Live broker test is opt-in and skips on timeout — CI must not depend on a
   LAN broker.
4. Deadline answers `504` rather than a partial or empty `200`: when the socket
   is wedged there is nothing honest to return, and a `200` carrying only the
   HELP/TYPE lines would report the exporter as healthy while exporting no
   devices. Known cost, documented in the README: any non-2xx marks the series
   stale and restarts the alert's `for: 10m` timer, and nothing in the rule set
   alerts on the exporter itself being down.
5. `0.3.0` — internal restructure and bug fixes, no new capability.
6. `@types/node` stays on 24.x while the runtime is Node 24.
7. Multi-arch `amd64,arm64` publishing — Home Assistant users run both, and
   the build is cheap.

## Implementation notes (2026-10-25)

What shipped, and every place it differs from the text above.

- Coordinator filtering is on the payload's `type`, verified against the live
  broker payload (which carries `type` and does **not** carry `last_seen`).
- Device messages that arrive before the seed are buffered and replayed;
  nothing is dropped.
- A device reporting without a usable `last_seen` counts as reported and its
  sample is omitted with a warning. No `NaN` ever reaches the exposition.
- Kept `application/device-source.ts` and `http/metrics-route.ts` rather than
  collapsing them into `app.ts`: the port is the seam every test uses, and the
  route file keeps `app.ts` a pure composition root.
- Build uses `tsconfig.build.json` (tests excluded), base config no longer
  emits declarations.
- Responses carry `text/plain; version=0.0.4; charset=utf-8`.
- The Dockerfile needed two files the design did not mention, both found by
  actually building the image: `pnpm-workspace.yaml` (pnpm 12 reads build-script
  approvals from it, without it the frozen install fails on esbuild) and
  `tsconfig.build.json` (without it `pnpm build` cannot find its project).

Evidence collected while implementing:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm lint` | 0 problems, no disable comments |
| `pnpm test:coverage` | 64 tests, 7 files, 100% statements/branches/functions/lines |
| `pnpm build` | clean, `dist` has no test files and no `.d.ts` |
| `pnpm format:check` | clean (`.github/renovate.json5` reformatted to the new style) |
| End to end against a fake Zigbee2MQTT websocket | `200` with both devices, coordinator excluded, label escaping correct, content type as above |
| Deadline path | `504` in 1.01s with `SCRAPE_DEADLINE_MS=1000` |
| Unreachable source | `500` in 0.01s |
| SIGTERM | process exits |
| `pnpm test:integration` against `mqtt.techtales.io` | passes, read-only, never publishes |
| `docker build` + `docker run` against the fake bridge | image serves correct exposition |

Known follow-ups, not done here:

- The image is 556 MB because pnpm's store and symlinked `node_modules` ship
  as-is. `pnpm deploy --prod` would cut it roughly in half.
- No cancellation plumbing: a scrape that outlives its deadline keeps a timer
  and socket until the deadline fires, which is bounded and harmless.
- Nothing alerts on the exporter being down; that is a `home-ops` concern.
