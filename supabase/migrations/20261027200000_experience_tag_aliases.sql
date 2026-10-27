-- Where to Go | 0026 free text onto the controlled vocabulary
--
-- Two problems, one table.
--
-- Users type freely. "somewhere with a bit of jazz" has to become the tag
-- `jazz` before anything deterministic can happen with it, and the mapping has
-- to be data rather than a switch statement in the parser: a market that adds
-- a term needs it searchable the same day, without a deploy.
--
-- Occurrences carry free-text genre_tags from their source - 'jazz', 'oud',
-- 'folk'. Those stay as the source said them, because that is what evidence
-- means, but matching cannot run on them: it would compare a string a user
-- typed against a string a venue wrote, which matches on spelling rather than
-- on meaning. The alias table maps both onto the same keys.
--
-- Aliases are stored folded to lowercase and matched that way. Arabic has no
-- case, so the fold is a no-op there and costs nothing.

create table experience_tag_aliases (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references experience_tags (id) on delete cascade,

  alias text not null check (alias = lower(btrim(alias)) and length(alias) between 2 and 60),

  -- BCP 47 language subtag, or null for an alias that works in any language
  -- (a proper noun, a borrowed word). Not a full locale: 'jazz' does not need
  -- a different row for en-AE and en-EG.
  lang text check (lang is null or lang ~ '^[a-z]{2}$'),

  created_at timestamptz not null default now(),

  -- One meaning per phrase per language. An alias mapping to two tags would
  -- make the parser's output depend on row order, which is the quietest
  -- possible way for a search to become irreproducible.
  unique (alias, lang)
);

create index experience_tag_aliases_tag_idx on experience_tag_aliases (tag_id);

comment on table experience_tag_aliases is
  'Free-text phrases that resolve to a vocabulary term. Used by the intent '
  'parser and by occurrence genre mapping, so both arrive at the same key for '
  'the same word.';

alter table experience_tag_aliases enable row level security;

/**
 * Resolve free text to tag keys for one market.
 *
 * Returns nothing rather than guessing when a phrase is unknown. A parser that
 * invents a tag for an unrecognised word would put a filter on the search the
 * user never asked for, and they would see it as a chip they did not type.
 */
create or replace function app_resolve_experience_aliases(
  p_market_id uuid,
  p_phrases text[]
)
returns table (phrase text, tag_key text, facet experience_facet)
language sql
stable
as $$
  select distinct on (p.phrase) p.phrase, t.key, t.facet
  from unnest(p_phrases) as p(phrase)
  join experience_tag_aliases a on a.alias = lower(btrim(p.phrase))
  join experience_tags t on t.id = a.tag_id
  where t.market_id is null or t.market_id = p_market_id
  -- A language-specific alias beats the language-neutral one for the same
  -- phrase; nulls sort last here.
  order by p.phrase, a.lang nulls last;
$$;

-- ---------------------------------------------------------------------------
-- the global aliases
-- ---------------------------------------------------------------------------
-- English and Arabic for each of the 22 approved terms. Deliberately modest:
-- these are the words someone would actually type, not a thesaurus. A wrong
-- alias is worse than a missing one, because a missing one produces no chip
-- and a wrong one produces a confident chip for something unasked.

