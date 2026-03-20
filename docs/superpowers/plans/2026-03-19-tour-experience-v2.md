# Tour Experience V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the active tour screen with fading map pins, depth tiers, pause/replay/skip/more controls, adaptive narration length, and an improved group tour guest experience.

**Architecture:** Backend-first (migration → edge functions → API client), then hooks (audio/scanner/session/group), then new UI components (NarrationStrip, TourMap pins), then screen rewires (tour screen layout, explore screen depth selector, guest join page).

**Tech Stack:** React Native / Expo, Supabase (Postgres + Edge Functions + Realtime + Storage), Zustand v5, expo-av, react-native-maps, TypeScript, Jest + @testing-library/react-native

**Spec:** `docs/superpowers/specs/2026-03-19-tour-experience-v2-design.md`

---

## Task 1: DB Migration — depth_tier column

**Files:**
- Create: `supabase/migrations/20260319000001_depth_tier.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260319000001_depth_tier.sql
-- Add depth_tier to tour_sessions for narration depth preference.

ALTER TABLE tour_sessions
  ADD COLUMN IF NOT EXISTS depth_tier TEXT NOT NULL DEFAULT 'full'
    CHECK (depth_tier IN ('quick', 'full', 'expert'));

COMMENT ON COLUMN tour_sessions.depth_tier IS
  'Narration depth selected by the host: quick (~20s), full (~75s), expert (~2.5min)';
```

- [ ] **Step 2: Apply the migration locally**

```bash
npx supabase db push
```

Expected: `Applied migration 20260319000001_depth_tier` with no errors.

- [ ] **Step 3: Verify column exists**

```bash
npx supabase db diff
```

Expected: No pending changes (migration applied cleanly).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260319000001_depth_tier.sql
git commit -m "feat: add depth_tier column to tour_sessions"
```

---

## Task 2: Update synthesize-poi edge function

**Files:**
- Modify: `supabase/functions/synthesize-poi/index.ts`

The function currently ignores narration depth. Add `depth_tier` param that adjusts the prompt instruction sent to Claude/GPT.

- [ ] **Step 1: Add depth tier prompt mapping** near the top of the file, after the `selectProvider` function:

```typescript
type DepthTier = 'quick' | 'full' | 'expert';

