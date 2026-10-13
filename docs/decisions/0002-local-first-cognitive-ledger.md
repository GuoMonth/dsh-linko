# 0002 Subjective local ledger

Status: accepted for the design phase.

## Decision

Each node owns a local, append-only ledger of signed claims and observations. A claim is scoped to an author, subject, task or project context, audience, confidence, evidence, and lifetime. There is no canonical universal reputation number.

The graph is the logical view. The event log is the synchronization view. SQLite is the first physical store, with JSONL export for inspection and replay. Derived rankings are user- and task-specific projections.

## Consequences

Conflicting opinions remain available and can receive different weights for different users. The system must explain a recommendation and retain the evidence used to produce it. Privacy, expiry, and revocation are first-class fields rather than cleanup features.
