# Linko inbox — design note

English | [中文](DESIGN.zh.md)

## What this package is

The human surface for a Linko node: it renders envelope covers, records
decisions and receipts, and composes new messages. It contains no node
implementation and no transport of its own — it is a client of one local node's
REST surface, and it either talks to that node or says plainly that it cannot.

Copy is Chinese-first with an English gloss, because the first readers are
Chinese-speaking while the protocol vocabulary is English.

## Data contract

The UI is a view of three documents and invents nothing beyond them:

- [spec 0002](../../docs/specs/0002-message-envelope.md) — envelope parts, the
  four authorship kinds, and the rule that delivery, read, acknowledgement and
  action are **independent facts**.
- [spec 0005](../../docs/specs/0005-state-and-storage.md) — the state dimensions,
  cursor scoping, and the split between durable events and private local rows.
- [spec 0003](../../docs/specs/0003-lan-sync-and-transport.md) — the REST surface.

`src/model.ts` holds that contract as pure functions with no DOM dependency, so
the browser and `scripts/smoke.mjs` exercise the same code. `src/api.ts` is the
only place that performs a network call.

Endpoints used: `GET /v1/node`, `GET /v1/sync`, `GET /v1/peers`,
`POST /v1/receipts`, `POST /v1/send`.

## Independence, enforced rather than promised

There is no combined message status anywhere in this package. The detail view
renders each dimension side by side with the rule that keeps it separate, and
each is derived from its own inputs only.

The property is tested rather than asserted: the smoke check marks a device as
read and then verifies that the delivery, acknowledgement and action facts did
not move. Presentation is reported as an explicit ratio (`read:1-of-2`), never as
a boolean, so the aggregate cannot imply "read on every device".

## Decisions are submissions

A decision is a **submission**, never a local outcome:

| Local state | Meaning | What the user sees |
| --- | --- | --- |
| `pending` | the receipt is in flight | "正在提交…", buttons withdrawn |
| `confirmed` | the node accepted it | recorded, and the action fact then comes from the node |
| `failed` | refused or unreachable | "决定未提交" with the reason and a retry |

Until the node accepts a receipt the action fact does **not** move, and a failure
is never rendered as a success. There is no undo control, because the node's
transition table makes a decided action terminal; offering one would be a claim
this client cannot honour. The copy says so rather than leaving the absence
unexplained.

Dismissing ("搁置") is a separate, local-only marker. It changes nothing on the
node and is labelled as staying on this device. The marker is a timestamped
local record, so it survives a reload; corrupt or older-than-30-day records are
pruned on load, and the ledger is capped at 128 entries. This bounded cleanup
cannot change the envelope, its authorship, or any node-owned action fact.

## Composing and sending

Compose builds a `message.human` envelope from the draft, adds a fresh `nonce`,
and — when replying — a `parents` reference plus a `quote` naming the parent.
The client deliberately does **not** invent an event id: the node derives it from
the canonical payload and rejects a supplied id that does not match, so the
client's job is uniqueness (`nonce`) and idempotency (`commandId`).

Sending posts to `POST /v1/send` with `peerId`, `envelope`, `clientId` and
`commandId`. The outbox shows a local status (`queued` / `sending` / `sent` /
`failed`) and, separately, the node's own `delivery` value verbatim — this client
does not know whether a peer received anything and does not claim to. Retrying
reuses the original `commandId`, so the node collapses the duplicate instead of
creating a second event.

Queued sends survive a reload and are flushed on the next successful poll.

## Peers and onboarding

`GET /v1/peers` populates the peer selector. Three states are distinguished, and
they are not the same problem:

- directory answered with peers — a normal selector;
- directory answered but empty — the node has no peers configured, and the copy
  says to pair on the node side first;
- directory unavailable (older node) — stated as a capability gap, with a
  manual peer-id field as an explicitly labelled fallback.

## Persistence and polling

`localStorage` holds the node address, the sync cursor, the device id, the
outbox, undecided submissions and timestamped dismissals. Dismissals survive a
reload but are bounded to 128 recent records and expire after 30 days; malformed
or stale rows are discarded locally. All of it is client-side convenience or
client-side state; none of it is authority.

Polling is incremental and cursor-based, with exponential backoff on failure and
a reset to the healthy interval when the tab becomes visible again. A first sync
drains every page indicated by `hasMore` before establishing the historical
baseline, and no page in that recovery pass produces desktop notifications.
Reconnects and `409` cursor resets close the baseline and repeat that drain. Later
pages are deduplicated by event id, and only previously unseen ids can notify
after the user grants permission; notification emission remains independent from
delivered, presented, read, acknowledged and action facts. The newer node
snapshot wins for an event, because the node's facts only move forward and
inventing a field-by-field merge here would put this client in the position of
deciding facts it does not own. A `409` cursor reset is treated as an instruction
— drop the cursor and drain from the start — not as an error to show the user.

