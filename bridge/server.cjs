'use strict';
// Personal HDRezka bridge for Lampa. Node.js >= 22; no external packages.
// Run only behind your own HTTPS reverse proxy. The token is never logged.
const http = require('node:http');
const crypto = require('node:crypto');

const base = new URL(process.env.REZKA_ORIGIN || 'https://rezka.fi/');
const key = process.env.REZKA_BRIDGE_TOKEN || '';
const host = process.env.BRIDGE_HOST || '127.0.0.1';
const port = Number(process.env.BRIDGE_PORT || 8787);
if (base.protocol !== 'https:') throw Error('REZKA_ORIGIN must use HTTPS');
if (key.length < 32) throw Error('REZKA_BRIDGE_TOKEN must contain at least 32 characters');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid BRIDGE_PORT');
const cookies = new Map();
let lastAuth = false;

function json(res, status, object) {
    const value = JSON.stringify(object);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(value) });
    res.end(value);
}
function sameHost(url) {
    return url.protocol === base.protocol && url.host === base.host;
}
function targetURL(value) {
    const url = new URL(value, base);
    if (!sameHost(url) || url.username || url.password) throw Error('Upstream host not allowed');
    return url;
}
function allowedPath(pathname, method) {
    if (method === 'POST') return /^\/ajax\/(?:get_cdn_series|login)\/?$/.test(pathname);
    if (method !== 'GET') return false;
    if (/^\/favorites\/(?:\d+\/)?(?:page\/\d+\/)?$/.test(pathname)) return true;
    if (pathname === '/engine/ajax/search.php') return true;
    // Film/series detail pages; block arbitrary upstream endpoints.
    return /^\/(?:films|series|cartoons|animation|anime|documentary|shows|tv-series)\/[a-z0-9_\u0400-\u04ff/%.-]+\/?$/i.test(pathname);
}
async function readBody(req, limit) {
    let size = 0;
    const parts = [];
    for await (const buf of req) {
        size += buf.length;
        if (size > limit) throw Error('Request body is too large');
        parts.push(buf);
    }
    return Buffer.concat(parts).toString('utf8');
}
function cookieHeader() {
    return [...cookies.entries()].map(([a,b]) => a + '=' + b).join('; ');
}
function collectCookies(response) {
    const values = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie() : [];
    for (const line of values) {
        const m = /^([^=;\s]+)=([^;]*)/.exec(line);
        if (!m) continue;
        if (/^(?:__Host-|__Secure-|dle_|PHPSESSID|cf_|cf_clearance|_)/i.test(m[1]) ||
            /^[a-z0-9_-]{2,80}$/i.test(m[1])) {
            if (m[2]) cookies.set(m[1], m[2]); else cookies.delete(m[1]);
        }
    }
}
async function upstream(url, method, body) {
    let current = targetURL(url);
    for (let i = 0; i < 4; i++) {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
            'Accept': method === 'POST' ? 'application/json, text/plain, */*' : 'text/html, application/json, */*',
            'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.7',
            'Referer': base.origin + '/',
            'Origin': base.origin
        };
        if (cookies.size) headers.Cookie = cookieHeader();
        if (method === 'POST') {
            headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
            headers['X-Requested-With'] = 'XMLHttpRequest';
        }
        const response = await fetch(current, {
            method, headers, body: method === 'POST' ? body : undefined,
            redirect: 'manual', signal: AbortSignal.timeout(15000)
        });
        collectCookies(response);
        if ([301,302,303,307,308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location) throw Error('Redirect without Location');
            current = targetURL(new URL(location, current));
            if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
                method = 'GET'; body = undefined;
            }
            continue;
        }
        return response;
    }
    throw Error('Too many upstream redirects');
}
function hasFavorites(text) {
    return /b-favorites_content|b-content__inline_item|b-header__user|href=["'][^"']*\/logout/i.test(text)
        && !/cf-challenge|challenge-form|Just a moment/i.test(text);
}
async function favoritesStatus() {
    const response = await upstream(new URL('/favorites/', base), 'GET');
    const html = await response.text();
    return { http: response.status, authenticated: response.ok && hasFavorites(html),
        gateway: /<title[^>]*>\s*(?:Вход|Sign in|Login)/i.test(html) ||
            /Создать аккаунт или восстановить пароль/i.test(html),
        cloudflare: /cf-challenge|challenge-form|Just a moment/i.test(html) };
}
function allowCors(req, res) {
    // Auth is via a random per-installation token, NOT browser cookies.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Rezka-Bridge-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    res.setHeader('Vary', 'Origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
}
function authorized(req) {
    const provided = req.headers['x-rezka-bridge-token'];
    if (typeof provided !== 'string') return false;
    const a = Buffer.from(provided), b = Buffer.from(key);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const server = http.createServer(async (req, res) => {
    allowCors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (!authorized(req)) { json(res, 401, { error: 'Invalid bridge token' }); return; }
    try {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/v1/status' && req.method === 'GET') {
            const state = await favoritesStatus();
            lastAuth = state.authenticated;
            json(res, 200, { ok: true, origin: base.origin, ...state });
            return;
        }
        if (pathname === '/v1/logout' && req.method === 'POST') {
            cookies.clear(); lastAuth = false;
            json(res, 200, { ok: true });
            return;
        }
        if (pathname === '/v1/login' && req.method === 'POST') {
            const incoming = new URLSearchParams(await readBody(req, 16384));
            const login = incoming.get('login') || '';
            const password = incoming.get('password') || '';
            if (!login || !password) { json(res, 400, { error: 'Missing credentials' }); return; }
            const payload = new URLSearchParams({
                login_name: login, login_password: password, login_not_save: '0', login: 'submit'
            });
            cookies.clear();
            const response = await upstream(new URL('/ajax/login/', base), 'POST', payload.toString());
            const body = await response.text();
            let data = {};
            try { data = JSON.parse(body); } catch (_) {}
            const state = await favoritesStatus();
            lastAuth = state.authenticated;
            if (!lastAuth) {
                const message = state.gateway
                    ? 'Закрытое зеркало требует отдельного входа; стандартный /ajax/login/ недоступен'
                    : state.cloudflare ? 'Cloudflare блокирует серверный запрос'
                    : 'Авторизация не подтверждена на /favorites/ (HTTP ' + state.http + ')';
                json(res, 409, { ok: false, error: message, upstream_message:
                    typeof data.message === 'string' ? data.message.slice(0, 200) : '' });
                return;
            }
            json(res, 200, { ok: true, authenticated: true });
            return;
        }
        if (pathname === '/v1/proxy' && (req.method === 'GET' || req.method === 'POST')) {
            const value = new URL(req.url, 'http://localhost').searchParams.get('url');
            if (!value) { json(res, 400, { error: 'Missing url' }); return; }
            const target = targetURL(value);
            if (!allowedPath(target.pathname, req.method)) {
                json(res, 403, { error: 'Path not allowed' }); return;
            }
            const body = req.method === 'POST' ? await readBody(req, 65536) : undefined;
            const response = await upstream(target, req.method, body);
            const data = Buffer.from(await response.arrayBuffer());
            if (data.length > 3000000) {
                json(res, 413, { error: 'Upstream response too large' }); return;
            }
            res.writeHead(response.status, {
                'Content-Type': (response.headers.get('content-type') || 'text/plain').split(';')[0] +
                    '; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end(data);
            return;
        }
        json(res, 404, { error: 'Unknown endpoint' });
    } catch (error) {
        // Never log request body, passwords, cookies or bridge token.
        json(res, 502, { error: 'Bridge upstream error', detail: error.message.slice(0, 160) });
    }
});
server.listen(port, host, () => console.log('HDRezka bridge listening on ' + host + ':' + port));