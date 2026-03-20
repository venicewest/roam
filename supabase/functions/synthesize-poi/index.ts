// supabase/functions/synthesize-poi/index.ts
// Phase 3 AI Flywheel: generates narrative for a POI that lacks one,
// caches TTS audio, and upserts the POI as Tier 2 (AI-generated).
//
// Called by get-poi-tile when a POI has no narrative (tier 3 / synthesis candidate).
// 8-second timeout enforced by AbortController.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Provider selection heuristic: use Claude for historical / real-estate,
// GPT-4o for general city / commercial.
function selectProvider(categoryId: number): "claude" | "gpt4o" {
  // category_ids: 1=history, 2=architecture, 3=art, 4=nature, 5=food,
  //               6=entertainment, 7=shopping, 8=landmarks (seeded in migration)
  const CLAUDE_CATEGORIES = new Set([1, 2, 3, 8]); // historical + architectural
  return CLAUDE_CATEGORIES.has(categoryId) ? "claude" : "gpt4o";
}

type DepthTier = 'quick' | 'full' | 'expert';

const DEPTH_INSTRUCTIONS: Record<DepthTier, string> = {
  quick: 'Be concise — one punchy fact and a hook. Maximum 2 sentences (30-40 words).',
  full: 'Write 2-3 sentences (50-80 words). Engaging, factual, direct.',
  expert: 'Be exhaustive — include architecture, history, controversies, and key figures. 4-6 sentences (130-180 words).',
};

async function generateWithClaude(
  poiName: string,
  city: string,
  categoryLabel: string,
  abortSignal: AbortSignal,
  depthTier: DepthTier = 'full',
): Promise<string> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `You are an expert tour guide narrating to a walking tourist. Write an audio narration about "${poiName}" in ${city}. Focus on: ${categoryLabel} angle. ${DEPTH_INSTRUCTIONS[depthTier]} Do NOT start with "Welcome to", "This is", "Here is", or the POI name alone. Jump straight into the interesting content. Speak directly to the listener.`,
        },
      ],
    }),
    signal: abortSignal,
  });

  if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
  const data = await response.json();
  return data.content[0].text.trim();
}

async function generateWithGPT4o(
  poiName: string,
  city: string,
  categoryLabel: string,
  abortSignal: AbortSignal,
  depthTier: DepthTier = 'full',
): Promise<string> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY")!;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: "You are an engaging local tour guide. Write concise, factual audio narrations.",
        },
        {
          role: "user",
          content: `Write an audio narration about "${poiName}" in ${city}. Focus on: ${categoryLabel} angle. ${DEPTH_INSTRUCTIONS[depthTier]} Do NOT start with "Welcome to", "This is", "Here is", or the POI name alone. Jump straight into the interesting content. Speak directly to the listener.`,
        },
      ],
    }),
    signal: abortSignal,
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

