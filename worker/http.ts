import { RequestError } from "./session";
export function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    },
  });
}
/** Enforce a byte bound while reading, including chunked requests. */
export async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new RequestError(415, "invalid");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "invalid");
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new RequestError(413, "too_large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    try {
      return JSON.parse(text);
    } catch {
      throw new RequestError(400, "invalid");
    }
  } finally {
    reader.releaseLock();
  }
}
/** A small form body, read with a byte bound; anything larger is refused. */
export async function readFormBody(
  request: Request,
  limit: number,
): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return "";
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
/** Browser navigation redirect; never leaks the callback URL as a referrer. */
export function redirect(location: string, cookie: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      "Set-Cookie": cookie,
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    },
  });
}
/** Validated public frontend base; links are never built from client input. */
export function frontend(env: {
  FRONTEND_URL: string;
  ALLOWED_ORIGINS: string;
}): URL | undefined {
  try {
    const url = new URL(env.FRONTEND_URL);
    if (
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      !env.ALLOWED_ORIGINS.split(",").includes(url.origin)
    )
      return;
    return url;
  } catch {
    return;
  }
}
