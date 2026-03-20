# Tour Experience V2 — Design Spec

**Date:** 2026-03-19
**Scope:** Active tour screen redesign — spatial awareness, narration quality, user controls, group tour propagation
**Affected files:** `app/tour/[session_id].tsx`, `components/tour/TourMap.tsx`, `components/tour/NarrationCard.tsx`, `app/join/index.tsx`, `hooks/useAudioPlayer.ts`, `hooks/usePoiScanner.ts`, `hooks/useGroupTour.ts`, `services/api.ts`, `supabase/functions/synthesize-poi`, new: `supabase/functions/get-poi-followup`

---

## Problem Statement

The current active tour experience has three gaps:

1. **Spatial awareness**: The tour feels like it "surprises" you — no sense of what POIs are coming up ahead.
2. **Narration quality**: Narrations are one-size-fits-all in depth and length, with no way to go deeper on a POI you find interesting or adapt to how fast you're walking.
3. **Control & pacing**: Hard to skip gracefully, no way to pause without ending the tour, can't replay a narration you missed.

Additionally, the group tour guest experience on `/join` is a black screen with audio — no visual context.

---

## Section 1 — Layout Structure

The tour screen is restructured so the map is the primary surface:

- **Header** (slim, ~44px): City name + elapsed time left; "End Tour" text button right. Nothing else.
- **Map** (~65% of screen height, full-width): Always visible, never obscured. Owns two floating overlays:
  - **Top-left**: Depth tier badge (e.g. `Full stories` or `Quick · Auto`) — tappable to cycle Quick / Full / Expert or lock/unlock adaptive mode.
  - **Top-right**: Transcript toggle button (opens existing `PoiDrawer`).
- **Narration strip** (fixed bottom, ~110px): Replaces the current slide-up `NarrationCard`. Always present. Shows:
  - Current POI name (bold)
  - One-line narration preview: the first sentence of `currentPoi.narrative`, truncated to 80 characters with ellipsis
  - Four inline action buttons: **Replay · More · Pause · Skip**

The narration card stops being a floating overlay that covers the map. It becomes a permanent strip — the map is never obscured during playback.

---

## Section 2 — Fading Map Pins (Spatial Awareness)

Upcoming POIs are rendered on the map with distance-based visual weight:

| State | Appearance |
|-------|-----------|
| Next to trigger (closest) | Full opacity, amber label badge with name + distance, dot pin |
| 2nd upcoming | ~50% opacity, muted grey label, no dot |
| 3rd+ upcoming | ~20% opacity ghost label only |
| Currently narrating | Pulsing amber dot, no distance label |
| Completed | Small muted green checkmark pin, no label |
| Skipped | Same as Completed — muted checkmark pin, no label |
| User position | Existing blue dot with accuracy ring — unchanged |

Pins update in real time on the existing 5s scan loop. The transition from "upcoming" to "narrating" to "completed"/"skipped" is driven by the existing POI state machine (`UNVISITED → QUEUED → NARRATING → COMPLETED | SKIPPED`) in `sessionStore` — no logic changes required. This is a pure rendering change to `TourMap.tsx`.

---

## Section 3 — Narration Strip Controls

Four buttons on the narration strip — 44px tap targets each:

### Replay (↩)
Restarts the current POI's audio from the beginning. Calls `useAudioPlayer.replay()` which calls `playFromPositionAsync(0)` on the existing Sound object. Disabled (dimmed) if no narration has played yet or during the inter-narration gap.

### More (+)
Requests a deeper follow-up narration for the current POI:
- Calls new edge function `get-poi-followup` (see Section 4).
- Follow-up is inserted at the front of the narration queue and plays immediately after the current narration ends.
- Does **not** cost an extra credit — it is part of the same stop.
- Disabled once a follow-up for the current POI has already been requested in this session. The "already requested" flag resets each new tour session — it is session-local state only.

### Pause (⏸ / ▶)
Suspends the tour without ending it:
- Calls `useAudioPlayer.pause()`: calls `sound.pauseAsync()` and stores `positionMillis` at the moment of pause.
- Suspends the POI scanner loop (`usePoiScanner`).
- Stops the 60s heartbeat in `useTourSession` (the direct Supabase update loop) — no credit time accrues while paused.
- The narration strip shows "Paused — tap to resume" in place of the POI preview text.
- Depth tier badge on map dims to indicate inactive state.
- **Resume**: calls `useAudioPlayer.resume()`, which calls `sound.playFromPositionAsync(positionMillis)`. If the Sound object has been unloaded by the OS (e.g. interrupted by a phone call), `resume()` recreates it from the cached `audioUrl` and seeks to `positionMillis` before playing. Scanner and heartbeat restart.
- Session remains open in Supabase — no `end-tour-session` is called.

### Skip (✕)
Immediately dismisses the current POI:
- Transitions POI to `SKIPPED` in `sessionStore`.
- Advances to the next queued POI.
- A **swipe-left gesture** on the narration strip is an alias for skip. Use a separate `PanResponder` scoped to the strip with `onMoveShouldSetPanResponder` checking for horizontal delta > 40px, to avoid conflicting with the map's pan gesture.
- Disabled during the inter-narration gap.

---

## Section 4 — Depth Tiers & Adaptive Length

### Depth Tiers

Three tiers, selectable on the explore screen before starting a tour. Stored on the session and switchable mid-tour via the map badge.

| Tier | Length | Prompt instruction |
|------|--------|-------------------|
| Quick | ~20–30 sec | "Be concise — one punchy fact and a hook." |
| Full | ~60–90 sec | Standard depth. Current behaviour. |
| Expert | ~2–3 min | "Be exhaustive — architecture, history, controversies, key figures." |

