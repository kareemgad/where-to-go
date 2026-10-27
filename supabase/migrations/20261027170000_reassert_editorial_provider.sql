-- Where to Go | 0020 re-assert the editorial source provider
--
-- 0017 inserted it, and then a reseed deleted it: the seeder cleared
-- source_providers wholesale, because until 0017 every provider in that table
-- was fixture data. The seeder now preserves this one, but any database that
-- was seeded in between has lost it, and app_edit_claim refuses to run without
-- it - correctly, since it is where a reviewer's own correction gets its
-- provenance.
--
-- Re-asserting infrastructure data in a migration rather than repairing it by
-- hand: the repository stays the source of truth, and a database restored from
-- any point in this history ends up with the row.

insert into source_providers (
  key, display_name, storage_policy, activation_status, kill_switch,
  tos_reviewed_at, legal_reviewer, cost_model, attribution_required
) values (
  'editorial',
  'Where to Go editorial',
  'canonical_ok',
  'active',
  false,
  now(),
  'first-party - no third-party terms apply to our own reviewers'' work',
  'internal',
  false
)
on conflict (key) do nothing;
