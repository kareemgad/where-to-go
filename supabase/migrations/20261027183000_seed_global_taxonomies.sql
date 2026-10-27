-- Where to Go | 0024 the global vocabulary
--
-- Reference data rather than fixture data, so it lives in a migration: the
-- parser maps onto these keys and the engine matches on them, which means an
-- environment without them has a broken search rather than an empty demo. The
-- seeder rebuilds the fictional world and must not be able to take the
-- vocabulary with it.
--
-- Market extensions are seeded instead, because they need market ids that only
-- exist once a market has been created.
--
-- Approved by the product owner on 2026-10-27 as the v1 list.

-- ---------------------------------------------------------------------------
-- experience tags
-- ---------------------------------------------------------------------------

insert into experience_tags (key, facet, sort_order) values
  ('live_music',      'music',    10),
  ('jazz',            'music',    20),
  ('arabic_music',    'music',    30),
  ('rock_indie',      'music',    40),
  ('electronic_dj',   'music',    50),
  ('acoustic_singer', 'music',    60),

  ('rooftop',          'setting', 10),
  ('waterfront',       'setting', 20),
  ('garden_courtyard', 'setting', 30),
  ('intimate_cosy',    'setting', 40),
  ('grand_historic',   'setting', 50),
  ('casual_everyday',  'setting', 60),

  ('date_night',    'occasion', 10),
  ('big_group',     'occasion', 20),
  ('family_outing', 'occasion', 30),
  ('solo_friendly', 'occasion', 40),
  ('celebration',   'occasion', 50),

  ('dancing',           'activity', 10),
  ('shisha',            'activity', 20),
  ('sports_screening',  'activity', 30),
  ('comedy',            'activity', 40),
  ('art_culture',       'activity', 50)
on conflict (key) do nothing;

-- Display text, never the key. Arabic here translates common nouns, which doc
-- 10 permits; it forbids translating proper names without a source, and none
-- of these are proper names.
insert into experience_tag_labels (tag_id, locale, label)
select t.id, v.locale, v.label
from experience_tags t
join (values
  ('live_music',      'en', 'Live music'),        ('live_music',      'ar', 'موسيقى حية'),
  ('jazz',            'en', 'Jazz'),              ('jazz',            'ar', 'جاز'),
  ('arabic_music',    'en', 'Arabic music'),      ('arabic_music',    'ar', 'موسيقى عربية'),
  ('rock_indie',      'en', 'Rock and indie'),    ('rock_indie',      'ar', 'روك وإندي'),
  ('electronic_dj',   'en', 'Electronic and DJ'), ('electronic_dj',   'ar', 'إلكترونية ودي جي'),
  ('acoustic_singer', 'en', 'Acoustic'),          ('acoustic_singer', 'ar', 'أكوستيك'),

  ('rooftop',          'en', 'Rooftop'),            ('rooftop',          'ar', 'سطح علوي'),
  ('waterfront',       'en', 'By the water'),       ('waterfront',       'ar', 'على الواجهة المائية'),
  ('garden_courtyard', 'en', 'Garden or courtyard'),('garden_courtyard', 'ar', 'حديقة أو فناء'),
  ('intimate_cosy',    'en', 'Intimate and cosy'),  ('intimate_cosy',    'ar', 'أجواء حميمة'),
  ('grand_historic',   'en', 'Grand or historic'),  ('grand_historic',   'ar', 'مكان تاريخي فخم'),
  ('casual_everyday',  'en', 'Casual and everyday'),('casual_everyday',  'ar', 'أجواء يومية بسيطة'),

  ('date_night',    'en', 'Date night'),    ('date_night',    'ar', 'موعد رومانسي'),
  ('big_group',     'en', 'Big group'),     ('big_group',     'ar', 'مجموعة كبيرة'),
  ('family_outing', 'en', 'Family outing'), ('family_outing', 'ar', 'خروجة عائلية'),
  ('solo_friendly', 'en', 'Good on your own'), ('solo_friendly', 'ar', 'مناسب للفرد'),
  ('celebration',   'en', 'Celebration'),   ('celebration',   'ar', 'احتفال'),

  ('dancing',          'en', 'Dancing'),           ('dancing',          'ar', 'رقص'),
  ('shisha',           'en', 'Shisha'),            ('shisha',           'ar', 'شيشة'),
  ('sports_screening', 'en', 'Sport on screen'),   ('sports_screening', 'ar', 'عرض مباريات'),
  ('comedy',           'en', 'Comedy'),            ('comedy',           'ar', 'كوميديا'),
  ('art_culture',      'en', 'Art and culture'),   ('art_culture',      'ar', 'فن وثقافة')
) as v(key, locale, label) on v.key = t.key
where t.market_id is null
on conflict (tag_id, locale) do nothing;

