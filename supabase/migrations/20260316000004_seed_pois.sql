-- supabase/migrations/20260316000004_seed_pois.sql
-- Seed Tier 1 (curated) POIs in major tourist cities.
-- These give the app something to narrate immediately after launch.
-- Coordinates: ST_GeographyFromText('SRID=4326;POINT(longitude latitude)')

INSERT INTO public.pois
  (id, name, city, country_code, location, tier, category_id, narrative, source_attribution, confidence_score, quality_status)
VALUES

-- ─── New York City ────────────────────────────────────────────────────────────
(
  uuid_generate_v4(),
  'Brooklyn Bridge',
  'New York City', 'US',
  ST_GeographyFromText('SRID=4326;POINT(-73.9969 40.7061)'),
  1, 8,
  'Completed in 1883, the Brooklyn Bridge was the longest suspension bridge in the world for 20 years. Chief engineer John Roebling designed it but died of a tetanus infection before construction finished — his son Washington carried on despite being partially paralyzed by decompression sickness. The gothic stone towers you see were revolutionary, blending engineering with architecture at a time when most bridges were purely functional.',
  'Roam Editorial', 0.95, 'active'
),
(
  uuid_generate_v4(),
  'Times Square',
  'New York City', 'US',
  ST_GeographyFromText('SRID=4326;POINT(-73.9855 40.7580)'),
  1, 6,
  'Times Square earned its name in 1904 when the New York Times moved its headquarters here and celebrated with a fireworks display — a tradition that evolved into the iconic New Year''s ball drop. During World War II, the bright signs were dimmed to protect against U-boat attacks, giving this stretch of Broadway the eerie nickname "the dim-out." Today about 50 million people pass through annually, making it one of the most visited places on Earth.',
  'Roam Editorial', 0.95, 'active'
),
(
  uuid_generate_v4(),
  'Bethesda Fountain, Central Park',
  'New York City', 'US',
  ST_GeographyFromText('SRID=4326;POINT(-73.9710 40.7740)'),
  1, 3,
  'The Bethesda Fountain is the only sculpture commissioned as part of Central Park''s original 1858 design. The angel atop it represents the biblical Pool of Bethesda, believed to have healing powers. Sculptor Emma Stebbins was the first woman ever commissioned for a major public artwork in New York City. The terrace surrounding it was designed to be the park''s ceremonial heart — a grand gathering place where all paths converge.',
  'Roam Editorial', 0.92, 'active'
),

-- ─── London ───────────────────────────────────────────────────────────────────
(
  uuid_generate_v4(),
  'Tower Bridge',
  'London', 'GB',
  ST_GeographyFromText('SRID=4326;POINT(-0.0754 51.5055)'),
  1, 2,
  'Despite looking medieval, Tower Bridge was built in 1894 — its Gothic towers were a deliberate design choice to complement the adjacent Tower of London. The central bascules, weighing over 1,000 tonnes each, can still be raised to let tall ships pass, though it only happens about 1,000 times a year now compared to 50 times a day in the Victorian era. The high-level walkways were originally open to the public but were closed in 1910 after becoming a favourite spot for pickpockets and prostitutes.',
  'Roam Editorial', 0.95, 'active'
),
(
  uuid_generate_v4(),
  'Buckingham Palace',
  'London', 'GB',
  ST_GeographyFromText('SRID=4326;POINT(-0.1419 51.5014)'),
  1, 8,
  'Buckingham Palace started life as a townhouse built for the Duke of Buckingham in 1703 — a far cry from a royal residence. George III bought it in 1761 as a private retreat, and it only became the official London home of the monarch when Queen Victoria moved in at the start of her reign in 1837. The famous balcony, where the Royal Family appears for national occasions, wasn''t added until 1851. The palace has 775 rooms, including 52 royal and guest bedrooms.',
  'Roam Editorial', 0.95, 'active'
),
(
  uuid_generate_v4(),
  'St Paul''s Cathedral',
  'London', 'GB',
  ST_GeographyFromText('SRID=4326;POINT(-0.0983 51.5138)'),
  1, 1,
  'Sir Christopher Wren designed St Paul''s after the Great Fire of London destroyed the previous cathedral in 1666, but his first two designs were rejected by the church authorities as too radical. The dome you see today is actually three domes in one: an inner dome, a brick cone for structural support, and an outer lead dome — an engineering trick that allows it to look perfect from both inside and outside. Wren is buried in the crypt below, with the epitaph: "Reader, if you seek his monument, look around you."',
  'Roam Editorial', 0.95, 'active'
),

