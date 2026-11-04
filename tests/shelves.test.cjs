'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const original = fs.readFileSync(path.resolve(__dirname, '../rezka.js'), 'utf8');
const hook = [
  '    window.__shelfTest = {',
  '        register: rezkaShelvesRegister,',
  '        specs: rezkaShelfSpecs,',
  '        category: rezkaShelfFindCategory,',
  '        load: rezkaShelfLoad,',
  '        make: rezkaShelfResult,',
  "        inject: function(kind, handler) {",
  "            if (kind === 'favorites') rezkaShelfFavorites = handler;",
  "            if (kind === 'continue') rezkaShelfContinue = handler;",
  '        },',
  '        setCategories: function(cats) { rezkaShelfCats = cats; },',
  '        clearCache: function() { rezkaShelfCache = {}; }',
  '    };',
  '})();'
].join('\n');
const exposed = original.replace('    bootstrap();\n})();', hook);

function harness(withSurs) {
  const storage = {rezka_domain:'https://flymaterez.net/',
    rezka_bridge_url:'https://preview.netlify.app',
    rezka_bridge_token:'b'.repeat(64)};
  const pushed = [], registered = [];
  const win = {appready:false};
  if (withSurs) win.surs_register_shelf = def => {
    registered.push(def);
    return true;
  };
  const Lampa = {
    Storage:{get:(name,def)=>storage[name]===undefined?def:storage[name],
      set:(name,value)=>{storage[name]=value;}},
    Listener:{follow(){}},
    Activity:{push:p=>pushed.push(p)},
    Maker:{make:(type,data)=>({type,data})},
    Background:{change(){}}
  };
  vm.runInNewContext(exposed, {window:win,Lampa,URL,console:{log(){}},setTimeout(){}},
    {timeout:4000});
  return {hooks:win.__shelfTest,win,registered,pushed,storage};
}
const favoriteEntry = {
  title:'Периферийные устройства',year:'2022',
  url:'https://flymaterez.net/series/fiction/51560-periferiynye-ustroystva-2022.html',
  poster:'https://cdn.example/poster.jpg'
};
test('shelves are opt-in and register with stable IDs through SURS manager',()=>{
  const h=harness(true);
  h.hooks.register();
  assert.deepEqual(Array.from(h.registered,x=>x.id),
    ['hdrezka_watchlist','hdrezka_continue','hdrezka_watched']);
  assert.ok(h.registered.every(x=>x.def===false&&x.cat==='plugin'));
  assert.ok(h.registered.every(x=>typeof x.loader==='function'));
  assert.match(h.registered[0].title,/Буду смотреть/);
  assert.match(h.registered[1].title,/Досмотреть/);
  assert.match(h.registered[2].title,/Просмотрено/);
});

test('shelves are discoverable even when HDRezka loads before SURS',()=>{
  const h=harness(false);
  h.hooks.register();
  assert.deepEqual(Object.keys(h.win.SURS_EXTERNAL_SHELVES).sort(),
    ['hdrezka_continue','hdrezka_watched','hdrezka_watchlist']);
  assert.ok(!h.win.SURS_EXTERNAL_SHELVES.hdrezka_watched.def);
});

test('shelf category IDs are discovered by label, not hardcoded IDs',()=>{
  const h=harness();
  const cats=[
    {id:'901',name:'Общее'},
    {id:'386',name:'Буду смотреть'},
    {id:'48',name:'смотрел'}
  ];
  assert.equal(h.hooks.category(cats,'watchlist'),'386');
  assert.equal(h.hooks.category(cats,'watched'),'48');
  assert.equal(h.hooks.category([{id:'88',name:'Смотреть позже'}],'watchlist'),'88');
  assert.equal(h.hooks.category([],'watchlist'),'');
});

test('watchlist cards use Lampa Maker and open existing HDRezka player',()=>{
  const h=harness(true);
  h.hooks.setCategories([{id:'386',name:'Буду смотреть'}]);
  h.hooks.inject('favorites',(kind,callback)=>callback([favoriteEntry]));
  h.hooks.register();
  let result;
  h.registered[0].loader(x=>{result=x;});
  assert.equal(result.title,'HDRezka · Буду смотреть');
  assert.equal(result.results.length,2);
  const card=result.results[0];
  assert.equal(card.title,'Периферийные устройства');
  assert.equal(card.poster,'https://cdn.example/poster.jpg');
  assert.equal(card.release_date,'2022-01-01');
  assert.equal(card.params.createInstance.call(card).type,'Card');
  card.params.emit.onlyEnter();
  assert.equal(h.pushed.at(-1).component,'rezka_online');
  assert.equal(h.pushed.at(-1).movie.rezka_url,favoriteEntry.url);
  result.results[1].params.emit.onlyEnter();
  assert.equal(h.pushed.at(-1).component,'rezka_favorites');
  assert.equal(h.pushed.at(-1).rezka_category,'386');
});

test('Continue shelf retains saved season, episode, translator, and position',()=>{
  const h=harness(true);
  h.hooks.inject('continue',cb=>cb([{
    title:'Джентльмены',url:'https://flymaterez.net/series/drama/900-the-gentlemen.html',
    poster:'https://cdn.example/gentlemen.jpg',season:'2',episode:'8',
    voice:'Дубляж',translator:'711',position:1257,status:'progress'
  }]));
  h.hooks.register();
  let result;
  h.registered[1].loader(x=>{result=x;});
  assert.equal(result.results.length,2);
  assert.match(result.results[0].overview,/Сезон 2 · Серия 8 · Дубляж/);
  result.results[0].params.emit.onlyEnter();
  const movie=h.pushed.at(-1).movie;
  assert.equal(movie.rezka_resume_season,'2');
  assert.equal(movie.rezka_resume_episode,'8');
  assert.equal(movie.rezka_resume_translator,'711');
  assert.equal(movie.rezka_resume_position,1257);
  result.results[1].params.emit.onlyEnter();
  assert.equal(h.pushed.at(-1).component,'rezka_continue');
});

test('SURS loader caches repeated shelf opens without duplicate requests',()=>{
  const h=harness(true);
  h.hooks.setCategories([{id:'386',name:'Буду смотреть'}]);
  let calls=0;
  h.hooks.inject('favorites',(kind,done)=>{calls++;done([favoriteEntry]);});
  h.hooks.register();
  h.registered[0].loader(()=>{});
  h.registered[0].loader(()=>{});
  assert.equal(calls,1);
});

test('empty account collections do not invent cards or show bogus items',()=>{
  const h=harness(true);
  h.hooks.inject('favorites',(kind,done)=>done([]));
  h.hooks.register();
  let output;
  h.registered[2].loader(data=>{output=data;});
  assert.equal(output.results.length,0);
});