async function generateTTS(
  narrative: string,
  abortSignal: AbortSignal,
): Promise<ArrayBuffer> {
  const googleKey = Deno.env.get("GOOGLE_TTS_API_KEY")!;

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: { text: narrative },
        voice: { languageCode: "en-US", name: "en-US-Journey-D" },
        audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
      }),
      signal: abortSignal,
    },
  );

  if (!response.ok) throw new Error(`Google TTS error: ${response.status}`);
  const data = await response.json();
  const base64Audio = data.audioContent;
  const binary = atob(base64Audio);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // 25-second timeout for the whole synthesis pipeline
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // M2M bypass: allow service-role calls (from submit-poi and pg_cron)
    const authHeader = req.headers.get("Authorization") ?? "";
    const isMachineCall = authHeader === `Bearer ${serviceRoleKey}`;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    if (!isMachineCall) {
      const userToken =
        req.headers.get("x-user-token") ??
        req.headers.get("Authorization")?.replace("Bearer ", "") ??
        "";
      const userClient = createClient(supabaseUrl, anonKey, {
        global: {
          headers: { Authorization: `Bearer ${userToken}` },
        },
      });

      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) {
        return new Response(
          JSON.stringify({ success: false, error: { code: "unauthorized", message: "Invalid token" } }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const { poi_id, depth_tier = 'full' } = await req.json();
    if (!poi_id) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "missing_poi_id", message: "poi_id required" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const VALID_TIERS = ['quick', 'full', 'expert'] as const;
    const depthTier: DepthTier = (VALID_TIERS as readonly string[]).includes(depth_tier)
      ? (depth_tier as DepthTier)
      : 'full';

    // Fetch POI details
    const { data: poi } = await adminClient
      .from("pois")
      .select("id, name, city, category_id, narrative, tier, quality_status")
      .eq("id", poi_id)
      .single();

    if (!poi) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "not_found", message: "POI not found" } }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Skip if already synthesized (Tier 1 or 2 with real narrative)
    if (poi.tier <= 2 && poi.narrative && !/^.+ is a point of interest in .+\.$/.test(poi.narrative.trim())) {
      return new Response(
        JSON.stringify({ success: true, data: { skipped: true, reason: "already_synthesized" } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Skip if suppressed
    if (poi.quality_status === "suppressed" || poi.quality_status === "removed") {
      return new Response(
        JSON.stringify({ success: false, error: { code: "poi_suppressed", message: "POI is suppressed" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check synthesis attempts — avoid re-synthesizing repeatedly failed POIs
    const { data: attempt } = await adminClient
      .from("poi_synthesis_attempts")
      .select("attempt_count")
      .eq("poi_id", poi_id)
      .single();

    if (attempt && attempt.attempt_count >= 3) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "max_attempts", message: "Max synthesis attempts reached" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Track this attempt
    await adminClient
      .from("poi_synthesis_attempts")
      .upsert({
        poi_id,
        last_attempted_at: new Date().toISOString(),
        attempt_count: (attempt?.attempt_count ?? 0) + 1,
      });

    // Fetch category label
    const { data: category } = await adminClient
      .from("interest_categories")
      .select("label")
      .eq("id", poi.category_id)
      .single();

    const categoryLabel = category?.label ?? "general interest";
    const provider = selectProvider(poi.category_id);

    // Generate narrative
    let narrative: string;
    if (provider === "claude") {
      narrative = await generateWithClaude(poi.name ?? poi.city, poi.city, categoryLabel, controller.signal, depthTier);
    } else {
      narrative = await generateWithGPT4o(poi.name ?? poi.city, poi.city, categoryLabel, controller.signal, depthTier);
    }

    // Generate TTS audio (Google TTS for Tier 2 AI content)
    const audioBuffer = await generateTTS(narrative, controller.signal);
    const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });

    // Upload to Supabase Storage
    const audioPath = `pois/${poi_id}/narrative.mp3`;
    await adminClient.storage
      .from("poi-audio")
      .upload(audioPath, audioBlob, { contentType: "audio/mpeg", upsert: true });

    // Create a short-lived signed URL (1 hour — will be regenerated on demand)
    const { data: signedUrlData } = await adminClient.storage
      .from("poi-audio")
      .createSignedUrl(audioPath, 3600);

    // Cache the audio in poi_audio_cache
    await adminClient
      .from("poi_audio_cache")
      .upsert({
        poi_id,
        voice_provider: "google",
        voice_id: "en-US-Journey-D",
        storage_path: audioPath,
        duration_seconds: null,
      });

    // Update the POI with the generated narrative and promote to Tier 2 (if not user-submitted)
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

    clearTimeout(timeout);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          poi_id,
          narrative,
          audio_url: signedUrlData?.signedUrl ?? null,
          provider,
        },
        meta: { request_id: crypto.randomUUID(), timestamp: new Date().toISOString() },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err.name === "AbortError";
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: isTimeout ? "timeout" : "server_error",
          message: isTimeout ? "Synthesis timed out" : err.message,
        },
      }),
      { status: isTimeout ? 504 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
