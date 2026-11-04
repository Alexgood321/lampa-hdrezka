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
  const pushed = [], registered = [], selects = [];
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
    Select:{show:config=>selects.push(config)},
    Controller:{toggle(){}},
    Api:{search:(_query,ok)=>ok({movie:{results:[{id:898,title:'Периферийные устройства',release_date:'2022-05-01'}]},tv:{results:[]}})},
    Maker:{make:(type,data,modules)=>({
      type, data, modules:modules({only:(...items)=>items})
    })},
    Background:{change(){}}
  };
  vm.runInNewContext(exposed, {window:win,Lampa,URL,console:{log(){}},setTimeout(){}},
    {timeout:4000});
  return {hooks:win.__shelfTest,win,registered,pushed,storage,selects};
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

test('watchlist shelf offers HDRezka, Lampa card and torrent results from one poster',()=>{
  const h=harness(true);
  h.hooks.setCategories([{id:'386',name:'Буду смотреть'}]);
  h.hooks.inject('favorites',(kind,callback)=>callback([favoriteEntry]));
  h.hooks.register();
  let result;
  h.registered[0].loader(x=>{result=x;});
  assert.equal(result.title,'HDRezka · Буду смотреть');
  assert.equal(result.results.length,1);
  assert.equal(result.total_pages,2,'native Lampa header More is enabled');
  assert.equal(typeof result.params.emit.onlyMore,'function');
  const card=result.results[0];
  assert.equal(card.title,'Периферийные устройства');
  assert.equal(card.poster,'https://cdn.example/poster.jpg');
  assert.equal(card.release_date,'2022-01-01');
  // Lampa.Utils.createInstance calls createInstance(element), not .call(element).
  const instance=card.params.createInstance(card);
  assert.equal(instance.type,'Card');
  assert.equal(instance.data,card);
  assert.deepEqual(Array.from(instance.modules),['Card','Release','Callback']);
  assert.equal(instance.data.poster,'https://cdn.example/poster.jpg');
  assert.equal(instance.data.title,'Периферийные устройства');
  // The template's {release_year} is handled by the Release module.
  assert.equal(result.results.filter(c=>c.title==='Все →').length,0);
  assert.equal(typeof result.params.emit.onlyMore,'function');
  card.params.emit.onlyEnter();
  assert.equal(h.pushed.length,0,'poster click opens choices, not direct playback');
  assert.equal(h.selects.length,1);
  const menu=h.selects[0];
  assert.equal(menu.title,'Периферийные устройства');
  assert.deepEqual(Array.from(menu.items,x=>x.action),['watch','card','torrents']);
  menu.onSelect({action:'torrents'});
  assert.equal(h.pushed.at(-1).component,'torrents');
  assert.equal(h.pushed.at(-1).from_search,true);
  assert.equal(h.pushed.at(-1).search,'Периферийные устройства 2022');
  menu.onSelect({action:'card'});
  assert.equal(h.pushed.at(-1).component,'full');
  assert.equal(h.pushed.at(-1).id,898);
  menu.onSelect({action:'watch'});
  assert.equal(h.pushed.at(-1).component,'rezka_online');
  assert.equal(h.pushed.at(-1).movie.rezka_url,favoriteEntry.url);
  result.params.emit.onlyMore();
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
  assert.equal(result.results.length,1);
  assert.equal(result.total_pages,2);
  assert.match(result.results[0].overview,/Сезон 2 · Серия 8 · Дубляж/);
  result.results[0].params.emit.onlyEnter();
  const movie=h.pushed.at(-1).movie;
  assert.equal(movie.rezka_resume_season,'2');
  assert.equal(movie.rezka_resume_episode,'8');
  assert.equal(movie.rezka_resume_translator,'711');
  assert.equal(movie.rezka_resume_position,1257);
  result.params.emit.onlyMore();
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

test('all three shelves create full, not empty, Lampa cards',()=>{
  const h=harness(true);
  const categories=[
    {id:'386',name:'Буду смотреть'},
    {id:'48',name:'Смотрел'}
  ];
  h.hooks.setCategories(categories);
  h.hooks.inject('favorites',(kind,cb)=>cb([favoriteEntry]));
  h.hooks.inject('continue',cb=>cb([favoriteEntry]));
  h.hooks.register();
  h.registered.forEach((shelf)=>{
    let output;
    shelf.loader(data=>{output=data;});
    assert.ok(output.results.length>0,shelf.id);
    const movie=output.results[0];
    const instance=movie.params.createInstance(movie);
    assert.equal(instance.data, movie, shelf.id);
    assert.equal(instance.data.title,'Периферийные устройства',shelf.id);
    assert.equal(instance.data.poster,'https://cdn.example/poster.jpg',shelf.id);
    assert.ok(instance.modules.includes('Release'),shelf.id);
  });
});

test('Continue shelf without release year has the Release module to remove placeholder',()=>{
  const h=harness(true);
  h.hooks.inject('continue',cb=>cb([{
    title:'Ноктюрн',
    url:'https://flymaterez.net/series/drama/900-nocturne.html',
    poster:'https://cdn.example/nocturne.jpg'
  }]));
  h.hooks.register();
  let output;
  h.registered[1].loader(data=>{output=data;});
  const entry=output.results[0];
  assert.equal(entry.release_date,'');
  const instance=entry.params.createInstance(entry);
  assert.ok(instance.modules.includes('Release'));
  assert.equal(instance.data.title,'Ноктюрн');
  assert.equal(instance.data.poster,'https://cdn.example/nocturne.jpg');
});

test('native More visibility is disabled for empty HDRezka shelves',()=>{
  const h=harness(true);
  h.hooks.inject('favorites',(kind,done)=>done([]));
  h.hooks.register();
  let result;
  h.registered[0].loader(data=>{result=data;});
  assert.equal(result.results.length,0);
  assert.equal(result.total_pages,1);
});

test('continue and watched shelves preserve direct HDRezka playback',()=>{
  const h=harness(true);
  h.hooks.inject('favorites',(_kind,cb)=>cb([favoriteEntry]));
  h.hooks.inject('continue',cb=>cb([favoriteEntry]));
  h.hooks.register();
  [1,2].forEach(index=>{
    let results;
    h.registered[index].loader(r=>{results=r;});
    results.results[0].params.emit.onlyEnter();
    assert.equal(h.pushed.at(-1).component,'rezka_online');
  });
  assert.equal(h.selects.length,0,'only watchlist introduces selection dialog');
});

test('direct torrent search handles missing release year',()=>{
  const h=harness(true);
  const entry={...favoriteEntry,year:''};
  h.hooks.inject('favorites',(_kind,cb)=>cb([entry]));
  h.hooks.register();
  let result;
  h.registered[0].loader(x=>{result=x;});
  result.results[0].params.emit.onlyEnter();
  h.selects[0].onSelect({action:'torrents'});
  const torrent=h.pushed.at(-1);
  assert.equal(torrent.component,'torrents');
  assert.equal(torrent.search,'Периферийные устройства');
});
