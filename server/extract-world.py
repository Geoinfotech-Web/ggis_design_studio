"""
Pull the world's administrative boundaries from Overture Maps.

    pip install duckdb
    python -I server/extract-world.py world-divisions.ndjson.gz [release]
    node server/import-world.mjs world-divisions.ndjson.gz

Overture's "divisions" theme is built from OpenStreetMap's boundary relations,
so these outlines are OSM's outlines and line up with the OSM basemap. Only
what the studio uses is pulled: countries, dependencies, first-level regions
and second-level districts, in their land version (cut at the coast).

Coordinates are rounded to 1e-5 degrees (~1 m) - the same rounding on both
sides of a shared border, so neighbours still meet exactly - and the file is
written gzipped. DuckDB reads only the parts of Overture's GeoParquet it
needs, straight from Overture's public S3 bucket; no account is required.

It is a plain streaming filter on purpose: no join, no sort, a small memory
limit. Joining the hierarchy table in made DuckDB hold gigabytes, and on a
machine short of RAM Windows grows its page file to cover it. Each district
already carries its region's ISO 3166-2 code, which is all the importer needs
to link it to its region.

Releases are listed at https://stac.overturemaps.org/catalog.json
"""

import sys
import time

import duckdb

out = sys.argv[1] if len(sys.argv) > 1 else 'world-divisions.ndjson.gz'
release = sys.argv[2] if len(sys.argv) > 2 else '2026-09-23.1'

started = time.time()
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
con.execute("SET s3_region='us-west-2'; SET memory_limit='2500MB'; SET threads=2; SET preserve_insertion_order=false;")
base = f"s3://overturemaps-us-west-2/release/{release}/theme=divisions"
con.execute(f"""
COPY (
  SELECT
    division_id AS id,
    subtype,
    country,
    region,
    names.primary AS name,
    names.common['en'] AS name_en,
    ST_AsGeoJSON(ST_ReducePrecision(geometry, 0.00001)) AS geom
  FROM read_parquet('{base}/type=division_area/*')
  WHERE class = 'land' AND subtype IN ('country', 'dependency', 'region', 'county')
) TO '{out}' (FORMAT JSON, COMPRESSION GZIP)
""")
print(f'Wrote {out} in {round(time.time() - started)} s (Overture release {release})')
