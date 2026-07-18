import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import dns from "dns";

dns.setDefaultResultOrder("ipv4first");

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const text: string | undefined = body?.text;
  if (!text || !text.trim()) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  const voiceName: string = body?.voiceName || "en-US-AvaNeural";
  const pitch: number = typeof body?.pitch === "number" ? body.pitch : 1;

  // Convert numeric pitch (0.0 to 2.0, default 1.0) to Edge's percentage offset (e.g. "+10%")
  const pitchDelta = Math.round((pitch - 1) * 100);
  const pitchString = `${pitchDelta >= 0 ? "+" : ""}${pitchDelta}%`;

  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const { audioStream } = tts.toStream(text, {
      rate: "0%", // applied on client-side playbackRate to avoid audio degradation
      pitch: pitchString,
    });

    // Convert Node stream to a Web ReadableStream for the Next Response
    const webStream = new ReadableStream({
      start(controller) {
        audioStream.on("data", (chunk) => controller.enqueue(chunk));
        audioStream.on("end", () => controller.close());
        audioStream.on("error", (err) => controller.error(err));
      },
    });

    return new Response(webStream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e: any) {
    console.error("[Edge TTS] Synthesis failed:", e);
    return NextResponse.json(
      { error: `Edge TTS synthesis failed: ${e.message || e}` },
      { status: 502 }
    );
  }
}
