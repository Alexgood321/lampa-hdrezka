import { getStore } from "@netlify/blobs";
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

// Netlify Functions 2026: serverless backend for the existing Lampa bridge API.
export const config = { path: "/v1/*" };

function env(name) {
  return (typeof Netlify !== "undefined" ? Netlify.env.get(name) : undefined) ||
    process.env[name] || "";
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Rezka-Bridge-Token",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function answer(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors(), "Content-Type": "application/json; charset=utf-8" },
  });
}

function secretEqual(value, actual) {
  if (!value || !actual || typeof value !== "string") return false;
  const left = Buffer.from(value);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function upstreamBase() {
  const origin = new URL(env("REZKA_ORIGIN") || "https://rezka.fi/");
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("REZKA_ORIGIN must be an HTTPS origin ending in /");
  }
  return origin;
}

function safeURL(url, base) {
  const u = new URL(url, base);
  if (u.origin !== base.origin || u.username || u.password) {
    throw new Error("Upstream changed domain: update REZKA_ORIGIN in Netlify");
  }
  return u;
}

function allowedPath(path, method) {
  if (method === "POST") return /^\/ajax\/(?:get_cdn_series|login)\/?$/.test(path);
  if (method !== "GET") return false;
  if (/^\/favorites\/(?:\d+\/)?(?:page\/\d+\/)?$/.test(path)) return true;
  if (/^\/continue\/(?:page\/\d+\/)?$/.test(path)) return true;
  if (path === "/engine/ajax/search.php") return true;
  return /^\/(?:films|series|cartoons|animation|anime|documentary|shows|tv-series)\/[a-z0-9_\u0400-\u04ff/%.-]+\/?$/i.test(path);
}

function keyBuffer() {
  const raw = env("REZKA_BRIDGE_KEY");
  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error("REZKA_BRIDGE_KEY must contain 64 hexadecimal characters");
  }
  return Buffer.from(raw, "hex");
}

function seal(payload) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer(), nonce);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
    cipher.final(),
  ]);
  return {
    v: 1,
    iv: nonce.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function unseal(blob) {
  if (!blob) return {};
  if (blob.v !== 1) throw new Error("Unsupported session encoding");
  const decipher = createDecipheriv("aes-256-gcm", keyBuffer(),
    Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "base64")),
    decipher.final(),
  ]);
  const value = JSON.parse(decrypted.toString("utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid encrypted session");
  }
  return value;
}

function sessionStore() {
  return getStore({ name: "rezka-private-session", consistency: "strong" });
}
async function loadSession(store) {
  return unseal(await store.get("primary", { type: "json", consistency: "strong" }));
}
async function saveSession(store, cookies) {
  if (Object.keys(cookies).length) {
    await store.setJSON("primary", seal(cookies));
  } else {
    await store.delete("primary");
  }
}

function absorbCookies(headers, jar) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const raw of values) {
    const cookie = /^([A-Za-z0-9_-]{1,80})=([^;\r\n]*)/.exec(raw);
    if (!cookie) continue;
    if (cookie[2]) jar[cookie[1]] = cookie[2];
    else delete jar[cookie[1]];
  }
}

async function remoteRequest(initial, method, body, jar, base) {
  let url = safeURL(initial, base);
  for (let step = 0; step < 5; step++) {
    const headers = {
      "Accept": method === "POST" ? "application/json, text/html, */*" : "text/html, application/json, */*",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.7",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
      "Referer": base.href,
    };
    if (Object.keys(jar).length) {
      headers.Cookie = Object.entries(jar).map(([name, value]) => name + "=" + value).join("; ");
    }
    if (method === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8";
      headers["X-Requested-With"] = "XMLHttpRequest";
      headers.Origin = base.origin;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? body : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    absorbCookies(response.headers, jar);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect without location");
      url = safeURL(location, url);
      if (response.status === 303 || ([301, 302].includes(response.status) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      await response.body?.cancel();
      continue;
    }
    return { response, resolved: url };
  }
  throw new Error("Excessive upstream redirects");
}

function favoritesHTML(html, url, base) {
  const locationOK = /^\/favorites\//.test(url.pathname) && url.origin === base.origin;
  const gated = /<title[^>]*>\s*(?:Вход|Sign in|Login)/i.test(html) ||
    /создать аккаунт или восстановить пароль/i.test(html);
  const cloudflare = /cf-challenge|challenge-form|just a moment|checking your browser/i.test(html);
  const signedIn = /b-favorites_content|b-content__inline_item|b-header__user|href=["'][^"']*\/logout/i.test(html);
  return { authenticated: locationOK && !gated && !cloudflare && signedIn,
    gateway: gated, cloudflare };
}

async function checkFavorites(jar, base) {
  const { response, resolved } = await remoteRequest(new URL("/favorites/", base), "GET",
    undefined, jar, base);
  const html = await response.text();
  return { ...favoritesHTML(html, resolved, base), http: response.status };
}


// Account-wide viewing state for Lampa. Stored encrypted and separate from
// HDRezka cookies, so Lampa devices share it without changing website history.
function watchStore() {
  return getStore({ name: "rezka-private-watch", consistency: "strong" });
}

async function readWatch(store) {
  const content = unseal(await store.get("primary", { type: "json", consistency: "strong" }));
  return content && content.entries && typeof content.entries === "object" &&
    !Array.isArray(content.entries) ? content.entries : {};
}

function normalizedWatch(payload, base) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid viewing data");
  }
  const url = safeURL(String(payload.url || ""), base);
  if (!allowedPath(url.pathname, "GET")) throw new Error("Invalid media URL");
  url.hash = "";
  url.search = "";
  const string = (value, max) => String(value || "").trim().slice(0, max);
  const number = (value, max) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n < 0 || n > max) throw new Error("Invalid playback position");
    return Math.round(n);
  };
  const id = value => {
    const v = string(value, 12);
    if (v && !/^\d{1,12}$/.test(v)) throw new Error("Invalid episode/translator ID");
    return v;
  };
  const status = string(payload.status, 20);
  if (!["started", "progress", "completed"].includes(status)) {
    throw new Error("Invalid playback status");
  }
  const title = string(payload.title, 180);
  if (!title) throw new Error("Missing media title");
  const season = id(payload.season), episode = id(payload.episode);
  const translator = id(payload.translator);
  const position = number(payload.position, 24 * 3600);
  const duration = number(payload.duration, 24 * 3600);
  const poster = string(payload.poster, 512);
  return {
    url: url.href, title, poster: /^https:\/\//i.test(poster) ? poster : "",
    season, episode, translator, voice: string(payload.voice, 100),
    position, duration, status,
  };
}

