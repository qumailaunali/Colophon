/** Bounded, best-effort reports; never include URL queries, cookies, or form values. */
export function installClientErrorReporter() {
  if (process.env.NEXT_PUBLIC_CLIENT_ERROR_REPORTING === "false") return;
  let reports = 0;
  const seen = new Set<string>();
  function report(message: string, stack = "") {
    // Scrub common credentials and URL query strings from arbitrary error text.
    const clean = (value: string, limit: number) => value
      .replace(/https?:\/\/[^\s)]+/g, (url) => url.split(/[?#]/)[0])
      .replace(/(?:postgres(?:ql)?):\/\/[^\s]+/gi, "[database URL removed]")
      .replace(/\b(?:eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, "[token removed]")
      .slice(0, limit);
    const payload = { message: clean(message, 1000), stack: clean(stack, 4000), userAgent: navigator.userAgent.slice(0, 500) };
    if (reports >= 10 || seen.has(payload.message)) return;
    seen.add(payload.message);
    reports++;
    if (process.env.NODE_ENV !== "production") {
      console.error("[client-error]", payload);
      return;
    }
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }
  window.addEventListener("error", (event) => report(event.message || "Resource load error", event.error instanceof Error ? event.error.stack : ""));
  window.addEventListener("unhandledrejection", (event) => {
    const error = event.reason;
    report(error instanceof Error ? error.message : "Unhandled promise rejection", error instanceof Error ? error.stack : "");
  });
}
