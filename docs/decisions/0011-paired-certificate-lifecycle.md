# 0011 Paired certificate lifecycle

English | [中文](0011-paired-certificate-lifecycle.zh.md)

Status: accepted MVP profile; local certificate tooling and renewal UX remain incremental work.

## Decision

The MVP uses one randomly generated private key and one self-signed TLS leaf per node. Pairing records the SHA-256 fingerprint of the exact certificate and a separate random bearer secret. A human verifies the fingerprint out of band; the node never silently trusts the first certificate it sees.

Certificates are generated with the operating system CSPRNG. A certificate is signed metadata around a public key; it must never be deterministically derived from a node ID, nickname, IP address, or cognitive-ledger value. Private keys stay owner-readable only and never enter JSON, SQLite, message envelopes, or logs.

The same TLS certificate protects the paired HTTPS listener and its future paired WSS listener. The local browser hint channel stays loopback-only and uses plain `ws://`; it is not a replacement for peer authentication.

## Validity and expiry

The sender checks both the configured fingerprint and the peer certificate's `notBefore`/`notAfter` window before writing a request body. An expired or not-yet-valid certificate produces a retryable unavailable state; it cannot be reported as delivered. Clock skew is an operational error and must be visible.

The initial local profile uses a long-lived leaf to keep manual pairing manageable, with an expiry warning at 30, 7, and 1 day. Renewal creates a new key and certificate, so its fingerprint changes. The owner must update the peer pin or complete an explicit re-pair before delivery resumes. Renewal is atomic at the configuration boundary: keep the old configuration until the new pin has been verified on both sides.

## Scale boundary

Per-node self-signed pins are appropriate for the first explicit two-node profile. A larger trusted LAN can later use a locally created CA or an organizational CA: peers pin the CA public key, and short-lived leaf certificates can rotate without editing every peer. That changes the trust and revocation model and requires its own acceptance evidence; it is not introduced as an automatic upgrade.

Public ACME certificates are optional deployment infrastructure, not a requirement for private IPs or mDNS names. A public CA does not replace Linko pairing, peer authorization, message signatures, or E2EE.

## Non-goals

There is no deterministic certificate algorithm, silent TOFU, plaintext fallback, or automatic acceptance of a changed fingerprint. Certificate trust authenticates a transport endpoint; it does not authenticate message authorship or make an envelope end-to-end encrypted.