insert into experience_tag_aliases (tag_id, alias, lang)
select t.id, v.alias, v.lang
from experience_tags t
join (values
  ('live_music', 'live music', 'en'), ('live_music', 'live band', 'en'),
  ('live_music', 'live', 'en'),       ('live_music', 'gig', 'en'),
  ('live_music', 'موسيقى حية', 'ar'), ('live_music', 'حفلة', 'ar'),

  ('jazz', 'jazz', null), ('jazz', 'جاز', 'ar'),

  ('arabic_music', 'arabic music', 'en'), ('arabic_music', 'arabic', 'en'),
  ('arabic_music', 'oud', 'en'),          ('arabic_music', 'tarab', 'en'),
  ('arabic_music', 'موسيقى عربية', 'ar'), ('arabic_music', 'عربي', 'ar'),
  ('arabic_music', 'عود', 'ar'),          ('arabic_music', 'طرب', 'ar'),

  ('rock_indie', 'rock', 'en'), ('rock_indie', 'indie', 'en'),
  ('rock_indie', 'alternative', 'en'),
  ('rock_indie', 'روك', 'ar'),  ('rock_indie', 'إندي', 'ar'),

  ('electronic_dj', 'electronic', 'en'), ('electronic_dj', 'dj', null),
  ('electronic_dj', 'house', 'en'),      ('electronic_dj', 'techno', null),
  ('electronic_dj', 'إلكترونية', 'ar'),  ('electronic_dj', 'دي جي', 'ar'),

  ('acoustic_singer', 'acoustic', 'en'), ('acoustic_singer', 'folk', 'en'),
  ('acoustic_singer', 'unplugged', 'en'),
  ('acoustic_singer', 'أكوستيك', 'ar'),  ('acoustic_singer', 'عزف هادئ', 'ar'),

  ('rooftop', 'rooftop', 'en'), ('rooftop', 'roof', 'en'),
  ('rooftop', 'skyline', 'en'), ('rooftop', 'سطح', 'ar'),
  ('rooftop', 'روف توب', 'ar'),

  ('waterfront', 'waterfront', 'en'), ('waterfront', 'sea view', 'en'),
  ('waterfront', 'marina', 'en'),     ('waterfront', 'by the water', 'en'),
  ('waterfront', 'إطلالة بحرية', 'ar'), ('waterfront', 'على البحر', 'ar'),

  ('garden_courtyard', 'garden', 'en'),   ('garden_courtyard', 'courtyard', 'en'),
  ('garden_courtyard', 'حديقة', 'ar'),    ('garden_courtyard', 'فناء', 'ar'),

  ('intimate_cosy', 'intimate', 'en'), ('intimate_cosy', 'cosy', 'en'),
  ('intimate_cosy', 'cozy', 'en'),     ('intimate_cosy', 'حميم', 'ar'),
  ('intimate_cosy', 'دافئ', 'ar'),

  ('grand_historic', 'historic', 'en'), ('grand_historic', 'heritage', 'en'),
  ('grand_historic', 'grand', 'en'),    ('grand_historic', 'تاريخي', 'ar'),
  ('grand_historic', 'تراثي', 'ar'),

  ('casual_everyday', 'casual', 'en'),   ('casual_everyday', 'relaxed', 'en'),
  ('casual_everyday', 'laid back', 'en'),('casual_everyday', 'كاجوال', 'ar'),
  ('casual_everyday', 'بسيط', 'ar'),

  ('date_night', 'date night', 'en'), ('date_night', 'date', 'en'),
  ('date_night', 'romantic', 'en'),   ('date_night', 'موعد', 'ar'),
  ('date_night', 'رومانسي', 'ar'),

  ('big_group', 'big group', 'en'), ('big_group', 'group', 'en'),
  ('big_group', 'friends', 'en'),   ('big_group', 'مجموعة', 'ar'),
  ('big_group', 'أصدقاء', 'ar'),

  ('family_outing', 'family', 'en'), ('family_outing', 'with kids', 'en'),
  ('family_outing', 'children', 'en'),
  ('family_outing', 'عائلة', 'ar'),  ('family_outing', 'أطفال', 'ar'),

  ('solo_friendly', 'solo', 'en'),   ('solo_friendly', 'on my own', 'en'),
  ('solo_friendly', 'alone', 'en'),  ('solo_friendly', 'بمفردي', 'ar'),
  ('solo_friendly', 'لوحدي', 'ar'),

  ('celebration', 'celebration', 'en'), ('celebration', 'birthday', 'en'),
  ('celebration', 'anniversary', 'en'),
  ('celebration', 'احتفال', 'ar'),      ('celebration', 'عيد ميلاد', 'ar'),

  ('dancing', 'dancing', 'en'), ('dancing', 'dance', 'en'),
  ('dancing', 'dancefloor', 'en'), ('dancing', 'رقص', 'ar'),

  ('shisha', 'shisha', null), ('shisha', 'sheesha', 'en'),
  ('shisha', 'hookah', 'en'), ('shisha', 'شيشة', 'ar'),
  ('shisha', 'أرجيلة', 'ar'),

  ('sports_screening', 'sports', 'en'),   ('sports_screening', 'football', 'en'),
  ('sports_screening', 'the match', 'en'),('sports_screening', 'رياضة', 'ar'),
  ('sports_screening', 'مباراة', 'ar'),   ('sports_screening', 'كرة', 'ar'),

  ('comedy', 'comedy', 'en'), ('comedy', 'stand up', 'en'),
  ('comedy', 'standup', 'en'), ('comedy', 'كوميديا', 'ar'),
  ('comedy', 'ستاند أب', 'ar'),

  ('art_culture', 'art', 'en'),      ('art_culture', 'gallery', 'en'),
  ('art_culture', 'exhibition', 'en'),('art_culture', 'culture', 'en'),
  ('art_culture', 'فن', 'ar'),       ('art_culture', 'معرض', 'ar'),
  ('art_culture', 'ثقافة', 'ar')
) as v(key, alias, lang) on v.key = t.key
where t.market_id is null
on conflict (alias, lang) do nothing;
