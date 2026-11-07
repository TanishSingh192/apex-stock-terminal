import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { handleRequest, type WorkerEnv } from "../cloudflare/worker";
import { fetchVercelUpstream } from "./upstream";

const env: WorkerEnv = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };

test("a compressed upstream JSON response can be read by the browser without decoding twice", async () => {
  const payload = { price: 188.7, symbol: "NVDA" };
  const compressed = gzipSync(JSON.stringify(payload));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "content-length": compressed.length });
    res.end(compressed);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const response = await fetchVercelUpstream(new Request(`http://127.0.0.1:${address.port}`));
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(response.headers.has("content-length")).toBe(false);
    expect(await response.json()).toEqual(payload);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("only same-origin API calls reach the server transport, retaining body and credentials", async () => {
  const seen: Request[] = [];
  const transport = (request: Request) => fetchVercelUpstream(request, async upstream => {
    seen.push(upstream);
    return Response.json({ ok: true }, { headers: { "set-cookie": "session=new; HttpOnly; Secure; Path=/" } });
  });
  const request = (origin: string) => new Request("https://apex.example/api/market/quotes/batch", {
    method: "POST", headers: { origin, referer: "https://apex.example/", "content-type": "application/json", cookie: "session=existing", authorization: "Bearer test", "accept-encoding": "gzip, br, zstd" },
    body: JSON.stringify({ symbols: ["NVDA"] }),
  });
  expect((await handleRequest(request("https://other.example"), env, transport)).status).toBe(403);
  expect(seen).toHaveLength(0);
  const response = await handleRequest(request("https://apex.example"), env, transport);
  expect(response.status).toBe(200);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.url).toBe("https://api.gloom.sh/market/quotes/batch");
  expect(seen[0]!.headers.get("origin")).toBeNull();
  expect(seen[0]!.headers.get("referer")).toBeNull();
  expect(seen[0]!.headers.get("accept-encoding")).toBe("identity");
  expect(seen[0]!.headers.get("cookie")).toBe("session=existing");
  expect(seen[0]!.headers.get("authorization")).toBe("Bearer test");
  expect(await seen[0]!.json()).toEqual({ symbols: ["NVDA"] });
  expect(response.headers.get("set-cookie")).toContain("session=new");
});
