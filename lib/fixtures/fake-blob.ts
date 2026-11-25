// A fake Vercel Blob store for tests: a private store, and the one request the backup job makes of it (lib/backup.ts),
// put, as @vercel/blob 2.9.0 sends it (dist/chunk-*.js, createPutHeaders and requestApi). The SDK makes its requests
// with undici's own fetch, not the global one, to the address in VERCEL_BLOB_API_URL in place of
// https://vercel.com/api/blob, so a test serves `handle` on a local port and points that variable at it. A put is
// PUT <base>/?pathname=<pathname>, the file as its body, with "authorization: Bearer <token>" and the options as
// headers: "x-vercel-blob-access", "x-content-type", "x-allow-overwrite" ("1" to allow) and "x-ttl-days". As the store
// does (vercel.com/docs/vercel-blob):
// - a token that is not the store's is 403 with the error code "forbidden", which the SDK throws as BlobAccessError;
// - a pathname already taken is refused unless overwriting is allowed;
// - ttlDays is a whole number from 1 to 730;
// - the store is private: a blob put as public is refused. The store's own words for these two refusals are not
//   documented, so the fake's are its own, under the code "bad_request", which the SDK throws as a BlobError at once.
// A blob stored is answered with its address on the store's private host. Every request is recorded in `calls`, and each
// blob in `blobs` by its pathname.

type FakeBlob = { body: Buffer; contentType: string | null; ttlDays: number | null };

const refuse = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

export function createFakeBlob(options: { token: string; storeId: string }) {
  const fake = {
    calls: [] as { method: string; pathname: string | null; headers: Record<string, string> }[],
    blobs: new Map<string, FakeBlob>(),

    async handle(request: Request): Promise<Response> {
      const pathname = new URL(request.url).searchParams.get("pathname");
      const headers = Object.fromEntries(request.headers);
      fake.calls.push({ method: request.method, pathname, headers });
      if (headers.authorization !== `Bearer ${options.token}`) return refuse(403, "forbidden", "Access denied");
      if (request.method !== "PUT" || !pathname) return refuse(400, "bad_request", "Not a put");
      if (headers["x-vercel-blob-access"] !== "private") return refuse(400, "bad_request", "This store is private.");
      if (fake.blobs.has(pathname) && headers["x-allow-overwrite"] !== "1") return refuse(400, "bad_request", "This blob already exists.");
      const ttl = headers["x-ttl-days"];
      if (ttl !== undefined && !(/^\d+$/.test(ttl) && Number(ttl) >= 1 && Number(ttl) <= 730)) return refuse(400, "bad_request", "ttlDays must be from 1 to 730.");
      const contentType = headers["x-content-type"] ?? null;
      fake.blobs.set(pathname, { body: Buffer.from(await request.arrayBuffer()), contentType, ttlDays: ttl === undefined ? null : Number(ttl) });
      const url = `https://${options.storeId}.private.blob.vercel-storage.com/${pathname}`;
      return Response.json({ url, downloadUrl: `${url}?download=1`, pathname, contentType, contentDisposition: "inline", etag: `"${fake.blobs.size}"` });
    },
  };
  return fake;
}
