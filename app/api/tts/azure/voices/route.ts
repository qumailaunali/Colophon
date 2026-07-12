import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import dns from "dns";

dns.setDefaultResultOrder("ipv4first");

interface AzureVoiceEntry {
  ShortName: string;
  Locale: string;
}

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

  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    return NextResponse.json(
      { error: "Azure Speech is not configured on the server" },
      { status: 500 }
    );
  }

  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cache.voices);
  }

  const azureRes = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
    { headers: { "Ocp-Apim-Subscription-Key": key } }
  );

  if (!azureRes.ok) {
    return NextResponse.json(
      { error: `Azure Speech voice list request failed (${azureRes.status})` },
      { status: 502 }
    );
  }

  const entries: AzureVoiceEntry[] = await azureRes.json();
  const voices = entries
    .map((v) => ({ name: v.ShortName, lang: v.Locale }))
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));

  cache = { fetchedAt: Date.now(), voices };
  return NextResponse.json(voices);
}
