# 0001 Clean-room reference policy

Status: accepted for the design phase.

## Decision

Linko may study public behavior, product descriptions, tests described in documentation, and architectural lessons from Rellopn/dsh-p2p-lan at commit 62e47e45ab7e2729c23d38f30d26e9ab6af0768f. Linko will not copy, fork, vendor, translate, mechanically transform, or import its source code, wire format, test cases, names, or module layout.

## Consequences

The repository records requirements and independent decisions before implementation. Interoperability with that project is not an initial requirement. If Linko later supports an adapter, the adapter will be written from an independently documented protocol and tested against public behavior.
