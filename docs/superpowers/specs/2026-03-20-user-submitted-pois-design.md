# User-Submitted POIs — Design Spec

**Date:** 2026-03-20
**Scope:** Allow users to suggest new POIs from the explore and tour screens. Submitted POIs are inserted with `quality_status = 'under_review'` (invisible to scanner) and become discoverable only after `synthesize-poi` successfully generates a narration.
**Affected files:** `supabase/functions/submit-poi/index.ts` (new), `supabase/functions/synthesize-poi/index.ts`, `components/shared/SubmitPoiSheet.tsx` (new), `app/(tabs)/index.tsx`, `app/tour/[session_id].tsx`, `services/api.ts`, `supabase/migrations/20260320000001_submitted_by_index.sql` (new)

---

## Problem Statement

Users on a walk may discover interesting places not in the Roam database. There is no submission UI or edge function, though the schema already supports it (`pois.submitted_by`, `pois.tier`, `pois.quality_status`).

---

## Section 1 — Entry Points

Two entry points open the same `SubmitPoiSheet`:

1. **Explore screen**: A `+ Suggest` labeled button placed beside the "Start Tour" button at the bottom of the screen.
2. **Tour screen**: A `+ Suggest` labeled button in the top-right map overlay, alongside the existing transcript toggle.

Both use identical style: amber border, amber text, dark background — matching the existing depth tier badge style.

---

## Section 2 — Submission Sheet (`SubmitPoiSheet`)

A bottom sheet (extends existing `BottomSheet` with `snapHeight={520}`) with three fields. The sheet wraps the body in `KeyboardAvoidingView` (behavior `'padding'` on iOS, `'height'` on Android) so the name `TextInput` is not covered by the software keyboard. Form state resets to empty on every open — each submission is a fresh gesture.

### Place name
Required `TextInput`. Placeholder: "e.g. The old clock tower". Validates non-empty on submit.

### Category
Horizontal `ScrollView` of pill buttons seeded by fetching all rows from `interest_categories` on mount (no hardcoded count). While the query is in-flight, renders 4 skeleton pill placeholders (muted grey, fixed width). One selection required.

### Location
Read-only field. On sheet open:
1. Try `useLocation().coords` (available if a tour is active).
2. Call `Location.requestForegroundPermissionsAsync()` — if not granted, show "⚠️ Location permission required." with the submit button disabled.
3. If granted, call `Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })` with a 5s timeout.
4. While resolving: show "📍 Getting your location..." with a spinner.
5. On success: show "📍 Your current location" with `lat/lng` subtitle.
6. On failure (timeout or OS error): show "⚠️ Location unavailable — move to an open area." Submit button remains disabled.

### Submit button
Disabled until name, category, and location are all resolved. Shows `ActivityIndicator` (disabled) during the API call. `callEdgeFunction` in `api.ts` automatically attaches the user's JWT as `x-user-token` — the call site does not pass it explicitly.

- **On success**: success toast "Thanks! Your suggestion is being added.", sheet closes.
- **On error** (including 429 rate limit): failure toast "Couldn't submit — please try again." Sheet stays open, button re-enables.

### Disclaimer
"AI will generate a narration for your suggestion. It may appear on tours within minutes."

---

## Section 3 — `submit-poi` Edge Function

**Input:** `{ name: string, category_id: number, lat: number, lng: number }` + user JWT in `x-user-token` header (attached automatically by `callEdgeFunction`).

**Auth:** Reads user JWT from `x-user-token` header. Uses `SUPABASE_SERVICE_ROLE_KEY` for all DB operations (bypasses RLS, consistent with all other edge functions). Returns 401 if JWT is invalid or absent. Guest (unauthenticated) submissions are rejected — the `submitted_by` nullable column is reserved for admin-created POIs, not guest submissions.

**Rate limiting:** Rolling 24-hour window (from current timestamp, not calendar-day). Before inserting, COUNT recent submissions:
```sql
SELECT COUNT(*) FROM pois
WHERE submitted_by = $user_id
  AND created_at > NOW() - INTERVAL '24 hours'
```
All submissions count against the limit regardless of `quality_status`. If count ≥ 5, return 429 with `{ error: { code: 'rate_limited', message: 'Submission limit reached (5 per day)' } }`. The index added by the migration (see Section 7) ensures this query is fast.

**City + country_code resolution:** Queries the nearest existing active POI within 50km:
```sql
SELECT city, country_code
FROM pois
WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography, 50000)
  AND quality_status = 'active'
ORDER BY location <-> ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography
LIMIT 1
```
If no POI found within 50km: `city = ''`, `country_code = 'XX'`. These are intentional placeholder values — the POI is created and synthesized but will not surface in city-based coverage queries until manually curated. This is an acceptable edge case for early app coverage.

**Deduplication:** Out of scope. Duplicate submissions (same name/location by same or different users) create separate POI records. Post-launch moderation handles merging.

**POI insertion:**
```sql
INSERT INTO pois
  (name, category_id, location, city, country_code, tier, submitted_by, narrative, quality_status)
VALUES
  ($name, $category_id,
   ST_SetSRID(ST_MakePoint($lng, $lat), 4326),
   $city, $country_code,
   3, $user_id,
   '',             -- empty string: falsy sentinel for "pending synthesis"; synthesize-poi will not skip tier=3 POIs
   'under_review') -- invisible to get-poi-tile until synthesize-poi activates it
```