-- ─── San Francisco ────────────────────────────────────────────────────────────
(
  uuid_generate_v4(),
  'Golden Gate Bridge',
  'San Francisco', 'US',
  ST_GeographyFromText('SRID=4326;POINT(-122.4783 37.8199)'),
  1, 2,
  'When the Golden Gate Bridge opened in 1937, it was the longest and tallest suspension bridge in the world. Its distinctive "International Orange" color was originally applied as a sealant primer — naval architects wanted it painted black with yellow stripes for visibility, but consulting architect Irving Morrow convinced them the warm orange complemented the natural landscape. The bridge moves: in high winds it can sway up to 27 feet, and on hot days the roadway expands enough to lower the center span by 10 feet.',
  'Roam Editorial', 0.95, 'active'
),
(
  uuid_generate_v4(),
  'Painted Ladies',
  'San Francisco', 'US',
  ST_GeographyFromText('SRID=4326;POINT(-122.4330 37.7763)'),
  1, 2,
  'The six Victorian houses on Steiner Street known as the Painted Ladies were built between 1892 and 1896, but their fame really took off after appearing as the Tanner family home in the TV show Full House. "Painted Ladies" refers to Victorian and Edwardian architecture painted in three or more colors to enhance their ornate details. San Francisco has over 48,000 Victorian buildings — more than any other American city — largely because the 1906 earthquake spared this neighborhood while devastating much of downtown.',
  'Roam Editorial', 0.93, 'active'
),

-- ─── Paris ────────────────────────────────────────────────────────────────────
(
  uuid_generate_v4(),
  'Eiffel Tower',
  'Paris', 'FR',
  ST_GeographyFromText('SRID=4326;POINT(2.2945 48.8584)'),
  1, 8,
  'Gustave Eiffel built this tower for the 1889 World''s Fair as a temporary structure — it was supposed to be demolished after 20 years. It was saved because its antenna proved useful for radio transmission. Parisians initially hated it, calling it an "eyesore" and "iron asparagus." The tower is repainted every seven years using 60 tonnes of paint, and it actually grows about 6 inches taller in summer as the iron expands in the heat.',
  'Roam Editorial', 0.95, 'active'
),
(
  uuid_generate_v4(),
  'Notre-Dame Cathedral',
  'Paris', 'FR',
  ST_GeographyFromText('SRID=4326;POINT(2.3499 48.8530)'),
  1, 1,
  'Construction on Notre-Dame began in 1163 and took nearly 200 years to complete. Victor Hugo''s 1831 novel The Hunchback of Notre-Dame, written partly to draw attention to the cathedral''s deterioration, sparked a major restoration effort led by Eugène Viollet-le-Duc. The spire you may remember from before April 2019 was actually Viollet-le-Duc''s 19th-century addition — the medieval original had been removed in 1786. Reconstruction following the 2019 fire is scheduled for completion by 2025.',
  'Roam Editorial', 0.95, 'active'
),

-- ─── Sydney ───────────────────────────────────────────────────────────────────
(
  uuid_generate_v4(),
  'Sydney Opera House',
  'Sydney', 'AU',
  ST_GeographyFromText('SRID=4326;POINT(151.2153 -33.8568)'),
  1, 3,
  'Danish architect Jørn Utzon won the design competition for the Opera House in 1957 with a sketch so abstract that some judges wanted to disqualify it. The iconic shell-shaped roofs posed an engineering problem that took years to solve — Utzon eventually realized all the shells could be cut from the same sphere, making construction feasible. He resigned in 1966 after a dispute with the government and never returned to see the finished building, which opened in 1973. He died in 2008, four years after it was listed as a UNESCO World Heritage Site.',
  'Roam Editorial', 0.95, 'active'
),

-- ─── Tokyo ────────────────────────────────────────────────────────────────────
(
  uuid_generate_v4(),
  'Senso-ji Temple',
  'Tokyo', 'JP',
  ST_GeographyFromText('SRID=4326;POINT(139.7967 35.7148)'),
  1, 1,
  'Senso-ji is Tokyo''s oldest temple, founded in 628 AD after two fishermen reportedly pulled a golden statue of Kannon, the goddess of mercy, from the Sumida River. The enormous paper lantern at the Kaminarimon gate weighs nearly a tonne and has been replaced several times — the current one was donated by Panasonic in 1960. Despite being a deeply sacred Buddhist site, the temple welcomes visitors of all faiths and sees around 30 million visitors each year, making it one of the world''s most visited spiritual sites.',
  'Roam Editorial', 0.95, 'active'
)

ON CONFLICT DO NOTHING;
