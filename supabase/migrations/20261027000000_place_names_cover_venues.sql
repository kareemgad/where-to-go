-- Where to Go | 0008 localised venue names
--
-- place_names covered the four geographic levels but not venues, so a venue
-- had only reference_name — an internal label explicitly not for display.
-- Doc 10 requires multilingual display text with BCP 47 tags, and doc 16
-- scenario 3 makes an Arabic Cairo query an acceptance gate, so a venue needs
-- localised names as much as a locality does.
--
-- Extending the existing enum rather than adding a venue_names table: a venue
-- is a place, the columns would be identical, and one lookup path is easier to
-- keep correct than two. ALTER TYPE ... ADD VALUE is transaction-safe here
-- because this migration only adds the value and does not use it.

alter type place_kind add value 'venue';

comment on type place_kind is
  'Subjects that place_names can localise, venues included. A venue''s '
  'reference_name stays an internal label; user-facing names come from here.';