When `/v1/node` advertises `capabilities.websocketHints: true`, the browser opens
one `ws:`/`wss:` connection to the same API base at `/v1/live`. It sends only the
`v1` hello, accepts the bounded ready/hint/ping/pong vocabulary, and uses every
hint as a request for the existing REST sync. Hints are coalesced for 100 ms and
never carry a cursor or payload. The handshake timeout is 5 s, heartbeat is sent
every 15 s with a 10 s pong watchdog, and reconnect uses equal jitter from 500 ms
to a 30 s cap. Frames are capped at 4,096 characters and buffered sends at 4 KiB.
Socket loss closes the notification baseline, so catch-up does not replay history;
periodic REST reconciliation remains active. A missing capability or WebSocket
support falls back to REST polling. `pagehide` closes the socket and pauses work;
`pageshow` resumes with a bounded REST catch-up.

## Fogg behaviour model

- **One prompt at a time.** One envelope is focused, the decision panel offers
  one primary button, and "下一个待决" leads to the next item that genuinely
  needs a person.
- **Low-friction safe choice.** Dismissing is one click and stays local.
  Deciding costs a deliberate second step, because it is the one that grants or
  removes authority.
- **Visible progress.** The masthead counts decided, open and dismissed items and
  draws them as a bar; dismissing is shown separately rather than counted as
  progress, because it is not a decision.

## About Face principles

- **Direct manipulation.** Envelopes are selected by clicking the cover itself;
  the list, the facts and the progress all react to the same selection.
- **Immediate feedback.** Every submission shows its own state at once, and the
  live region announces the outcome. Nothing is implied.
- **No action that cannot be honoured.** The one place this design deliberately
  departs from "reversible actions" is the decision, because the node treats it
  as terminal; the interface explains the omission instead of faking a control.

## Security posture

- **Peer surfaces are inert.** `surfaceRef`, `bodyRef` and `parents` render as
  reference chips. Nothing is fetched, rendered or executed.
- **No markup-string sinks.** The package contains no inner-markup assignment, no
  adjacent-markup insertion, no document-writing call, no `eval` and no
  `Function` constructor; every value reaches the DOM through `textContent`. The
  smoke check strips comments and asserts this against the built bundle.
- **Untrusted input is narrowed, not sanitised.** `parseEnvelope` copies only
  known fields, bounds every string, strips control and bidi characters, and
  **rejects** an envelope whose actor kind or actor id it does not recognise
  rather than relabelling it as `system`.
- **No transport security claim.** This client asserts nothing about TLS, peer
  authentication or the safety of a LAN connection; those belong to the node and
  to a later phase. The default node address is loopback.
- No network dependency: no CDN, no webfont, no remote asset.

## Themes and accessibility

Light is paper and ink with colour held back for signal — vermillion for the one
thing asking for a decision, indigo for information, mineral green for what is
settled. Dark is deep navy over graphite, with cyan for interaction and amber for
attention. Roles are the same in both, and the accent direction is drawn from
Chinese ink-and-colour practice generally rather than any artist's work.

Both themes are driven by tokens on `:root`; the theme is resolved before first
paint. Keyboard: `j`/`k` move, `n` next decision, `a` approve, `r` reject, `d`
dismiss, `m` mark read, `c` compose, `t` theme, `Esc` cancel. Focus is always
visible, the shell has a skip link, and `prefers-reduced-motion` is respected.

## Running it

```sh
pnpm node:start    # the local node (separate package), default 127.0.0.1:8787
pnpm web:build     # tsc + static assets into packages/web/dist
pnpm web:serve     # static preview on http://127.0.0.1:4173
pnpm web:preview   # build, then serve
pnpm web:smoke     # build, then assert the properties above
pnpm typecheck     # root typecheck, includes this package
```

Point the page at a node with `?api=http://host:port`. The node allows the
preview origin by default (`LINKO_ALLOWED_ORIGINS` overrides it). Peer pairing is
configured on the node side (`LINKO_PEERS_FILE`, TLS material in `LINKO_TLS_KEY`
and `LINKO_TLS_CERT`); this client only reads the resulting peer directory.

## Known limits and deviations

- **Fixture data is a preview, not a fallback for real content.** When no node
  answers, the inbox shows clearly-labelled fixtures so the interface can be
  reviewed offline; the moment a node answers they are dropped, along with any
  cursor, so real and fake events are never mixed.
- **The node is a separate workstream.** `POST /v1/send` and `GET /v1/peers` were
  added to the node package during this work; a node that predates them produces
  an explicit "此节点尚未提供 POST /v1/send" failure rather than a silent one.
- **Sending requires peers to be configured on the node.** The default node has
  none, so compose correctly reports an unpaired state.
- **Decisions are submitted, not queued offline.** A decision attempted while the
  node is unreachable is recorded as failed with a retry, rather than being
  queued silently and reported later as if it had succeeded.
- **No durable cursor for a reset.** A cursor reset drains the bounded pages from
  the start; there is no local cache of the full log.
- **Dismissals are local and bounded.** A dismissal can expire after 30 days or
  fall out of the 128-entry local ledger; expiry never changes node facts.
- **Not an end-to-end encrypted client.** Group E2EE is a separate milestone and
  nothing here claims otherwise.
