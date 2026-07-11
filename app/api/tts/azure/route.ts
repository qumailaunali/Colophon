import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { buildSsml, DEFAULT_AZURE_VOICE } from "@/lib/tts/azureSsml";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    return NextResponse.json(
      { error: "Azure Speech is not configured on the server" },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  const text: string | undefined = body?.text;
  if (!text || !text.trim()) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  const voiceName: string = body?.voiceName || DEFAULT_AZURE_VOICE;
  const pitch: number = typeof body?.pitch === "number" ? body.pitch : 1;

  const ssml = buildSsml(text, voiceName, pitch);

  const azureRes = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-64kbitrate-mono-mp3",
        "User-Agent": "colophon-app",
      },
      body: ssml,
    }
  );

  if (!azureRes.ok) {
    const detail = await azureRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Azure Speech request failed (${azureRes.status})`, detail },
      { status: 502 }
    );
  }

  const audio = await azureRes.arrayBuffer();
  if (audio.byteLength === 0) {
    return NextResponse.json({ error: "Azure returned an empty audio response" }, { status: 502 });
  }

  return new NextResponse(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audio.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
