// src/renderers/vercel/upstream.ts
async function fetchVercelUpstream(request, fetchUpstream = fetch) {
  const headers = new Headers(request.headers);
  headers.delete("origin");
  headers.delete("referer");
  headers.delete("host");
  headers.set("accept-encoding", "identity");
  const upstream = await fetchUpstream(new Request(request, { headers }));
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}

// src/utils/http-proxy-response.ts
var BASE64_CHUNK_BYTES = 3 * 8192;
function encodeBase64(bytes, native = typeof bytes.toBase64 === "function") {
  if (native)
    return bytes.toBase64();
  const parts = [];
  for (let offset = 0;offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES))));
  }
  return parts.join("");
}
function decodeBase64(value, native = typeof Uint8Array.fromBase64 === "function") {
  try {
    if (native)
      return Uint8Array.fromBase64(value);
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0;index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return;
  }
}
function readRequestInit(raw) {
  const init = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const method = typeof init.method === "string" && init.method.trim() ? init.method.trim().toUpperCase() : "GET";
  const headers = init.headers && typeof init.headers === "object" && !Array.isArray(init.headers) ? Object.fromEntries(Object.entries(init.headers).filter((entry) => typeof entry[1] === "string")) : {};
  const acceptsBody = method !== "GET" && method !== "HEAD";
  return {
    method,
    headers,
    body: !acceptsBody ? undefined : typeof init.body === "string" ? init.body : typeof init.bodyBase64 === "string" ? decodeBase64(init.bodyBase64) : undefined,
    redirect: init.redirect === "manual" || init.redirect === "error" || init.redirect === "follow" ? init.redirect : undefined,
    timeoutMs: typeof init.timeoutMs === "number" && Number.isFinite(init.timeoutMs) && init.timeoutMs > 0 ? init.timeoutMs : undefined
  };
}
function toResponseHead(response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie")
      return;
    headers[key] = value;
  });
  const setCookie = [...response.headers.getSetCookie?.() ?? []];
  const singleSetCookie = response.headers.get("set-cookie");
  if (setCookie.length === 0 && singleSetCookie)
    setCookie.push(singleSetCookie);
  return { status: response.status, statusText: response.statusText, headers, setCookie };
}
var STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });
function encodeResponseBody(bytes) {
  const hasByteOrderMark = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191;
  if (!hasByteOrderMark) {
    try {
      return { body: STRICT_UTF8.decode(bytes) };
    } catch {}
  }
  return { body: "", bodyBase64: encodeBase64(bytes) };
}
var NULL_BODY_STATUSES = new Set([204, 205, 304]);
// src/utils/plugin-proxy-hosts.json
var plugin_proxy_hosts_default = {
  hosts: [
    "api.crypto.com",
    "api.elections.kalshi.com",
    "api.fda.gov",
    "api.gemini.com",
    "api.limitless.exchange",
    "api.votehub.com",
    "clinicaltrials.gov",
    "data.pascal.trade",
    "efts.sec.gov",
    "forms13f.com",
    "gateway.polymarket.us",
    "markets.newyorkfed.org",
    "nasdaqtrader.com",
    "production.dataviz.cnn.io",
    "services-dynarep.ddwa.finra.org",
    "www.treasurydirect.gov"
  ]
};