const DEPTH_INSTRUCTIONS: Record<DepthTier, string> = {
  quick: 'Be concise — one punchy fact and a hook. Maximum 2 sentences (30-40 words).',
  full: 'Write 2-3 sentences (50-80 words). Engaging, factual, direct.',
  expert: 'Be exhaustive — include architecture, history, controversies, and key figures. 4-6 sentences (130-180 words).',
};
```

- [ ] **Step 2: Update `generateWithClaude` signature and prompt**

Change:
```typescript
async function generateWithClaude(
  poiName: string,
  city: string,
  categoryLabel: string,
  abortSignal: AbortSignal,
): Promise<string> {
```
To:
```typescript
async function generateWithClaude(
  poiName: string,
  city: string,
  categoryLabel: string,
  abortSignal: AbortSignal,
  depthTier: DepthTier = 'full',
): Promise<string> {
```

Change the `content` string inside to use depth instruction:
```typescript
content: `You are an expert tour guide narrating to a walking tourist. Write an audio narration about "${poiName}" in ${city}. Focus on: ${categoryLabel} angle. ${DEPTH_INSTRUCTIONS[depthTier]} Do NOT start with "Welcome to", "This is", "Here is", or the POI name alone. Jump straight into the interesting content. Speak directly to the listener.`,
```

- [ ] **Step 3: Update `generateWithGPT4o` signature and prompt** (same pattern as Step 2)

Change signature to add `depthTier: DepthTier = 'full'` parameter.

Change the user `content` string to:
```typescript
content: `Write an audio narration about "${poiName}" in ${city}. Focus on: ${categoryLabel} angle. ${DEPTH_INSTRUCTIONS[depthTier]} Do NOT start with "Welcome to", "This is", "Here is", or the POI name alone. Jump straight into the interesting content.`,
```

- [ ] **Step 4: Extract depth_tier from request body** in the `Deno.serve` handler, after extracting `poi_id`:

```typescript
const { poi_id, depth_tier = 'full' } = await req.json();
const depthTier: DepthTier = ['quick', 'full', 'expert'].includes(depth_tier)
  ? (depth_tier as DepthTier)
  : 'full';
```

- [ ] **Step 5: Pass depthTier to generate functions** — in the section that calls `generateWithClaude`/`generateWithGPT4o`:

```typescript
if (provider === 'claude') {
  narrative = await generateWithClaude(poi.name ?? poi.city, poi.city, categoryLabel, controller.signal, depthTier);
} else {
  narrative = await generateWithGPT4o(poi.name ?? poi.city, poi.city, categoryLabel, controller.signal, depthTier);
}
```

- [ ] **Step 6: Deploy the function**

```bash
npx supabase functions deploy synthesize-poi
```

Expected: `Deployed synthesize-poi`

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/synthesize-poi/index.ts
git commit -m "feat: synthesize-poi accepts depth_tier param"
```

---

## Task 3: Update start-tour-session edge function

**Files:**
- Modify: `supabase/functions/start-tour-session/index.ts`

Accept `depth_tier` in request body and store it on the new column.

- [ ] **Step 1: Extract depth_tier from request body**

Find this line in the handler:
```typescript
const { interest_category_ids, city, is_group_tour } = body;
```
Change to:
```typescript
const { interest_category_ids, city, is_group_tour, depth_tier = 'full' } = body;
const depthTier = ['quick', 'full', 'expert'].includes(depth_tier) ? depth_tier : 'full';
```

- [ ] **Step 2: Include depth_tier in the insert**

Find the `.insert({` block and add `depth_tier: depthTier` to the object:
```typescript
.insert({
  host_user_id: user.id,
  join_code,
  is_group_tour: is_group_tour ?? false,
  interest_category_ids,
  city: city ?? 'Unknown',
  billing_status: 'open',
  status: 'active',
  depth_tier: depthTier,
  last_heartbeat: new Date().toISOString(),
})
```

- [ ] **Step 3: Deploy**

```bash
npx supabase functions deploy start-tour-session
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/start-tour-session/index.ts
git commit -m "feat: start-tour-session stores depth_tier"
```

---

## Task 4: Create get-poi-followup edge function

**Files:**
- Create: `supabase/functions/get-poi-followup/index.ts`

New function: given a poi_id and depth_tier, generate a follow-up narration (deeper continuation), cache audio, return signed URL.

**Note on `session_id`:** The spec lists `session_id` as an accepted param. It is received but not required for the current implementation (caching is keyed by `poi_id`/tier, auth is by user token). Accept it from the request body silently for forward compatibility.

- [ ] **Step 1: Create the function file**

```typescript
// supabase/functions/get-poi-followup/index.ts
// Generates a deeper follow-up narration for a POI the user wants to
// explore further. Caches audio at poi-audio/{poi_id}/followup-{tier}.mp3.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DepthTier = 'quick' | 'full' | 'expert';

function selectProvider(categoryId: number): 'claude' | 'gpt4o' {
  const CLAUDE_CATEGORIES = new Set([1, 2, 3, 8]);
  return CLAUDE_CATEGORIES.has(categoryId) ? 'claude' : 'gpt4o';
}

async function generateFollowupWithClaude(
  poiName: string,
  city: string,
  existingNarrative: string,
  categoryLabel: string,
  tier: DepthTier,
  abortSignal: AbortSignal,
): Promise<string> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!;
  const wordTarget = tier === 'expert' ? '150-200' : '80-110';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `You are an expert tour guide. The tourist just heard this introduction about "${poiName}" in ${city}:\n\n"${existingNarrative}"\n\nNow go deeper. Add a story, a lesser-known fact, a historical detail, or a ${categoryLabel} insight NOT already covered. ${wordTarget} words. Speak directly to the listener. Do NOT repeat anything from the introduction.`,
      }],
    }),
    signal: abortSignal,
  });

  if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
  const data = await response.json();
  return data.content[0].text.trim();
}

async function generateFollowupWithGPT4o(
  poiName: string,
  city: string,
  existingNarrative: string,
  categoryLabel: string,
  tier: DepthTier,
  abortSignal: AbortSignal,
): Promise<string> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
  const wordTarget = tier === 'expert' ? '150-200' : '80-110';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 400,
      messages: [
        { role: 'system', content: 'You are an engaging local tour guide providing deeper context.' },
        { role: 'user', content: `The tourist just heard: "${existingNarrative}"\n\nGo deeper about "${poiName}" in ${city}. Add a ${categoryLabel} story or detail NOT already covered. ${wordTarget} words. Speak directly to the listener.` },
      ],
    }),
    signal: abortSignal,
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

async function generateTTS(narrative: string, abortSignal: AbortSignal): Promise<ArrayBuffer> {
  const googleKey = Deno.env.get('GOOGLE_TTS_API_KEY')!;
  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: { text: narrative },
        voice: { languageCode: 'en-US', name: 'en-US-Journey-D' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 },
      }),
      signal: abortSignal,
    },
  );
  if (!response.ok) throw new Error(`Google TTS error: ${response.status}`);
  const data = await response.json();
  const binary = atob(data.audioContent);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const userToken =
      req.headers.get('x-user-token') ??
      req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'unauthorized', message: 'Invalid token' } }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { poi_id, session_id: _session_id, depth_tier = 'full' } = await req.json();
    if (!poi_id) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'missing_poi_id', message: 'poi_id required' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const tier: DepthTier = ['quick', 'full', 'expert'].includes(depth_tier)
      ? (depth_tier as DepthTier)
      : 'full';

    // Check if follow-up already cached
    const audioPath = `pois/${poi_id}/followup-${tier}.mp3`;
    const { data: existingFile } = await adminClient.storage
      .from('poi-audio')
      .list(`pois/${poi_id}`, { search: `followup-${tier}.mp3` });

    if (existingFile && existingFile.length > 0) {
      const { data: signedUrlData } = await adminClient.storage
        .from('poi-audio')
        .createSignedUrl(audioPath, 3600);
      clearTimeout(timeout);
      return new Response(
        JSON.stringify({ success: true, data: { audio_url: signedUrlData?.signedUrl, cached: true } }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fetch POI details (narrative is the source context)
    const { data: poi } = await adminClient
      .from('pois')
      .select('id, name, city, category_id, narrative')
      .eq('id', poi_id)
      .single();

    if (!poi) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'not_found', message: 'POI not found' } }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: category } = await adminClient
      .from('interest_categories')
      .select('label')
      .eq('id', poi.category_id)
      .single();

    const categoryLabel = category?.label ?? 'general interest';
    const provider = selectProvider(poi.category_id);
    const existingNarrative = poi.narrative ?? `${poi.name} is a notable place in ${poi.city}.`;

    let followup: string;
    if (provider === 'claude') {
      followup = await generateFollowupWithClaude(
        poi.name ?? poi.city, poi.city, existingNarrative, categoryLabel, tier, controller.signal,
      );
    } else {
      followup = await generateFollowupWithGPT4o(
        poi.name ?? poi.city, poi.city, existingNarrative, categoryLabel, tier, controller.signal,
      );
    }

    const audioBuffer = await generateTTS(followup, controller.signal);
    const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });

    await adminClient.storage
      .from('poi-audio')
      .upload(audioPath, audioBlob, { contentType: 'audio/mpeg', upsert: true });

    const { data: signedUrlData } = await adminClient.storage
      .from('poi-audio')
      .createSignedUrl(audioPath, 3600);

    clearTimeout(timeout);

    return new Response(
      JSON.stringify({
        success: true,
        data: { audio_url: signedUrlData?.signedUrl ?? null, cached: false },
        meta: { request_id: crypto.randomUUID(), timestamp: new Date().toISOString() },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err.name === 'AbortError';
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: isTimeout ? 'timeout' : 'server_error', message: isTimeout ? 'Timed out' : err.message },
      }),
      { status: isTimeout ? 504 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy get-poi-followup
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/get-poi-followup/index.ts
git commit -m "feat: add get-poi-followup edge function"
```

---

## Task 5: Update services/api.ts

**Files:**
- Modify: `services/api.ts`

Add `depth_tier` to `synthesizePoi` and add the new `getPoiFollowup` method.

- [ ] **Step 1: Write the failing test**

Create `services/__tests__/api.test.ts`:

```typescript
// services/__tests__/api.test.ts
// Verify api type signatures include new fields.
import { api } from '../api';

describe('api', () => {
  it('synthesizePoi accepts optional depth_tier', () => {
    // TypeScript compile-time check — if this file compiles, the type is correct.
    type SynthesizeBody = Parameters<typeof api.synthesizePoi>[0];
    const body: SynthesizeBody = { poi_id: 'abc', depth_tier: 'quick' };
    expect(body.depth_tier).toBe('quick');
  });

  it('getPoiFollowup is defined', () => {
    expect(typeof api.getPoiFollowup).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest services/__tests__/api.test.ts
```

Expected: FAIL — `api.getPoiFollowup is not a function`

- [ ] **Step 3: Update synthesizePoi in api.ts**

Find:
```typescript
synthesizePoi: (body: { poi_id: string }) =>
  call<{ poi_id: string; narrative: string; audio_url: string | null; provider: string }>(
    'synthesize-poi',
    body,
  ),
```
Replace with:
```typescript
synthesizePoi: (body: { poi_id: string; depth_tier?: 'quick' | 'full' | 'expert' }) =>
  call<{ poi_id: string; narrative: string; audio_url: string | null; provider: string }>(
    'synthesize-poi',
    body,
  ),

getPoiFollowup: (body: { poi_id: string; depth_tier?: 'quick' | 'full' | 'expert' }) =>
  call<{ audio_url: string | null; cached: boolean }>(
    'get-poi-followup',
    body,
  ),
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest services/__tests__/api.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/api.ts services/__tests__/api.test.ts
git commit -m "feat: api.ts — synthesizePoi depth_tier, add getPoiFollowup"
```

---

## Task 6: Update useAudioPlayer hook

**Files:**
- Modify: `hooks/useAudioPlayer.ts`
- Create: `hooks/__tests__/useAudioPlayer.test.ts`

Add `pause()`, `resume()`, and `replay()` methods. `pause()` stores `positionMillis`. `resume()` handles OS audio session reclaim.

- [ ] **Step 1: Write the failing tests**

```typescript
// hooks/__tests__/useAudioPlayer.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { Audio } from 'expo-av';
import { useAudioPlayer } from '../useAudioPlayer';

jest.mock('expo-av', () => ({
  Audio: {
    Sound: {
      createAsync: jest.fn(),
    },
    setAudioModeAsync: jest.fn(),
  },
}));

const mockSound = {
  playAsync: jest.fn(),
  stopAsync: jest.fn(),
  pauseAsync: jest.fn().mockResolvedValue(undefined),
  unloadAsync: jest.fn().mockResolvedValue(undefined),
  playFromPositionAsync: jest.fn().mockResolvedValue(undefined),
  getStatusAsync: jest.fn().mockResolvedValue({ isLoaded: true, positionMillis: 5000 }),
};

beforeEach(() => {
  jest.clearAllMocks();
  (Audio.Sound.createAsync as jest.Mock).mockResolvedValue({ sound: mockSound });
});

describe('useAudioPlayer', () => {
  it('replay() calls playFromPositionAsync(0)', async () => {
    const { result } = renderHook(() => useAudioPlayer());

    await act(async () => {
      await result.current.playAudio('http://audio.mp3', 'poi-1');
    });

    await act(async () => {
      await result.current.replay();
    });

    expect(mockSound.playFromPositionAsync).toHaveBeenCalledWith(0);
  });

  it('pause() stores positionMillis and sets isPaused', async () => {
    const { result } = renderHook(() => useAudioPlayer());

    await act(async () => {
      await result.current.playAudio('http://audio.mp3', 'poi-1');
    });

    await act(async () => {
      await result.current.pause();
    });

    expect(mockSound.pauseAsync).toHaveBeenCalled();
    expect(result.current.isPaused).toBe(true);
  });

  it('resume() calls playFromPositionAsync with stored position', async () => {
    const { result } = renderHook(() => useAudioPlayer());

    await act(async () => {
      await result.current.playAudio('http://audio.mp3', 'poi-1');
    });
    await act(async () => { await result.current.pause(); });
    await act(async () => { await result.current.resume(); });

    expect(mockSound.playFromPositionAsync).toHaveBeenCalledWith(5000);
  });

  it('resume() recreates sound if OS reclaimed it', async () => {
    const { result } = renderHook(() => useAudioPlayer());

    await act(async () => {
      await result.current.playAudio('http://audio.mp3', 'poi-1');
    });
    await act(async () => { await result.current.pause(); });

    // Simulate OS reclaim by nulling the sound
    (Audio.Sound.createAsync as jest.Mock).mockResolvedValue({ sound: mockSound });

    // Force sound to null by calling stop (simulating OS reclaim)
    await act(async () => { await result.current.stopPlayback(); });

    // Resume after reclaim — should recreate from audioUrl
    await act(async () => { await result.current.resume(); });

    expect(Audio.Sound.createAsync).toHaveBeenCalledTimes(2); // initial + recreate
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest hooks/__tests__/useAudioPlayer.test.ts
```

Expected: FAIL — `replay is not a function`, `isPaused` is undefined

- [ ] **Step 3: Implement the new methods in useAudioPlayer.ts**

Add two refs near the top of the hook (after `currentPoiRef`):
```typescript
const pausedPositionMs = useRef<number>(0);
const currentAudioUrl = useRef<string | null>(null);
const [isPaused, setIsPaused] = useState(false);
```

In `playAudio`, store the URL before creating the sound:
```typescript
currentAudioUrl.current = audioUrl;
setIsPaused(false);
```

Add new methods after `stopPlayback`:
```typescript
const replay = useCallback(async () => {
  if (!soundRef.current) return;
  await soundRef.current.playFromPositionAsync(0);
  setIsPaused(false);
}, []);

const pause = useCallback(async () => {
  if (!soundRef.current) return;
  const status = await soundRef.current.getStatusAsync();
  if (status.isLoaded) {
    pausedPositionMs.current = status.positionMillis ?? 0;
  }
  await soundRef.current.pauseAsync();
  setIsPaused(true);
}, []);

const resume = useCallback(async () => {
  if (soundRef.current) {
    await soundRef.current.playFromPositionAsync(pausedPositionMs.current);
    setIsPaused(false);
    return;
  }
  // OS reclaimed the audio session — recreate from cached URL
  const url = currentAudioUrl.current;
  if (!url || !currentPoiRef.current) return;
  const poiId = currentPoiRef.current;
  await playAudio(url, poiId);
  // Seek to stored position after recreation
  if (soundRef.current) {
    await soundRef.current.playFromPositionAsync(pausedPositionMs.current);
  }
  setIsPaused(false);
}, [playAudio]);
```

Update the return value:
```typescript
return {
  ...state,
  isPaused,
  canPlay,
  playAudio,
  stopPlayback,
  replay,
  pause,
  resume,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest hooks/__tests__/useAudioPlayer.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hooks/useAudioPlayer.ts hooks/__tests__/useAudioPlayer.test.ts
git commit -m "feat: useAudioPlayer — add pause/resume/replay with position recovery"
```

---

## Task 7: Update useTourSession — expose heartbeat pause/resume

**Files:**
- Modify: `hooks/useTourSession.ts`

Expose `pauseHeartbeat()` and `resumeHeartbeat()` so the tour screen can suspend billing time while paused.

- [ ] **Step 1: Expose the methods in the return value**

In `useTourSession.ts`, the `startHeartbeat` and `clearHeartbeat` functions already exist. Add them to the return object:

Find:
```typescript
return {
  session,
  isActive,
  startTour,
  endTour,
};
```

Change to:
```typescript
return {
  session,
  isActive,
  startTour,
  endTour,
  pauseHeartbeat: clearHeartbeat,
  resumeHeartbeat: startHeartbeat,
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add hooks/useTourSession.ts
git commit -m "feat: useTourSession exposes pauseHeartbeat/resumeHeartbeat"
```

---

## Task 8: Update usePoiScanner — add suspendScanner/resumeScanner

**Files:**
- Modify: `hooks/usePoiScanner.ts`

Add `suspendScanner()` (pause scan loop without losing state) and `resumeScanner()` (restart without re-fetching tile).

- [ ] **Step 1: Add suspend/resume methods** after `stopScanner`:

```typescript
/** Pause the scan loop without clearing tile state (used by tour pause). */
const suspendScanner = useCallback(() => {
  if (scanTimer.current) {
    clearInterval(scanTimer.current);
    scanTimer.current = null;
  }
}, []);

/** Resume the scan loop without re-fetching the tile. */
const resumeScanner = useCallback(() => {
  if (scanTimer.current) return; // already running
  scanTimer.current = setInterval(() => runScanRef.current(), SCAN_INTERVAL_MS);
}, []);
```

- [ ] **Step 2: Export from hook return**

Find:
```typescript
return {
  updateLocation,
  startScanner,
  stopScanner,
  handleStationary,
  fetchTile,
};
```
Change to:
```typescript
return {
  updateLocation,
  startScanner,
  stopScanner,
  suspendScanner,
  resumeScanner,
  handleStationary,
  fetchTile,
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add hooks/usePoiScanner.ts
git commit -m "feat: usePoiScanner — suspendScanner/resumeScanner for tour pause"
```

---

## Task 9: Update useGroupTour — extend event types and add broadcast methods

**Files:**
- Modify: `hooks/useGroupTour.ts`
- Create: `hooks/__tests__/useGroupTour.test.ts`

Extend `GroupTourEvent` with PAUSED/RESUMED. Extend `POI_NARRATE` payload with optional `poi_description?`/`category_name?`. Add `broadcastPause()`, `broadcastResume()`, `broadcastReplay()`.

- [ ] **Step 1: Write the failing tests**

```typescript
// hooks/__tests__/useGroupTour.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { useGroupTour } from '../useGroupTour';
import { useSessionStore } from '../../stores/sessionStore';

jest.mock('../../services/supabase', () => ({
  supabase: {
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
      unsubscribe: jest.fn(),
      send: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));

jest.mock('../../stores/sessionStore', () => ({
  useSessionStore: jest.fn(),
}));

describe('useGroupTour', () => {
  const mockSend = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    (useSessionStore as jest.Mock).mockReturnValue({
      session: { is_group_tour: true, join_code: 'ABC123' },
    });
    const { supabase } = require('../../services/supabase');
    (supabase.channel as jest.Mock).mockReturnValue({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
      unsubscribe: jest.fn(),
      send: mockSend,
    });
  });

  it('broadcastPause sends SESSION_STATE PAUSED', async () => {
    const { result } = renderHook(() => useGroupTour({}));
    await act(async () => { await result.current.broadcastPause(); });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'SESSION_STATE', payload: { status: 'paused' } })
    );
  });

  it('broadcastResume sends SESSION_STATE RESUMED', async () => {
    const { result } = renderHook(() => useGroupTour({}));
    await act(async () => { await result.current.broadcastResume(); });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'SESSION_STATE', payload: { status: 'resumed' } })
    );
  });

  it('broadcastNarration includes optional poi_description and category_name', async () => {
    const { result } = renderHook(() => useGroupTour({}));
    await act(async () => {
      await result.current.broadcastNarration('poi-1', 'http://a.mp3', 'Tower Bridge', 'Victorian era bridge.', 'History');
    });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'POI_NARRATE',
        payload: expect.objectContaining({ poi_description: 'Victorian era bridge.', category_name: 'History' }),
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest hooks/__tests__/useGroupTour.test.ts
```

Expected: FAIL

- [ ] **Step 3: Audit the existing file before replacing**

Read `hooks/useGroupTour.ts` and confirm the replacement below preserves all existing logic (GUEST_JOINED handling, channel config, broadcastNarration). The existing file is straightforward but verify before overwriting.

Replace the entire file with:

```typescript
// hooks/useGroupTour.ts
import { useCallback, useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { useSessionStore } from '../stores/sessionStore';

export type GroupTourEvent =
  | {
      event: 'POI_NARRATE';
      payload: {
        poi_id: string;
        audio_url: string;
        poi_name: string;
        poi_description?: string;
        category_name?: string;
      };
    }
  | { event: 'SESSION_STATE'; payload: { status: 'ended' | 'paused' | 'resumed'; city?: string } }
  | { event: 'GUEST_JOINED'; payload: { guest_count: number } };

type UseGroupTourOptions = {
  onGuestJoined?: (guestCount: number) => void;
};

export function useGroupTour({ onGuestJoined }: UseGroupTourOptions = {}) {
  const { session } = useSessionStore();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const joinCode = session?.is_group_tour ? session.join_code : null;

  useEffect(() => {
    if (!joinCode) return;

    const channel = supabase.channel(`tour:${joinCode}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'GUEST_JOINED' }, ({ payload }) => {
        onGuestJoined?.(payload.guest_count);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [joinCode, onGuestJoined]);

  const broadcastNarration = useCallback(
    async (
      poiId: string,
      audioUrl: string,
      poiName: string,
      poiDescription?: string,
      categoryName?: string,
    ) => {
      if (!channelRef.current) return;
      await channelRef.current.send({
        type: 'broadcast',
        event: 'POI_NARRATE',
        payload: {
          poi_id: poiId,
          audio_url: audioUrl,
          poi_name: poiName,
          ...(poiDescription ? { poi_description: poiDescription } : {}),
          ...(categoryName ? { category_name: categoryName } : {}),
        },
      });
    },
    [],
  );

  const broadcastPause = useCallback(async () => {
    if (!channelRef.current) return;
    await channelRef.current.send({
      type: 'broadcast',
      event: 'SESSION_STATE',
      payload: { status: 'paused' },
    });
  }, []);

  const broadcastResume = useCallback(async () => {
    if (!channelRef.current) return;
    await channelRef.current.send({
      type: 'broadcast',
      event: 'SESSION_STATE',
      payload: { status: 'resumed' },
    });
  }, []);

  const broadcastReplay = useCallback(
    async (poiId: string, audioUrl: string, poiName: string) => {
      if (!channelRef.current) return;
      await channelRef.current.send({
        type: 'broadcast',
        event: 'POI_NARRATE',
        payload: { poi_id: poiId, audio_url: audioUrl, poi_name: poiName },
      });
    },
    [],
  );

  return { broadcastNarration, broadcastPause, broadcastResume, broadcastReplay };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest hooks/__tests__/useGroupTour.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hooks/useGroupTour.ts hooks/__tests__/useGroupTour.test.ts
git commit -m "feat: useGroupTour — pause/resume/replay broadcast, extended POI_NARRATE payload"
```

---

## Task 10: Update stores/userStore — add adaptiveLock

**Files:**
- Modify: `stores/userStore.ts`

Add `adaptiveLock: boolean` and `setAdaptiveLock(v: boolean)`. In-memory only (no DB).

- [ ] **Step 1: Add to UserStore type** — find the `type UserStore = {` block and add:

```typescript
adaptiveLock: boolean;
setAdaptiveLock: (locked: boolean) => void;
```

- [ ] **Step 2: Add initial state and action** — find the `create<UserStore>` call:

Add `adaptiveLock: false` to the initial state object, and add the action:
```typescript
setAdaptiveLock: (locked) => set({ adaptiveLock: locked }),
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add stores/userStore.ts
git commit -m "feat: userStore — add adaptiveLock in-memory preference"
```

---

## Task 11: Create NarrationStrip component

**Files:**
- Create: `components/tour/NarrationStrip.tsx`
- Create: `components/tour/__tests__/NarrationStrip.test.tsx`

Replaces `NarrationCard`. Fixed bottom strip (~110px) with POI name, preview text, and 4 action buttons. Handles swipe-left-to-skip and paused state.

- [ ] **Step 1: Write failing tests**

```typescript
// components/tour/__tests__/NarrationStrip.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NarrationStrip } from '../NarrationStrip';

const mockPoi = {
  id: 'poi-1',
  name: 'Tower Bridge',
  lat: 51.5,
  lon: -0.07,
  tier: 1,
  category_id: 8,
  priority: 1,
  state: 'NARRATING' as const,
};

describe('NarrationStrip', () => {
  const defaultProps = {
    poi: mockPoi,
    narrative: 'Built in 1894, this Victorian masterpiece spans the Thames.',
    isPaused: false,
    isInGap: false,
    followupRequested: false,
    onReplay: jest.fn(),
    onMore: jest.fn(),
    onPause: jest.fn(),
    onSkip: jest.fn(),
  };

  it('renders POI name', () => {
    const { getByText } = render(<NarrationStrip {...defaultProps} />);
    expect(getByText('Tower Bridge')).toBeTruthy();
  });

  it('shows paused state when isPaused', () => {
    const { getByText } = render(
      <NarrationStrip {...defaultProps} isPaused={true} />
    );
    expect(getByText(/paused/i)).toBeTruthy();
  });

  it('calls onSkip when Skip pressed', () => {
    const onSkip = jest.fn();
    const { getByText } = render(<NarrationStrip {...defaultProps} onSkip={onSkip} />);
    fireEvent.press(getByText('Skip'));
    expect(onSkip).toHaveBeenCalled();
  });

  it('calls onMore when More pressed', () => {
    const onMore = jest.fn();
    const { getByText } = render(<NarrationStrip {...defaultProps} onMore={onMore} />);
    fireEvent.press(getByText('More'));
    expect(onMore).toHaveBeenCalled();
  });

  it('disables More when followupRequested', () => {
    const onMore = jest.fn();
    const { getByText } = render(
      <NarrationStrip {...defaultProps} followupRequested={true} onMore={onMore} />
    );
    fireEvent.press(getByText('More'));
    expect(onMore).not.toHaveBeenCalled();
  });

  it('disables Replay and Skip when isInGap', () => {
    const onReplay = jest.fn();
    const onSkip = jest.fn();
    const { getByText } = render(
      <NarrationStrip {...defaultProps} isInGap={true} onReplay={onReplay} onSkip={onSkip} />
    );
    fireEvent.press(getByText('Replay'));
    fireEvent.press(getByText('Skip'));
    expect(onReplay).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest components/tour/__tests__/NarrationStrip.test.tsx
```

Expected: FAIL — `NarrationStrip` not found

- [ ] **Step 3: Create the component**

```typescript
// components/tour/NarrationStrip.tsx
// Fixed bottom strip showing current POI + narration controls.
// Replaces the slide-up NarrationCard overlay.
import { useRef } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { QueuedPoi } from '../../stores/sessionStore';

type Props = {
  poi: QueuedPoi | null;
  narrative: string | null;
  isPaused: boolean;
  isInGap: boolean;
  followupRequested: boolean;
  onReplay: () => void;
  onMore: () => void;
  onPause: () => void;
  onSkip: () => void;
};

export function NarrationStrip({
  poi,
  narrative,
  isPaused,
  isInGap,
  followupRequested,
  onReplay,
  onMore,
  onPause,
  onSkip,
}: Props) {
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 40 && Math.abs(gs.dy) < 20,
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -40 && !isInGap) onSkip();
      },
    }),
  ).current;

  const poiName = poi?.name ?? 'Nearby location';
  const preview = narrative ? narrative.split('.')[0].slice(0, 80) + '…' : '';

  return (
    <View style={styles.strip} {...panResponder.panHandlers}>
      <View style={styles.textArea}>
        <Text style={styles.poiName} numberOfLines={1}>
          {poiName}
        </Text>
        {isPaused ? (
          <Text style={styles.pausedLabel}>Paused — tap ▶ to resume</Text>
        ) : (
          <Text style={styles.preview} numberOfLines={1}>
            {preview}
          </Text>
        )}
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.btn, isInGap && styles.btnDisabled]}
          onPress={isInGap ? undefined : onReplay}
          activeOpacity={isInGap ? 1 : 0.7}
        >
          <Text style={[styles.btnText, isInGap && styles.btnTextDisabled]}>
            Replay
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, followupRequested && styles.btnDisabled]}
          onPress={followupRequested ? undefined : onMore}
          activeOpacity={followupRequested ? 1 : 0.7}
        >
          <Text style={[styles.btnText, followupRequested && styles.btnTextDisabled]}>
            More
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btn} onPress={onPause} activeOpacity={0.7}>
          <Text style={styles.btnText}>{isPaused ? '▶' : '⏸'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, isInGap && styles.btnDisabled]}
          onPress={isInGap ? undefined : onSkip}
          activeOpacity={isInGap ? 1 : 0.7}
        >
          <Text style={[styles.btnText, isInGap && styles.btnTextDisabled]}>
            Skip
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    backgroundColor: '#0d1a0d',
    borderTopWidth: 1,
    borderTopColor: '#1a2a1a',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 110,
  },
  textArea: { marginBottom: 10 },
  poiName: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 3 },
  preview: { fontSize: 13, color: '#7ac47a', lineHeight: 18 },
  pausedLabel: { fontSize: 13, color: '#888', fontStyle: 'italic' },
  buttons: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1,
    backgroundColor: '#1a2a1a',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: '#7ac47a', fontSize: 13, fontWeight: '600' },
  btnTextDisabled: { color: '#555' },
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest components/tour/__tests__/NarrationStrip.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/tour/NarrationStrip.tsx components/tour/__tests__/NarrationStrip.test.tsx
git commit -m "feat: add NarrationStrip component with pause/replay/skip/more controls"
```

---

## Task 12: Update TourMap — fading pins by POI state

**Files:**
- Modify: `components/tour/TourMap.tsx`
- Create: `components/tour/__tests__/TourMap.test.tsx`

Add `poiStates` and `queue` props. Render custom marker views with distance-based opacity and state-specific styles.

- [ ] **Step 1: Write failing tests**

```typescript
// components/tour/__tests__/TourMap.test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { TourMap } from '../TourMap';

