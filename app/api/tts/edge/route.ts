import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import dns from "dns";
import { Readable } from "node:stream";

dns.setDefaultResultOrder("ipv4first");
export const runtime = "nodejs";

/** Most sentences one batch request may carry. Each batch costs a single
 * WebSocket handshake to Microsoft, which is what its rate limit counts. */
const MAX_BATCH = 5;

/** Microsoft rejects the handshake with HTTP 429 when it rate-limits this
 * server's IP. Report that as a real 429 so the client backs off instead of
 * treating it like any other failure. */
function errorResponse(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  const throttled = /HTTP 429/.test(message);
  return NextResponse.json(
    { error: `Edge TTS synthesis failed: ${message}`, throttled },
    { status: throttled ? 429 : 502 }
  );
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const voiceName: string = typeof body?.voiceName === "string" && body.voiceName ? body.voiceName : "en-US-AvaNeural";
  const pitch: number = typeof body?.pitch === "number" ? body.pitch : 1;

  // Convert numeric pitch (0.0 to 2.0, default 1.0) to Edge's percentage offset (e.g. "+10%")
  const pitchDelta = Math.round((pitch - 1) * 100);
  const pitchString = `${pitchDelta >= 0 ? "+" : ""}${pitchDelta}%`;

  if (Array.isArray(body?.texts)) {
    const texts: unknown[] = body.texts;
    if (!texts.length || texts.length > MAX_BATCH || texts.some((t) => typeof t !== "string" || !t.trim())) {
      return NextResponse.json({ error: `texts must be 1-${MAX_BATCH} non-empty strings` }, { status: 400 });
    }
    return synthesizeBatch(request, texts as string[], voiceName, pitchString);
  }

  const text: string | undefined = body?.text;
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

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
    return errorResponse(e);
  }
}

/** Synthesizes several sentences one after another over a single Edge
 * connection and returns them as base64 MP3s in request order. If a later
 * sentence fails, the ones already finished are still returned (failed or
 * skipped entries are null) so the client keeps whatever audio it got. */
async function synthesizeBatch(request: Request, texts: string[], voiceName: string, pitchString: string) {
  const tts = new MsEdgeTTS();
  let current: Readable | undefined;
  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
    tts.close();
  };
  const abort = () => {
    current?.destroy(new Error("Edge speech request cancelled"));
    cleanup();
  };
  const timeout = setTimeout(() => {
    current?.destroy(new Error("Edge speech request timed out"));
    cleanup();
  }, 45000);
  request.signal.addEventListener("abort", abort, { once: true });

  const audios: (string | null)[] = texts.map(() => null);
  try {
    if (request.signal.aborted) throw new Error("Edge speech request cancelled");
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    for (let i = 0; i < texts.length; i++) {
      if (finished) throw new Error("Edge speech request cancelled or timed out");
      try {
        ({ audioStream: current } = tts.toStream(texts[i], { rate: "0%", pitch: pitchString }));
        const chunks: Buffer[] = [];
        for await (const chunk of current) chunks.push(Buffer.from(chunk));
        const audio = Buffer.concat(chunks);
        if (audio.length) audios[i] = audio.toString("base64");
      } catch (e) {
        // Nothing synthesized yet: report the failure itself (e.g. a 429).
        if (!audios.some(Boolean)) throw e;
        console.error("[Edge TTS] Batch stopped early:", e);
        break;
      }
    }
    cleanup();
    return NextResponse.json({ audios }, { headers: { "Cache-Control": "no-cache" } });
  } catch (e: unknown) {
    cleanup();
    console.error("[Edge TTS] Synthesis failed:", e);
    return errorResponse(e);
  }
}
