'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const original = fs.readFileSync(path.resolve(__dirname, '../rezka.js'), 'utf8');
const source = original.replace(
  '    bootstrap();\n})();',
  '    window.__rezka_test_hooks = { rezkaOpenLampaCard, rezkaParseTranslators };\n    bootstrap();\n})();'
);
assert.notEqual(source, original, 'test helper injection anchor must be available');

function harness(config = {}) {
  const store = {
    rezka_domain: 'https://flymaterez.net/',
    rezka_bridge_url: 'https://bridge.example.net',
    rezka_bridge_token: 'a'.repeat(64),
    rezka_status: 'logged'
  };
  const components = {}, pushes = [], scrolls = [], errors = [], calls = [];
  const w = { appready: true };
  let active = null;

  class Elem {
    constructor(markup = '') { this.markup = markup; this.children = []; this.events = {}; }
    appendTo(root) { root.children.push(this); return this; }
    text(value) { this.content = value; return this; }
    attr() { return this; }
    on(event, callback) { this.events[event] = callback; return this; }
    append(child) { this.children.push(child); return this; }
    empty() { this.children = []; return this; }
    remove() { return this; }
    find() { return { length: 0, text() {} }; }
    querySelectorAll(selector) {
      if (selector === '.b-simple_season__item' && (this.innerHTML || '').includes('b-simple_season__item')) {
        return [{textContent:'Сезон 1',getAttribute:k=>k === 'data-tab_id' ? '1' : null}];
      }
      if (selector === '.b-simple_episode__item' && (this.innerHTML || '').includes('b-simple_episode__item')) {
        return [{textContent:'1 серия',getAttribute:k=>k === 'data-season_id' ? '1' : k === 'data-episode_id' ? '1' : null}];
      }
      return [];
    }
  }
  class XHR {
    constructor() {
      this.status = config.status ?? 200;
      this.responseText = config.response ??
        '<script>initCDNMoviesEvents(123, 456, 0, 0)</script>';
    }
    open(method, url) { calls.push({method,url}); }
    setRequestHeader() {}
    send(body) {
      if (calls.length) calls[calls.length - 1].body=body;
      if (config.failNetwork) this.onerror(); else this.onload();
    }
    abort() {}
  }
  const Lampa = {
    Storage: { get:(k,d)=>store[k]===undefined?d:store[k], set:(k,v)=>store[k]=v },
    SettingsApi: { addComponent(){}, addParam(){} },
    Component: { add(key,ctor){ components[key]=ctor; } },
    Online: { register(){} }, Listener: { follow(){} },
    Menu: { addButton(){} }, Manifest: { plugins:[] },
    Reguest: class { timeout(){} clear(){} },
    Explorer: class {
      appendFiles(){} appendHead(){}
      render(){return {};}
      destroy(){}
    },
    Scroll: class {
      constructor() { this.elements=[];scrolls.push(this); }
      minus(){} render(){return {};}
      append(x){this.elements.push(x)}
      destroy(){}
    },
    Filter: class {
      constructor() { config.filter=this; }
      render(){return {};}
      set(type,values) { this.last={type,values}; }
      destroy(){}
    },
    Controller: {add(){},toggle(){},collectionSet(){},collectionFocus(){},enable(){}},
    Background: {immediately(){}},
    Utils: {cardImgBackgroundBlur(){return '';}},
    Noty: {show(s){errors.push(String(s))}},
    Modal: {open(){},close(){}},
    Player: {play(){},playlist(){}},
    Api: {
      search(params,cb){config.searchQuery=params.query;cb(config.searchAnswer||{});}
    },
    Activity: {
      active(){return {activity:active};},
      push(obj) {
        pushes.push(obj);
        if (!components[obj.component]) return;
        const view = new components[obj.component](obj);
        const activity = { loader(){},toggle(){} };
        view.activity=activity;active=activity;
        view.create();view.start();
        config.view=view;
      }
    }
  };
  const document={
    getElementById(){return {};},
    createElement(){return new Elem('div');},
    head:{appendChild(){}}
  };
  // Minimal inert DOMParser double for representative HDRezka translator HTML.
  class MockDOMParser {
    parseFromString(html) {
      const blocks = [...html.matchAll(/<(ul|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi)];
      const makeList = block => ({
        querySelectorAll() {
          const items=[...block[3].matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)];
          return items.map(m=>({
            textContent:m[2].replace(/<[^>]*>/g,'').replace(/&amp;/g,'&'),
            getAttribute(key) {
              const attr=new RegExp('\\b'+key+'\\s*=\\s*["\\x27]([^"\\x27]*)["\\x27]','i').exec(m[1]);
              return attr?attr[1]:null;
            }
          })).filter(li=>li.getAttribute('data-translator_id'));
        }
      });
      const attrContains = (attributes,prop,value) =>
        new RegExp('\\b'+prop+'\\s*=\\s*["\\x27][^"\\x27]*'+value+'[^"\\x27]*["\\x27]','i').test(attributes);
      return {
        getElementById(id) {
          const block=blocks.find(b=>attrContains(b[2],'id',id));
          return block?makeList(block):null;
        },
        querySelector(selector) {
          const block=blocks.find(b=>attrContains(b[2],'class','b-translator__list'));
          return block?makeList(block):null;
        },
        querySelectorAll(){return []}
      };
    }
  }
  vm.runInNewContext(source, {
    Lampa, window:w, document, $:markup=>new Elem(markup),
    XMLHttpRequest:XHR, URL, Navigator:{}, console:{log(){}},
    setTimeout(){}, DOMParser:MockDOMParser
  }, {timeout:5000});
  return {Lampa,w,components,pushes,scrolls,calls,errors,config};
}

