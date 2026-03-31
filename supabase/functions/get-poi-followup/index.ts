// supabase/functions/get-poi-followup/index.ts
// Generates a deeper follow-up narration for a POI the user wants to
// explore further. Caches audio at pois/{poi_id}/followup-{tier}.mp3 in the poi-audio bucket.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DepthTier = "quick" | "full" | "expert";

function selectProvider(categoryId: number): "claude" | "gpt4o" {
  const CLAUDE_CATEGORIES = new Set([1, 2, 3, 8]);
  return CLAUDE_CATEGORIES.has(categoryId) ? "claude" : "gpt4o";
}

async function generateFollowupWithClaude(
  poiName: string,
  city: string,
  existingNarrative: string,
  categoryLabel: string,
  tier: DepthTier,
  abortSignal: AbortSignal,
): Promise<string> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
  const wordTarget = tier === "expert" ? "150-200" : "80-110";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{
        role: "user",
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
  const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
  const wordTarget = tier === "expert" ? "150-200" : "80-110";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content: "You are an engaging local tour guide. Write concise, factual audio narrations.",
        },
        {
          role: "user",
          content: `The tourist just heard this introduction about "${poiName}" in ${city}:\n\n"${existingNarrative}"\n\nNow go deeper. Add a story, a lesser-known fact, a historical detail, or a ${categoryLabel} insight NOT already covered. ${wordTarget} words. Speak directly to the listener. Do NOT repeat anything from the introduction.`,
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const userToken =
      req.headers.get("x-user-token") ??
      req.headers.get("Authorization")?.replace("Bearer ", "") ??
      "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      clearTimeout(timeout);
      return new Response(
        JSON.stringify({ success: false, error: { code: "unauthorized", message: "Invalid token" } }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let poi_id: string | undefined;
    let depth_tier = "full";
    try {
      const body = await req.json();
      poi_id = body.poi_id;
      depth_tier = body.depth_tier ?? "full";
    } catch {
      clearTimeout(timeout);
      return new Response(
        JSON.stringify({ success: false, error: { code: "invalid_body", message: "Request body must be valid JSON" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!poi_id) {
      clearTimeout(timeout);
      return new Response(
        JSON.stringify({ success: false, error: { code: "missing_poi_id", message: "poi_id required" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const VALID_TIERS = ["quick", "full", "expert"] as const;
    const depthTier: DepthTier = (VALID_TIERS as readonly string[]).includes(depth_tier)
      ? (depth_tier as DepthTier)
      : "full";

    // Path within the poi-audio bucket, consistent with synthesize-poi: pois/{poi_id}/...
    const audioPath = `pois/${poi_id}/followup-${depthTier}.mp3`;

    // Return cached audio if it exists — list folder within bucket (no bucket name prefix)
    const { data: existingFile } = await adminClient.storage
      .from("poi-audio")
      .list(`pois/${poi_id}`, { search: `followup-${depthTier}.mp3` });

    if (existingFile && existingFile.length > 0) {
      const { data: signedUrlData } = await adminClient.storage
        .from("poi-audio")
        .createSignedUrl(audioPath, 3600);
      clearTimeout(timeout);
      return new Response(
        JSON.stringify({ success: true, data: { audio_url: signedUrlData?.signedUrl ?? null, poi_id } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch POI details
    const { data: poi } = await adminClient
      .from("pois")
      .select("id, name, city, category_id, narrative")
      .eq("id", poi_id)
      .single();

    if (!poi) {
      clearTimeout(timeout);
      return new Response(
        JSON.stringify({ success: false, error: { code: "not_found", message: "POI not found" } }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const existingNarrative = poi.narrative ?? `${poi.name} is a point of interest in ${poi.city}.`;

    const { data: category } = await adminClient
      .from("interest_categories")
      .select("label")
      .eq("id", poi.category_id)
      .single();

    const categoryLabel = category?.label ?? "general interest";
    const provider = selectProvider(poi.category_id);

    let narrative: string;
    if (provider === "claude") {
      narrative = await generateFollowupWithClaude(
        poi.name ?? poi.city,
        poi.city,
        existingNarrative,
        categoryLabel,
        depthTier,
        controller.signal,
      );
    } else {
      narrative = await generateFollowupWithGPT4o(
        poi.name ?? poi.city,
        poi.city,
        existingNarrative,
        categoryLabel,
        depthTier,
        controller.signal,
      );
    }

    const audioBuffer = await generateTTS(narrative, controller.signal);
    const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });

    const { error: uploadError } = await adminClient.storage
      .from("poi-audio")
      .upload(audioPath, audioBlob, { contentType: "audio/mpeg", upsert: true });

    if (uploadError) {
      clearTimeout(timeout);
      return new Response(
        JSON.stringify({ success: false, error: { code: "storage_error", message: "Failed to cache audio" } }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: signedUrlData } = await adminClient.storage
      .from("poi-audio")
      .createSignedUrl(audioPath, 3600);

    clearTimeout(timeout);

    return new Response(
      JSON.stringify({
        success: true,
        data: { audio_url: signedUrlData?.signedUrl ?? null, poi_id },
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
