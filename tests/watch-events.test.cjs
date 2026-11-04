'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../rezka.js'),'utf8')
  .replace('    bootstrap();\n})();',
    '    window.__watch_tests={rezkaWatchLaunch,rezkaWatchInstall};\n    bootstrap();\n})();');
function harness(){
  const watchers=[],video={currentTime:0,duration:3600};
  function bus(){
    const subscriptions={};
    return {
      follow(type,fn){(subscriptions[type]??=[]).push(fn);},
      remove(type,fn){subscriptions[type]=(subscriptions[type]||[]).filter(x=>x!==fn);},
      send(type,payload){for(const fn of [...(subscriptions[type]||[])])fn(payload);}
    };
  }
  const playerEvents=bus(),videoEvents=bus();
  const storage={rezka_domain:'https://flymaterez.net/',rezka_bridge_url:'https://site.netlify.app',rezka_bridge_token:'a'.repeat(64)};
  const Lampa={
    Storage:{get:(k,d)=>storage[k]??d,set:(k,v)=>storage[k]=v},
    Listener:{follow(){}},
    Player:{listener:playerEvents},PlayerVideo:{listener:videoEvents,video}
  };
  class XHR {
    open(method,url){this.url=url;this.method=method;}
    setRequestHeader(){}
    send(body){
      watchers.push({method:this.method,url:this.url,body:body&&JSON.parse(body)});
      this.status=200;this.responseText=JSON.stringify({ok:true,saved:true});
      this.onload?.();
    }
    abort(){}
  }
  let clock=1_000_000;
  const date={now:()=>clock};
  const window={appready:false};
  vm.runInNewContext(source,{window,Lampa,console:{log(){}},Date:date,URL,
    XMLHttpRequest:XHR,setTimeout(){}},{timeout:5000});
  return{launch:window.__watch_tests.rezkaWatchLaunch,
    install:window.__watch_tests.rezkaWatchInstall,
    playerEvents,videoEvents,watchers,video,clock:(next)=>{clock=next;}};
}
test('initial launch is saved even when external player has no playback events',()=>{
  const h=harness();h.install();
  h.launch({page_url:'https://flymaterez.net/series/drama/111-lucky.html'},
    {title:'Лаки'}, {id:'40',name:'TVShows'}, {id:'1'},{episode_id:'3'},
    'https://cdn.example/movie.mp4');
  assert.equal(h.watchers.length,1);
  assert.equal(h.watchers[0].body.status,'started');
  assert.equal(h.watchers[0].body.episode,'3');
  assert.equal(h.watchers[0].body.translator,'40');
});
test('Lampa built-in timeupdate writes progress and completed status',()=>{
  const h=harness();h.install();
  h.launch({page_url:'https://flymaterez.net/series/drama/111-lucky.html'},
    {title:'Лаки',rezka_resume_position:129},
    {id:'40',name:'TVShows'},{id:'1'},{episode_id:'3'},
    'https://cdn.example/movie.mp4');
  h.playerEvents.send('start',{url:'https://cdn.example/movie.mp4'});
  h.videoEvents.send('canplay');
  assert.equal(h.video.currentTime,129);
  h.clock(1_022_000);
  h.videoEvents.send('timeupdate',{current:120,duration:3600});
  assert.equal(h.watchers.at(-1).body.status,'progress');
  assert.equal(h.watchers.at(-1).body.position,120);
  h.videoEvents.send('ended');
  assert.equal(h.watchers.at(-1).body.status,'completed');
  h.playerEvents.send('destroy');
});
