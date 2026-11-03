import test from "node:test";
import assert from "node:assert/strict";
import { __test } from "../netlify/functions/bridge.mjs";

const origin = new URL("https://flymaterez.net/");
const sampleForm = '<html><title>Вход на HDrezka</title>' +
  '<form id="loginForm" action="/ajax/login/">' +
  '<input name="login_name" type="email">' +
  '<input name="login_password" type="password">' +
  '<input name="login_not_save" type="hidden" value="0">' +
  '</form></html>';

test("parses a real mirror's error response instead of generic gateway error", () => {
  const result = __test.loginResponse(JSON.stringify({
    success: false, message: { email: "Введен неверный email или пароль" },
  }), 200);
  assert.equal(result.success, false);
  assert.equal(result.error, "Введен неверный email или пароль");
});

test("submits one POST and does not retry a rejected username/password", async () => {
  const original = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), method: init.method, body: init.body });
      if (init.method === "GET") return new Response(sampleForm);
      return Response.json({ success: false, message: { email: "Неверный пароль" } });
    };
    const result = await __test.loginToMirror("demo@example.org", "not-really-a-password", {}, origin);
    assert.equal(result.authenticated, false);
    assert.equal(result.error, "Неверный пароль");
    const posts = requests.filter(r => r.method === "POST");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://flymaterez.net/ajax/login/");
    assert.equal(new URLSearchParams(posts[0].body).get("login_name"), "demo@example.org");
    assert.equal(new URLSearchParams(posts[0].body).get("login_not_save"), "0");
    assert.equal(new URLSearchParams(posts[0].body).has("login"), false);
  } finally { globalThis.fetch = original; }
});

test("accepts a successful login only when favorites is accessible with session", async () => {
  const original = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), method: init.method });
      if (init.method === "POST") {
        return Response.json({ success: true }, {
          headers: { "Set-Cookie": "dle_user_id=123; Path=/; Secure; HttpOnly" },
        });
      }
      if (String(url).endsWith("/favorites/")) {
        assert.match(init.headers.Cookie, /dle_user_id=123/);
        return new Response('<html><div class="b-favorites_content"></div></html>');
      }
      return new Response(sampleForm);
    };
    const cookieJar = {};
    const result = await __test.loginToMirror("demo@example.org", "example-only", cookieJar, origin);
    assert.equal(result.authenticated, true);
    assert.equal(cookieJar.dle_user_id, "123");
    assert.equal(requests.filter(r => r.method === "POST").length, 1);
  } finally { globalThis.fetch = original; }
});

test("rejects HTML login replies without attempting a second POST", async () => {
  const original = globalThis.fetch;
  let postCount = 0;
  try {
    globalThis.fetch = async (url, init) => {
      if (init.method === "GET") return new Response(sampleForm);
      postCount++;
      return new Response("<html>Blocked</html>", { status: 200 });
    };
    const result = await __test.loginToMirror("demo@example.org", "example-only", {}, origin);
    assert.equal(result.authenticated, false);
    assert.match(result.error, /не JSON/);
    assert.equal(postCount, 1);
  } finally { globalThis.fetch = original; }
});
