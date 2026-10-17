/**
 * Elasticsearch indexer for the worker process — Milestone 9
 *
 * Provides a fire-and-forget indexEmail() utility that re-indexes a single
 * email document after the worker changes its status (SENT, FAILED, SCHEDULED).
 *
 * This is intentionally minimal — the API service owns the full index management.
 * All failures are swallowed so the write path (PostgreSQL) is never blocked.
 */

import { Client } from '@elastic/elasticsearch';

const EMAIL_INDEX = process.env.ELASTICSEARCH_INDEX || 'reachinbox_emails';
const ES_URL      = process.env.ELASTICSEARCH_URL  || 'http://localhost:9200';

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    _client = new Client({
      node: ES_URL,
      tls:  process.env.ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED === 'false'
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }
  return _client;
}

export interface EmailIndexDoc {
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

/**
 * Upsert an email document in Elasticsearch.
 * Silently no-ops if Elasticsearch is unreachable.
 */
export async function indexEmailDoc(doc: EmailIndexDoc): Promise<void> {
  try {
    const client = getClient();
    // Quick ping — fail fast if ES is down
    await client.ping();
    await client.index({
      index:    EMAIL_INDEX,
      id:       doc.id,
      document: doc,
    });
  } catch {
    // Best-effort — never block the job processor
  }
}