async function writeWatch(payload, base) {
  const item = normalizedWatch(payload, base);
  const store = watchStore();
  const entries = await readWatch(store);
  const key = new URL(item.url).pathname;
  const previous = entries[key] || {};
  const episodeKey = item.season + ":" + item.episode;
  const seen = previous.seen && typeof previous.seen === "object" &&
    !Array.isArray(previous.seen) ? { ...previous.seen } : {};
  if (item.status === "completed") seen[episodeKey] = Date.now();
  entries[key] = {
    ...item, seen, updatedAt: Date.now(),
  };
  const sorted = Object.keys(entries).sort((a, b) =>
    (entries[b].updatedAt || 0) - (entries[a].updatedAt || 0));
  const clipped = {};
  sorted.slice(0, 250).forEach(k => { clipped[k] = entries[k]; });
  await store.setJSON("primary", seal({ entries: clipped }));
  return { ok: true, saved: true, updatedAt: entries[key].updatedAt };
}

function attribute(html, name) {
  const regex = new RegExp("(?:^|\\s)" + name +
    "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const m = regex.exec(html);
  return m ? (m[1] || m[2] || m[3] || "") : "";
}

function gatewayForm(html, base) {
  const forms = html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi);
  for (const match of forms) {
    const inputs = [...match[2].matchAll(/<input\b[^>]*>/gi)].map(m => ({
      name: attribute(m[0], "name"),
      type: attribute(m[0], "type").toLowerCase(),
      value: attribute(m[0], "value"),
    }));
    const password = inputs.find(x => x.name && (x.type === "password" || /pass(word)?/i.test(x.name)));
    const login = inputs.find(x => x.name && x !== password &&
      (x.type === "email" || /^(?:email|mail|login|username|login_name)$/i.test(x.name)));
    if (!password || !login) continue;
    const action = safeURL(attribute(match[1], "action") || "/", base);
    const params = new URLSearchParams();
    inputs.filter(x => x.name && !["password", "email", "submit", "button", "file"].includes(x.type))
      .forEach(x => params.set(x.name, x.value));
    return { action, params, loginField: login.name, passwordField: password.name };
  }
  return null;
}

function loginMessage(reply) {
  if (!reply || typeof reply !== "object") return "";
  if (reply.logged_email) return "Сервис сообщает, что уже выполнен вход под другим аккаунтом";
  let value = reply.message;
  if (value && typeof value === "object") {
    value = value.email || value.password || value.login_name ||
      value.login_password || Object.values(value).find(v => typeof v === "string");
  }
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]+/g," ")
    .replace(/\s+/g, " ").trim().slice(0, 180);
}

function loginResponse(text, status) {
  if (status < 200 || status >= 300) {
    return { success: false, error: "HDRezka: HTTP " + status };
  }
  let data;
  try { data = JSON.parse(text); }
  catch { return { success: false, error: "HDRezka вернула не JSON вместо ответа авторизации" }; }
  if (data && data.success === true) return { success: true };
  return { success: false, error: loginMessage(data) || "HDRezka отклонила авторизацию" };
}

