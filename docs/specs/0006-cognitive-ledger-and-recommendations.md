# 0006 Local cognitive ledger and collaborator recommendations

English | [中文](0006-cognitive-ledger-and-recommendations.zh.md)

Status: P1/P2 implementation baseline.

## Ledger

A node may keep an append-only JSONL ledger at a user-selected local path. Each claim has `author`, `subject`, `context`, `evidence`, `confidence` (0–1), `expiry`, and `audience`, plus an id and creation time for replay. Invalid rows are rejected on write and skipped in isolation on read; expiry removes a claim from current eligibility without erasing its history.

The ledger never stores a global reputation number. Claims remain attributable and scoped. `recommendCollaborators` is a query projection: it filters by subject, context, audience, and evaluation time, then returns a query-local relevance value together with every claim and an explanation that supports the result. A consumer must show the evidence and scope beside a suggestion and must not treat relevance as authority.

## Envelope experience

The inbox renders the cover first. A body object is an inert reference until the reader requests it. The UI fetches the object through the local node, bounds it, renders it as text, and caches it locally for later offline viewing. Fetch failures remain visible and offer retry; a cached body never grants action authority.

New envelopes can produce a browser notification only after the user grants permission. Notification emission is independent from delivered, presented, read, acknowledged, and action facts. REST detail fetch is the recovery path after a reconnect or dropped hint stream.