// src/utils/plugin-proxy-hosts.ts
var PROXY_ALLOWED_HOSTS = plugin_proxy_hosts_default.hosts;
var WEB_DIRECT_HOSTS = [
  "api.fiscaldata.treasury.gov",
  "api.thebuildout.ai",
  "clob.polymarket.com",
  "data-api.polymarket.com",
  "gamma-api.polymarket.com"
];
var HTTP_PROXY_PATH = "/http-proxy";
function isProxiedHost(hostname, hosts = PROXY_ALLOWED_HOSTS) {
  const host = hostname.toLowerCase();
  return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

// src/utils/http-proxy-upstream.ts
var STRIPPED_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
var CROSS_ORIGIN_STRIPPED_HEADERS = ["authorization", "cookie", "proxy-authorization"];
var REQUEST_BODY_HEADERS = ["content-encoding", "content-language", "content-location", "content-type"];
var REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
var MAX_REDIRECTS = 5;
function upstreamHeaders(raw) {
  const headers = new Headers;
  for (const [name, value] of Object.entries(raw)) {
    if (STRIPPED_REQUEST_HEADERS.has(name.toLowerCase()))
      continue;
    try {
      headers.set(name, value);
    } catch {}
  }
  return headers;
}
async function fetchCheckingRedirects(first, init, options) {
  const { fetch: fetchUpstream, check, signal } = options;
  const headers = upstreamHeaders(init.headers);
  const mode = init.redirect ?? "follow";
  let url = first;
  let method = init.method;
  let body = init.body;
  for (let followed = 0;; followed += 1) {
    const response = await fetchUpstream(url, { method, headers, body, redirect: "manual", signal });
    const location = REDIRECT_STATUSES.has(response.status) ? response.headers.get("location") : null;
    if (location === null || mode === "manual")
      return { response };
    await response.body?.cancel().catch(() => {});
    if (mode === "error")
      return { error: "The upstream response was a redirect.", status: 502 };
    if (followed >= MAX_REDIRECTS)
      return { error: "The upstream redirected too many times.", status: 502 };
    let next;
    try {
      next = new URL(location, url).href;
    } catch {
      return { error: "The upstream sent an invalid redirect.", status: 502 };
    }
    const target = await check(next);
    if ("error" in target)
      return { error: `The upstream redirect was refused. ${target.error}`, status: 502 };
    if (target.url.origin !== url.origin) {
      for (const name of CROSS_ORIGIN_STRIPPED_HEADERS)
        headers.delete(name);
    }
    if (response.status === 303 && method !== "GET" && method !== "HEAD" || (response.status === 301 || response.status === 302) && method === "POST") {
      method = "GET";
      body = undefined;
      for (const name of REQUEST_BODY_HEADERS)
        headers.delete(name);
    }
    url = target.url;
  }
}
async function readBytesWithin(body, maxBytes) {
  if (!body)
    return new Uint8Array(0);
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  for (;; ) {
    const { done, value } = await reader.read();
    if (done)
      break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// src/renderers/cloudflare/http-proxy.ts
var PROXY_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
var READ = ["GET", "HEAD"];
var SIGNED_OUT_ROUTES = {
  "api.crypto.com": [{ methods: READ, path: "/dcm/v1/public/" }],
  "api.elections.kalshi.com": [{ methods: READ, path: "/trade-api/v2/" }],
  "api.fda.gov": [{ methods: READ, path: "/" }],
  "api.gemini.com": [{ methods: READ, path: "/v1/prediction-markets/" }],
  "api.limitless.exchange": [{ methods: READ, path: "/markets/" }],
  "api.votehub.com": [{ methods: READ, path: "/polls" }],
  "clinicaltrials.gov": [{ methods: READ, path: "/api/v2/" }],
  "data.pascal.trade": [
    { methods: READ, path: "/api/v1/markets" },
    { methods: ["POST"], path: "/api/v1/markets/text-search" }
  ],
  "efts.sec.gov": [{ methods: READ, path: "/LATEST/search-index" }],
  "forms13f.com": [{ methods: READ, path: "/api/v1/" }],
  "gateway.polymarket.us": [{ methods: READ, path: "/v1/markets" }],
  "markets.newyorkfed.org": [{ methods: READ, path: "/api/" }],
  "nasdaqtrader.com": [{ methods: READ, path: "/rss.aspx" }],
  "production.dataviz.cnn.io": [{ methods: READ, path: "/index/fearandgreed/" }],
  "services-dynarep.ddwa.finra.org": [{ methods: ["POST"], path: "/public/reporting/v2/data/group/" }],
  "www.treasurydirect.gov": [{ methods: READ, path: "/TA_WS/securities/search" }]
};
function signedOutRouteAllows(url, method, routes = SIGNED_OUT_ROUTES) {
  const host = url.hostname.toLowerCase();
  const entry = Object.entries(routes).find(([allowed]) => host === allowed || host.endsWith(`.${allowed}`));
  return !!entry?.[1].some((route) => route.methods.includes(method) && (route.path.endsWith("/") ? url.pathname.startsWith(route.path) : url.pathname === route.path || url.pathname.startsWith(`${route.path}/`)));
}
var MAX_BODY_BYTES = 5 * 1024 * 1024;
var MAX_REQUEST_BYTES = 1024 * 1024;
var MAX_TIMEOUT_MS = 30000;
var DEFAULT_TIMEOUT_MS = 20000;
function validateProxyTarget(rawUrl, hosts = PROXY_ALLOWED_HOSTS) {
  if (typeof rawUrl !== "string" || rawUrl.length > 2048) {
    return { error: "A target URL is required.", status: 400 };
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: "The target URL is not valid.", status: 400 };
  }
  if (url.protocol !== "https:") {
    return { error: "Only https targets are allowed.", status: 400 };
  }
  if (url.username || url.password) {
    return { error: "Credentials in the URL are not allowed.", status: 400 };
  }
  if (url.port && url.port !== "443") {
    return { error: "Only the default https port is allowed.", status: 400 };
  }
  if (/^\d|^\[|:/.test(url.hostname) || url.hostname === "localhost") {
    return { error: "The target host is not allowed.", status: 403 };
  }
  if (!isProxiedHost(url.hostname, hosts)) {
    return { error: "The target host is not on the plugin allowlist.", status: 403 };
  }
  return { url };
}
function proxyError(message, status, headers = {}) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store", ...headers } });
}
function upstreamFailure(error) {
  const timedOut = error instanceof Error && error.name === "TimeoutError";
  return proxyError(timedOut ? "The data source timed out. Try again shortly." : "The data source could not be reached. Try again shortly.", 504);
}
async function handleHttpProxy(request, options) {
  const { sessions, fetchApi, fetchUpstream = fetch, hosts = PROXY_ALLOWED_HOSTS, signedOutRoutes = SIGNED_OUT_ROUTES } = options;
  if (request.method !== "POST") {
    return proxyError("Method not allowed", 405);
  }
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return proxyError("Origin not allowed", 403);
  }
  const admission = await sessions.admit(request, fetchApi);
  if (!admission.ok) {
    const headers = admission.retryAfterSeconds ? { "retry-after": String(admission.retryAfterSeconds) } : {};
    return proxyError(admission.error, admission.status, headers);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  const raw = declaredLength > MAX_REQUEST_BYTES ? null : await readBytesWithin(request.body, MAX_REQUEST_BYTES);
  if (raw === null) {
    return proxyError("The plugin request is too large.", 413);
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return proxyError("The request body is not valid JSON.", 400);
  }
  if (!payload || typeof payload !== "object") {
    return proxyError("The request body is not valid JSON.", 400);
  }
  const target = validateProxyTarget(payload.url, hosts);
  if ("error" in target)
    return proxyError(target.error, target.status);
  const init = readRequestInit(payload.init);
  if (!PROXY_METHODS.has(init.method)) {
    return proxyError("Method not allowed", 405);
  }
  if (!admission.signedIn) {
    if (!signedOutRouteAllows(target.url, init.method, signedOutRoutes)) {
      return proxyError("Sign in to Gloom to send this request.", 401);
    }
    if (options.signedOutLimit && !await options.signedOutLimit(request).catch(() => {
      console.warn("[http-proxy] Could not check the signed-out rate limit; the request went ahead");
      return true;
    })) {
      return proxyError("Too many requests right now. Sign in to Gloom, or try again in a minute.", 429, { "retry-after": "60" });
    }
  }
  const signal = AbortSignal.timeout(Math.min(init.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS));
  let result;
  try {
    result = await fetchCheckingRedirects(target.url, init, {
      fetch: fetchUpstream,
      check: (url) => validateProxyTarget(url, hosts),
      signal
    });
  } catch (error) {
    return upstreamFailure(error);
  }
  if ("error" in result)
    return proxyError(result.error, result.status);
  const { response } = result;
  const tooLarge = `The upstream response is larger than ${MAX_BODY_BYTES / (1024 * 1024)} MB.`;
  if (init.method !== "HEAD" && Number(response.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    await response.body?.cancel().catch(() => {});
    return proxyError(tooLarge, 502);
  }
  let body;
  try {
    body = await readBytesWithin(response.body, MAX_BODY_BYTES);
  } catch (error) {
    return upstreamFailure(error);
  }
  if (body === null)
    return proxyError(tooLarge, 502);
  const envelope = { ...toResponseHead(response), ...encodeResponseBody(body) };
  return Response.json(envelope, { headers: { "cache-control": "no-store" } });
}

// src/api-client/session-cookie.ts
var SESSION_COOKIE_NAMES = ["__Secure-gloomberb.session_token", "gloomberb.session_token"];

// src/renderers/cloudflare/proxy-session.ts
var DONT_REMEMBER_COOKIE_NAMES = ["__Secure-gloomberb.dont_remember", "gloomberb.dont_remember"];
var FORWARDED_COOKIE_NAMES = new Set([...SESSION_COOKIE_NAMES, ...DONT_REMEMBER_COOKIE_NAMES]);
var SESSION_NAMES = new Set(SESSION_COOKIE_NAMES);
var DEFAULT_TTL_MS = 60000;
var DEFAULT_MAX_ENTRIES = 1000;
var DEFAULT_CHECK_TIMEOUT_MS = 5000;
var SHARED_CHECK_GRACE_MS = 500;
var DEFAULT_REQUESTS_PER_WINDOW = 300;
var DEFAULT_ANONYMOUS_REQUESTS_PER_WINDOW = 240;
var DEFAULT_WINDOW_MS = 60000;
var DEFAULT_MAX_ENTRIES_PER_USER = 4;
function anonymousRateKey(request) {
  const ip = request.headers.get("cf-connecting-ip")?.trim().toLowerCase() ?? "";
  if (!ip.includes(":"))
    return `ip:${ip || "unknown"}`;
  const [head = "", tail] = ip.split("::", 2);
  const front = head ? head.split(":") : [];
  const back = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups = tail === undefined ? front : [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back];
  return `ip6:${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}`;
}
function forwardedCookies(header) {
  if (!header)
    return null;
  const kept = [];
  let hasSession = false;
  for (const part of header.split(";")) {
    const pair = part.trim();
    const eq = pair.indexOf("=");
    if (eq <= 0)
      continue;
    const name = pair.slice(0, eq).trim();
    if (!FORWARDED_COOKIE_NAMES.has(name) || !pair.slice(eq + 1).trim())
      continue;
    if (SESSION_NAMES.has(name))
      hasSession = true;
    kept.push(pair);
  }
  return hasSession ? kept.join("; ") : null;
}
async function cacheKey(cookie) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cookie));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function settleWithin(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(resolve, Math.max(0, ms), undefined);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
function makeRoom(map, maxEntries, expired) {
  if (map.size < maxEntries)
    return;
  for (const [key, value] of map) {
    if (expired(value))
      map.delete(key);
  }
  while (map.size >= maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest === undefined)
      break;
    map.delete(oldest);
  }
}
async function checkSession(sessionUrl, cookie, userAgent, fetchApi, timeoutMs) {
  const headers = new Headers({ accept: "application/json", cookie });
  if (userAgent)
    headers.set("user-agent", userAgent);
  try {
    const response = await fetchApi(new Request(sessionUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    }));
    if (response.status === 401 || response.status === 403)
      return "invalid";
    if (!response.ok)
      return "unavailable";
    const text = await response.text();
    if (!text.trim())
      return "invalid";
    const body = JSON.parse(text);
    const id = body?.user?.id;
    return typeof id === "string" && id.length > 0 ? { userId: id } : "invalid";
  } catch {
    console.warn("[proxy-session] Could not check the session; the request counts as signed out");
    return "unavailable";
  }
}
function createProxySessionGate(options) {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxEntriesPerUser = Math.max(1, options.maxEntriesPerUser ?? DEFAULT_MAX_ENTRIES_PER_USER);
  const requestsPerWindow = options.requestsPerWindow ?? DEFAULT_REQUESTS_PER_WINDOW;
  const anonymousRequestsPerWindow = options.anonymousRequestsPerWindow ?? DEFAULT_ANONYMOUS_REQUESTS_PER_WINDOW;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const checkTimeoutMs = options.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const sharedWaitMs = checkTimeoutMs + SHARED_CHECK_GRACE_MS;
  const confirmed = new Map;
  const pending = new Map;
  const windows = new Map;
  function confirm(key, userId) {
    const settledAt = now();
    confirmed.delete(key);
    const ownKeys = [];
    for (const [other, entry] of confirmed) {
      if (entry.userId === userId)
        ownKeys.push(other);
    }
    for (let i = 0;i <= ownKeys.length - maxEntriesPerUser; i += 1)
      confirmed.delete(ownKeys[i]);
    makeRoom(confirmed, maxEntries, (entry) => entry.expiresAt <= settledAt);
    confirmed.set(key, { expiresAt: settledAt + ttlMs, userId });
  }
  async function verdictFor(key, cookie, request, fetchApi) {
    const at = now();
    const known = confirmed.get(key);
    if (known && known.expiresAt > at)
      return { userId: known.userId };
    confirmed.delete(key);
    const shared = pending.get(key);
    if (shared && at - shared.startedAt < sharedWaitMs) {
      const verdict2 = await settleWithin(shared.verdict, sharedWaitMs - (at - shared.startedAt));
      if (verdict2 !== undefined)
        return verdict2;
    }
    const startedAt = now();
    const check = {
      startedAt,
      verdict: checkSession(options.sessionUrl, cookie, request.headers.get("user-agent"), fetchApi, checkTimeoutMs)
    };
    pending.delete(key);
    makeRoom(pending, maxEntries, (entry) => startedAt - entry.startedAt >= sharedWaitMs);
    pending.set(key, check);
    const verdict = await check.verdict;
    if (pending.get(key) === check)
      pending.delete(key);
    if (typeof verdict === "object")
      confirm(key, verdict.userId);
    return verdict;
  }
  function withinRate(windowKey, limit, signedIn) {
    const at = now();
    let window = windows.get(windowKey);
    if (!window || at - window.startedAt >= windowMs) {
      windows.delete(windowKey);
      makeRoom(windows, maxEntries, (entry) => at - entry.startedAt >= windowMs);
      window = { startedAt: at, count: 0 };
      windows.set(windowKey, window);
    }
    window.count += 1;
    if (window.count <= limit)
      return { ok: true, signedIn };
    return {
      ok: false,
      status: 429,
      error: "Too many requests right now. Try again in a minute.",
      retryAfterSeconds: Math.max(1, Math.ceil((window.startedAt + windowMs - at) / 1000))
    };
  }
  return {
    async admit(request, fetchApi) {
      const cookie = forwardedCookies(request.headers.get("cookie"));
      const verdict = cookie ? await verdictFor(await cacheKey(cookie), cookie, request, fetchApi) : "invalid";
      if (typeof verdict === "object")
        return withinRate(`user:${verdict.userId}`, requestsPerWindow, true);
      return withinRate(anonymousRateKey(request), anonymousRequestsPerWindow, false);
    }
  };
}

