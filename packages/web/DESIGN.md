# Linko inbox — design note

English | [中文](DESIGN.zh.md)

This package is the first runnable surface for Linko. It renders envelope covers
and records decisions. It contains no node implementation, no protocol code, and
no transport: it either talks to a local node over the conceptual REST surface in
[spec 0003](../../docs/specs/0003-lan-sync-and-transport.md), or falls back to
fixtures and says so.

## Data contract

The UI is a view of two documents and invents nothing beyond them:

- [spec 0002](../../docs/specs/0002-message-envelope.md) — envelope parts, the four
  authorship kinds, and the rule that delivery, read, acknowledgement and action
  are **independent facts**.
- [spec 0005](../../docs/specs/0005-state-and-storage.md) — the state dimensions,
  cursor scoping, and the split between durable events and private local rows.

`src/model.ts` holds that contract as pure functions. It is the only place that
decides what a fact means, and it has no DOM dependency, so the browser and
`scripts/smoke.mjs` exercise the same code.

## Independence, enforced rather than promised

There is no combined message status anywhere in this package. The detail view
renders each dimension side by side with the rule that keeps it separate, and
`factViews` derives each one from its own inputs only.

The property is tested rather than asserted: the smoke check marks a device as
read and then verifies that the delivery, acknowledgement and action facts did
not move. Per-device presentation is kept per device, so the aggregate can say
"read on 1 of 2" but never claims every device.

## Decisions

Three kinds, with different durability — the distinction is the point:

| Kind | Durability | Effect on the action state |
| --- | --- | --- |
| `defer` | private local row | none; the envelope stays open |
| `approve` / `reject` | durable work, queued for the node | moves the action attempt |
| `reopen` | compensating record | returns the envelope to needing a decision |

Reversal appends a record rather than deleting one, so history survives. The
control is withdrawn — with the reason shown — once an action is executing, has
succeeded, or has an uncertain outcome, because past that point a reversal would
be a claim rather than a fact.

## Fogg behaviour model

- **One prompt at a time.** Exactly one envelope is focused, the decision panel
  offers one primary button, and "Next decision →" always leads to the next item
  that genuinely needs a person.
- **Low-friction safe choice.** Defer is a single click, has no side effects, and
  is private. Approval costs a deliberate second step, because it is the one that
  grants authority.
- **Visible progress.** The masthead counts decided, open and deferred items and
  draws them as a bar. Deferring is shown separately rather than counted as
  progress, because it is not a decision.

## About Face principles

- **Direct manipulation.** Envelopes are selected by clicking the cover itself;
  the list, the facts and the progress all react to the same selection.
- **Immediate feedback.** Acting updates the list, the facts and the progress at
  once, and the live region announces the result. Each consequence is stated in
  plain words instead of being implied.
- **Reversible actions.** Undo is offered while a reversal is truthful, and the
  reason is given when it is not.

## Security posture

- **Peer surfaces are inert.** `surfaceRef` and `bodyRef` render as reference
  chips. Nothing is fetched, rendered, or executed, and no body holder is
  contacted to draw the cover.
- **No markup-string sinks.** The package contains no inner-markup assignment, no
  adjacent-markup insertion, no document-writing call, no `eval`, and no
  `Function` constructor. Every value reaches the DOM through `textContent`.
  The smoke check strips comments and asserts this against the built bundle.
- **Untrusted input is narrowed, not sanitised.** `parseEnvelope` copies only
  known fields, bounds every string, and strips control and bidi characters.
  A message containing `<script>` stays text.
- **No network dependency.** No CDN, no webfont, no remote asset. The preview
  renders with the machine offline.
- The preview server binds loopback and refuses paths that escape `dist/`.

## Themes

Light is paper and ink with colour held back for signal: vermillion marks the one
thing asking for a decision, indigo carries information, mineral green marks what
is settled. Dark uses a deep navy ground against graphite, with cyan for
interaction and amber for attention. Roles are the same in both, so a tinted
element always means something. Accents are drawn from Chinese ink-and-colour
practice generally; no artist's work is reproduced.

## Running it

```sh
pnpm web:build     # tsc + static assets into packages/web/dist
pnpm web:serve     # static preview on http://127.0.0.1:4173
pnpm web:preview   # build, then serve
pnpm web:smoke     # build, then assert the properties above
pnpm typecheck     # root typecheck, includes this package
```

Point the page at a node with `?api=http://host:port`, or leave it — the inbox
falls back to fixtures and labels itself as a preview.

## Known limits

- **The local ledger is held in this page.** A reload clears the local defer and
  undo history. Approve/reject is sent to the node when connected, while the
  node remains the durable authority.
- **No durable cursor.** Each load syncs from the start rather than resuming a
  checkpoint, because persisting a batch and its checkpoint atomically needs a
  store this package does not have.
- **CORS is explicit.** The local node allowlists the preview origins; a custom
  host or port must add its UI origin deliberately.
- The narrow layout switches between list and detail panes rather than showing
  both.