test('watch activity initializes itself once and renders an episode item', ()=>{
  const h=harness();
  h.Lampa.Activity.push({
    title:'HDREZKA – Периферийные устройства',
    component:'rezka_online',
    movie:{title:'Периферийные устройства',rezka_url:'https://flymaterez.net/series/fantasy/the-peripheral/'}
  });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, 'GET');
  assert.match(h.calls[0].url, /^https:\/\/bridge\.example\.net\/v1\/proxy\?/);
  assert.ok(h.scrolls[0].elements.length>0);
  const page=h.scrolls[0].elements[0];
  assert.ok(page.children.length>0,'film entries must be rendered');
  assert.match(page.children[0].markup,/online selector/);
  assert.equal(page.children[0].children[0].content,'Смотреть фильм');
  h.config.view.start();
  assert.equal(h.calls.length,1,'no second request when restoring activity');
});

test('watch activity reports a parse failure, not a blank screen', ()=>{
  const h=harness({response:'<html>Unsupported player</html>'});
  h.Lampa.Activity.push({
    component:'rezka_online',
    movie:{title:'Тест',rezka_url:'https://flymaterez.net/series/fantasy/the-peripheral/'}
  });
  assert.equal(h.calls.length,1);
  assert.ok(h.errors.some(x=>/Не удалось определить ID плеера/.test(x)));
  assert.ok(h.scrolls[0].elements.length>0);
});

test('opens matching Lampa tv card using real Api.search response structure',()=>{
  const h=harness({searchAnswer:{
    movie:{results:[{id:42,title:'Чужой фильм',release_date:'2022-01-01'}]},
    tv:{results:[{id:1234,name:'Периферийные устройства',first_air_date:'2022-10-21'}]}
  }});
  h.w.__rezka_test_hooks.rezkaOpenLampaCard({title:'Периферийные устройства',year:'2022'});
  const pushed=h.pushes[0];
  assert.equal(pushed.component,'full');
  assert.equal(pushed.id,1234);
  assert.equal(pushed.method,'tv');
  assert.equal(pushed.source,'tmdb');
  assert.equal(pushed.url,'tv/1234');
  assert.equal(h.config.searchQuery,encodeURIComponent('Периферийные устройства'));
});

