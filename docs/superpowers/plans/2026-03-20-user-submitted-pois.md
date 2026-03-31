# User-Submitted POIs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow authenticated users to suggest new POIs from the explore and tour screens. Submissions are inserted as `quality_status='under_review'` / `tier=3`, synthesized asynchronously via the existing AI pipeline, and become scanner-visible once synthesis completes.

**Architecture:** New `submit-poi` edge function handles rate limiting, city resolution, DB insert, and fire-and-forget synthesis trigger. `synthesize-poi` is updated to accept service-role M2M calls and to activate `under_review` POIs post-synthesis without promoting their tier. `SubmitPoiSheet` is a reusable bottom sheet opened from both the explore and tour screens.

**Tech Stack:** React Native, Expo Router, Supabase Edge Functions (Deno), PostGIS, expo-location, TypeScript, Jest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260320000001_submitted_by_index.sql` | Create | Index on `pois(submitted_by, created_at)` for rate-limit queries |
| `supabase/functions/synthesize-poi/index.ts` | Modify | M2M auth bypass + tier gate + quality_status activation |
| `supabase/functions/submit-poi/index.ts` | Create | Rate limit, city resolution, POI insert, synthesis trigger |
| `services/api.ts` | Modify | Add `submitPoi` method |
| `components/shared/SubmitPoiSheet.tsx` | Create | Bottom sheet: name + category + location + submit |
| `app/(tabs)/index.tsx` | Modify | Add `+ Suggest` button, wire sheet |
| `app/tour/[session_id].tsx` | Modify | Add `+ Suggest` button in map overlay, wire sheet |

---

## Task 1: DB migration — submitted_by index

**Files:**
- Create: `supabase/migrations/20260320000001_submitted_by_index.sql`

- [ ] **Step 1.1: Create the migration file**

```sql
-- Migration: index to support efficient rate-limit COUNT queries on pois.submitted_by
-- Used by submit-poi edge function: COUNT WHERE submitted_by=$uid AND created_at > NOW()-24h

CREATE INDEX IF NOT EXISTS pois_submitted_by_created_at_idx
  ON public.pois (submitted_by, created_at DESC)
  WHERE submitted_by IS NOT NULL;
```

- [ ] **Step 1.2: Commit**

```bash
git add supabase/migrations/20260320000001_submitted_by_index.sql
git commit -m "feat: add submitted_by index for POI submission rate limiting"
```

---

## Task 2: Update `synthesize-poi`

**Files:**
- Modify: `supabase/functions/synthesize-poi/index.ts`

Three targeted changes. Make them one at a time.

- [ ] **Step 2.1: Add M2M auth bypass**

Near the top of the `Deno.serve` handler, before the existing user JWT validation block, add:

```ts
// M2M bypass: allow service-role calls (from submit-poi and pg_cron)
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const authHeader = req.headers.get("Authorization") ?? "";
const isMachineCall = authHeader === `Bearer ${serviceRoleKey}`;

