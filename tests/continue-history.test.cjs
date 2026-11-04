'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../rezka.js'),'utf8')
  .replace('    bootstrap();\n})();',
    '    window.__continue_tests={rezkaParseContinue,rezkaContinueHints};\n    bootstrap();\n})();');
function harness(){
  const window={appready:false};
  const Lampa={Listener:{follow(){}},Storage:{get:(k,d)=>k==='rezka_domain'?'https://flymaterez.net/':d}};
  class DOMParser{
    parseFromString(html){
      const found=html.includes('b-videosaves__list_item');
      const title='Ноктюрн';
      const link={
        getAttribute(k){return k==='href'?'/series/drama/123-nocturne.html':
          k==='data-cover_url'?'https://cdn.example.com/poster.jpg':null;},
        cloneNode(){
          const copy={textContent:title+' (2026)',querySelector(sel){
            return sel==='small'?{remove(){copy.textContent=title;}}:null;
          }};
          return copy;
        }
      };
      const row={querySelector(selector){
        if(selector==='.td.title a[href]')return link;
        if(selector==='.td.info')return{
          textContent:'1 сезон 2 серия (TVShows) смотреть ещё 6 серий',
          querySelector(){return{textContent:'смотреть ещё 6 серий'}}
        };
        if(selector==='.td.date')return{textContent:'сегодня'};
        if(selector==='.td.title small')return{textContent:'2026, США'};
        return null;
      }};
      return{querySelectorAll(selector){
        return found&&selector==='.b-videosaves__list_item[id^="videosave"]'?[row]:[];
      },querySelector(){return null;}};
    }
  }
  vm.runInNewContext(source,{window,Lampa,DOMParser,URL,setTimeout(){},console:{log(){}}},{timeout:5000});
  return window.__continue_tests;
}
test('HDRezka /continue/ entries are parsed with titles, URL and last episode',()=>{
 const methods=harness();
 const html='<div class="b-videosaves__list_item" id="videosave1"></div>';
 const result=methods.rezkaParseContinue(html);
 assert.equal(result.items.length,1);
 const first=result.items[0];
 assert.equal(first.title,'Ноктюрн');
 assert.equal(first.url,'https://flymaterez.net/series/drama/123-nocturne.html');
 assert.equal(first.poster,'https://cdn.example.com/poster.jpg');
 assert.equal(first.date,'сегодня');
 assert.match(first.info,/1 сезон 2 серия/);
 const hints=methods.rezkaContinueHints(first.info);
 assert.equal(hints.season,'1');
 assert.equal(hints.episode,'2');
 const nested=methods.rezkaContinueHints('1 сезон 8 серия (HDRezka Studio (18+))');
 assert.equal(nested.season,'1');
 assert.equal(nested.episode,'8');
 assert.equal(nested.voice,'HDRezka Studio (18+)');
});
test('empty HDRezka history is represented as empty list, not fake entries',()=>{
 const result=harness().rezkaParseContinue('<div class="b-videosaves"></div>');
 assert.equal(result.items.length,0);
 assert.equal(result.error,'');
});
