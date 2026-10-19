/**
 * Import the world's administrative boundaries into server/data/world.db.
 *
 *   python -I server/extract-world.py <out.ndjson.gz>     (once: pulls from Overture)
 *   node server/import-world.mjs <out.ndjson.gz>
 *
 * The boundaries are Overture Maps' "divisions" theme (overturemaps.org,
 * ODbL), which is built from OpenStreetMap's own boundary relations. That is
 * the point of using it: the borders are OSM's borders, vertex for vertex, so
 * they line up with the OpenStreetMap basemap and with every OSM lookup the
 * studio makes, and two neighbours share exactly the same points along their
 * common border. The "land" version of each unit is used — clipped to the
 * coastline rather than running out to the territorial-sea limit.
 *
 * Three levels are kept: countries (and dependencies), first-level regions
 * (states, provinces…) and second-level districts (LGAs, counties…).
 *
 * Every outline is:
 *  - snapped to a 1 m grid (the extract already rounds to it);
 *  - simplified *topologically* by a few metres: each border two units share
 *    is simplified once, identically for both, so no gaps or overlaps open
 *    between neighbours (see topology.mjs);
 *  - repaired: anything still invalid is rebuilt as valid polygons;
 *  - measured, and linked to its region by ISO 3166-2 code.
 *
 * The extract is read once per level per pass. The new database is written
 * beside the old one and swapped in at the end, so a failed run leaves the
 * working one alone. Stop the cache server first: Windows will not replace a
 * file another process has open.
 */

import { createReadStream, existsSync, renameSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip, gzipSync } from 'node:zlib';
import turfArea from '@turf/area';
import { createWorldDb, indexWorldDb, normalise, worldStats, WORLD_PATH } from './world.mjs';
import { VertexTable, countFeature, simplifyShared, repairPolygons } from './topology.mjs';

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('Usage: node server/import-world.mjs <divisions.ndjson.gz from server/extract-world.py>');
  process.exit(1);
}

/** Degrees. ≈ 3 m — invisible against the OSM basemap at any zoom a sheet is printed at. */
const TOLERANCE = Number(process.env.WORLD_TOLERANCE ?? 0.00003);
const TABLE_BITS = Number(process.env.WORLD_TABLE_BITS ?? 26);

const LEVEL_OF = { country: 0, dependency: 0, region: 1, county: 2 };

const countryName = (() => {
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    return (code) => { try { return names.of(String(code).toUpperCase()) ?? code; } catch { return code; } };
  } catch {
    return (code) => code;
  }
})();

/* ---- reading ----------------------------------------------------------- */

async function* rows(level) {
  const input = createReadStream(file).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (LEVEL_OF[row.subtype] !== level) continue;
    const geometry = typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom;
    if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') continue;
    yield { ...row, geometry };
  }
}

const polygonsOf = (geometry) => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates);

/* ---- geometry helpers ---------------------------------------------------- */

const asGeometry = (polys) => (polys.length === 1
  ? { type: 'Polygon', coordinates: polys[0] }
  : { type: 'MultiPolygon', coordinates: polys });

function bboxOfPolys(polys) {
  let w = 180; let s = 90; let e = -180; let n = -90;
  for (const poly of polys) for (const [x, y] of poly[0]) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

/* ---- import -------------------------------------------------------------- */

const BUILD_PATH = `${WORLD_PATH}.new`;
for (const suffix of ['', '-wal', '-shm']) rmSync(`${BUILD_PATH}${suffix}`, { force: true });
const db = createWorldDb(BUILD_PATH);
const insert = db.prepare(`
  INSERT INTO units (level, name, name_norm, iso3, iso2, country, parent_id, parent_name, w, s, e, n, area_km2, geom)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const regionRow = new Map();   // ISO 3166-2 region code → { rowid, name }
const started = Date.now();

for (const level of [0, 1, 2]) {
  let count = 0; let repaired = 0; let orphans = 0;
  console.log(`Level ${level} (${['countries', 'regions', 'districts'][level]})`);

  // Pass 1: which vertices are shared, and by whom.
  const table = new VertexTable(TABLE_BITS);
  let fid = 0;
  for await (const row of rows(level)) {
    fid += 1;
    countFeature(table, polygonsOf(row.geometry), fid);
  }
  console.log(`  ${table.used.toLocaleString()} distinct vertices in ${fid.toLocaleString()} units`);

  // Pass 2: simplify shared borders once, repair, store.
  db.exec('BEGIN');
  for await (const row of rows(level)) {
    const simplified = polygonsOf(row.geometry)
      .map((poly) => {
        const outer = simplifyShared(table, poly[0], TOLERANCE);
        if (!outer) return null;
        return [outer, ...poly.slice(1).map((r) => simplifyShared(table, r, TOLERANCE)).filter(Boolean)];
      })
      .filter(Boolean);
    const polys = repairPolygons(simplified);
    if (!polys.length) continue;
    if (polys.length !== simplified.length) repaired += 1;

    const iso2 = String(row.country ?? '').toLowerCase();
    // English where Overture has it, so "Bavaria" and "Lagos" read the way
    // the rest of the studio does; the local name is searchable as well.
    const local = String(row.name ?? '').trim();
    const name = String(row.name_en ?? '').trim() || local || iso2.toUpperCase();
    const searchName = local && local !== name ? `${name} ${local}` : name;

    // A district names its region by ISO 3166-2 code ("NG-LA"), the same
    // code the region itself carries — no hierarchy table needed.
    let parentId = null; let parentName = null;
    if (level === 2) {
      const parent = row.region && regionRow.get(row.region);
      if (parent) { parentId = parent.rowid; parentName = parent.name; } else orphans += 1;
    }

    const geometry = asGeometry(polys);
    const bbox = bboxOfPolys(polys);
    let areaKm2 = 0;
    try { areaKm2 = turfArea({ type: 'Feature', properties: {}, geometry }) / 1e6; } catch { /* left at 0 */ }

    const { lastInsertRowid } = insert.run(
      level, name, normalise(searchName), iso2.toUpperCase(), iso2, countryName(iso2) || iso2.toUpperCase(),
      parentId, parentName, ...bbox, Math.round(areaKm2 * 100) / 100, gzipSync(JSON.stringify(geometry)),
    );
    if (level === 1 && row.region) regionRow.set(row.region, { rowid: Number(lastInsertRowid), name });

    count += 1;
    if (count % 2000 === 0) process.stdout.write(`  ${count.toLocaleString()}…\r`);
  }
  db.exec('COMMIT');
  console.log(`  ${count.toLocaleString()} imported, ${repaired.toLocaleString()} repaired${level === 2 ? `, ${orphans} without a region` : ''}`);
}

indexWorldDb(db);
const summary = worldStats(db);
db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;');
db.close();
for (const suffix of ['', '-wal', '-shm']) rmSync(`${WORLD_PATH}${suffix}`, { force: true });
renameSync(BUILD_PATH, WORLD_PATH);
console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s → ${WORLD_PATH}`, summary);