// Only validate user JWT for non-machine calls
if (!isMachineCall) {
  const userToken =
    req.headers.get("x-user-token") ??
    authHeader.replace("Bearer ", "") ??
    "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(
      JSON.stringify({ success: false, error: { code: "unauthorized", message: "Invalid token" } }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}
```

Remove (or wrap in the `!isMachineCall` block) the existing standalone auth check that was previously at the top level.

- [ ] **Step 2.2: Gate `tier: 2` promotion on `poi.tier < 3`**

Find the existing POI update block (after `generateTTS` completes, currently sets `narrative`, `tier: 2`, etc.). Change the `tier` field to be conditional:

```ts
await adminClient
  .from("pois")
  .update({
    narrative,
    // Do not promote user-submitted tier=3 POIs to tier=2
    ...(poi.tier < 3 ? { tier: 2 } : {}),
    ai_generated_at: new Date().toISOString(),
    confidence_score: 0.7,
    source_attribution: "ai_generated",
    // Activate POIs that were held under_review pending synthesis
    ...(poi.quality_status === "under_review" ? { quality_status: "active" } : {}),
  })
  .eq("id", poi_id);
```

- [ ] **Step 2.3: Commit**

```bash
git add supabase/functions/synthesize-poi/index.ts
git commit -m "feat: synthesize-poi — M2M auth bypass, tier gate for submitted POIs, quality_status activation"
```

---

## Task 3: `submit-poi` edge function

**Files:**
- Create: `supabase/functions/submit-poi/index.ts`

- [ ] **Step 3.1: Create the edge function**

```ts
// supabase/functions/submit-poi/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth: validate user JWT from x-user-token header
    const userToken =
      req.headers.get("x-user-token") ??
      req.headers.get("Authorization")?.replace("Bearer ", "") ??
      "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "unauthorized", message: "Authentication required" } }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { name, category_id, lat, lng } = await req.json();
    if (!name?.trim() || !category_id || lat == null || lng == null) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "invalid_input", message: "name, category_id, lat, lng are required" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Rate limit: rolling 24h window, max 5 submissions per user
    const { count } = await adminClient
      .from("pois")
      .select("id", { count: "exact", head: true })
      .eq("submitted_by", user.id)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if ((count ?? 0) >= 5) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "rate_limited", message: "Submission limit reached (5 per day)" } }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // City resolution: nearest active POI within 50km
    const { data: nearby } = await adminClient.rpc("get_pois_in_radius", {
      p_lat: lat,
      p_lng: lng,
      p_radius_meters: 50000,
      p_quality_statuses: ["active"],
      p_limit: 1,
    });

    const city: string = nearby?.[0]?.city ?? "";
    const countryCode: string = nearby?.[0]?.country_code ?? "XX";

    // Insert POI as under_review — invisible to scanner until synthesis activates it
    const { data: poi, error: insertError } = await adminClient
      .from("pois")
      .insert({
        name: name.trim(),
        category_id,
        location: `SRID=4326;POINT(${lng} ${lat})`,
        city,
        country_code: countryCode,
        tier: 3,
        submitted_by: user.id,
        narrative: "",         // empty: synthesis-pending sentinel (tier=3 bypasses synthesize-poi skip guard)
        quality_status: "under_review",  // invisible to get-poi-tile until synthesis completes
      })
      .select("id")
      .single();

    if (insertError || !poi) {
      console.error("POI insert error:", insertError);
      return new Response(
        JSON.stringify({ success: false, error: { code: "insert_failed", message: "Failed to save POI" } }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Trigger synthesis: M2M call (service role), fire-and-forget
    // Fallback: synthesize_poi_cron runs every 5min and picks up stranded under_review POIs
    fetch(`${supabaseUrl}/functions/v1/synthesize-poi`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
        "apikey": serviceRoleKey,
      },
      body: JSON.stringify({ poi_id: poi.id }),
    }).catch(() => {}); // errors are silent; cron is the guaranteed fallback

    return new Response(
      JSON.stringify({
        success: true,
        data: { poi_id: poi.id },
        meta: { request_id: crypto.randomUUID(), timestamp: new Date().toISOString() },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: { code: "server_error", message: (err as Error).message } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
```

- [ ] **Step 3.2: Commit**

```bash
git add supabase/functions/submit-poi/index.ts
git commit -m "feat: add submit-poi edge function"
```

---

## Task 4: `submitPoi` API method

**Files:**
- Modify: `services/api.ts`
- Test: `services/__tests__/api.test.ts`

- [ ] **Step 4.1: Write the failing test**

Add to `services/__tests__/api.test.ts`:

```ts
describe('api.submitPoi', () => {
  it('calls submit-poi with correct body', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({ success: true, data: { poi_id: 'poi-abc' } }),
    });
    const result = await api.submitPoi('Old Clock Tower', 2, 40.7128, -74.006);
    expect(result.success).toBe(true);
    expect(result.data?.poi_id).toBe('poi-abc');
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls.at(-1)[1].body);
    expect(body).toMatchObject({ name: 'Old Clock Tower', category_id: 2, lat: 40.7128, lng: -74.006 });
  });
});
```

- [ ] **Step 4.2: Run to confirm it fails**

```bash
npx jest --testPathPatterns="services/__tests__/api" --no-coverage --forceExit
```
Expected: FAIL — `api.submitPoi is not a function`

- [ ] **Step 4.3: Add `submitPoi` to `services/api.ts`**

In the `api` object (alongside the existing methods), add:

```ts
submitPoi: (name: string, categoryId: number, lat: number, lng: number) =>
  call<{ poi_id: string }>("submit-poi", {
    name,
    category_id: categoryId,
    lat,
    lng,
  }),
