// supabase/functions/process-city-import-queue/index.ts
// Processes up to 5 pending cities from city_import_queue, fetching POIs from
// the Overpass API and inserting them into the pois table as Tier 3 entries.
//
// Called by cron or manually:
//   curl -X POST .../process-city-import-queue \
//     -H "Authorization: Bearer <service_role_key>"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 5;
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const RATE_LIMIT_DELAY_MS = 2000;

// ----------------------------------------------------------------
// OSM tag → category_id mapping
// category_ids: 1=History, 2=Architecture, 3=Art & Culture,
//               4=Nature, 5=Food & Drink, 6=Entertainment,
//               7=Shopping, 8=Landmarks
// ----------------------------------------------------------------
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

  const building = tags["building"];
  if (
    building === "cathedral" ||
    building === "church" ||
    building === "mosque"
  ) return 2; // Architecture

  return 8; // Default: Landmarks
}

// ----------------------------------------------------------------
// Build Overpass query
// ----------------------------------------------------------------
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

// ----------------------------------------------------------------
// Fetch POIs from Overpass for a single city
// ----------------------------------------------------------------
interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function fetchOverpassPois(city: string): Promise<OverpassElement[]> {
  const query = buildOverpassQuery(city);
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(
      `Overpass API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  return (data.elements ?? []) as OverpassElement[];
}

// ----------------------------------------------------------------
// Resolve lat/lon from a node or way element
// ----------------------------------------------------------------
function resolveCoords(
  el: OverpassElement,
): { lat: number; lon: number } | null {
  if (el.lat != null && el.lon != null) {
    return { lat: el.lat, lon: el.lon };
  }
  if (el.center) {
    return { lat: el.center.lat, lon: el.center.lon };
  }
  return null;
}

// ----------------------------------------------------------------
// Sleep helper
// ----------------------------------------------------------------
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ----------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Require service role key
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!token || token !== serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ------------------------------------------------------------------
  // 1. Pick up to BATCH_SIZE pending cities
  // ------------------------------------------------------------------
  const { data: pendingCities, error: fetchError } = await supabase
    .from("city_import_queue")
    .select("id, city, country_code")
    .eq("status", "pending")
    .order("id", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchError) {
    return new Response(
      JSON.stringify({ error: `Failed to fetch queue: ${fetchError.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!pendingCities || pendingCities.length === 0) {
    return new Response(
      JSON.stringify({ message: "No pending cities in queue.", processed: [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ------------------------------------------------------------------
  // 2. Mark all picked cities as 'processing'
  // ------------------------------------------------------------------
  const cityIds = pendingCities.map((c) => c.id);

  const { error: markError } = await supabase
    .from("city_import_queue")
    .update({ status: "processing" })
    .in("id", cityIds);

  if (markError) {
    return new Response(
      JSON.stringify({ error: `Failed to mark cities as processing: ${markError.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ------------------------------------------------------------------
  // 3. Process each city
  // ------------------------------------------------------------------
  const results: Array<{
    id: number;
    city: string;
    status: "done" | "failed";
    poi_count?: number;
    error?: string;
  }> = [];

  for (let i = 0; i < pendingCities.length; i++) {
    const { id, city, country_code } = pendingCities[i];

    try {
      // Fetch POIs from Overpass
      const elements = await fetchOverpassPois(city);

      // Filter elements that have a name tag and valid coordinates
      const validElements = elements.filter((el) => {
        const name = el.tags?.["name"];
        const coords = resolveCoords(el);
        return name && coords;
      });

      // Fetch existing POI names for this city to skip duplicates
      const { data: existingRows } = await supabase
        .from("pois")
        .select("name")
        .eq("city", city)
        .in(
          "name",
          validElements.map((el) => el.tags!["name"]),
        );

      const existingNames = new Set<string>(
        (existingRows ?? []).map((r: { name: string }) => r.name),
      );

      // Build insert payload
      const newPois = validElements
        .filter((el) => !existingNames.has(el.tags!["name"]))
        .map((el) => {
          const tags = el.tags!;
          const coords = resolveCoords(el)!;
          const name = tags["name"];
          const categoryId = osmTagsToCategoryId(tags);

          return {
            name,
            city,
            country_code,
            category_id: categoryId,
            tier: 3,
            quality_status: "active",
            narrative: `${name} is a point of interest in ${city}.`,
            source_attribution: "OpenStreetMap contributors",
            location: `SRID=4326;POINT(${coords.lon} ${coords.lat})`,
            lat: coords.lat,
            lon: coords.lon,
          };
        });

      let insertedCount = 0;

      if (newPois.length > 0) {
        const { data: inserted, error: insertError } = await supabase
          .from("pois")
          .insert(newPois)
          .select("id");

        if (insertError) {
          throw new Error(`Insert error: ${insertError.message}`);
        }

        insertedCount = inserted?.length ?? 0;
      }

      // Mark city as done
      await supabase
        .from("city_import_queue")
        .update({
          status: "done",
          poi_count: insertedCount,
          processed_at: new Date().toISOString(),
        })
        .eq("id", id);

      results.push({ id, city, status: "done", poi_count: insertedCount });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      // Mark city as failed
      await supabase
        .from("city_import_queue")
        .update({
          status: "failed",
          error_msg: message,
          processed_at: new Date().toISOString(),
        })
        .eq("id", id);

      results.push({ id, city, status: "failed", error: message });
    }

    // Respect Overpass rate limits between cities (skip delay after last one)
    if (i < pendingCities.length - 1) {
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  // ------------------------------------------------------------------
  // 4. Return summary
  // ------------------------------------------------------------------
  const summary = {
    processed: results.length,
    done: results.filter((r) => r.status === "done").length,
    failed: results.filter((r) => r.status === "failed").length,
    details: results,
  };

  return new Response(
    JSON.stringify(summary),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