async function loginToMirror(login, password, jar, base) {
  const home = await remoteRequest(base, "GET", undefined, jar, base);
  const homeHTML = await home.response.text();
  const form = gatewayForm(homeHTML, base);
  // Mirrors with a login form already specify their own auth endpoint.
  // A fallback second POST with the same password may trigger account limits.
  const endpoint = form ? form.action : new URL("/ajax/login/", base);
  const payload = form ? form.params : new URLSearchParams({ login_not_save: "0" });
  payload.set(form ? form.loginField : "login_name", login);
  payload.set(form ? form.passwordField : "login_password", password);
  const ajax = await remoteRequest(endpoint, "POST", payload.toString(), jar, base);
  const message = loginResponse(await ajax.response.text(), ajax.response.status);
  if (!message.success) {
    return { authenticated: false, error: message.error, upstreamHttp: ajax.response.status };
  }
  const status = await checkFavorites(jar, base);
  if (!status.authenticated) {
    status.error = status.cloudflare ? "HDRezka ограничила запросы Cloudflare" :
      status.gateway ? "HDRezka приняла вход, но сессия не открыла избранное. Проверьте cookies и доступ к зеркалу." :
      "HDRezka приняла вход, но /favorites/ недоступно (HTTP " + status.http + ")";
  }
  return status;
}


async function boundedText(request, max) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > max) throw new Error("Request body too large");
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > max) throw new Error("Request body too large");
  return raw;
}

function actionURL(req) {
  const url = new URL(req.url);
  return url.pathname;
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }
  const token = env("REZKA_BRIDGE_TOKEN");
  if (token.length < 32 || !secretEqual(req.headers.get("X-Rezka-Bridge-Token"), token)) {
    return answer({ error: "Invalid bridge token" }, 401);
  }

  try {
    // Do not use cookies as client authorization. All client access is token-gated.
    const base = upstreamBase();
    const action = actionURL(req);
    if (action === "/v1/status" && req.method === "GET") {
      const store = sessionStore();
      const jar = await loadSession(store);
      const before = JSON.stringify(jar);
      const status = await checkFavorites(jar, base);
      if (before !== JSON.stringify(jar)) await saveSession(store, jar);
      return answer({ ok: true, origin: base.origin, ...status });
    }

    if (action === "/v1/logout" && req.method === "POST") {
      await sessionStore().delete("primary");
      return answer({ ok: true });
    }

    if (action === "/v1/login" && req.method === "POST") {
      const form = new URLSearchParams(await boundedText(req, 8192));
      const login = form.get("login") || "";
      const password = form.get("password") || "";
      if (!login || !password || login.length > 250 || password.length > 500) {
        return answer({ error: "Invalid credentials format" }, 400);
      }
      const store = sessionStore();
      const jar = {};
      const status = await loginToMirror(login, password, jar, base);
      if (!status.authenticated) {
        return answer({
          ok: false,
          error: status.error || (status.cloudflare ? "HDRezka отклонила серверный запрос (Cloudflare)" :
            status.gateway ? "После входа сайт всё ещё показывает форму авторизации" :
              "Избранное недоступно (HTTP " + status.http + ")"),
        }, 409);
      }
      await saveSession(store, jar);
      return answer({ ok: true, authenticated: true });
    }


    if (action === "/v1/watch/progress" && req.method === "GET") {
      const entries = await readWatch(watchStore());
      return answer({ ok: true, items: Object.values(entries).sort((a,b)=>
        (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0,250) });
    }
    if (action === "/v1/watch/progress" && req.method === "POST") {
      let payload;
      try { payload = JSON.parse(await boundedText(req, 4096)); }
      catch { return answer({ error: "Invalid progress JSON" }, 400); }
      try { return answer(await writeWatch(payload, base)); }
      catch (error) {
        return answer({ error: String(error.message || "Invalid progress").slice(0,120) }, 400);
      }
    }

    if (action === "/v1/proxy" && (req.method === "GET" || req.method === "POST")) {
      const target = new URL(req.url).searchParams.get("url");
      if (!target) return answer({ error: "Missing url" }, 400);
      const url = safeURL(target, base);
      if (!allowedPath(url.pathname, req.method)) {
        return answer({ error: "Route not allowed" }, 403);
      }
      const store = sessionStore();
      const jar = await loadSession(store);
      const previous = JSON.stringify(jar);
      const body = req.method === "POST" ? await boundedText(req, 65536) : undefined;
      const { response } = await remoteRequest(url, req.method, body, jar, base);
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > 2_000_000) return answer({ error: "Upstream response too large" }, 413);
      const data = await response.arrayBuffer();
      if (data.byteLength > 2_000_000) return answer({ error: "Upstream response too large" }, 413);
      if (previous !== JSON.stringify(jar)) await saveSession(store, jar);
      const ct = response.headers.get("content-type") || "text/plain; charset=utf-8";
      return new Response(data, {
        status: response.status,
        headers: { ...cors(), "Content-Type": ct },
      });
    }
    return answer({ error: "Unknown endpoint" }, 404);
  } catch (error) {
    const safe = error instanceof Error ? error.message : "Unknown upstream error";
    // No request bodies, passwords, tokens or upstream cookies are logged.
    return answer({ error: "Bridge error", detail: safe.slice(0, 160) }, 502);
  }
}

// Internal test helpers. Not HTTP routes; credentials are never exported.
export const __test = { loginMessage, loginResponse, loginToMirror, gatewayForm, normalizedWatch, allowedPath };