test('never opens unrelated TMDB card as a match',()=>{
  const h=harness({searchAnswer:{
    tv:{results:[{id:987,name:'Другая история',first_air_date:'2022-12-03'}]}
  }});
  h.w.__rezka_test_hooks.rezkaOpenLampaCard({title:'Периферийные устройства',year:'2022'});
  assert.ok(h.pushes.length>=1);
  assert.notEqual(h.pushes[0].component,'full');
});

test('series player accepts modern initializer with numeric flag 2 and class variants',()=>{
  const response='<script>sof.tv.initCDNSeriesEvents(51560, 457, 2, 0, false, "mirror", true, false, {"url":"x"});</script>' +
    '<ul class="b-simple_seasons__list extra"><li class="b-simple_season__item" data-tab_id="1">Сезон 1</li></ul>' +
    '<ul class="extra b-simple_episodes__list"><li class="b-simple_episode__item" data-season_id="1" data-episode_id="1">1 серия</li></ul>';
  const h=harness({response});
  h.Lampa.Activity.push({
    component:'rezka_online',
    movie:{title:'Периферийные устройства',rezka_url:'https://flymaterez.net/series/fiction/51560-periferiynye-ustroystva-2022.html'}
  });
  assert.equal(h.calls.length,1);
  assert.equal(h.errors.length,0,'modern series page must not trigger parse error');
  const page=h.scrolls[0].elements[0];
  assert.equal(page.children.length,1,'one episode is rendered');
  assert.match(page.children[0].markup,/online selector/);
  assert.equal(page.children[0].children[0].content,'1 серия');
  assert.ok(!h.errors.some(e=>/escape/.test(e)),'no dependence on Lampa.Utils.escape');
  assert.ok(h.config.view,'activity must remain usable');
});


test('episode title with untrusted HTML is rendered as text, never parsed into markup',()=>{
  const input='<img src=x onerror=alert(1)>';
  const response='<script>sof.tv.initCDNSeriesEvents(51560, 457, 2, 0, false, "mirror");</script>' +
    '<ul class="b-simple_seasons__list"><li class="b-simple_season__item" data-tab_id="1">1 сезон</li></ul>' +
    '<ul class="b-simple_episodes__list"><li class="b-simple_episode__item" data-season_id="1" data-episode_id="1">' + input + '</li></ul>';
  const h=harness({response});
  h.Lampa.Activity.push({component:'rezka_online',
    movie:{title:'Пример',rezka_url:'https://flymaterez.net/series/fiction/example.html'}});
  const row=h.scrolls[0].elements[0].children[0];
  assert.equal(row.children[0].content,'1 серия');
  assert.ok(!row.markup.includes('onerror'),'row markup must not contain untrusted HTML');
});


test('parses current #translators-list, retains every dubbing ID and selects site default',()=>{
  const html='<script>sof.tv.initCDNSeriesEvents(51560, 702, 2, 0, false, "mirror");</script>' +
    '<ul class="other" id="translators-list">' +
    '<li data-translator_id="701">Дубляж (18+)</li>' +
    '<li data-translator_id="702">HDRezka Studio</li>' +
    '<li data-translator_id="703" data-camrip="0"><span>LostFilm</span></li>' +
    '<li data-translator_id="703">duplicate entry</li>' +
    '</ul>' +
    '<ul class="b-simple_seasons__list"><li class="b-simple_season__item" data-tab_id="1">Сезон 1</li></ul>' +
    '<ul class="b-simple_episodes__list"><li class="b-simple_episode__item" data-season_id="1" data-episode_id="1">Серия 1</li></ul>';
  const h=harness({response:html});
  const direct=h.w.__rezka_test_hooks.rezkaParseTranslators(html,'702','2','0','0');
  assert.equal(direct.length,3);
  assert.equal(direct[0].name,'Дубляж (18+)');
  assert.equal(direct[1].id,'702');
  assert.equal(direct[2].name,'LostFilm');
  h.Lampa.Activity.push({component:'rezka_online',movie:{
    title:'Лаки',rezka_url:'https://flymaterez.net/series/drama/lucky.html'
  }});
  assert.equal(h.errors.length,0);
  assert.equal(h.config.filter.last.type,'filter');
  const selected=h.config.filter.last.values.find(v=>v.stype==='voice');
  assert.equal(selected.items.length,3);
  assert.equal(selected.subtitle,'HDRezka Studio');
  assert.equal(h.scrolls[0].elements[0].children[0].children[1].content,'HDRezka Studio');

  // Change dubbing in Lampa and click an episode. POST must use the selected ID.
  h.config.filter.onSelect('filter',{stype:'voice'},{index:2});
  const item=h.scrolls[0].elements[h.scrolls[0].elements.length-1].children[0];
  assert.equal(item.children[1].content,'LostFilm');
  item.events['hover:enter']();
  const post=h.calls.find(c=>c.method==='POST');
  assert.ok(post,'expected get_cdn_series POST after choosing an episode');
  assert.equal(new URLSearchParams(post.body).get('translator_id'),'703');
  assert.equal(new URLSearchParams(post.body).get('action'),'get_stream');
});