jest.mock('react-native-maps', () => {
  const MockMapView = ({ children }: any) => <>{children}</>;
  const MockMarker = ({ testID, children }: any) => <>{children}</>;
  return { __esModule: true, default: MockMapView, Marker: MockMarker, PROVIDER_GOOGLE: 'google' };
});

const location = { lat: 51.5, lon: -0.07, accuracy: 5, heading: 0, speed: 1.0 };
const pois = [
  { id: 'poi-1', name: 'Tower Bridge', lat: 51.505, lon: -0.075, tier: 1, category_id: 8 },
  { id: 'poi-2', name: 'St. Paul', lat: 51.513, lon: -0.098, tier: 1, category_id: 1 },
];

describe('TourMap', () => {
  it('renders without crashing with poiStates and queue', () => {
    const { toJSON } = render(
      <TourMap
        location={location}
        pois={pois}
        currentPoiId={null}
        poiStates={{ 'poi-1': 'QUEUED', 'poi-2': 'UNVISITED' }}
        queue={[{ ...pois[0], state: 'QUEUED', priority: 1 }]}
      />
    );
    expect(toJSON()).toBeTruthy();
  });

  it('renders completed pin for COMPLETED state', () => {
    const { getByText } = render(
      <TourMap
        location={location}
        pois={pois}
        currentPoiId={null}
        poiStates={{ 'poi-1': 'COMPLETED', 'poi-2': 'UNVISITED' }}
        queue={[]}
      />
    );
    expect(getByText('✓')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest components/tour/__tests__/TourMap.test.tsx
```

Expected: FAIL — `poiStates` prop not accepted

- [ ] **Step 3: Rewrite TourMap.tsx**

```typescript
// components/tour/TourMap.tsx
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { PoiTileItem } from '../../services/supabase';
import type { LocationFix } from '../../hooks/useLocation';
import type { QueuedPoi } from '../../stores/sessionStore';
import { distanceMeters } from '../../utils/geo';

type PoiState = 'UNVISITED' | 'QUEUED' | 'NARRATING' | 'COMPLETED' | 'SKIPPED';

type Props = {
  location: LocationFix | null;
  pois: PoiTileItem[];
  currentPoiId: string | null;
  poiStates: Record<string, PoiState>;
  queue: QueuedPoi[];
  onPoiPress?: (poi: PoiTileItem) => void;
};

function PulsingDot() {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.4, duration: 600, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <Animated.View style={[styles.narrating, { transform: [{ scale }] }]} />
  );
}

export function TourMap({ location, pois, currentPoiId, poiStates, queue, onPoiPress }: Props) {
  const lat = location?.lat ?? 29.9511;
  const lon = location?.lon ?? -90.0715;

  // Build a map of queue position by poi_id for opacity calculation
  const queueIndexMap: Record<string, number> = {};
  queue.forEach((q, i) => { queueIndexMap[q.id] = i; });

  return (
    <MapView
      style={StyleSheet.absoluteFillObject}
      provider={PROVIDER_GOOGLE}
      mapType="standard"
      customMapStyle={darkMapStyle}
      initialRegion={{ latitude: lat, longitude: lon, latitudeDelta: 0.008, longitudeDelta: 0.008 }}
      region={location ? { latitude: lat, longitude: lon, latitudeDelta: 0.008, longitudeDelta: 0.008 } : undefined}
      showsUserLocation
      showsMyLocationButton={false}
      showsCompass={false}
      showsScale={false}
    >
      {pois.map((poi) => {
        const state = poiStates[poi.id] ?? 'UNVISITED';

        if (state === 'UNVISITED') return null;

        if (state === 'COMPLETED' || state === 'SKIPPED') {
          return (
            <Marker
              key={poi.id}
              coordinate={{ latitude: poi.lat, longitude: poi.lon }}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => onPoiPress?.(poi)}
            >
              <View style={styles.checkmark}>
                <Text style={styles.checkmarkText}>✓</Text>
              </View>
            </Marker>
          );
        }

        if (state === 'NARRATING') {
          return (
            <Marker
              key={poi.id}
              coordinate={{ latitude: poi.lat, longitude: poi.lon }}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <PulsingDot />
            </Marker>
          );
        }

        // QUEUED — fading label pins
        const queueIndex = queueIndexMap[poi.id] ?? 2;
        const opacity = queueIndex === 0 ? 1 : queueIndex === 1 ? 0.5 : 0.2;
        const isNext = queueIndex === 0;
        const dist = location
          ? Math.round(distanceMeters(lat, lon, poi.lat, poi.lon))
          : null;

        return (
          <Marker
            key={poi.id}
            coordinate={{ latitude: poi.lat, longitude: poi.lon }}
            anchor={{ x: 0.5, y: 1 }}
            onPress={() => onPoiPress?.(poi)}
          >
            <View style={{ opacity, alignItems: 'center' }}>
              <View style={[styles.labelBadge, isNext && styles.labelBadgeNext]}>
                <Text style={[styles.labelText, isNext && styles.labelTextNext]}>
                  {poi.name}{dist !== null ? ` · ${dist}m` : ''}
                </Text>
              </View>
              {isNext && <View style={styles.dot} />}
            </View>
          </Marker>
        );
      })}
    </MapView>
  );
}

const styles = StyleSheet.create({
  labelBadge: {
    backgroundColor: '#33333399',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  labelBadgeNext: { backgroundColor: '#e8a44aee', borderRadius: 4 },
  labelText: { fontSize: 10, color: '#ccc', fontWeight: '500' },
  labelTextNext: { color: '#000', fontWeight: '700' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#e8a44a', marginTop: 2 },
  narrating: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#e8a44a',
    borderWidth: 2, borderColor: '#fff',
  },
  checkmark: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#2a4a2a',
    alignItems: 'center', justifyContent: 'center',
  },
  checkmarkText: { color: '#7ac47a', fontSize: 10, fontWeight: '700' },
});

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a3e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283d6a' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
];
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest components/tour/__tests__/TourMap.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/tour/TourMap.tsx components/tour/__tests__/TourMap.test.tsx
git commit -m "feat: TourMap — fading pins by POI state with distance labels"
```

---

## Task 13: Update explore screen — depth tier selector

**Files:**
- Modify: `app/(tabs)/index.tsx`

Add a 3-button depth tier picker (Quick / Full / Expert) above the start tour CTAs. Pass `depth_tier` to `startTourSession`.

- [ ] **Step 1: Add depth tier state** — near the top of `HomeScreen`, after existing `useState` declarations:

```typescript
const [depthTier, setDepthTier] = useState<'quick' | 'full' | 'expert'>('full');
```

- [ ] **Step 2: Add the depth tier picker UI** — just above the tour start buttons in the JSX. Find the section with the "Start Solo Tour" / "Start Group Tour" buttons and insert before them:

```tsx
{/* Depth tier selector */}
<View style={styles.tierRow}>
  <Text style={styles.tierLabel}>Narration depth</Text>
  <View style={styles.tierButtons}>
    {(['quick', 'full', 'expert'] as const).map((tier) => (
      <TouchableOpacity
        key={tier}
        style={[styles.tierBtn, depthTier === tier && styles.tierBtnActive]}
        onPress={() => setDepthTier(tier)}
      >
        <Text style={[styles.tierBtnText, depthTier === tier && styles.tierBtnTextActive]}>
          {tier.charAt(0).toUpperCase() + tier.slice(1)}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
</View>
```

- [ ] **Step 3: Add tier styles** to `StyleSheet.create`:

```typescript
tierRow: { marginBottom: 16 },
tierLabel: { color: '#888', fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
tierButtons: { flexDirection: 'row', gap: 8 },
tierBtn: {
  flex: 1, paddingVertical: 10, borderRadius: 8,
  backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a2a4e',
  alignItems: 'center',
},
tierBtnActive: { backgroundColor: '#1a2a1a', borderColor: '#4a7c4a' },
tierBtnText: { color: '#666', fontSize: 13, fontWeight: '600' },
tierBtnTextActive: { color: '#7ac47a' },
```

- [ ] **Step 4: Pass depthTier to api.startTourSession**

Find the call to `api.startTourSession(...)` inside the start tour handler and add `depth_tier: depthTier` to the body:
```typescript
const res = await api.startTourSession({
  interest_category_ids: selectedCategoryIds,
  city,
  is_group_tour: isGroupTour,
  depth_tier: depthTier,
});
```

Also update the type signature of `api.startTourSession` in `services/api.ts` to accept `depth_tier`:

Find:
```typescript
startTourSession: (body: {
  interest_category_ids: number[];
  city: string;
  is_group_tour: boolean;
}) =>
```
Change to:
```typescript
startTourSession: (body: {
  interest_category_ids: number[];
  city: string;
  is_group_tour: boolean;
  depth_tier?: 'quick' | 'full' | 'expert';
}) =>
```

- [ ] **Step 5: Pass depthTier through useTourSession.startTour** — open `hooks/useTourSession.ts` and update `startTour` params type:

```typescript
async (params: {
  interest_category_ids: number[];
  city: string;
  is_group_tour: boolean;
  depth_tier?: 'quick' | 'full' | 'expert';
}): Promise<...>
```

And pass it through to `api.startTourSession(params)` — since params is already spread, no change needed if the type is updated.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add app/(tabs)/index.tsx hooks/useTourSession.ts services/api.ts
git commit -m "feat: explore screen — depth tier selector, pass to tour session"
```

---

## Task 14: Rewire tour screen — layout + all controls

**Files:**
- Modify: `app/tour/[session_id].tsx`

This is the largest task. Restructure the layout (map as flex hero, permanent narration strip at bottom), wire up all new controls (pause, resume, replay, skip, more, depth badge), and pass new props to TourMap.

- [ ] **Step 1: Add new imports** at the top of `app/tour/[session_id].tsx`:

```typescript
import { NarrationStrip } from '../../components/tour/NarrationStrip';
import { useUserStore } from '../../stores/userStore';
```

- [ ] **Step 2: Add new state and refs** near the existing `useState` declarations:

```typescript
const [isPaused, setIsPaused] = useState(false);
const [followupRequestedIds, setFollowupRequestedIds] = useState<Set<string>>(new Set());
const [currentNarrative, setCurrentNarrative] = useState<string | null>(null);
const currentAudioUrlRef = useRef<string | null>(null);
```

- [ ] **Step 3: Destructure new hooks**

Update the `useAudioPlayer` destructure to include new methods:
```typescript
const { playAudio, stopPlayback, currentPoiId, isPaused: audioIsPaused, pause, resume, replay } = useAudioPlayer(
  (completedPoiId) => { /* existing callback */ }
);
```

Update `useTourSession` destructure:
```typescript
const { endTour, pauseHeartbeat, resumeHeartbeat } = useTourSession();
```

Update `usePoiScanner` destructure:
```typescript
const { updateLocation, startScanner, stopScanner, suspendScanner, resumeScanner } = usePoiScanner({ onPoiReady: handlePoiReady });
```

Update `useGroupTour` destructure:
```typescript
const { broadcastNarration, broadcastPause, broadcastResume, broadcastReplay } = useGroupTour({
  onGuestJoined: setLiveGuestCount,
});
```

Get depth tier from store:
```typescript
const { adaptiveLock, setAdaptiveLock } = useUserStore();
```

- [ ] **Step 4: Store narrative when POI starts narrating**

In `handlePoiReady`, just before `await playAudio(...)`, add:
```typescript
setCurrentNarrative(narrative ?? null);
currentAudioUrlRef.current = ttsResult.audioUrl;
```

Also store the POI name and description for group broadcast. Update the `broadcastNarration` call to pass optional description:
```typescript
if (session?.is_group_tour) {
  const firstSentence = narrative?.split('.')[0] ?? '';
  await broadcastNarration(poi.id, ttsResult.audioUrl, poi.name ?? '', firstSentence);
}
```

- [ ] **Step 5: Add pause/resume handler**

```typescript
const handlePause = useCallback(async () => {
  if (isPaused) {
    // Resume
    await resume();
    resumeScanner();
    resumeHeartbeat();
    setIsPaused(false);
    if (session?.is_group_tour) broadcastResume();
  } else {
    // Pause
    await pause();
    suspendScanner();
    pauseHeartbeat();
    setIsPaused(true);
    if (session?.is_group_tour) broadcastPause();
  }
}, [isPaused, pause, resume, suspendScanner, resumeScanner, pauseHeartbeat, resumeHeartbeat, session?.is_group_tour, broadcastPause, broadcastResume]);
```

- [ ] **Step 6: Add replay handler**

```typescript
const handleReplay = useCallback(async () => {
  await replay();
  if (session?.is_group_tour && currentPoi && currentAudioUrlRef.current) {
    broadcastReplay(currentPoi.id, currentAudioUrlRef.current, currentPoi.name ?? '');
  }
}, [replay, session?.is_group_tour, currentPoi, broadcastReplay]);
```

- [ ] **Step 7: Add skip handler**

`skipPoi` exists in `stores/sessionStore.ts` (line 56). It removes the POI from the queue and sets its state to `SKIPPED`.

```typescript
const handleSkip = useCallback(() => {
  if (!currentPoi) return;
  useSessionStore.getState().skipPoi(currentPoi.id);
  stopPlayback();
}, [currentPoi, stopPlayback]);
```

- [ ] **Step 8: Add "More" handler**

```typescript
const handleMore = useCallback(async () => {
  if (!currentPoi || !session) return;
  setFollowupRequestedIds((prev) => new Set(prev).add(currentPoi.id));
  const depthTier = session.depth_tier ?? 'full';
  const result = await api.getPoiFollowup({ poi_id: currentPoi.id, depth_tier: depthTier });
  if (result.success && result.data?.audio_url) {
    // Insert at front of queue by playing after current finishes
    // Store in a followup ref to play on onNarrationComplete
    followupAudioRef.current = result.data.audio_url;
  }
}, [currentPoi, session]);
```

Add the ref and completion hook:
```typescript
const followupAudioRef = useRef<string | null>(null);
```

In the `onNarrationComplete` callback (inside `useAudioPlayer`), after `completeNarration(completedPoiId)`, add:
```typescript
const pending = followupAudioRef.current;
if (pending) {
  followupAudioRef.current = null;
  // Play follow-up as next item — re-use beginNarrating on same POI
  setTimeout(() => playAudio(pending, completedPoiId + '-followup'), 500);
}
```

- [ ] **Step 9: Add adaptive depth logic**

`useLocation()` returns `rollingSpeedMs` (15s rolling average) alongside `current`. The tour screen currently only destructures `current` as `location`. Update the destructure:

```typescript
const {
  current: location,
  rollingSpeedMs,
  startTracking,
  stopTracking,
} = useLocation();
```

Then add computed `effectiveDepthTier`:
```typescript
const effectiveDepthTier = !adaptiveLock && rollingSpeedMs > 1.2
  ? 'quick'
  : (session?.depth_tier ?? 'full');
const isAdaptive = !adaptiveLock && rollingSpeedMs > 1.2;
```

Pass `effectiveDepthTier` to `api.synthesizePoi` calls inside `handlePoiReady`:
```typescript
const result = await api.synthesizePoi({ poi_id: poi.id, depth_tier: effectiveDepthTier });
```

- [ ] **Step 10: Restructure the JSX layout**

Replace the existing `return (...)` with:

```tsx
return (
  <View style={styles.container}>
    {/* Map area — flex fills available space above narration strip */}
    <View style={styles.mapArea}>
      <TourMap
        location={location}
        pois={tile}
        currentPoiId={currentPoiId}
        poiStates={poiStates}
        queue={queue}
      />

      {/* Depth tier badge overlay — top left */}
      <TouchableOpacity
        style={styles.depthBadge}
        onPress={() => setAdaptiveLock(!adaptiveLock)}
      >
        <Text style={[styles.depthBadgeText, isPaused && styles.depthBadgeDimmed]}>
          {effectiveDepthTier.charAt(0).toUpperCase() + effectiveDepthTier.slice(1)}
          {isAdaptive ? ' · Auto' : ''}
        </Text>
      </TouchableOpacity>

      {/* Transcript toggle — top right */}
      <TouchableOpacity
        style={styles.transcriptToggle}
        onPress={() => setDrawerOpen(true)}
      >
        <Text style={styles.transcriptToggleText}>≡</Text>
      </TouchableOpacity>
    </View>

    {/* Header bar — rendered above map via absolute positioning */}
    <SafeAreaView style={styles.topBar} pointerEvents="box-none">
      <Text style={styles.cityText}>{session?.city ?? ''}</Text>
      <TouchableOpacity style={styles.endButton} onPress={confirmEndTour}>
        <Text style={styles.endButtonText}>End Tour</Text>
      </TouchableOpacity>
    </SafeAreaView>

    {/* Group badge */}
    {session?.is_group_tour && session.join_code && (
      <GroupBadge
        guestCount={liveGuestCount || session.guest_count}
        joinCode={session.join_code}
      />
    )}

    {/* Narration strip — fixed bottom */}
    <NarrationStrip
      poi={currentPoi}
      narrative={currentNarrative}
      isPaused={isPaused}
      isInGap={!canPlay()}
      followupRequested={currentPoi ? followupRequestedIds.has(currentPoi.id) : false}
      onReplay={handleReplay}
      onMore={handleMore}
      onPause={handlePause}
      onSkip={handleSkip}
    />

    {/* Transcript bottom sheet */}
    <BottomSheet visible={drawerOpen} onClose={() => setDrawerOpen(false)} snapHeight={450}>
      <Text style={styles.drawerTitle}>Tour transcript</Text>
      <PoiDrawer events={pendingNarrationEvents} />
    </BottomSheet>
  </View>
);
```

- [ ] **Step 11: Update styles**

Replace the existing `StyleSheet.create` with:

```typescript
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0d' },
  mapArea: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 8,
  },
  cityText: { color: '#ccc', fontSize: 14 },
  endButton: {
    backgroundColor: '#1a1a2edd', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8,
    borderWidth: 1, borderColor: '#ff6b6b',
  },
  endButtonText: { color: '#ff6b6b', fontWeight: '700', fontSize: 14 },
  depthBadge: {
    position: 'absolute', top: 52, left: 12,
    backgroundColor: '#00000088', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#333',
  },
  depthBadgeText: { color: '#e8a44a', fontSize: 12, fontWeight: '600' },
  depthBadgeDimmed: { color: '#555' },
  transcriptToggle: {
    position: 'absolute', top: 52, right: 12,
    backgroundColor: '#00000088', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#333',
  },
  transcriptToggleText: { color: '#aaa', fontSize: 16 },
  drawerTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 16 },
});
```

- [ ] **Step 12: Destructure poiStates and queue from sessionStore**

Add to the `useSessionStore()` destructure:
```typescript
const { ..., poiStates, queue } = useSessionStore();
```

- [ ] **Step 13: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Fix any type errors before continuing.

- [ ] **Step 14: Commit**

```bash
git add app/tour/[session_id].tsx
git commit -m "feat: tour screen — HUD layout, fading pins, pause/replay/skip/more wired up"
```

---

## Task 15: Redesign guest join page

**Files:**
- Modify: `app/join/index.tsx`

Add Now Playing panel, live transcript feed, and paused state. Handle new `SESSION_STATE` events (`paused`/`resumed`).

- [ ] **Step 1: Add new state** near the existing `useState` declarations:

```typescript
type TranscriptCard = {
  poi_name: string;
  category_name?: string;
  poi_description?: string;
  received_at: number;
};

const [transcript, setTranscript] = useState<TranscriptCard[]>([]);
const [nowPlaying, setNowPlaying] = useState<{
  poi_name: string;
  category_name?: string;
  poi_description?: string;
} | null>(null);
const [hostPaused, setHostPaused] = useState(false);
```

- [ ] **Step 2: Update the Realtime event handler** — find the section inside `handleUnlockAndJoin` (or wherever the channel subscription is set up) that handles `POI_NARRATE` events:

Find the `.on('broadcast', { event: 'POI_NARRATE' }, ...)` handler and update it:
```typescript
.on('broadcast', { event: 'POI_NARRATE' }, ({ payload }) => {
  const event: NarrationEvent = {
    poi_id: payload.poi_id,
    audio_url: payload.audio_url,
    poi_name: payload.poi_name,
    received_at: Date.now(),
  };
  pendingRef.current.push(event);

  // Update Now Playing
  setNowPlaying({
    poi_name: payload.poi_name,
    category_name: payload.category_name,
    poi_description: payload.poi_description,
  });

  // Append to transcript
  setTranscript((prev) => [...prev, {
    poi_name: payload.poi_name,
    category_name: payload.category_name,
    poi_description: payload.poi_description,
    received_at: Date.now(),
  }]);
  setHostPaused(false);
})
```

- [ ] **Step 3: Handle PAUSED and RESUMED in SESSION_STATE handler**

Find the `.on('broadcast', { event: 'SESSION_STATE' }, ...)` handler:

```typescript
.on('broadcast', { event: 'SESSION_STATE' }, ({ payload }) => {
  if (payload.status === 'ended') {
    setPhase('ended');
  } else if (payload.status === 'paused') {
    setHostPaused(true);
    soundRef.current?.pauseAsync().catch(() => {});
  } else if (payload.status === 'resumed') {
    setHostPaused(false);
    soundRef.current?.playAsync().catch(() => {});
  }
})
```

- [ ] **Step 4: Replace the listening phase UI**

Find the JSX block rendered when `phase === 'listening'` and replace its contents:

```tsx
{phase === 'listening' && (
  <View style={styles.listeningContainer}>
    {/* Now Playing panel */}
    {hostPaused ? (
      <View style={styles.pausedBanner}>
        <Text style={styles.pausedBannerText}>Host has paused — standing by</Text>
      </View>
    ) : nowPlaying ? (
      <View style={styles.nowPlaying}>
        <Text style={styles.nowPlayingLabel}>Now playing</Text>
        <Text style={styles.nowPlayingTitle}>{nowPlaying.poi_name}</Text>
        {nowPlaying.category_name && (
          <Text style={styles.nowPlayingCategory}>{nowPlaying.category_name}</Text>
        )}
        {nowPlaying.poi_description && (
          <Text style={styles.nowPlayingDescription}>{nowPlaying.poi_description}</Text>
        )}
      </View>
    ) : (
      <View style={styles.nowPlaying}>
        <Text style={styles.nowPlayingLabel}>Waiting for next stop…</Text>
      </View>
    )}

    {/* Live transcript feed */}
    <Text style={styles.transcriptHeader}>Tour stops</Text>
    <ScrollView style={styles.transcriptScroll}>
      {transcript.map((card, i) => (
        <View key={i} style={styles.transcriptCard}>
          <Text style={styles.transcriptCardName}>{card.poi_name}</Text>
          {card.category_name && (
            <Text style={styles.transcriptCardMeta}>{card.category_name}</Text>
          )}
          <Text style={styles.transcriptCardTime}>
            {new Date(card.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      ))}
      {transcript.length === 0 && (
        <Text style={styles.transcriptEmpty}>Stops will appear here as the tour progresses.</Text>
      )}
    </ScrollView>
  </View>
)}
```

- [ ] **Step 5: Add new styles**

Add to the existing `StyleSheet.create`:

```typescript
listeningContainer: { flex: 1 },
pausedBanner: {
  backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16,
  marginBottom: 16, alignItems: 'center',
},
pausedBannerText: { color: '#888', fontSize: 14, fontStyle: 'italic' },
nowPlaying: {
  backgroundColor: '#1a2a1a', borderRadius: 12, padding: 16,
  marginBottom: 16, borderLeftWidth: 3, borderLeftColor: '#4a7c4a',
},
nowPlayingLabel: { color: '#7ac47a', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
nowPlayingTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 4 },
nowPlayingCategory: { color: '#7ac47a', fontSize: 13, marginBottom: 6 },
nowPlayingDescription: { color: '#aaa', fontSize: 14, lineHeight: 20 },
transcriptHeader: { color: '#666', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
transcriptScroll: { flex: 1 },
transcriptCard: {
  flexDirection: 'row', alignItems: 'center',
  paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  gap: 8,
},
transcriptCardName: { flex: 1, color: '#ccc', fontSize: 14, fontWeight: '600' },
transcriptCardMeta: { color: '#555', fontSize: 12 },
transcriptCardTime: { color: '#444', fontSize: 11 },
transcriptEmpty: { color: '#555', fontSize: 14, fontStyle: 'italic', textAlign: 'center', marginTop: 20 },
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add app/join/index.tsx
git commit -m "feat: join page — Now Playing panel, transcript feed, host pause/resume state"
```

---

## Task 16: Final integration check

- [ ] **Step 1: Run all tests**

```bash
npx jest --passWithNoTests
```

Expected: All tests pass.

- [ ] **Step 2: Full TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Start the dev server and smoke test**

```bash
npx expo start
```

Check:
- Explore screen shows Quick / Full / Expert tier buttons
- Starting a tour passes depth_tier to the session
- Tour screen: map visible, narration strip at bottom, no floating NarrationCard
- Fading pins appear on map as POIs queue
- Pause / Resume works (scanner and heartbeat stop/start)
- Replay replays current audio from beginning
- Skip moves to next POI
- More button calls get-poi-followup and plays follow-up audio
- Group tour: pause/resume broadcasts to guests on /join
- /join shows Now Playing panel and transcript cards

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: tour experience v2 — complete integration"
```
