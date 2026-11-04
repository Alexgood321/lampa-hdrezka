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
  const controllers = {}, components = {}, settings = {}, calls = [], scrolls = [], explorers = [], alerts = [], selections = [], appended = [];
  let current = null, active = null;

  class Element {
    constructor(markup = '') {
      this.markup = markup; this.children = []; this.events = {}; this.value = ''; this.attrs = {};
    }
    appendTo(target) { target.children.push(this); return this; }
    text(value) { this.value = value; return this; }
    attr(k,v) { this.attrs[k] = v; return this; }
    append(child) { this.children.push(child); return this; }
    on(event, handler) { this.events[event] = handler; return this; }
    remove() { return this; }
    find() { return { text() {}, length: 0 }; }
  }

  class Parser {
    parseFromString(html) {
      const category = /b-favorites_content__cats_list_link/.test(html);
      const hasFilms = /b-content__inline_item/.test(html);
      const second = /data-movie="second"/.test(html);
      const film = {
        querySelector(selector) {
          if (selector === '.b-content__inline_item-link a[href]') {
            return {getAttribute: k => k === 'href' ?
              (second ? '/series/fiction/second-film.html' : '/series/fiction/example-film.html') :
              k === 'title' ? (second ? 'Второй фильм' : 'Периферийные устройства') : null,
              textContent: second ? 'Второй фильм' : 'Периферийные устройства'};
          }
          if (selector === '.b-content__inline_item-cover img')
            return opts.noPoster ? null : {getAttribute: k =>
              k === 'data-src' ? 'https://cdn.example.com/peripheral.jpg' : null};
          if (selector === '.b-content__inline_item-link div') return {textContent: '2022 США'};
          return null;
        }
      };
      return {
        title: '',
        querySelector(selector) {
          if (selector.includes('.b-favorites_content') && /b-favorites_content/.test(html)) return {};
          return null;
        },
        querySelectorAll(selector) {
          if (hasFilms && selector === '.b-content__inline_item') return [film];
          if (selector === '.b-navigation a[href], .b-pagination a[href]' &&
              /data-next="2"/.test(html)) {
            return [{getAttribute:()=>'/favorites/7/page/2/'}];
          }
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
    open(method, url) { this.url=url; calls.push({ method, url }); }
    setRequestHeader() {}
    send() {
      if (opts.pages && /page%2F2%2F/.test(this.url)) {
        this.responseText=opts.pages[2];
        this.status=opts.status2 ?? 200;
      }
      if (opts.networkError) this.onerror(); else this.onload();
    }
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
    Select: { show(x) { selections.push(x); } },
    Scroll: class {
      constructor() { this.added = []; scrolls.push(this); }
      minus() {}
      render() { return {}; }
      append(x) { this.added.push(x); }
      destroy() {}
    },
    Explorer: class {
      constructor(object) { explorers.push({ noinfo: !!(object.params && object.params.noinfo), object }); }
      appendFiles() {}
      render() { return {}; }
      destroy() {}
    },
    Controller: {
      add(name, callbacks) { controllers[name] = callbacks; },
      toggle() {},
      collectionSet() {},
      collectionFocus() {},
      collectionAppend(el) { appended.push(el); }
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
  return { components, settings, scrolls, explorers, calls, alerts, states, selections, appended,
    open() { settings.rezka_open_favorites.onChange(); },
    openCategory() { Lampa.Activity.push({component:'rezka_favorites',
      rezka_category:'7',rezka_page:1}); },
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


test('favorites category uses native Lampa card grid, poster, year and same watch actions',()=>{
  const app = harness({response:'<div class="b-favorites_content"><div class="b-content__inline_item"></div></div>'});
  app.openCategory();
  assert.equal(app.calls.length,1);
  assert.match(app.calls[0].url,/favorites%2F7%2F/);
  const page = app.scrolls[0].added[0];
  const grid=page.children[0];
  assert.match(grid.markup,/rezka-fav-grid/);
  assert.equal(grid.children.length,1);
  const card=grid.children[0];
  assert.match(card.markup,/card selector/);
  assert.match(card.markup,/rezka-fav-card/);
  assert.match(card.children[0].markup,/card__view/);
  assert.equal(card.children[0].children[0].attrs.src,'https://cdn.example.com/peripheral.jpg');
  assert.equal(card.children[1].value,'Периферийные устройства');
  assert.equal(card.children[2].value,'2022');
  card.events['hover:enter']();
  assert.equal(app.selections.length,1);
  assert.deepEqual(Array.from(app.selections[0].items,i=>i.action),['watch','card']);
  app.startAgain();
  assert.equal(app.calls.length,1,'navigation should not reload page');
});
test('favorites card has a visible fallback when poster is missing',()=>{
  const app=harness({noPoster:true,
    response:'<div class="b-favorites_content"><div class="b-content__inline_item"></div></div>'});
  app.openCategory();
  const card=app.scrolls[0].added[0].children[0].children[0];
  assert.match(card.children[0].children[0].markup,/rezka-fav-no-poster/);
  assert.equal(card.children[0].children[0].value,'Нет постера');
  assert.equal(card.children[1].value,'Периферийные устройства');
});
test('Continue screen remains a textual list, never converted into poster cards',()=>{
  const app=harness();
  assert.ok(app.components.rezka_continue,'existing Continue component retained');
  const contents=plugin.substring(plugin.indexOf('function rezkaContinueComponent'),plugin.indexOf('function rezkaFavoritesRegister'));
  assert.match(contents,/online selector rezka-fav-row/);
  assert.doesNotMatch(contents,/posterCard|rezka-fav-grid/);
});


test('HDRezka Favorites and Continue use native full-width Lampa Explorer without sidebar',()=>{
  const app=harness();
  app.open();
  assert.equal(app.explorers[0].noinfo,true,
    'Favorites must enable built-in Explorer noinfo flag');
  const before=app.explorers.length;
  const continueActivity=new app.components.rezka_continue({params:{client_setting:'preserve'}});
  assert.ok(continueActivity);
  assert.equal(app.explorers.length,before+1);
  assert.equal(app.explorers.at(-1).noinfo,true,
    'Continue must enable built-in Explorer noinfo flag');
  assert.equal(app.explorers.at(-1).object.params.client_setting,'preserve',
    'other Explorer params must not be lost');
});

test('favorites automatically append page two inside same grid when scrolling to end',()=>{
  const app=harness({
    response:'<div class="b-favorites_content"><div class="b-content__inline_item"></div><span data-next="2"></span></div>',
    pages:{2:'<div class="b-favorites_content"><div class="b-content__inline_item" data-movie="second"></div></div>'}
  });
  app.openCategory();
  const scroll=app.scrolls[0];
  const grid=scroll.added[0].children[0];
  assert.equal(grid.children.length,1);
  assert.equal(app.calls.length,1);
  assert.equal(typeof scroll.onEnd,'function');
  scroll.onEnd();
  assert.equal(app.calls.length,2,'scrolling requests second page');
  assert.match(app.calls[1].url,/favorites%2F7%2Fpage%2F2%2F/);
  assert.equal(grid.children.length,2,'new cards appended into the original grid');
  assert.equal(grid.children[0].children[1].value,'Периферийные устройства');
  assert.equal(grid.children[1].children[1].value,'Второй фильм');
  assert.equal(app.appended.length,1,'additional card is registered for remote focus');
  assert.equal(app.scrolls.length,1,'activity never navigates to a new page');
  scroll.onEnd();
  assert.equal(app.calls.length,2,'last server page stops further requests');
  assert.ok(!app.alerts.some(x=>/Следующая страница/.test(x)));
});
test('favorites do not load page two before reaching the scroll end',()=>{
  const app=harness({
    response:'<div class="b-favorites_content"><div class="b-content__inline_item"></div><span data-next="2"></span></div>',
    pages:{2:'<div class="b-favorites_content"><div class="b-content__inline_item" data-movie="second"></div></div>'}
  });
  app.openCategory();
  app.startAgain();
  assert.equal(app.calls.length,1);
  assert.equal(app.scrolls[0].added[0].children.length,1);
});
