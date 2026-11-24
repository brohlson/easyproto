export const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};
export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers });
}
export function error(message: string, status: number) {
  return json({ error: message }, status);
}

export async function boundedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw new Error("BODY_LIMIT");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("EMPTY_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("BODY_LIMIT");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.length;
  }
  return bytes;
}
