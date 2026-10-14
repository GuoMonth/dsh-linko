#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendClaim, readClaims, recommendCollaborators, validateClaim } from './dist/ledger.js';

const directory = await mkdtemp(join(tmpdir(), 'linko-ledger-'));
const path = join(directory, 'claims.jsonl');
try {
  const now = '2026-01-01T00:00:00.000Z';
  await appendClaim(path, { id: 'claim:1', author: 'person:a', subject: 'person:b', context: 'release', evidence: 'reviewed rollback', confidence: 0.9, expiry: '2027-01-01T00:00:00.000Z', audience: 'team:one', createdAt: now });
  await appendClaim(path, { id: 'claim:expired', author: 'person:c', subject: 'person:b', context: 'release', evidence: 'old review', confidence: 1, expiry: '2025-01-01T00:00:00.000Z', audience: 'team:one', createdAt: now });
  const claims = await readClaims(path);
  if (claims.length !== 2) throw new Error('claims did not round-trip');
  const result = recommendCollaborators(claims, { context: 'release', audience: 'team:one', now });
  if (result.length !== 1 || result[0].subject !== 'person:b' || result[0].evidence[0].claimId !== 'claim:1') throw new Error('recommendation is not scoped or explainable');
  if ('reputation' in result[0]) throw new Error('global reputation leaked into recommendation');
  const invalid = () => validateClaim({ id: 'x', author: 'a', subject: 'b', context: 'c', evidence: 'e', confidence: 2, expiry: null, audience: 'team', createdAt: now });
  let rejected = false;
  try { invalid(); } catch { rejected = true; }
  if (!rejected) throw new Error('invalid confidence accepted');
  const text = await readFile(path, 'utf8');
  if (text.split('\n').filter(Boolean).length !== 2) throw new Error('JSONL append expected');
  console.log('ledger smoke ok');
} finally {
  await rm(directory, { recursive: true, force: true });
}
