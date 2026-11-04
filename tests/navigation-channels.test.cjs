'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'rezka.js'), 'utf8');
const hook = [
  '    window.__navTest = {',
  '        items: rezkaNavItems,',
  '        register: rezkaNavRegister,',
  '        settings: rezkaChannelsSettingsRegister,',
  '        openCollection: rezkaNavOpenCollection,',
  '        setCategories: function(cats) { rezkaShelfCats = cats; },',
  '        readHidden: rezkaNavHidden',
  '    };',
  '})();'
].join('\n');
assert.ok(source.includes('    bootstrap();\n})();'),
  'test instrumentation must replace exactly the bootstrap call');
const code = source.replace('    bootstrap();\n})();', hook);

function harness({hasChannels=true, staticChannels=false, hidden=[], initialized=false}={}) {
  const storage = {
    menu_hide: hidden.slice(),
    menu_sort: ['Главная','История','Избранное HDRezka','Досмотреть HDRezka'],
    hdrezka_nav_defaults_v1: initialized
  };
  const menus = [], params = [], pushed = [], notices = [];
  const listeners = [];
  const Lampa = {
    Storage: {
      get(k, d) {
        if (k in storage) return storage[k];
        if (d === '[]') return [];
        return d;
      },
      set(k, value, silent) {
        storage[k]=value;
        if (!silent) listeners.forEach(fn=>fn({name:k,value}));
      },
      listener: {follow(name, fn) {if(name==='change')listeners.push(fn);}}
    },
    Menu: {addButton(icon, title, open) {
      const button={icon,title,open,hidden:false,toggleClass(name,value) {
        if(name === 'hidden') this.hidden=!!value;
        return this;
      }};
      menus.push(button);
      return button;
    }},
    SettingsApi: {
      getComponent(name) {return hasChannels && name === 'channels' ? {component:name} : null;},
      addParam(x) {params.push(x);}
    },
    Template: {get(name) {
      if(name!=='settings_main') return null;
      return {find(q) {return {length:staticChannels && q==='[data-component="channels"]' ? 1 : 0};}};
    }},
    Activity: {push(value) {pushed.push(value);}},
    Noty: {show(value) {notices.push(value);}}
  };
  const win={};
  vm.runInNewContext(code,{
    window:win,Lampa,URL,Date,
    console:{log(){}},setTimeout(){},
  },{timeout:4000});
  return {nav:win.__navTest,storage,menus,params,pushed,notices,Lampa};
}

test('five menu links register once, preserving old names and enabling only old two',()=>{
  const h=harness();
  h.nav.register();
  assert.deepEqual(h.menus.map(i=>i.title),[
    'Избранное HDRezka','Буду смотреть HDRezka',
    'Просмотрено HDRezka','Досмотреть HDRezka','Новинки HDRezka']);
  assert.deepEqual(h.menus.map(i=>i.hidden),[false,true,true,false,true]);
  assert.equal(h.storage.hdrezka_nav_defaults_v1,true);
  assert.deepEqual(h.storage.menu_sort,
    ['Главная','История','Избранное HDRezka','Досмотреть HDRezka']);
  h.nav.register();
  assert.equal(h.menus.length,5);
});

test('Channels settings exposes five HDRezka toggles and controls sidebar',()=>{
  const h=harness();
  h.nav.register();
  h.nav.settings();
  const toggles=h.params.filter(x=>x.param.type==='trigger');
  assert.equal(toggles.length,5);
  assert.ok(h.params.every(x=>x.component==='channels'));
  assert.deepEqual(toggles.map(x=>x.param.name),[
    'hdrezka_nav_favorites','hdrezka_nav_watchlist','hdrezka_nav_watched',
    'hdrezka_nav_continue','hdrezka_nav_newest']);
  assert.equal(h.storage.hdrezka_nav_watchlist,false);
  toggles[1].onChange('true');
  assert.equal(h.storage.menu_hide.includes('Буду смотреть HDRezka'),false);
  assert.equal(h.menus[1].hidden,false);
  assert.equal(h.storage.hdrezka_nav_watchlist,true);
  toggles[3].onChange('false');
  assert.equal(h.storage.menu_hide.includes('Досмотреть HDRezka'),true);
  assert.equal(h.menus[3].hidden,true);
});

test('native sidebar editor writes are mirrored to Channels switches',()=>{
  const h=harness();
  h.nav.register();
  h.nav.settings();
  h.Lampa.Storage.set('menu_hide',['Избранное HDRezka','Просмотрено HDRezka']);
  assert.equal(h.storage.hdrezka_nav_favorites,false);
  assert.equal(h.storage.hdrezka_nav_continue,true);
  assert.equal(h.storage.hdrezka_nav_watched,false);
  assert.equal(h.storage.hdrezka_nav_watchlist,true);
});

test('user-hidden old buttons survive plugin updates, no forced reset',()=>{
  const h=harness({hidden:['Досмотреть HDRezka'],initialized:true});
  h.nav.register();
  assert.equal(h.menus.find(x=>x.title==='Досмотреть HDRezka').hidden,true);
  assert.equal(h.menus.find(x=>x.title==='Буду смотреть HDRezka').hidden,false);
  assert.deepEqual(h.storage.menu_hide,['Досмотреть HDRezka']);
});

test('unsupported Channels settings falls back to normal HDRezka settings',()=>{
  const h=harness({hasChannels:false,staticChannels:false});
  h.nav.register();
  h.nav.settings();
  assert.ok(h.params.every(p=>p.component==='rezka'));
});

test('static Channels folder in newer Lampa builds is recognized',()=>{
  const h=harness({hasChannels:false,staticChannels:true});
  h.nav.register();
  h.nav.settings();
  assert.ok(h.params.every(p=>p.component==='channels'));
});

test('sidebar links open actual HDRezka destinations and account-specific collections',()=>{
  const h=harness();
  h.nav.register();
  h.nav.setCategories([
    {id:'386',name:'Буду смотреть'},
    {id:'48',name:'Смотрел'}
  ]);
  h.menus[0].open();
  assert.equal(h.pushed.at(-1).component,'rezka_favorites');
  assert.equal(h.pushed.at(-1).rezka_category,'');
  h.menus[1].open();
  assert.equal(h.pushed.at(-1).rezka_category,'386');
  h.menus[2].open();
  assert.equal(h.pushed.at(-1).rezka_category,'48');
  h.menus[3].open();
  assert.equal(h.pushed.at(-1).component,'rezka_continue');
  h.menus[4].open();
  assert.equal(h.pushed.at(-1).component,'rezka_newest');
});

test('nav plugin does not affect SURS shelf registrations or sync endpoints',()=>{
  assert.match(source,/rezkaShelvesRegister\(\);/);
  assert.match(source,/rezkaWatchInstall\(\);/);
  assert.match(source,/rezkaChannelsSettingsRegister\(\);/);
  assert.match(source,/function rezkaNavOpenCollection/);
});
