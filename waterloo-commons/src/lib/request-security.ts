import "server-only";

export class SafeRequestError extends Error {
  readonly status: 400 | 403 | 413;

  constructor(message: string, status: 400 | 403 | 413) {
    super(message);
    this.name = "SafeRequestError";
    this.status = status;
  }
}

function headerOrigin(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function requireSameOrigin(request: Request): void {
  const expectedOrigin = new URL(request.url).origin;
  const suppliedOrigin = headerOrigin(request.headers.get("origin"))
    ?? headerOrigin(request.headers.get("referer"));

  if (!suppliedOrigin || suppliedOrigin !== expectedOrigin) {
    throw new SafeRequestError("Request could not be verified.", 403);
  }
}

export async function readJsonWithLimit<T>(request: Request, maxBytes: number): Promise<T> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new SafeRequestError("Request is too large.", 413);
  }

  if (!request.body) throw new SafeRequestError("Request body is required.", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new SafeRequestError("Request is too large.", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new SafeRequestError("Request body must be valid JSON.", 400);
  }
}

export async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Operation timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
