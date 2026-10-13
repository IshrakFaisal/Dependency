import "server-only";

export class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function requireLocalOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== new URL(request.url).origin) || fetchSite === "cross-site") {
    throw new RequestError("Cross-origin analysis requests are not allowed.", 403);
  }
}

export async function readComparisonRequest(request: Request): Promise<unknown> {
  requireLocalOrigin(request);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new RequestError("Send an application/json comparison request.", 415);
  if (Number(request.headers.get("content-length")) > 4096) throw new RequestError("Comparison request is too large.", 413);
  if (!request.body) throw new RequestError("A comparison is required.", 400);
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new RequestError("Request body timed out.", 408)), 5000); });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new RequestError("Comparison request is too large.", 413);
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new RequestError("Request must contain valid JSON.", 400); }
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export function jsonResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
}
