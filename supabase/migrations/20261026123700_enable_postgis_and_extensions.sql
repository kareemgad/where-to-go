-- Where to Go | 0001 enable spatial and utility extensions
-- Applied to where-to-go-dev (lujwjhrqiksrpdgsblad) on 2026-10-26.
--
-- PostGIS backs market boundary polygons and venue point geography (ADR-001, doc 10).
-- Installed into the dedicated `extensions` schema rather than `public`, per
-- Supabase guidance, so application tables stay separable from extension objects.

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

comment on extension postgis is
  'Spatial types and predicates for market boundaries and venue locations.';
comment on extension pg_trgm is
  'Trigram matching for venue name search and identity resolution (doc 11 step 3).';
comment on extension unaccent is
  'Accent-insensitive matching; paired with trigram search for transliterated names (doc 10).';
