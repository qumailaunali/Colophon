import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { MsEdgeTTS } from "msedge-tts";
import dns from "dns";

dns.setDefaultResultOrder("ipv4first");

interface CachedVoices {
  fetchedAt: number;
  voices: { name: string; lang: string }[];
}

const CACHE_TTL_MS = 60 * 60 * 1000;
let cache: CachedVoices | null = null;

export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cache.voices);
  }

  try {
    const tts = new MsEdgeTTS();
    const entries = await tts.getVoices();
    const voices = entries
      .filter((v: any) => v.Locale && v.Locale.toLowerCase() === "en-us")
      .map((v: any) => ({ name: v.ShortName, lang: v.Locale }))
      .sort((a: any, b: any) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));

    cache = { fetchedAt: Date.now(), voices };
    return NextResponse.json(voices);
  } catch (e: any) {
    console.error("[Edge TTS] Failed to fetch voice list:", e);
    return NextResponse.json(
      { error: `Edge Speech voice list request failed: ${e.message || e}` },
      { status: 502 }
    );
  }
}
