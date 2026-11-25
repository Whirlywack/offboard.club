// A fake Vercel Blob store for tests: a private store, and the three requests the backup job makes of it (lib/backup.ts),
// put, list and del, as @vercel/blob 2.9.0 sends them (dist/index.js and chunk-*.js, createPutHeaders, list, del and
// requestApi). The SDK makes its requests with undici's own fetch, not the global one, to the address in
// VERCEL_BLOB_API_URL in place of https://vercel.com/api/blob, so a test serves `handle` on a local port and points that
// variable at it. Each carries "authorization: Bearer <token>". As the store does (vercel.com/docs/vercel-blob):
// - put is PUT <base>/?pathname=<pathname>, the file as its body, the options as headers: "x-vercel-blob-access",
//   "x-content-type", "x-allow-overwrite" ("1" to allow) and "x-ttl-days". A pathname already taken is refused unless
//   overwriting is allowed; ttlDays is a whole number from 1 to 730; the store is private, so a blob put as public is
//   refused. A blob stored is answered with its address on the store's private host.
// - list is GET <base>/?prefix=&limit=&cursor=: the blobs whose pathname starts with the prefix, in the order of their
//   pathnames, at most `limit` (1000 if not given) a page, with a cursor and hasMore while there are more.
// - del is POST <base>/delete, a JSON body {"urls": [...]}, each a blob's url or pathname; one that is not there is no
//   error.
// - A token that is not the store's is 403 with the error code "forbidden", which the SDK throws as BlobAccessError. The
//   store's own words for the other refusals are not documented, so the fake's are its own, under the code "bad_request",
//   which the SDK throws as a BlobError at once.
// Every request is recorded in `calls`, and each blob in `blobs` by its pathname.

type FakeBlob = { body: Buffer; contentType: string | null; ttlDays: number | null; uploadedAt: Date };

const refuse = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

export function createFakeBlob(options: { token: string; storeId: string }) {
  const host = `https://${options.storeId}.private.blob.vercel-storage.com/`;
  const fake = {
    calls: [] as { method: string; pathname: string | null; headers: Record<string, string> }[],
    blobs: new Map<string, FakeBlob>(),

    // A blob as the store has it, for a test to put there.
    add(pathname: string, body = Buffer.from("")) {
      fake.blobs.set(pathname, { body, contentType: null, ttlDays: null, uploadedAt: new Date() });
    },

    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const pathname = url.searchParams.get("pathname");
      const headers = Object.fromEntries(request.headers);
      fake.calls.push({ method: request.method, pathname, headers });
      if (headers.authorization !== `Bearer ${options.token}`) return refuse(403, "forbidden", "Access denied");
      if (request.method === "GET") {
        const prefix = url.searchParams.get("prefix") ?? "";
        const limit = Number(url.searchParams.get("limit") ?? 1000);
        const from = Number(url.searchParams.get("cursor") ?? 0);
        const all = [...fake.blobs.keys()].filter((name) => name.startsWith(prefix)).sort();
        const page = all.slice(from, from + limit).map((name) => {
          const { body, uploadedAt } = fake.blobs.get(name)!;
          return { url: `${host}${name}`, downloadUrl: `${host}${name}?download=1`, pathname: name, size: body.length, uploadedAt, etag: `"${name}"` };
        });
        const hasMore = from + limit < all.length;
        return Response.json({ blobs: page, hasMore, ...(hasMore && { cursor: String(from + limit) }) });
      }
      if (request.method === "POST" && url.pathname.endsWith("/delete")) {
        const { urls } = (await request.json()) as { urls: string[] };
        for (const each of urls) fake.blobs.delete(each.startsWith(host) ? each.slice(host.length) : each);
        return Response.json({});
      }
      if (request.method !== "PUT" || !pathname) return refuse(400, "bad_request", "Not a request this store takes.");
      if (headers["x-vercel-blob-access"] !== "private") return refuse(400, "bad_request", "This store is private.");
      if (fake.blobs.has(pathname) && headers["x-allow-overwrite"] !== "1") return refuse(400, "bad_request", "This blob already exists.");
      const ttl = headers["x-ttl-days"];
      if (ttl !== undefined && !(/^\d+$/.test(ttl) && Number(ttl) >= 1 && Number(ttl) <= 730)) return refuse(400, "bad_request", "ttlDays must be from 1 to 730.");
      const contentType = headers["x-content-type"] ?? null;
      fake.blobs.set(pathname, { body: Buffer.from(await request.arrayBuffer()), contentType, ttlDays: ttl === undefined ? null : Number(ttl), uploadedAt: new Date() });
      return Response.json({ url: `${host}${pathname}`, downloadUrl: `${host}${pathname}?download=1`, pathname, contentType, contentDisposition: "inline", etag: `"${fake.blobs.size}"` });
    },
  };
  return fake;
}