test('legacy b-translator__list is still supported and missing list has safe fallback',()=>{
  const h=harness();
  const parse=h.w.__rezka_test_hooks.rezkaParseTranslators;
  const old='<ul class="b-translator__list"><li class="b-translator__item" data-translator_id="20">TVShows</li></ul>';
  assert.equal(parse(old,'20','0','0','0')[0].name,'TVShows');
  assert.equal(parse('<html></html>','20','0','0','0').length,0);
});


test('Premium dubbing is marked from b-prem_translator and free voices stay unmarked',()=>{
  const html='<script>sof.tv.initCDNSeriesEvents(51560, 702, 2, 0, false, "mirror");</script>' +
    '<ul id="translators-list">' +
    '<li data-translator_id="701" class="b-prem_translator active">HDRezka Studio (18+)</li>' +
    '<li data-translator_id="702" class="active">HDRezka Studio</li>' +
    '<li data-translator_id="703" class="b-prem_translator">Дубляж (18+)</li>' +
    '<li data-translator_id="704">Premium Voice (free tier test)</li>' +
    '</ul>' +
    '<ul class="b-simple_seasons__list"><li class="b-simple_season__item" data-tab_id="1">1 сезон</li></ul>' +
    '<ul class="b-simple_episodes__list"><li class="b-simple_episode__item" data-season_id="1" data-episode_id="1">1 серия</li></ul>';
  const h=harness({response:html});
  const voices=h.w.__rezka_test_hooks.rezkaParseTranslators(html,'702','2','0','0');
  assert.deepEqual(Array.from(voices,v=>v.id),['701','702','703','704']);
  assert.deepEqual(Array.from(voices,v=>v.premium),[true,false,true,false]);
  assert.equal(voices[1].name,'HDRezka Studio','do not relabel original studio name');

  h.Lampa.Activity.push({component:'rezka_online',
    movie:{title:'Ноктюрн',rezka_url:'https://flymaterez.net/series/drama/test.html'}});
  const before=h.config.filter.last.values.find(v=>v.stype==='voice');
  assert.equal(before.subtitle,'HDRezka Studio');
  assert.match(before.items[0].title,/HDRezka Studio \(18\+\).*🔒 Premium/);
  assert.equal(before.items[1].title,'HDRezka Studio');
  assert.match(before.items[2].title,/Дубляж \(18\+\).*🔒 Premium/);
  assert.equal(before.items[3].title,'Premium Voice (free tier test)');
  h.config.filter.onSelect('filter',{stype:'voice'},{index:0});
  const selected=h.config.filter.last.values.find(v=>v.stype==='voice');
  assert.match(selected.subtitle,/🔒 Premium/);
  const ep=h.scrolls[0].elements.at(-1).children[0];
  assert.match(ep.children[1].content,/🔒 Premium/);
  ep.events['hover:enter']();
  const post=h.calls.find(c=>c.method==='POST');
  assert.equal(new URLSearchParams(post.body).get('translator_id'),'701');
});