-- ---------------------------------------------------------------------------
-- outing kinds
-- ---------------------------------------------------------------------------

insert into outing_kinds (key, sort_order) values
  ('restaurant',        10),
  ('drinks_lounge',     20),
  ('cafe',              30),
  ('live_music_venue',  40),
  ('concert_show',      50),
  ('nightlife',         60),
  ('outdoor_activity',  70),
  ('culture',           80),
  ('family_activity',   90),
  ('wellness',         100),
  ('sports_active',    110),
  ('beach_day_out',    120)
on conflict (key) do nothing;

insert into outing_kind_labels (kind_id, locale, label)
select k.id, v.locale, v.label
from outing_kinds k
join (values
  ('restaurant',       'en', 'Restaurant'),        ('restaurant',       'ar', 'مطعم'),
  ('drinks_lounge',    'en', 'Drinks and lounge'), ('drinks_lounge',    'ar', 'مشروبات وصالة'),
  ('cafe',             'en', 'Café'),              ('cafe',             'ar', 'مقهى'),
  ('live_music_venue', 'en', 'Live music'),        ('live_music_venue', 'ar', 'موسيقى حية'),
  ('concert_show',     'en', 'Concert or show'),   ('concert_show',     'ar', 'حفل أو عرض'),
  ('nightlife',        'en', 'Nightlife'),         ('nightlife',        'ar', 'حياة ليلية'),
  ('outdoor_activity', 'en', 'Outdoor activity'),  ('outdoor_activity', 'ar', 'نشاط في الهواء الطلق'),
  ('culture',          'en', 'Culture'),           ('culture',          'ar', 'ثقافة'),
  ('family_activity',  'en', 'Family activity'),   ('family_activity',  'ar', 'نشاط عائلي'),
  ('wellness',         'en', 'Wellness'),          ('wellness',         'ar', 'صحة واسترخاء'),
  ('sports_active',    'en', 'Sport and active'),  ('sports_active',    'ar', 'رياضة ونشاط'),
  ('beach_day_out',    'en', 'Beach or day out'),  ('beach_day_out',    'ar', 'شاطئ أو يوم خارجي')
) as v(key, locale, label) on v.key = k.key
where k.market_id is null
on conflict (kind_id, locale) do nothing;

-- ---------------------------------------------------------------------------
-- time-of-day bands
-- ---------------------------------------------------------------------------
-- Global defaults. A market overrides any of these by inserting its own row,
-- which app_market_time_bands prefers. Band *labels* are UI copy and live in
-- the i18n module: the set of four is fixed, so only the hours vary by market.
--
-- Late night deliberately ends before it starts. The search window already
-- rolls a range like that into the following day, which is the behaviour that
-- makes "late night" mean tonight-into-tomorrow rather than an empty result.

insert into time_of_day_bands (key, market_id, starts_local, ends_local, sort_order) values
  ('brunch',     null, '10:00', '14:00', 10),
  ('afternoon',  null, '14:00', '17:00', 20),
  ('evening',    null, '19:00', '23:00', 30),
  ('late_night', null, '22:00', '03:00', 40)
on conflict do nothing;
