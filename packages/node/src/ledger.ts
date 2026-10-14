/**
 * Local cognitive ledger.
 *
 * Claims are append-only, scoped observations. The module deliberately has no
 * global reputation field or aggregate: recommendations are a projection for
 * one query, context and audience and retain the claims that explain it.
 */
import { appendFile, readFile } from 'node:fs/promises';

export interface CognitiveClaim {
  readonly id: string;
  readonly author: string;
  readonly subject: string;
  readonly context: string;
  readonly evidence: string;
  readonly confidence: number;
  readonly expiry: string | null;
  readonly audience: string;
  readonly createdAt: string;
}

export interface LedgerQuery {
  readonly context?: string;
  readonly audience?: string;
  readonly subject?: string;
  readonly now?: string;
  readonly limit?: number;
}

export interface RecommendationEvidence {
  readonly claimId: string;
  readonly author: string;
  readonly subject: string;
  readonly context: string;
  readonly evidence: string;
  readonly confidence: number;
  readonly expiry: string | null;
  readonly audience: string;
}

export interface CollaboratorRecommendation {
  readonly subject: string;
  /** Query-local relevance. This is not a durable or global reputation score. */
  readonly relevance: number;
  readonly evidence: readonly RecommendationEvidence[];
  readonly explanation: string;
}

const MAX = {
  id: 160,
  text: 2_000,
  audience: 240,
};

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function optionalExpiry(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 80) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function isConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function normaliseClaim(value: unknown, now = new Date().toISOString()): CognitiveClaim | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = boundedText(record.id, MAX.id);
  const author = boundedText(record.author, MAX.text);
  const subject = boundedText(record.subject, MAX.text);
  const context = boundedText(record.context, MAX.text);
  const evidence = boundedText(record.evidence, MAX.text);
  const audience = boundedText(record.audience, MAX.audience);
  const expiry = optionalExpiry(record.expiry);
  const createdAt = optionalExpiry(record.createdAt);
  if (id === null || author === null || subject === null || context === null || evidence === null || audience === null) return null;
  if (!isConfidence(record.confidence) || expiry === undefined || createdAt === undefined) return null;
  return {
    id,
    author,
    subject,
    context,
    evidence,
    confidence: record.confidence,
    expiry,
    audience,
    createdAt: createdAt ?? now,
  };
}

export function validateClaim(value: unknown): CognitiveClaim {
  const claim = normaliseClaim(value);
  if (claim === null) throw new TypeError('invalid cognitive claim');
  return claim;
}

export async function appendClaim(path: string, claim: CognitiveClaim | Record<string, unknown>): Promise<CognitiveClaim> {
  const valid = validateClaim(claim);
  await appendFile(path, `${JSON.stringify(valid)}\n`, { encoding: 'utf8' });
  return valid;
}

export async function readClaims(path: string): Promise<CognitiveClaim[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const claims: CognitiveClaim[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      const claim = normaliseClaim(JSON.parse(line));
      if (claim !== null) claims.push(claim);
    } catch {
      // A damaged JSONL row is isolated; later claims remain inspectable.
    }
  }
  return claims;
}

function active(claim: CognitiveClaim, now: number): boolean {
  return claim.expiry === null || Date.parse(claim.expiry) > now;
}

function matches(claim: CognitiveClaim, query: LedgerQuery): boolean {
  if (query.subject !== undefined && claim.subject !== query.subject) return false;
  if (query.context !== undefined && claim.context !== query.context) return false;
  if (query.audience !== undefined && claim.audience !== query.audience && claim.audience !== '*') return false;
  return true;
}

/**
 * Return explainable, query-scoped collaborator suggestions. Expired claims
 * are excluded from current eligibility while remaining in the JSONL history.
 */
export function recommendCollaborators(claims: readonly CognitiveClaim[], query: LedgerQuery = {}): CollaboratorRecommendation[] {
  const now = Date.parse(query.now ?? new Date().toISOString());
  const groups = new Map<string, CognitiveClaim[]>();
  for (const claim of claims) {
    if (!active(claim, now) || !matches(claim, query)) continue;
    const existing = groups.get(claim.subject) ?? [];
    existing.push(claim);
    groups.set(claim.subject, existing);
  }
  const recommendations = [...groups].map(([subject, evidence]) => {
    const relevance = Math.round((evidence.reduce((sum, claim) => sum + claim.confidence, 0) / evidence.length) * 100) / 100;
    const explanation = evidence
      .map((claim) => `${claim.author} 在「${claim.context}」提供证据「${claim.evidence}」（置信度 ${claim.confidence.toFixed(2)}）`)
      .join('；');
    return {
      subject,
      relevance,
      evidence: evidence.map(({ id, author, subject: evidenceSubject, context, evidence: text, confidence, expiry, audience }) => ({
        claimId: id,
        author,
        subject: evidenceSubject,
        context,
        evidence: text,
        confidence,
        expiry,
        audience,
      })),
      explanation,
    } satisfies CollaboratorRecommendation;
  });
  recommendations.sort((left, right) => right.relevance - left.relevance || left.subject.localeCompare(right.subject));
  const limit = Math.max(1, Math.min(100, Math.trunc(query.limit ?? 20)));
  return recommendations.slice(0, limit);
}
