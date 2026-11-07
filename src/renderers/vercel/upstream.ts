type FetchUpstream = (request: Request) => Promise<Response>;

/** Adapt Node's decoding fetch to a response Vercel can send to a browser. */
export async function fetchVercelUpstream(request: Request, fetchUpstream: FetchUpstream = fetch): Promise<Response> {
  const headers = new Headers(request.headers);
  // The worker has already checked the browser's Origin against this app.
  // This is now a server-to-server request, not a cross-origin browser fetch.
  headers.delete("origin");
  headers.delete("referer");
  headers.delete("host");
  headers.set("accept-encoding", "identity");
  const upstream = await fetchUpstream(new Request(request, { headers }));
  const responseHeaders = new Headers(upstream.headers);
  // Native fetch decodes compressed responses even when the server ignores
  // identity. Its original wire encoding/length no longer describe the body.
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
