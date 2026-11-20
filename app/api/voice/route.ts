import { NextResponse } from "next/server";

export const runtime = "nodejs";

// GET /api/voice?text=...  ->  MP3 from ElevenLabs text-to-speech.
// Returns 204 when no API key is set, so the browser falls back to its own voice.
export async function GET(req: Request) {
  const text = (new URL(req.url).searchParams.get("text") || "").slice(0, 200);
  const key = process.env.ELEVENLABS_API_KEY;
  if (!text) return NextResponse.json({ error: "No text" }, { status: 400 });
  if (!key) return new NextResponse(null, { status: 204 });

  const voice = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.5 },
    }),
  });

  if (!r.ok) {
    console.error("ElevenLabs error:", r.status, await r.text());
    return new NextResponse(null, { status: 204 });
  }
  return new NextResponse(r.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