`narrative = ''` is the synthesis-pending sentinel. The existing `synthesize-poi` skip guard (`poi.tier <= 2 && poi.narrative && ...`) only fires for tier 1/2 POIs — submitted POIs at `tier=3` always proceed to synthesis regardless of narrative content.

**Synthesis trigger:** `submit-poi` calls `synthesize-poi` as a machine-to-machine call (fire-and-forget, service role key as auth), matching the pattern used by the existing pg_cron job:
```ts
fetch(`${supabaseUrl}/functions/v1/synthesize-poi`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${serviceRoleKey}`,  // M2M — bypasses user JWT gate (see Section 4a)
    'apikey': serviceRoleKey,
  },
  body: JSON.stringify({ poi_id: newPoi.id }),
});
// intentionally not awaited
```

**Fallback:** If the fire-and-forget call fails (network error, cold start, etc.), the existing `synthesize-poi` pg_cron job (every 5 minutes, `20260318000005_synthesize_poi_cron.sql`) will pick up the stranded `under_review` POI and synthesize it on its next run. No additional retry mechanism is needed.

Note: concurrent synthesis calls for the same POI may race on the `poi_synthesis_attempts` upsert. This is an acceptable known condition at current submission volumes — the last writer wins on the narrative.

**Response:** `{ success: true, data: { poi_id } }`

---

## Section 4 — `synthesize-poi` Updates

Three changes to `synthesize-poi`:

### 4a — Accept service role key for machine-to-machine calls

The existing auth gate validates only user JWTs. The pg_cron job and `submit-poi` both call `synthesize-poi` using the service role JWT. Add a bypass before the user-auth check:

```ts
const authHeader = req.headers.get("Authorization") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const isMachineCall = authHeader === `Bearer ${serviceRoleKey}`;

if (!isMachineCall) {
  // Existing user JWT validation path (unchanged)
  const userToken = req.headers.get("x-user-token") ?? authHeader.replace("Bearer ", "") ?? "";
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return 401;
}
```

Machine calls (from `submit-poi` and the pg_cron) bypass user auth. User calls (from `get-poi-tile` and direct invocation) still require a valid JWT.

### 4b — Gate `tier: 2` promotion on current tier

User-submitted POIs start at `tier=3` and must remain at `tier=3` after synthesis (tier=3 indicates user-contributed content, distinct from curated tier=2). Update the promotion logic:

```ts
await adminClient
  .from("pois")
  .update({
    narrative,
    // Only promote tier if below tier 3 (do not promote user submissions)
    ...(poi.tier < 3 ? { tier: 2 } : {}),
    ai_generated_at: new Date().toISOString(),
    confidence_score: 0.7,
    // Activate submitted POIs now that they have a real narration
    ...(poi.quality_status === 'under_review' ? { quality_status: 'active' } : {}),
  })
  .eq("id", poi_id);
```

### 4c — Placement

Both changes go in the existing success update block, after `generateTTS` completes. The skip guard (`poi.tier <= 2 && poi.narrative`) does not apply to submitted POIs (`tier=3`), so no change to the guard is needed.

---

## Section 5 — API Layer

`services/api.ts` — add:
```ts
submitPoi: (name: string, categoryId: number, lat: number, lng: number) =>
  callEdgeFunction<{ poi_id: string }>('submit-poi', { name, category_id: categoryId, lat, lng })
  // callEdgeFunction automatically attaches x-user-token; do not pass token in body
```

---

## Section 6 — Moderation

Submitted POIs go live after synthesis completes (typically ~30s). Post-hoc moderation uses the existing `poi_flags` table — users flag via the transcript screen. Flagging triggers `quality_status = 'under_review'` or `'suppressed'` via the existing `handle_poi_flag` Postgres function. No admin UI is added in this spec.

---

## Section 7 — Migration

`supabase/migrations/20260320000001_submitted_by_index.sql` — adds index to support efficient rate-limit COUNT queries:

```sql
CREATE INDEX IF NOT EXISTS pois_submitted_by_created_at_idx
  ON public.pois (submitted_by, created_at DESC)
  WHERE submitted_by IS NOT NULL;
```

---

## Section 8 — Files Changed

| File | Change |
|---|---|
| `supabase/functions/submit-poi/index.ts` | New edge function |
| `supabase/functions/synthesize-poi/index.ts` | Extend update block to activate `under_review` POIs post-synthesis |
| `components/shared/SubmitPoiSheet.tsx` | New bottom sheet component |
| `app/(tabs)/index.tsx` | Add `+ Suggest` button, wire `SubmitPoiSheet` |
| `app/tour/[session_id].tsx` | Add `+ Suggest` button in map overlay, wire `SubmitPoiSheet` |
| `services/api.ts` | Add `submitPoi` method |
| `supabase/migrations/20260320000001_submitted_by_index.sql` | New index on `(submitted_by, created_at)` |

---

## Out of Scope

- Editing or deleting own submissions
- Viewing a list of own submitted POIs
- Admin review UI
- Duplicate detection/merging
- Multilingual submission
