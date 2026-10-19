/**
 * The world boundaries database.
 *
 * Every country, first-level region (state, province, region…) and
 * second-level district (LGA, county, district…) on Earth, from Overture
 * Maps' divisions theme — OpenStreetMap's own boundaries (ODbL) — pulled by
 * server/extract-world.py and imported by server/import-world.mjs into its
 * own SQLite file.
 *
 * It exists so the study-area search can answer as you type, for any place in
 * the world, without asking a public geocoder anything: names are matched from
 * an index here, and an outline is one row read and sent still gzipped.
 *
 * Kept apart from geodata.db on purpose. That one is a cache and may be
 * pruned; this one is reference data that is only ever rebuilt.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const WORLD_PATH = process.env.WORLD_DB ?? resolve(HERE, 'data', 'world.db');

export const LEVELS = ['country', 'state', 'lga'];   // ADM0, ADM1, ADM2

/** Lower case, accents off, punctuation to spaces — "Côte d'Ivoire" → "cote d ivoire". */
export const normalise = (text) => String(text ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function createWorldDb(path = WORLD_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    DROP TABLE IF EXISTS units;
    CREATE TABLE units (
      id          INTEGER PRIMARY KEY,
      level       INTEGER NOT NULL,           -- 0 country, 1 state, 2 district
      name        TEXT NOT NULL,
      name_norm   TEXT NOT NULL,
      iso3        TEXT NOT NULL,           -- country code, upper case
      iso2        TEXT NOT NULL,
      country     TEXT NOT NULL,
      parent_id   INTEGER,
      parent_name TEXT,
      w REAL, s REAL, e REAL, n REAL,
      area_km2    REAL,
      geom        BLOB NOT NULL               -- gzipped GeoJSON geometry
    );
  `);
  return db;
}

export function indexWorldDb(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS units_name   ON units (name_norm);
    CREATE INDEX IF NOT EXISTS units_place  ON units (iso2, level, name_norm);
    CREATE INDEX IF NOT EXISTS units_parent ON units (parent_id);
    ANALYZE;
  `);
}

/** The database if it has been imported, otherwise null (the studio then searches online only). */
export function openWorldDb(path = WORLD_PATH) {
  if (!existsSync(path)) return null;
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    db.prepare('SELECT 1 FROM units LIMIT 1').get();
    return db;
  } catch {
    return null;
  }
}

const row = (r) => ({
  id: r.id,
  name: r.name,
  level: LEVELS[r.level],
  country: r.country,
  countryCode: r.iso2,
  parentId: r.parent_id ?? null,
  parentName: r.parent_name ?? null,
  bbox: [r.w, r.s, r.e, r.n],
  areaKm2: r.area_km2,
});

const LIST = 'id, level, name, country, iso2, parent_id, parent_name, w, s, e, n, area_km2';

/**
 * Places whose name starts with (or has a word starting with) the text.
 *
 * "ikeja, lagos" narrows by what follows the comma: the region, or the
 * country. Exact names first, then whole-word starts, then bigger units
 * before smaller ones — so "Lagos" offers the state before a district.
 *
 * @param {{q:string, country?:string, level?:string, parent?:number, limit?:number}} opts
 */
export function searchWorld(db, { q, country = '', level = '', parent = null, limit = 10 }) {
  const [head, ...rest] = String(q ?? '').split(',');
  const name = normalise(head);
  const within = normalise(rest.join(' '));
  if (!name) return [];

  const where = ['(name_norm LIKE :prefix OR name_norm LIKE :word)'];
  const params = { prefix: `${name}%`, word: `% ${name}%`, exact: name, limit: Math.min(50, Math.max(1, Number(limit) || 10)) };
  if (country) { where.push('iso2 = :country'); params.country = String(country).toLowerCase(); }
  const lv = LEVELS.indexOf(level);
  if (lv >= 0) { where.push('level = :level'); params.level = lv; }
  if (parent) { where.push('parent_id = :parent'); params.parent = Number(parent); }
  if (within) {
    where.push("(lower(coalesce(parent_name,'')) LIKE :within OR lower(country) LIKE :within)");
    params.within = `%${within}%`;
  }

  const rows = db.prepare(`
    SELECT ${LIST},
      CASE WHEN name_norm = :exact THEN 0 WHEN name_norm LIKE :prefix THEN 1 ELSE 2 END AS rank
    FROM units WHERE ${where.join(' AND ')}
    ORDER BY rank, level, area_km2 DESC
    LIMIT :limit
  `).all(params);
  return rows.map(row);
}

/** The units one level down from a parent, or every unit of a country at a level, by name. */
export function listWorld(db, { country = '', level = 'state', parent = null }) {
  const lv = Math.max(0, LEVELS.indexOf(level));
  const rows = parent
    ? db.prepare(`SELECT ${LIST} FROM units WHERE parent_id = ? ORDER BY name`).all(Number(parent))
    : db.prepare(`SELECT ${LIST} FROM units WHERE iso2 = ? AND level = ? ORDER BY name`).all(String(country).toLowerCase(), lv);
  return rows.map(row);
}

/** One unit with its outline, the outline still gzipped. */
export function getWorldUnit(db, id) {
  const r = db.prepare(`SELECT ${LIST}, geom FROM units WHERE id = ?`).get(Number(id));
  return r ? { unit: row(r), geom: r.geom } : null;
}

export function worldStats(db) {
  const rows = db.prepare('SELECT level, count(*) AS n FROM units GROUP BY level').all();
  return Object.fromEntries(rows.map((r) => [LEVELS[r.level], r.n]));
}