```

- [ ] **Step 4.4: Run tests to confirm they pass**

```bash
npx jest --testPathPatterns="services/__tests__/api" --no-coverage --forceExit
```
Expected: PASS

- [ ] **Step 4.5: Commit**

```bash
git add services/api.ts services/__tests__/api.test.ts
git commit -m "feat: add submitPoi to api service"
```

---

## Task 5: `SubmitPoiSheet` component

**Files:**
- Create: `components/shared/SubmitPoiSheet.tsx`
- Create: `components/shared/__tests__/SubmitPoiSheet.test.tsx`

- [ ] **Step 5.1: Write the failing tests**

Create `components/shared/__tests__/SubmitPoiSheet.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SubmitPoiSheet } from '../SubmitPoiSheet';
import { api } from '../../../services/api';
import * as Location from 'expo-location';

jest.mock('../../../services/api', () => ({
  api: { submitPoi: jest.fn() },
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

jest.mock('../../BottomSheet', () => ({
  BottomSheet: ({ children, visible }: any) => visible ? <>{children}</> : null,
}));

const defaultProps = {
  visible: true,
  onClose: jest.fn(),
};

describe('SubmitPoiSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 40.7128, longitude: -74.006 },
    });
  });

  it('renders name input and submit button', async () => {
    const { getByPlaceholderText, getByText } = render(<SubmitPoiSheet {...defaultProps} />);
    expect(getByPlaceholderText('e.g. The old clock tower')).toBeTruthy();
    await waitFor(() => expect(getByText('Submit suggestion')).toBeTruthy());
  });

  it('submit button is disabled until name + category + location are set', async () => {
    const { getByText } = render(<SubmitPoiSheet {...defaultProps} />);
    await waitFor(() => expect(getByText('Submit suggestion')).toBeTruthy());
    // No name, no category — button should be disabled (accessibilityState)
    expect(getByText('Submit suggestion').props.accessibilityState?.disabled).toBe(true);
  });

  it('calls api.submitPoi with correct args on submit', async () => {
    (api.submitPoi as jest.Mock).mockResolvedValue({ success: true, data: { poi_id: 'poi-1' } });
    const { getByPlaceholderText, getByText, getAllByText } = render(<SubmitPoiSheet {...defaultProps} />);
    await waitFor(() => expect(getByText('Submit suggestion')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('e.g. The old clock tower'), 'Old Clock Tower');
    // Tap first category pill
    const pills = getAllByText(/History|Art|Food|Nature|Architecture|Culture|Music|Sport/);
    fireEvent.press(pills[0]);

    fireEvent.press(getByText('Submit suggestion'));
    await waitFor(() => expect(api.submitPoi).toHaveBeenCalledWith(
      'Old Clock Tower', expect.any(Number), 40.7128, -74.006
    ));
  });

  it('shows error toast and stays open on API failure', async () => {
    (api.submitPoi as jest.Mock).mockResolvedValue({
      success: false, error: { code: 'server_error', message: 'Oops' },
    });
    const { getByPlaceholderText, getByText, getAllByText } = render(<SubmitPoiSheet {...defaultProps} />);
    await waitFor(() => expect(getByText('Submit suggestion')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('e.g. The old clock tower'), 'Some Place');
    fireEvent.press(getAllByText(/History|Art|Food|Nature|Architecture|Culture|Music|Sport/)[0]);
    fireEvent.press(getByText('Submit suggestion'));

    await waitFor(() => expect(defaultProps.onClose).not.toHaveBeenCalled());
  });
});
```

- [ ] **Step 5.2: Run to confirm it fails**

```bash
npx jest --testPathPatterns="components/shared/__tests__/SubmitPoiSheet" --no-coverage --forceExit
```
Expected: FAIL — `Cannot find module '../SubmitPoiSheet'`

- [ ] **Step 5.3: Create `components/shared/SubmitPoiSheet.tsx`**

```tsx
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api } from '../../services/api';
import { BottomSheet } from './BottomSheet';

type Category = { id: number; name: string; emoji: string };
type LocationState =
  | { status: 'loading' }
  | { status: 'ready'; lat: number; lng: number }
  | { status: 'error'; message: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Pre-filled coords (e.g. from active tour). If provided, skips GPS request. */
  initialCoords?: { lat: number; lng: number };
};

