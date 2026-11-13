# WebSocket readiness

Companion demo for an article on telling whether a WebSocket connection is actually usable.

`onopen` means the socket is open. It says nothing about whether the peer is alive or whether the service behind it works. This demo runs a real WebSocket server with fault injection and six stages of a client, so you can break the server and compare what the client says with what is really happening.

Each stage is a subclass containing only its own fix, so a stage's file is exactly the diff from the previous one:

| stage | file | what it adds | what it still gets wrong |
|---|---|---|---|
| 0 | `stage0NaiveClient.ts` | `onopen` = online, fixed 1 s reconnect | believes a frozen server is fine, requests hang forever |
| 1 | `stage1RequestRegistry.ts` | request timeouts, in-flight requests rejected on close, typed errors | the status still lies |
| 2 | `stage2Heartbeat.ts` | not alive until the first ping, watchdog at 2 × server-announced interval | a late `onclose` of the old socket hits the new connection |
| 3 | `stage3StaleEvents.ts` | only the current socket may change state | a live peer is mistaken for a working service |
| 4 | `stage4ServiceReadiness.ts` | subscription must be acknowledged, retried and restored over the same socket | reconnect load |
| 5 | `stage5ReconnectPolicy.ts` | full jitter, exponential backoff with a cap, reset only after a cooldown, offline awareness | — |

## Getting started

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # client stages, backoff policies, fleet simulator, demo server
npm run lint
```

The demo server runs inside the Vite server (`server/vitePlugin.ts`), both for `npm run dev` and for `npm run preview`. Static hosting won't work: the demo needs this server. Fault state is per server, so use one tab at a time.

The stage is kept in the URL: `?stage=0` … `?stage=5`.

## Things to try

1. **The lie.** Stage 0, press "Freeze". The client keeps saying READY while updates stop and requests pile up as pending. Stage 2 notices within two heartbeat intervals.
2. **Requests that never finish.** Stage 0, "Service down", wait, "Normal": the pending requests stay pending forever. Stage 1 fails them with typed errors.
3. **Stale events.** Stage 2, "Freeze" for 10 seconds, then "Normal". One tab now holds several open connections on the server, for good. Repeat on stage 3: back to one.
4. **Three levels.** Stage 3, "Service down" for a few seconds, then "Normal": READY, but updates never come back. Stage 4 reports the loss immediately and subscribes again by itself.
5. **Flapping.** Stage 4, then stage 5, "Flapping" for 15 seconds. Compare "conn. tries" in the "Measurements" table.
6. **Reconnect storm.** The "Reconnect storm" tab compares backoff policies for 10,000 clients.

## Structure

```
server/
  demoServer.ts      WebSocket server with faults, plus its small HTTP API
  vitePlugin.ts      attaches it to the Vite server
src/
  shared/protocol.ts messages shared by the server and the clients
  lib/
    client/          the six stages, one file each, and their tests
    backoff.ts       reconnect delay policies
    fleet.ts         virtual-time simulation of many clients
  hooks/             client lifecycle, server polling, fault measurements
  components/        status, requests, log, measurements, storm charts
  App.tsx
```

## How the faults work

- **Freeze** pauses the server's TCP socket. The connection stays open, but nothing is read, so even a close frame goes unanswered. To the browser, this looks like a peer that has silently disappeared.
- **Service down** keeps heartbeats going, drops subscriptions and stops answering.
- **Flapping** accepts connections, and drops them after 300 ms.
- **Restart** terminates every connection and refuses new ones for 3 seconds.

## Notes on measurements

- "Noticed" and "back" in the "Measurements" table depend on polling the server every 250 ms, so treat values below that as approximate.
- The reconnect storm is a simulation: it uses the same backoff code as stage 5, but refused attempts cost the server nothing. A real server suffers from them, so the results are optimistic for the policies with many attempts.
