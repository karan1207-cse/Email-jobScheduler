/**
 * The worker shares the API's Prisma schema. npm workspaces give the worker its
 * own copy of @prisma/client, which `prisma generate` in the API never fills,
 * so the worker would fail with "@prisma/client did not initialize yet".
 * This generates the client from the API schema and copies it into the worker.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = resolve(workerDir, '../api');

const source = resolve(apiDir, 'node_modules/.prisma/client');
try {
  execSync('npx prisma generate --schema=prisma/schema.prisma', { cwd: apiDir, stdio: 'inherit' });
} catch (err) {
  // On Windows a running API keeps the query engine DLL locked; reuse its client.
  if (!existsSync(resolve(source, 'index.js'))) throw err;
  console.warn('[worker] prisma generate failed; reusing the existing API Prisma client.');
}
const target = resolve(workerDir, 'node_modules/.prisma/client');
if (!existsSync(resolve(workerDir, 'node_modules/@prisma/client'))) {
  // @prisma/client is hoisted and shared with the API, so nothing to copy.
  process.exit(0);
}
cpSync(source, target, { recursive: true });
console.log(`[worker] Prisma client synced to ${target}`);
