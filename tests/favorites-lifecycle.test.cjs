'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const plugin = fs.readFileSync(path.resolve(__dirname, '../rezka.js'), 'utf8');

function harness(opts = {}) {
  const states = {
    rezka_domain: 'https://flymaterez.net/',
    rezka_bridge_url: 'https://bridge.test',
    rezka_bridge_token: 'a'.repeat(64),
    rezka_status: 'logged'
  };
  const controllers = {}, components = {}, settings = {}, calls = [], scrolls = [], alerts = [];
  let current = null, active = null;

  class Element {
    constructor(markup = '') {
      this.markup = markup; this.children = []; this.events = {}; this.value = '';
    }
    appendTo(target) { target.children.push(this); return this; }
    text(value) { this.value = value; return this; }
    attr() { return this; }
    append(child) { this.children.push(child); return this; }
    on(event, handler) { this.events[event] = handler; return this; }
    remove() { return this; }
    find() { return { text() {}, length: 0 }; }
  }

  class Parser {
    parseFromString(html) {
      const category = /b-favorites_content__cats_list_link/.test(html);
      return {
        title: '',
        querySelector(selector) {
          if (selector.includes('.b-favorites_content') && /b-favorites_content/.test(html)) return {};
          return null;
        },
        querySelectorAll(selector) {
          if (category && selector === 'a.b-favorites_content__cats_list_link') {
            return [{
              getAttribute: () => '/favorites/7/',
              querySelector: () => null,
              textContent: 'Мои фильмы'
            }];
          }
          return [];
        }
      };
    }
  }

  class XHR {
    constructor() {
      this.status = opts.status ?? 200;
      this.responseText = opts.response ??
        '<div class="b-favorites_content"><a class="b-favorites_content__cats_list_link" href="/favorites/7/">Мои фильмы</a></div>';
    }
    open(method, url) { calls.push({ method, url }); }
    setRequestHeader() {}
    send() { if (opts.networkError) this.onerror(); else this.onload(); }
    abort() {}
  }

  const Lampa = {
    Storage: {
      get: (k, d) => states[k] === undefined ? d : states[k],
      set: (k, v) => { states[k] = v; }
    },
    Component: { add(k, ctor) { components[k] = ctor; } },
    SettingsApi: { addComponent() {}, addParam(x) { settings[x.param.name] = x; } },
    Reguest: class { timeout() {} },
    Manifest: { plugins: [] },
    Listener: { follow() {} },
    Online: { register() {} },
    Menu: { addButton() {} },
    Noty: { show(msg) { alerts.push(msg); } },
    Scroll: class {
      constructor() { this.added = []; scrolls.push(this); }
      minus() {}
      render() { return {}; }
      append(x) { this.added.push(x); }
      destroy() {}
    },
    Explorer: class {
      appendFiles() {}
      render() { return {}; }
      destroy() {}
    },
    Controller: {
      add(name, callbacks) { controllers[name] = callbacks; },
      toggle() {},
      collectionSet() {},
      collectionFocus() {}
    },
    Activity: {
      active() { return { activity: active }; },
      push(obj) {
        current = new components[obj.component](obj);
        current.activity = { loader() {}, toggle() {} };
        active = current.activity;
        current.create();
        current.start();
      }
    }
  };
  const document = { getElementById: () => ({}), createElement: () => ({}), head: { appendChild() {} } };
  vm.runInNewContext(plugin, {
    window: { appready: true }, document, Lampa, $: value => new Element(value),
    DOMParser: Parser, XMLHttpRequest: XHR, URL, Navigator: {},
    console: { log() {} }, setTimeout() {}
  }, { timeout: 5000 });
  return { components, settings, scrolls, calls, alerts, states,
    open() { settings.rezka_open_favorites.onChange(); },
    startAgain() { current.start(); },
    get current() { return current; }
  };
}

test('favorites activity requests and renders collections on first start', () => {
  const app = harness();
  app.open();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].method, 'GET');
  assert.match(app.calls[0].url, /\/v1\/proxy\?url=https%3A%2F%2Fflymaterez\.net%2Ffavorites%2F/);
  assert.equal(app.scrolls.length, 1);
  const page = app.scrolls[0].added[0];
  assert.ok(page, 'favorites content appended to scroll');
  assert.equal(page.children.length, 1);
  assert.equal(page.children[0].children[0].children[0].value, 'Мои фильмы');
  app.startAgain();
  assert.equal(app.calls.length, 1, 're-entering the activity must not fetch twice');
});

test('favorites request failure is visible, not a blank screen', () => {
  const app = harness({ status: 502, response: JSON.stringify({error:'Ошибка шлюза'}) });
  app.open();
  assert.equal(app.calls.length, 1);
  assert.ok(app.scrolls[0].added.length, 'error content appended');
  assert.ok(app.alerts.some(s => String(s).includes('Ошибка шлюза')));
});

test('favorites parser failure is visible, not a blank screen', () => {
  const app = harness({ response: '<html><title>Login</title></html>' });
  app.open();
  assert.ok(app.alerts.some(s => String(s).includes('Не удалось подтвердить')));
});