// src/renderers/cloudflare/worker.ts
function signedOutProxyLimit(env) {
  const { SIGNED_OUT_PROXY_PER_ADDRESS: perAddress, SIGNED_OUT_PROXY_TOTAL: total } = env;
  if (!perAddress && !total)
    return;
  return async (request) => {
    if (perAddress && !(await perAddress.limit({ key: anonymousRateKey(request) })).success)
      return false;
    return !total || (await total.limit({ key: "signed-out" })).success;
  };
}
var SHARE_PATH = /^\/s\/[a-f0-9]{32}\/?$/;
var LAYOUT_SHARE_PATH = /^\/l\/[a-f0-9]{32}\/?$/;
var API_PATH = /^\/api(?:\/|$)/;
var APPLE_APP_SITE_ASSOCIATION_PATH = "/.well-known/apple-app-site-association";
var ROBOTS_PATH = "/robots.txt";
var IMMUTABLE_ASSET_PATH = /^\/assets\/.+-[a-f0-9]{16}\.(?:js|css)$/;
var IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
var DAILY_ASSET_PATH = /^\/(?:favicon\.(?:ico|svg)|manifest\.webmanifest|app-icon-\d+\.png)$/;
var DAILY_CACHE_CONTROL = "public, max-age=86400";
var ROBOTS_TXT = `User-agent: *
Allow: /
`;
var APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    details: [
      {
        appIDs: ["3XQML3UV65.sh.gloom.companion"],
        components: [{ "/": "/s/*", comment: "Public portfolio shares" }]
      }
    ]
  }
};
var API_ORIGIN = "https://api.gloom.sh";
var API_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
var proxySessions = createProxySessionGate({ sessionUrl: `${API_ORIGIN}/auth/get-session` });
var GOOGLE_IDENTITY = "https://accounts.google.com/gsi/";
var CONNECT_SRC = [
  "'self'",
  "https://api.github.com",
  "https://plugins.gloom.sh",
  "https://gloom.sh",
  GOOGLE_IDENTITY,
  ...WEB_DIRECT_HOSTS.map((host) => `https://${host}`)
].join(" ");
var SECURITY_HEADERS = {
  "content-security-policy": `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self' ${GOOGLE_IDENTITY}client; frame-src 'self' ${GOOGLE_IDENTITY}; style-src 'self' 'unsafe-inline' ${GOOGLE_IDENTITY}style; img-src 'self' data: https:; media-src 'self' https:; connect-src ${CONNECT_SRC}; form-action 'self'; upgrade-insecure-requests`,
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
};
function withSecurityHeaders(response, options = {}) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS))
    headers.set(name, value);
  const html = (headers.get("content-type") ?? "").includes("text/html");
  if (options.share)
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  else if (options.noindex && html)
    headers.set("x-robots-tag", "noindex");
  if (html)
    headers.set("cache-control", "no-store");
  else if (options.keep && (response.ok || response.status === 304)) {
    headers.set("cache-control", options.keep === "immutable" ? IMMUTABLE_CACHE_CONTROL : DAILY_CACHE_CONTROL);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function apiUpstreamUrl(url) {
  const path = url.pathname.slice("/api".length) || "/";
  if (!path.startsWith("/") || /^\/[/\\]/.test(path))
    return null;
  const upstream = new URL(`${API_ORIGIN}${path}${url.search}`);
  return upstream.origin === API_ORIGIN ? upstream : null;
}
async function proxyApi(request, fetchApi) {
  const url = new URL(request.url);
  if (!API_METHODS.has(request.method)) {
    return Response.json({ error: "Method not allowed" }, {
      status: 405,
      headers: { Allow: [...API_METHODS].join(", ") }
    });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return Response.json({ error: "Origin not allowed" }, { status: 403 });
  }
  const upstreamUrl = apiUpstreamUrl(url);
  if (!upstreamUrl)
    return Response.json({ error: "Not found" }, { status: 404 });
  return fetchApi(new Request(upstreamUrl, request));
}
async function handleRequest(request, env, fetchApi = fetch) {
  const url = new URL(request.url);
  if (API_PATH.test(url.pathname))
    return proxyApi(request, fetchApi);
  if (url.pathname === HTTP_PROXY_PATH) {
    return withSecurityHeaders(await handleHttpProxy(request, {
      sessions: proxySessions,
      fetchApi,
      signedOutLimit: signedOutProxyLimit(env)
    }));
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return withSecurityHeaders(Response.json({ error: "Method not allowed" }, {
      status: 405,
      headers: { Allow: "GET, HEAD" }
    }));
  }
  if (url.pathname === "/health") {
    return withSecurityHeaders(Response.json({ status: "ok" }));
  }
  if (url.pathname === APPLE_APP_SITE_ASSOCIATION_PATH) {
    return withSecurityHeaders(Response.json(APPLE_APP_SITE_ASSOCIATION, {
      headers: { "cache-control": "public, max-age=3600" }
    }));
  }
  if (url.pathname === ROBOTS_PATH) {
    return withSecurityHeaders(new Response(ROBOTS_TXT, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" }
    }));
  }
  const socialShare = SHARE_PATH.test(url.pathname) || LAYOUT_SHARE_PATH.test(url.pathname);
  if (socialShare) {
    const assetUrl = new URL("/share.html", url.origin);
    const assetRequest = new Request(assetUrl, { method: request.method, headers: request.headers });
    return withSecurityHeaders(await env.ASSETS.fetch(assetRequest), { share: true });
  }
  const deepLink = url.pathname !== "/" || url.search !== "";
  const keep = IMMUTABLE_ASSET_PATH.test(url.pathname) ? "immutable" : DAILY_ASSET_PATH.test(url.pathname) ? "daily" : undefined;
  return withSecurityHeaders(await env.ASSETS.fetch(request), { noindex: deepLink, keep });
}

// scripts/vercel-middleware.ts
var env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  SIGNED_OUT_PROXY_TOTAL: { limit: async () => ({ success: false }) }
};
function middleware(request) {
  const path = new URL(request.url).pathname;
  if (path === "/api" || path.startsWith("/api/") || path === "/http-proxy" || path === "/health") {
    return handleRequest(request, env, fetchVercelUpstream);
  }
  return Promise.resolve(new Response(null, { headers: { "x-middleware-next": "1" } }));
}
var config = { matcher: ["/api/:path*", "/http-proxy", "/health"] };
export {
  middleware as default,
  config
};
