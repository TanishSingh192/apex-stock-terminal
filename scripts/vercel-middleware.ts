import { fetchVercelUpstream } from "../src/renderers/vercel/upstream";
import { handleRequest, type WorkerEnv } from "../src/renderers/cloudflare/worker";

// Vercel has no Cloudflare rate-limit binding. Refuse anonymous plugin proxy
// traffic until a shared limiter is configured; authenticated sessions retain
// the upstream per-session limit.
const env: WorkerEnv = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  SIGNED_OUT_PROXY_TOTAL: { limit: async () => ({ success: false }) },
};

export default function middleware(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/api" || path.startsWith("/api/") || path === "/http-proxy" || path === "/health") {
    return handleRequest(request, env, fetchVercelUpstream);
  }
  return Promise.resolve(new Response(null, { headers: { "x-middleware-next": "1" } }));
}

export const config = { matcher: ["/api/:path*", "/http-proxy", "/health"] };
