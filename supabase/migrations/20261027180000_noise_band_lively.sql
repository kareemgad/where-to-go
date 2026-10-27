-- Where to Go | 0021 a fourth noise band
--
-- The UI offers Quiet, Moderate, Lively and Loud. The stored enum had three
-- values, so "lively" and "loud" would have collapsed onto one — the UI would
-- have offered a distinction the data could not make, which reads as a bug
-- rather than as missing data.
--
-- Alone in its own migration on purpose. Postgres permits ALTER TYPE ADD VALUE
-- inside a transaction, but the new value cannot be *used* until that
-- transaction commits, and the repository's runner wraps each migration in
-- one. Anything referencing 'lively' therefore has to land in a later file.

alter type noise_band add value if not exists 'lively' before 'loud';
