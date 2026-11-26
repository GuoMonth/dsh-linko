import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { appendClaim, readClaims, recommendCollaborators, validateClaim } from '../src/ledger.js';

const now = '2026-01-01T00:00:00.000Z';

test('retains expired claims in the ledger and explains recommendations with current evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'linko-ledger-'));
  const path = join(directory, 'claims.jsonl');
  try {
    await appendClaim(path, {
      id: 'claim:1',
      author: 'person:a',
      subject: 'person:b',
      context: 'release',
      evidence: 'reviewed rollback',
      confidence: 0.9,
      expiry: '2027-01-01T00:00:00.000Z',
      audience: 'team:one',
      createdAt: now,
    });
    await appendClaim(path, {
      id: 'claim:expired',
      author: 'person:c',
      subject: 'person:b',
      context: 'release',
      evidence: 'old review',
      confidence: 1,
      expiry: '2025-01-01T00:00:00.000Z',
      audience: 'team:one',
      createdAt: now,
    });

    const claims = await readClaims(path);
    expect(claims.map((claim) => claim.id)).toEqual(['claim:1', 'claim:expired']);
    const recommendations = recommendCollaborators(claims, { context: 'release', audience: 'team:one', now });
    expect(recommendations).toMatchObject([{ subject: 'person:b', evidence: [{ claimId: 'claim:1' }] }]);
    expect(recommendations[0]).not.toHaveProperty('reputation');
    expect((await readFile(path, 'utf8')).split('\n').filter(Boolean)).toHaveLength(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects confidence outside the supported range', () => {
  expect(() => validateClaim({
    id: 'claim:invalid',
    author: 'person:a',
    subject: 'person:b',
    context: 'release',
    evidence: 'reviewed rollback',
    confidence: 2,
    expiry: null,
    audience: 'team:one',
    createdAt: now,
  })).toThrow();
});
