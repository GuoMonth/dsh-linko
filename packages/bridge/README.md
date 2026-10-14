# Linko DSH companion bridge

English | [中文](README.zh.md)

`@dsh-linko/bridge` is a small, replaceable TypeScript adapter between a DSH-style host and one local Linko node. It defines a host-facing tool contract without importing, copying, or depending on DeepSeek Harness source. The bridge translates the contract to Linko's existing loopback REST API; it does not add node routes or change the node and web packages.

## Contract

The bridge exposes six operations:

| Operation | Effect | Linko request |
| --- | --- | --- |
| `ask` | Build an Agent request and commit it locally, or queue it for a configured peer when `targetPeerId` is supplied. | `POST /v1/envelopes` or `POST /v1/send` |
| `inbox` | List the local inbox projection. | `GET /v1/inbox` |
| `inspect` | Read one event and its delivery/read/action projection. | `GET /v1/inbox/:eventId` |
| `draft` | Read a parent and return an uncommitted reply envelope. | `GET /v1/inbox/:eventId` |
| `approve` | Record the requested `approve` action. The node checks its action list and expiry. | `POST /v1/receipts` |
| `reply` | Draft and commit a reply whose `parents` contains the inspected event ID. | `GET /v1/inbox/:eventId`, then `POST /v1/envelopes` or `POST /v1/send` |

`draft` is pure from Linko's perspective: it returns an object without an `id`. `reply` is the operation that commits it and lets the node derive the immutable event ID. The bridge reports node facts as returned; it does not turn `confirmed` into approval or infer that a message was read.

## Host and client boundary

The **host** owns the Agent runtime, tool registration, credentials, human approval policy, context selection, and execution of any external side effect. Call `bridge.register(host)` with a host that implements `registerTool`; the six descriptors and handlers are the only host integration surface.

The **client** owns one loopback `http:` or `https:` Linko API origin. `LinkoLocalClient` validates that origin, caps JSON responses, checks response shape, and maps node errors to `LinkoBridgeError`. Peer discovery, HTTPS peer authentication, retries, durable storage, and projections remain node responsibilities.

Approval only records a Linko receipt. It never executes a command, grants a capability, sends a host message, or calls an LLM. A host may choose to invoke `reply` after approval according to its own policy.

## Unsupported by this package

- DeepSeek Harness internals, plugin loading, scheduler APIs, or host-specific SDK types.
- LLM prompting, collaborator ranking, context retrieval, or automatic policy decisions.
- Direct peer sockets, LAN discovery, WebSocket hints, or remote/non-loopback Linko APIs.
- Cryptographic signing, message-layer E2EE, capability issuance, or execution of approved work.
- A guarantee that a peer received a queued `ask` or `reply`; delivery remains the node's observable outbox state.

These cuts keep the bridge replaceable. A different host or client can implement the same six operations against the documented Linko envelope and receipt contracts.

## API and CLI

```ts
import { createDshCompanionBridge, LinkoLocalClient } from '@dsh-linko/bridge';

const bridge = createDshCompanionBridge({
  client: new LinkoLocalClient('http://127.0.0.1:8787'),
});

const request = await bridge.ask({
  title: 'Review a fixture',
  body: 'Please inspect this fixture and approve a scoped reply.',
  agentId: 'agent:example',
});
const events = await bridge.inbox();
await bridge.approve({ eventId: request.eventId, actionId: 'approve' });
const reply = await bridge.reply({ eventId: request.eventId, body: 'Approved.' });
```

The dependency-free CLI uses the same contract and accepts JSON as an argument or from stdin. Build the package first when running from this checkout:

```sh
pnpm bridge:build
LINKO_LOCAL_URL=http://127.0.0.1:8787 \
  node packages/bridge/dist/cli.js inbox --json '{}'
node packages/bridge/dist/cli.js approve --json '{"eventId":"sha256:...","actionId":"approve"}'
```

## Contract fixture

Build and run the fixture from the repository root:

```sh
pnpm bridge:contract:smoke
```

It starts an in-memory Linko node and exercises `ask → inbox → inspect → draft → approve → reply`, then checks the CLI adapter against the same local API. The fixture imports only Linko's public node server and the bridge package; it does not assume a DSH implementation.
