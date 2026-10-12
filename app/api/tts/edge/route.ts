import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import dns from "dns";
import { Readable } from "node:stream";

dns.setDefaultResultOrder("ipv4first");
export const runtime = "nodejs";

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
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  const voiceName: string = typeof body?.voiceName === "string" && body.voiceName ? body.voiceName : "en-US-AvaNeural";
  const pitch: number = typeof body?.pitch === "number" ? body.pitch : 1;

  // Convert numeric pitch (0.0 to 2.0, default 1.0) to Edge's percentage offset (e.g. "+10%")
  const pitchDelta = Math.round((pitch - 1) * 100);
  const pitchString = `${pitchDelta >= 0 ? "+" : ""}${pitchDelta}%`;

  const tts = new MsEdgeTTS();
  let audioStream: Readable | undefined;
  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
    tts.close();
  };
  const abort = () => {
    audioStream?.destroy(new Error("Edge speech request cancelled"));
    cleanup();
  };
  const timeout = setTimeout(() => {
    audioStream?.destroy(new Error("Edge speech request timed out"));
    cleanup();
  }, 30000);
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    if (request.signal.aborted) throw new Error("Edge speech request cancelled");
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    if (finished) throw new Error("Edge speech request cancelled or timed out");

    ({ audioStream } = tts.toStream(text, {
      rate: "0%", // applied on client-side playbackRate to avoid audio degradation
      pitch: pitchString,
    }));

    // Native conversion forwards errors and cancellation and applies backpressure.
    const webStream = Readable.toWeb(audioStream) as ReadableStream<Uint8Array>;
    audioStream.once("end", cleanup);
    audioStream.once("close", cleanup);
    audioStream.once("error", cleanup);

    return new Response(webStream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e: unknown) {
    cleanup();
    console.error("[Edge TTS] Synthesis failed:", e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Edge TTS synthesis failed: ${message}` },
      { status: 502 }
    );
  }
}
