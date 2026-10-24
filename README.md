# zigbee2mqtt-exporter

Prometheus exporter for Zigbee2MQTT device last-seen times. It exposes one
gauge and nothing else: for every non-coordinator device known to the
Zigbee2MQTT bridge, how many seconds ago it was last seen.

Runs as an HTTP sidecar next to Zigbee2MQTT and reads the Zigbee2MQTT
websocket API, so no MQTT credentials or database are involved.

## Metrics

| Metric                  | Type  | Labels   | Unit                                   |
| ----------------------- | ----- | -------- | -------------------------------------- |
| `zigbee2mqtt_last_seen` | gauge | `device` | seconds since the device last reported |

One sample per non-coordinator device, for example:

```text
# HELP zigbee2mqtt_last_seen Device last seen in seconds
# TYPE zigbee2mqtt_last_seen gauge
zigbee2mqtt_last_seen{device="kitchen/lamp"} 12.345
zigbee2mqtt_last_seen{device="hallway/sensor"} 3600.007
```

Served at `GET /metrics` on `PORT`, as
`text/plain; version=0.0.4; charset=utf-8`.

## Configuration

| Variable             | Default                   | Meaning                                                                                                             |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `PORT`               | `3000`                    | TCP port to listen on. A port number only; the unix socket path `PORT` used to accept is gone.                      |
| `ZIGBEE2MQTT_WS`     | `ws://127.0.0.1:8080/api` | Zigbee2MQTT websocket API URL.                                                                                      |
| `SCRAPE_DEADLINE_MS` | `10000`                   | How long one scrape may wait for devices to report, in milliseconds. Keep it below the Prometheus `scrape_timeout`. |

All three are validated at startup; an invalid value stops the process with a
clear message instead of failing on the first scrape.

## How it works

Each scrape opens one websocket to Zigbee2MQTT, asks for the device list over
the bridge topic, and waits until every non-coordinator device has sent a
message. The socket is then closed and the answer is rendered. If some device
stays quiet, the scrape gives up at `SCRAPE_DEADLINE_MS` and answers `504`, so
a stuck device cannot hang Prometheus until its own `scrape_timeout` throws
away every device in the response. A source error or a socket closed mid
scrape answers `500`.

## Development

Requires Node 24 and pnpm 12 (both pinned in `.mise.toml`).

```sh
pnpm install
pnpm dev             # start with reload
pnpm lint            # eslint
pnpm typecheck       # tsc --noEmit
pnpm test            # unit tests
pnpm test:coverage   # unit tests with coverage thresholds
pnpm build           # compile to dist/
pnpm start           # run the compiled exporter
```

## Testing

The unit tests are offline and use fake sockets, so they never touch a broker
or the Zigbee2MQTT instance.

One integration test is opt-in and read-only:

```sh
pnpm test:integration
```

It connects to `mqtt.techtales.io:1883`, subscribes to the retained
`zigbee2mqtt/bridge/devices` payload and feeds that real payload through the
parser. It never publishes, and it skips rather than fails if no payload
arrives within 10 seconds. It is excluded from `pnpm test` and never runs in
CI.

## Known behaviour

- Every scrape opens a fresh websocket instead of sharing one connection with
  a cache. This is deliberate: it keeps the exporter stateless, at the cost of
  one connection per scrape (every 5 minutes in the reference deployment). The
  side effect is that a scrape reflects the moment it ran, not a snapshot that
  may be minutes old.
- Zigbee2MQTT only publishes `last_seen` when advanced last-seen tracking is
  enabled, and a device that has not reported since the bridge started sends
  messages without it. Such a device counts as reported, but there is no
  timestamp to measure, so the exporter leaves its sample out of that scrape
  and logs a warning instead of publishing a made-up value.
- The coordinator is filtered by its Zigbee2MQTT device `type`, so renaming it
  does not affect the exporter.
- Nothing in the Prometheus rule set alerts on the exporter itself being down
  or failing its scrape. A broken target is only visible as a missing series
  or as `up`.

## License

MIT