export function SubmitPoiSheet({ visible, onClose, initialCoords }: Props) {
  const [name, setName] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [location, setLocation] = useState<LocationState>({ status: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Reset form on every open
  useEffect(() => {
    if (!visible) return;
    setName('');
    setSelectedCategory(null);
    setSubmitting(false);
    setToast(null);
  }, [visible]);

  // Fetch categories on mount
  useEffect(() => {
    // Categories are stable — fetch once
    import('../../services/supabase').then(({ supabase }) => {
      supabase
        .from('interest_categories')
        .select('id, name, emoji')
        .order('id')
        .then(({ data }) => {
          if (data) setCategories(data as Category[]);
        });
    });
  }, []);

  // Resolve location on open
  useEffect(() => {
    if (!visible) return;
    if (initialCoords) {
      setLocation({ status: 'ready', lat: initialCoords.lat, lng: initialCoords.lng });
      return;
    }
    (async () => {
      setLocation({ status: 'loading' });
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocation({ status: 'error', message: 'Location permission required' });
        return;
      }
      try {
        const pos = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
        setLocation({ status: 'ready', lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch {
        setLocation({ status: 'error', message: 'Location unavailable — move to an open area' });
      }
    })();
  }, [visible, initialCoords]);

  const canSubmit =
    name.trim().length > 0 &&
    selectedCategory !== null &&
    location.status === 'ready' &&
    !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || location.status !== 'ready') return;
    setSubmitting(true);
    const result = await api.submitPoi(
      name.trim(),
      selectedCategory!.id,
      location.lat,
      location.lng,
    );
    setSubmitting(false);
    if (result.success) {
      setToast("Thanks! Your suggestion is being added.");
      setTimeout(() => {
        setToast(null);
        onClose();
      }, 1500);
    } else {
      setToast("Couldn't submit — please try again");
      setTimeout(() => setToast(null), 3000);
    }
  }, [canSubmit, location, name, selectedCategory, onClose]);

  return (
    <BottomSheet visible={visible} onClose={onClose} snapHeight={520}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* Handle */}
        <View style={styles.handle} />

        {/* Title */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>Suggest a place</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.close}>✕</Text></TouchableOpacity>
        </View>

        <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
          {/* Name */}
          <Text style={styles.label}>PLACE NAME</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. The old clock tower"
            placeholderTextColor="#555"
            value={name}
            onChangeText={setName}
          />

          {/* Category */}
          <Text style={styles.label}>CATEGORY</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow}>
            {categories.length === 0
              ? [1, 2, 3, 4].map(i => <View key={i} style={styles.pillSkeleton} />)
              : categories.map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.pill, selectedCategory?.id === cat.id && styles.pillSelected]}
                    onPress={() => setSelectedCategory(cat)}
                  >
                    <Text style={[styles.pillText, selectedCategory?.id === cat.id && styles.pillTextSelected]}>
                      {cat.emoji} {cat.name}
                    </Text>
                  </TouchableOpacity>
                ))}
          </ScrollView>

          {/* Location */}
          <Text style={styles.label}>LOCATION</Text>
          <View style={styles.locationBox}>
            {location.status === 'loading' && (
              <View style={styles.locationRow}>
                <ActivityIndicator size="small" color="#f0a500" />
                <Text style={styles.locationText}>📍 Getting your location...</Text>
              </View>
            )}
            {location.status === 'ready' && (
              <View>
                <Text style={styles.locationText}>📍 Your current location</Text>
                <Text style={styles.locationCoords}>
                  {location.lat.toFixed(4)}° N, {Math.abs(location.lng).toFixed(4)}° W
                </Text>
              </View>
            )}
            {location.status === 'error' && (
              <Text style={styles.locationError}>⚠️ {location.message}</Text>
            )}
          </View>

          {/* Toast */}
          {toast && <Text style={styles.toast}>{toast}</Text>}

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityState={{ disabled: !canSubmit }}
          >
            {submitting
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.submitText}>Submit suggestion</Text>}
          </TouchableOpacity>

          {/* Disclaimer */}
          <Text style={styles.disclaimer}>
            AI will generate a narration for your suggestion.{'\n'}
            It may appear on tours within minutes.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  handle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },
  close: { color: '#888', fontSize: 14 },
  body: { paddingHorizontal: 20 },
  label: { color: '#aaa', fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginTop: 18, marginBottom: 6 },
  input: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14 },
  pillRow: { flexDirection: 'row' },
  pill: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginRight: 8 },
  pillSelected: { backgroundColor: '#f0a500', borderColor: '#f0a500' },
  pillText: { color: '#aaa', fontSize: 12 },
  pillTextSelected: { color: '#000', fontWeight: '600' },
  pillSkeleton: { width: 80, height: 30, backgroundColor: '#222', borderRadius: 20, marginRight: 8 },
  locationBox: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', borderRadius: 10, padding: 12 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locationText: { color: '#fff', fontSize: 13 },
  locationCoords: { color: '#666', fontSize: 11, marginTop: 3 },
  locationError: { color: '#ff6b6b', fontSize: 13 },
  toast: { color: '#ff6b6b', fontSize: 13, textAlign: 'center', marginTop: 12 },
  submitButton: { backgroundColor: '#f0a500', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 20 },
  submitButtonDisabled: { opacity: 0.4 },
  submitText: { color: '#000', fontWeight: '700', fontSize: 15 },
  disclaimer: { color: '#555', fontSize: 11, textAlign: 'center', marginTop: 12, marginBottom: 24, lineHeight: 17 },
});
```

- [ ] **Step 5.4: Run tests to confirm they pass**

```bash
npx jest --testPathPatterns="components/shared/__tests__/SubmitPoiSheet" --no-coverage --forceExit
```
Expected: PASS (4 tests)

- [ ] **Step 5.5: Commit**

```bash
git add components/shared/SubmitPoiSheet.tsx components/shared/__tests__/SubmitPoiSheet.test.tsx
git commit -m "feat: add SubmitPoiSheet component"
```

---

## Task 6: Wire into explore and tour screens

**Files:**
- Modify: `app/(tabs)/index.tsx`
- Modify: `app/tour/[session_id].tsx`

- [ ] **Step 6.1: Add `+ Suggest` button to explore screen**

In `app/(tabs)/index.tsx`:

1. Import `SubmitPoiSheet` at the top:
   ```tsx
   import { SubmitPoiSheet } from '../../components/shared/SubmitPoiSheet';
   ```

2. Add state near the top of the component:
   ```tsx
   const [showSuggest, setShowSuggest] = useState(false);
   ```

3. Find the "Start Tour" button row and add `+ Suggest` beside it:
   ```tsx
   <TouchableOpacity
     onPress={() => setShowSuggest(true)}
     style={styles.suggestButton}
   >
     <Text style={styles.suggestText}>+ Suggest</Text>
   </TouchableOpacity>
   ```

4. Add the sheet at the bottom of the JSX (before the closing `</View>`):
   ```tsx
   <SubmitPoiSheet visible={showSuggest} onClose={() => setShowSuggest(false)} />
   ```

5. Add styles:
   ```ts
   suggestButton: { borderWidth: 1, borderColor: '#f0a500', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
   suggestText: { color: '#f0a500', fontSize: 13, fontWeight: '600' },
   ```

- [ ] **Step 6.2: Add `+ Suggest` button to tour screen**

In `app/tour/[session_id].tsx`:

1. Import `SubmitPoiSheet`:
   ```tsx
   import { SubmitPoiSheet } from '../../components/shared/SubmitPoiSheet';
   ```

2. Add state:
   ```tsx
   const [showSuggest, setShowSuggest] = useState(false);
   ```

3. In the top-right map overlay (alongside the existing transcript toggle button), add:
   ```tsx
   <TouchableOpacity
     onPress={() => setShowSuggest(true)}
     style={styles.overlayButton}
   >
     <Text style={styles.overlayButtonText}>+ Suggest</Text>
   </TouchableOpacity>
   ```

4. Add sheet below the map (before closing `</View>`):
   ```tsx
   <SubmitPoiSheet
     visible={showSuggest}
     onClose={() => setShowSuggest(false)}
     initialCoords={location ? { lat: location.coords.latitude, lng: location.coords.longitude } : undefined}
   />
   ```
   Note: `useLocation` is destructured as `{ current: location, ... }` at line 44 of this file — `location` is the correct variable name (`LocationObject | null`).

- [ ] **Step 6.3: Run full test suite**

```bash
npx jest --testPathPatterns="components/tour|hooks/__tests__|services/__tests__|components/shared" --no-coverage --forceExit
```
Expected: all pass

- [ ] **Step 6.4: Commit**

```bash
git add "app/(tabs)/index.tsx" "app/tour/[session_id].tsx"
git commit -m "feat: wire SubmitPoiSheet into explore and tour screens"
```
