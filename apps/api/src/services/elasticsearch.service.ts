/**
 * Elasticsearch Service — Milestone 9
 *
 * Handles indexing, searching, and rebuilding the email search index.
 * PostgreSQL remains the source of truth; Elasticsearch is a rebuildable
 * read-side search index.
 *
 * Design decisions:
 * - All search queries are scoped to userId — no cross-user data leaks.
 * - Indexing failures are logged and swallowed so the write path (PostgreSQL)
 *   is never blocked by search-index failures.
 * - A rebuild procedure drops and recreates the index from Postgres data.
 */

import { Client } from '@elastic/elasticsearch';
import type { Email, Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let esClient: Client | null = null;

function getEsUrl(): string {
  return process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
}

export function getEsClient(): Client {
  if (!esClient) {
    esClient = new Client({
      node: getEsUrl(),
      maxRetries: 1,
      requestTimeout: 2000,
      // In development, ignore self-signed cert errors if using HTTPS locally
      tls: process.env.ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED === 'false'
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }
  return esClient;
}

// ---------------------------------------------------------------------------
// Index configuration
// ---------------------------------------------------------------------------

export const EMAIL_INDEX = 'reachinbox_emails';

const INDEX_MAPPINGS = {
  properties: {
    id:            { type: 'keyword' as const },
    userId:        { type: 'keyword' as const },
    recipient:     { type: 'keyword' as const },
    subject:       { type: 'text' as const, analyzer: 'standard' },
    body:          { type: 'text' as const, analyzer: 'standard' },
    status:        { type: 'keyword' as const },
    scheduledTime: { type: 'date' as const },
    sentAt:        { type: 'date' as const },
    createdAt:     { type: 'date' as const },
    updatedAt:     { type: 'date' as const },
    attemptCount:  { type: 'integer' as const },
    lastError:     { type: 'text' as const },
  },
};

// ---------------------------------------------------------------------------
// Availability probe
// ---------------------------------------------------------------------------

/**
 * Returns true if Elasticsearch is reachable; false otherwise.
 * Never throws — callers use this to decide whether to fall back gracefully.
 */
export async function isElasticsearchAvailable(): Promise<boolean> {
  try {
    const client = getEsClient();
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Index management
// ---------------------------------------------------------------------------

export async function ensureIndexExists(): Promise<void> {
  const client = getEsClient();
  const exists = await client.indices.exists({ index: EMAIL_INDEX });
  if (!exists) {
    await client.indices.create({
      index: EMAIL_INDEX,
      mappings: INDEX_MAPPINGS,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0, // Suitable for single-node dev; adjust for production
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Document helpers
// ---------------------------------------------------------------------------

function emailToDoc(email: Email) {
  return {
    id:            email.id,
    userId:        email.userId,
    recipient:     email.recipient,
    subject:       email.subject,
    body:          email.body,
    status:        email.status,
    scheduledTime: email.scheduledTime?.toISOString() ?? null,
    sentAt:        email.sentAt?.toISOString() ?? null,
    createdAt:     email.createdAt.toISOString(),
    updatedAt:     email.updatedAt.toISOString(),
    attemptCount:  email.attemptCount,
    lastError:     email.lastError ?? null,
  };
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

/**
 * Index (upsert) a single email document.
 * Failures are logged but never thrown so the write path stays healthy.
 */
export async function indexEmail(email: Email): Promise<void> {
  try {
    if (!(await isElasticsearchAvailable())) return;
    await ensureIndexExists();
    const client = getEsClient();
    await client.index({
      index:   EMAIL_INDEX,
      id:      email.id,
      document: emailToDoc(email),
    });
  } catch (err) {
    console.warn('[ES] Failed to index email', email.id, err instanceof Error ? err.message : err);
  }
}

/**
 * Remove an email document from the index.
 * Failures are logged but never thrown.
 */
export async function deleteEmailFromIndex(emailId: string): Promise<void> {
  try {
    if (!(await isElasticsearchAvailable())) return;
    const client = getEsClient();
    await client.delete({ index: EMAIL_INDEX, id: emailId }).catch(() => {
      // Ignore 404 — document may not have been indexed yet
    });
  } catch (err) {
    console.warn('[ES] Failed to delete email from index', emailId, err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchEmailsParams {
  userId:    string;
  query?:    string;          // Full-text query over subject + body
  status?:   string;          // Filter by exact status keyword
  fromDate?: string;          // ISO string lower bound for createdAt
  toDate?:   string;          // ISO string upper bound for createdAt
  page?:     number;
  limit?:    number;
}

export interface EmailSearchHit {
  id:            string;
  userId:        string;
  recipient:     string;
  subject:       string;
  body:          string;
  status:        string;
  scheduledTime: string | null;
  sentAt:        string | null;
  createdAt:     string;
  updatedAt:     string;
  attemptCount:  number;
  lastError:     string | null;
}

export interface SearchEmailsResult {
  data:  EmailSearchHit[];
  total: number;
  page:  number;
  limit: number;
  totalPages: number;
  source: 'elasticsearch' | 'postgres_fallback';
}

/**
 * Search emails in Elasticsearch with multi-user isolation.
 * Falls back to PostgreSQL if Elasticsearch is unavailable, fails, or has no
 * matches for a text query. PostgreSQL is the source of truth, while the
 * Elasticsearch index is rebuildable and can be incomplete after outages.
 */
export async function searchEmails(params: SearchEmailsParams): Promise<SearchEmailsResult> {
  const {
    userId,
    query,
    status,
    fromDate,
    toDate,
    page  = 1,
    limit = 20,
  } = params;

  const safeLimit = Math.min(Math.max(1, limit), 100);
  const from      = (Math.max(1, page) - 1) * safeLimit;

  // --- Elasticsearch path ---
  if (await isElasticsearchAvailable()) {
    try {
      await ensureIndexExists();
      const client = getEsClient();

      // Build must-clause filters
      const filter: object[] = [{ term: { userId } }];

      if (status) {
        filter.push({ term: { status } });
      }

      if (fromDate || toDate) {
        const rangeClause: Record<string, string> = {};
        if (fromDate) rangeClause['gte'] = fromDate;
        if (toDate)   rangeClause['lte'] = toDate;
        filter.push({ range: { createdAt: rangeClause } });
      }

      const mustClause: object[] = query
        ? [{
            multi_match: {
              query,
              fields: ['subject^2', 'body', 'recipient'],
              type:   'best_fields',
              fuzziness: 'AUTO',
            },
          }]
        : [{ match_all: {} }];

      const response = await client.search({
        index: EMAIL_INDEX,
        from,
        size:  safeLimit,
        sort:  [{ createdAt: { order: 'desc' } }],
        query: {
          bool: {
            must:   mustClause,
            filter,
          },
        },
      });

      const hits  = response.hits.hits;
      const total = typeof response.hits.total === 'number'
        ? response.hits.total
        : (response.hits.total?.value ?? 0);

      if (total > 0 || !query) {
        return {
          data:       hits.map(h => h._source as EmailSearchHit),
          total,
          page:       Math.max(1, page),
          limit:      safeLimit,
          totalPages: Math.ceil(total / safeLimit) || 1,
          source:     'elasticsearch',
        };
      }

      console.warn('[ES] Search returned no matches; checking PostgreSQL for records missing from the index.');
    } catch (err) {
      console.warn('[ES] Search failed, falling back to Postgres:', err instanceof Error ? err.message : err);
    }
  }

  // --- Postgres fallback path ---
  return postgresSearchFallback({ userId, query, status, fromDate, toDate, page, limit: safeLimit });
}

async function postgresSearchFallback(params: SearchEmailsParams): Promise<SearchEmailsResult> {
  const { userId, query, status, fromDate, toDate, page = 1, limit = 20 } = params;
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const skip      = (Math.max(1, page) - 1) * safeLimit;

  const prisma = getPrismaClient();

  const where: Record<string, unknown> = { userId };
  if (status) where['status'] = status;
  if (fromDate || toDate) {
    const dateFilter: Record<string, Date> = {};
    if (fromDate) dateFilter['gte'] = new Date(fromDate);
    if (toDate)   dateFilter['lte'] = new Date(toDate);
    where['createdAt'] = dateFilter;
  }

  // Postgres doesn't support full-text multi_match easily;
  // use OR-based contains search on subject + body
  if (query) {
    where['OR'] = [
      { subject:   { contains: query, mode: 'insensitive' } },
      { body:      { contains: query, mode: 'insensitive' } },
      { recipient: { contains: query, mode: 'insensitive' } },
    ];
  }

  const [records, total] = await Promise.all([
    prisma.email.findMany({
      where:   where as Prisma.EmailWhereInput,
      skip,
      take:    safeLimit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.email.count({
      where: where as Prisma.EmailWhereInput,
    }),
  ]);

  return {
    data: records.map(r => ({
      id:            r.id,
      userId:        r.userId,
      recipient:     r.recipient,
      subject:       r.subject,
      body:          r.body,
      status:        r.status,
      scheduledTime: r.scheduledTime?.toISOString() ?? null,
      sentAt:        r.sentAt?.toISOString() ?? null,
      createdAt:     r.createdAt.toISOString(),
      updatedAt:     r.updatedAt.toISOString(),
      attemptCount:  r.attemptCount,
      lastError:     r.lastError ?? null,
    })),
    total,
    page:       Math.max(1, page),
    limit:      safeLimit,
    totalPages: Math.ceil(total / safeLimit) || 1,
    source:     'postgres_fallback',
  };
}

// ---------------------------------------------------------------------------
// Index rebuild
// ---------------------------------------------------------------------------

/**
 * Rebuild the entire search index from PostgreSQL.
 * Drops the existing index first (safe — Postgres is source of truth).
 * Processes emails in batches to avoid memory pressure.
 */
export async function rebuildEmailIndex(): Promise<{ indexed: number; errors: number }> {
  const client = getEsClient();

  // Drop and recreate
  const exists = await client.indices.exists({ index: EMAIL_INDEX });
  if (exists) {
    await client.indices.delete({ index: EMAIL_INDEX });
  }
  await client.indices.create({
    index:    EMAIL_INDEX,
    mappings: INDEX_MAPPINGS,
    settings: { number_of_shards: 1, number_of_replicas: 0 },
  });

  const prisma = getPrismaClient();
  const BATCH  = 200;
  let   cursor = 0;
  let   indexed = 0;
  let   errors  = 0;

  for (;;) {
    const batch = await prisma.email.findMany({
      skip:    cursor,
      take:    BATCH,
      orderBy: { createdAt: 'asc' },
    });

    if (batch.length === 0) break;

    const operations = batch.flatMap(email => [
      { index: { _index: EMAIL_INDEX, _id: email.id } },
      emailToDoc(email),
    ]);

    const result = await client.bulk({ operations, refresh: false });
    if (result.errors) {
      const itemErrors = result.items.filter(i => i.index?.error);
      errors += itemErrors.length;
      indexed += batch.length - itemErrors.length;
    } else {
      indexed += batch.length;
    }

    cursor += batch.length;
    if (batch.length < BATCH) break;
  }

  return { indexed, errors };
}
