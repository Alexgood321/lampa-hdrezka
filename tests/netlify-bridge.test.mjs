import test from "node:test";
import assert from "node:assert/strict";
import handler, { config } from "../netlify/functions/bridge.mjs";

process.env.REZKA_BRIDGE_TOKEN = "a".repeat(64);
process.env.REZKA_BRIDGE_KEY = "b".repeat(64);
process.env.REZKA_ORIGIN = "https://rezka.fi/";

function req(path, method = "GET", withToken = true, body = undefined) {
  const headers = new Headers();
  if (withToken) headers.set("X-Rezka-Bridge-Token", "a".repeat(64));
  if (body) headers.set("Content-Type", "application/x-www-form-urlencoded");
  return new Request("https://bridge.netlify.app" + path, { method, headers, body });
}

test("function has Netlify custom route", () => {
  assert.equal(config.path, "/v1/*");
});

test("preflight returns CORS response without credentials", async () => {
  const response = await handler(req("/v1/login", "OPTIONS", false));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /X-Rezka-Bridge-Token/);
});

test("protected routes refuse missing token", async () => {
  const response = await handler(req("/v1/status", "GET", false));
  assert.equal(response.status, 401);
});

test("protected routes refuse wrong token", async () => {
  const request = req("/v1/status");
  request.headers.set("X-Rezka-Bridge-Token", "x".repeat(64));
  const response = await handler(request);
  assert.equal(response.status, 401);
});

test("refuses unauthorized upstream paths before accessing session storage", async () => {
  const response = await handler(req("/v1/proxy?url=" +
    encodeURIComponent("https://rezka.fi/admin/")));
  assert.equal(response.status, 403);
});

test("refuses invalid login payload before accessing session storage", async () => {
  const response = await handler(req("/v1/login", "POST", true, "login=&password="));
  assert.equal(response.status, 400);
});

test("rejects cross-origin targets without outgoing fetch", async () => {
  const response = await handler(req("/v1/proxy?url=" +
    encodeURIComponent("https://example.com/favorites/")));
  assert.equal(response.status, 502);
  assert.match((await response.json()).detail, /Upstream changed domain/);
});