The selected tier is passed to `start-tour-session` and stored on `tour_sessions.depth_tier`. The `synthesize-poi` edge function receives the tier and maps it to a prompt instruction. For Tier 1 POIs (pre-synthesized audio), the app silently falls back to Full narration — no special handling in the edge function is required since Tier 1 POIs are served from pre-cached Storage files and `synthesize-poi` is not called for them.

### `get-poi-followup` Edge Function (new)

Accepts: `poi_id`, `session_id`, `current_tier`

Generates a 60–90 second continuation narration using the same Claude/GPT pipeline as `synthesize-poi`, with the instruction: "The user just heard an introduction to this place. Go deeper — add a story, a lesser-known fact, or historical detail not covered in the intro." Uses `pois.narrative` as source context, which is present for all POI tiers.

Returns: `audio_url` (synthesized and cached in Storage under `poi-audio/{poi_id}/followup-{tier}.mp3`)

### Adaptive Length

Adaptive length uses `rollingSpeedMs` from `useLocation` (the 15-second rolling average), not raw `fix.speed`, for stability against GPS noise.

| Condition | Behaviour |
|-----------|-----------|
| `rollingSpeedMs > 1.2` (brisk walk) | Cap narration to Quick length regardless of tier |
| `rollingSpeedMs < 0.3` (stationary) | Use full selected tier length |
| Between 0.3–1.2 | Use selected tier |

When speed override is active, the depth badge shows `Quick · Auto` (or `Full · Auto`). Tapping the badge opens a small picker: cycle tier OR toggle "Lock" to disable speed adaptation. **Lock state is stored in Zustand memory only** — it resets on app restart. No DB column or migration is needed.

---

## Section 5 — Group Tour: Host Propagation & Guest Experience

### Host Control Propagation

All host actions on the narration strip broadcast to guests via the existing Supabase Realtime channel `tour:{joinCode}`:

| Host action | Realtime event | Guest effect |
|-------------|---------------|-------------|
| Pause | `SESSION_STATE: PAUSED` | Guest page shows "Host paused" banner; audio stops |
| Resume | `SESSION_STATE: RESUMED` | Banner clears; audio resumes |
| Replay | Re-broadcast same `POI_NARRATE` event | Guests re-hear the narration |
| More (follow-up) | New `POI_NARRATE` event (follow-up audio) | Guests hear the follow-up automatically |
| Skip | No broadcast | POI simply never plays for anyone |
| Depth tier | Applied server-side in `synthesize-poi` | Guests transparently receive narrations at host's depth |

### Guest Page Redesign (`/join`)

**Now Playing panel** (top of page):
- POI name (large)
- Category icon + category name
- One-sentence teaser of the narration

Populated from the `POI_NARRATE` event payload. Requires adding two **optional** fields to the broadcast payload: `poi_description?: string` (1–2 sentences) and `category_name?: string`. The guest page renders gracefully if these fields are absent — the teaser line is simply omitted if `poi_description` is undefined. No changes to channel structure or `validate-join-code` / `guest-joined` functions.

**Live transcript feed** (below now playing):
- Narrations accumulate as cards as the tour progresses.
- Each card: POI name, category (if present), timestamp received.
- Scrollable. New narrations append to the bottom.

**Paused state**:
- "Host has paused — standing by" banner replaces the Now Playing panel.
- Transcript feed remains visible and scrollable.
- Banner clears automatically on `SESSION_STATE: RESUMED`.

---

## Data & API Changes Summary

| Change | Type | Notes |
|--------|------|-------|
| `get-poi-followup` | New edge function | Claude/GPT follow-up narration, cached in Storage |
| `tour_sessions.depth_tier` | New column | `'quick' \| 'full' \| 'expert'`, default `'full'` |
| `synthesize-poi` | Modified | Accepts optional `depth_tier` param, maps to prompt instruction |
| `start-tour-session` | Modified | Accepts and stores `depth_tier` |
| `api.synthesizePoi` | Modified | Updated to accept optional `depth_tier: 'quick' \| 'full' \| 'expert'` |
| `POI_NARRATE` Realtime payload | Extended | Add optional `poi_description?`, `category_name?` fields |
| `SESSION_STATE` Realtime event | Extended | Add `PAUSED` and `RESUMED` event types |

---

## Files Changed

| File | Change |
|------|--------|
| `app/tour/[session_id].tsx` | Layout restructure; wire up all new controls |
| `components/tour/TourMap.tsx` | Fading pin rendering by POI state |
| `components/tour/NarrationCard.tsx` | Replaced by permanent narration strip component |
| `hooks/useAudioPlayer.ts` | Add `replay()`, `pause()` (stores positionMillis), `resume()` (playFromPositionAsync with OS-reclaim fallback) |
| `hooks/usePoiScanner.ts` | Suspend/resume on pause |
| `hooks/useTourSession.ts` | Expose pause/resume for 60s heartbeat |
| `hooks/useGroupTour.ts` | Broadcast pause/resume/replay events |
| `services/api.ts` | Update `synthesizePoi` to accept optional `depth_tier` |
| `app/join/index.tsx` | Now Playing panel + transcript feed + paused state |
| `app/(tabs)/index.tsx` | Depth tier selector before tour start |
| `stores/userStore.ts` | Store adaptive lock preference (in-memory only, no DB) |
| `supabase/functions/synthesize-poi/index.ts` | Accept `depth_tier` param |
| `supabase/functions/get-poi-followup/index.ts` | New function |
| `supabase/migrations/20260319000001_depth_tier.sql` | Add `depth_tier` column to `tour_sessions` |

---

## Out of Scope

- Per-guest depth preferences (guests inherit host's tier)
- Guest ability to request "More" independently
- Persisting adaptive lock preference to the database
- Offline city download
- Multilingual narration
