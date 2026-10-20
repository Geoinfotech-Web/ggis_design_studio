/**
 * Take a consistent copy of any of the studio's SQLite databases.
 *
 *   node server/backup-sqlite.mjs <source.db> <copy.db>
 *
 * Meant above all for accounts.db — the one database that cannot be rebuilt,
 * since it holds every user and every saved map. Run it daily (cron, a
 * scheduled task, or `docker compose run --rm backup-accounts`).
 *
 * `VACUUM INTO` has SQLite write the copy itself: it folds in the write-ahead
 * log, so the copy is never quietly missing recent writes the way a `cp` of a
 * live database can be, and it is safe to run while the server is using the
 * file. The copy is then checked with `PRAGMA integrity_check` before this
 * reports success.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const [from, to] = process.argv.slice(2);
if (!from || !to) {
  console.error('Usage: node server/backup-sqlite.mjs <source.db> <copy.db>');
  process.exit(1);
}
const source = resolve(from);
const target = resolve(to);
if (!existsSync(source)) {
  console.error(`No database at ${source}.`);
  process.exit(1);
}
// VACUUM INTO refuses to overwrite; replacing an old copy is explicit here.
if (existsSync(target)) unlinkSync(target);

const mb = (bytes) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const started = Date.now();

const db = new DatabaseSync(source, { readOnly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
const count = (conn) => Object.fromEntries(tables.map((t) => [t, conn.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
const before = count(db);
// VACUUM takes no bound parameters; doubling quotes keeps the path literal intact.
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

const copy = new DatabaseSync(target, { readOnly: true });
const integrity = copy.prepare('PRAGMA integrity_check').get();
const after = count(copy);
copy.close();

const mismatch = tables.filter((t) => before[t] !== after[t]);
if (Object.values(integrity)[0] !== 'ok' || mismatch.length) {
  console.error(`Copy failed verification (${mismatch.length ? `row counts differ in ${mismatch.join(', ')}` : 'integrity check'}). Not trusting it.`);
  process.exit(1);
}
console.log(`Wrote ${target} (${mb(statSync(target).size)}) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(`Verified: ${tables.map((t) => `${t} ${after[t].toLocaleString()}`).join(' · ')}`);
