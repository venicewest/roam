// supabase/functions/import-city-pois/index.ts
// Seeds Tier 3 POIs for a city using OpenStreetMap Overpass API.
// Tier 3 POIs have no narrative yet — synthesize-poi generates them lazily
// when users first encounter them during a tour.
//
// Called manually by admins:
//   curl -X POST .../import-city-pois \
//     -H "Authorization: Bearer <service_role_key>" \
//     -d '{"city":"Chicago","country_code":"US"}'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// OSM tag → category_id mapping
// category_ids: 1=History, 2=Architecture, 3=Art & Culture,
//               4=Nature, 5=Food & Drink, 6=Entertainment, 7=Shopping, 8=Landmarks
function osmTagsToCategoryId(tags: Record<string, string>): number {
  const historic = tags["historic"];
  const tourism = tags["tourism"];
  const amenity = tags["amenity"];
  const leisure = tags["leisure"];
  const natural = tags["natural"];

  if (historic) return 1; // History & Heritage
  if (tourism === "museum") return 3; // Art & Culture
  if (tourism === "gallery" || amenity === "arts_centre") return 3;
  if (amenity === "theatre" || amenity === "cinema") return 6; // Entertainment
  if (tourism === "attraction" || tourism === "viewpoint") return 8; // Landmarks
  if (amenity === "place_of_worship") return 1; // History (churches/temples)
  if (leisure === "park" || leisure === "garden" || natural) return 4; // Nature
  if (amenity === "marketplace" || tags["shop"]) return 7; // Shopping
  if (tourism === "artwork") return 3; // Art & Culture

  // Default architecture tag check
  const building = tags["building"];
  if (building === "cathedral" || building === "church" || building === "mosque") return 2;

  return 8; // Default: Landmarks
}

// Build Overpass query for interesting named POIs in a city
function buildOverpassQuery(city: string): string {
  return `
[out:json][timeout:60];
area["name"="${city}"]["boundary"="administrative"]->.searchArea;
(
  node["historic"]["name"](area.searchArea);
  node["tourism"~"museum|attraction|gallery|viewpoint|artwork|zoo|aquarium|theme_park|information"]["name"](area.searchArea);
  node["amenity"~"place_of_worship|theatre|arts_centre|cinema|nightclub|casino|community_centre|fountain|grave_yard"]["name"](area.searchArea);
  node["leisure"~"park|garden|nature_reserve|stadium|marina"]["name"](area.searchArea);
  node["man_made"~"lighthouse|pier|tower|monument"]["name"](area.searchArea);
  node["building"~"cathedral|church|chapel|mosque|synagogue|temple|monument|civic"]["name"](area.searchArea);
  node["natural"~"beach|cliff|peak|spring"]["name"](area.searchArea);
  way["historic"]["name"](area.searchArea);
  way["tourism"~"museum|attraction|gallery|viewpoint|artwork|zoo|aquarium"]["name"](area.searchArea);
  way["amenity"~"place_of_worship|theatre|arts_centre|cinema|nightclub|casino|grave_yard"]["name"](area.searchArea);
  way["leisure"~"park|garden|nature_reserve|stadium|marina"]["name"](area.searchArea);
  way["man_made"~"lighthouse|pier|tower|monument"]["name"](area.searchArea);
  way["building"~"cathedral|church|chapel|mosque|synagogue|temple|monument|civic"]["name"](area.searchArea);
  way["natural"~"beach|cliff"]["name"](area.searchArea);
  relation["historic"]["name"](area.searchArea);
  relation["tourism"~"museum|attraction|gallery"]["name"](area.searchArea);
  relation["leisure"~"park|garden|nature_reserve"]["name"](area.searchArea);
  relation["amenity"~"place_of_worship|theatre"]["name"](area.searchArea);
);
out center tags;
  `.trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { city, country_code = "US" } = await req.json();
    if (!city) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "missing_param", message: "city required" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch POIs from Overpass API
    const query = buildOverpassQuery(city);
    const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!overpassRes.ok) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "overpass_error", message: `Overpass API returned ${overpassRes.status}` } }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const osmData = await overpassRes.json();
    const elements: any[] = osmData.elements ?? [];

    if (elements.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "no_pois", message: `No POIs found for "${city}". Try a different city name or spelling.` } }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Convert OSM elements to POI rows
    const poisToInsert: any[] = [];
    for (const el of elements) {
      const name: string | undefined = el.tags?.name;
      if (!name) continue;

      // Get coordinates (node = direct, way = center)
      const lat: number = el.lat ?? el.center?.lat;
      const lon: number = el.lon ?? el.center?.lon;
      if (!lat || !lon) continue;

      const categoryId = osmTagsToCategoryId(el.tags ?? {});

      poisToInsert.push({
        name,
        city,
        country_code: country_code.toUpperCase().substring(0, 2),
        location: `SRID=4326;POINT(${lon} ${lat})`,
        tier: 3,
        category_id: categoryId,
        narrative: `${name} is a point of interest in ${city}.`, // placeholder — synthesize-poi will replace this
        confidence_score: null,
        quality_status: "active",
        source_attribution: "OpenStreetMap contributors",
      });
    }

    if (poisToInsert.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "no_valid_pois", message: "No POIs with valid coordinates found" } }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Upsert in batches of 100 — skip duplicates by name+city (best effort)
    let inserted = 0;
    let skipped = 0;
    const BATCH = 100;

    for (let i = 0; i < poisToInsert.length; i += BATCH) {
      const batch = poisToInsert.slice(i, i + BATCH);

      // Check which names already exist in this city
      const names = batch.map((p) => p.name);
      const { data: existing } = await adminClient
        .from("pois")
        .select("name")
        .eq("city", city)
        .in("name", names);

      const existingNames = new Set((existing ?? []).map((p: any) => p.name));
      const newPois = batch.filter((p) => !existingNames.has(p.name));

      skipped += batch.length - newPois.length;

      if (newPois.length > 0) {
        const { error } = await adminClient.from("pois").insert(newPois);
        if (error) {
          console.error("Insert error:", error.message);
        } else {
          inserted += newPois.length;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          city,
          found: elements.length,
          inserted,
          skipped_duplicates: skipped,
          message: `${inserted} POIs imported for ${city}. Narratives will be AI-generated when users encounter them.`,
        },
        meta: { request_id: crypto.randomUUID(), timestamp: new Date().toISOString() },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("import-city-pois error:", err.message);
    return new Response(
      JSON.stringify({ success: false, error: { code: "server_error", message: err.message } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
