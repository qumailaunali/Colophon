import { NextResponse } from "next/server";

let windowStarted = Date.now();
let reports = 0;

export async function POST(request: Request) {
  if (process.env.CLIENT_ERROR_REPORTING === "false") return new NextResponse(null, { status: 204 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return new NextResponse(null, { status: 403 });
  if (Date.now() - windowStarted > 60000) { windowStarted = Date.now(); reports = 0; }
  if (++reports > 100) return new NextResponse(null, { status: 429 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return new NextResponse(null, { status: 415 });
  // Read with a byte limit even when Content-Length is absent or dishonest.
  const reader = request.body?.getReader();
  if (!reader) return new NextResponse(null, { status: 400 });
  let size = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        return new NextResponse(null, { status: 413 });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const data = JSON.parse(text);
    if (!data || typeof data.message !== "string" || typeof data.stack !== "string" || typeof data.userAgent !== "string") return new NextResponse(null, { status: 400 });
    console.error("[client-error]", JSON.stringify({ message: data.message.slice(0, 1000), stack: data.stack.slice(0, 4000), userAgent: data.userAgent.slice(0, 500) }));
    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 400 });
  }
}
