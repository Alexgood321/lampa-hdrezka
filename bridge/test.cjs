'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.REZKA_BRIDGE_TOKEN = 'a'.repeat(64);
process.env.REZKA_ORIGIN = 'https://rezka.fi';
const { server, allowedPath, targetURL, gatewayForm, hasFavorites } = require('./server.cjs');

test('only expected read-only content and media endpoints allowed', () => {
    assert.equal(allowedPath('/favorites/', 'GET'), true);
    assert.equal(allowedPath('/favorites/123/', 'GET'), true);
    assert.equal(allowedPath('/favorites/123/page/2/', 'GET'), true);
    assert.equal(allowedPath('/engine/ajax/search.php', 'GET'), true);
    assert.equal(allowedPath('/ajax/get_cdn_series/', 'POST'), true);
    assert.equal(allowedPath('/ajax/favorites/', 'POST'), false);
    assert.equal(allowedPath('/admin/', 'GET'), false);
    assert.equal(allowedPath('/favorites/', 'POST'), false);
});

test('rejects external targets and credentials', () => {
    assert.throws(() => targetURL('https://example.org/favorites/'));
    assert.throws(() => targetURL('http://rezka.fi/favorites/'));
    assert.throws(() => targetURL('https://user:pass@rezka.fi/favorites/'));
    assert.equal(targetURL('/favorites/5/').href, 'https://rezka.fi/favorites/5/');
});

test('parses ordinary first-party gateway login without external targets', () => {
    const html = '<form action="/sign-in" method="POST">' +
        '<input type="hidden" name="_csrf" value="abc123">' +
        '<input name="email" type="email">' +
        '<input name="password" type="password"></form>';
    const form = gatewayForm(html);
    assert.equal(form.url.href, 'https://rezka.fi/sign-in');
    assert.equal(form.usernameField, 'email');
    assert.equal(form.passwordField, 'password');
    assert.equal(form.data.get('_csrf'), 'abc123');
    assert.throws(() => gatewayForm(html.replace('/sign-in', 'https://example.org/')));
});

test('distinguishes favorites page from login/challenge', () => {
    assert.equal(hasFavorites('<div class="b-favorites_content"></div>'), true);
    assert.equal(hasFavorites('<form><input name="password"></form>'), false);
    assert.equal(hasFavorites('Just a moment <div class="b-favorites_content"></div>'), false);
});
// The server is not started when imported by tests.
