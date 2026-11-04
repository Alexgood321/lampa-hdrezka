'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const original = fs.readFileSync(path.resolve(__dirname, '../rezka.js'), 'utf8');
const exposed = original.replace(
  '    bootstrap();\n})();',
  '    window.__qualityTest = { parsePlaylist, choose: rezkaChooseFreeQuality, getStream };\n})();'
);
assert.notEqual(original, exposed, 'the quality test injection anchor must exist');

function harness(payload) {
  const storage = {
    rezka_domain: 'https://flymaterez.net/',
    rezka_bridge_url: 'https://private-bridge.example.net',
    rezka_bridge_token: 'a'.repeat(64)
  };
  const calls = [];
  class XHR {
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    send(body) {
      calls.push({ method: this.method, url: this.url, body });
      this.status = 200;
      this.responseText = JSON.stringify(payload);
      this.onload();
    }
  }
  const window = {appready:false};
  const Lampa = {
    Storage: {get:(k,d)=>storage[k]===undefined?d:storage[k]}
  };
  vm.runInNewContext(exposed, {
    window, Lampa, URL, XMLHttpRequest: XHR,
    console:{log(){}}, setTimeout(){}, Date
  }, {timeout:5000});
  function stream({series=false}={}) {
    let data, error;
    window.__qualityTest.getStream(
      {film_id:'915',is_series:series,favs:'0'},
      {id:'702',name:'HDRezka Studio'},
      series ? {id:'1'} : null,
      series ? {episode_id:'8'} : null,
      value => {data=value;},
      value => {error=value;}
    );
    return {data,error,request:calls[calls.length-1]};
  }
  return {stream,choose:window.__qualityTest.choose,parse:window.__qualityTest.parsePlaylist};
}

test('highest free quality wins regardless of playlist order; premium excluded from menu',()=>{
  const h=harness({
    success:true,premium_content:true,
    url:'[720p]https://cdn.test/720.mp4,[1080p Ultra]https://cdn.test/ultra.mp4,'+
        '[480p]https://cdn.test/480.mp4,[1080p]https://cdn.test/1080.mp4,'+
        '[2160p]https://cdn.test/2160.mp4',
    subtitle:''
  });
  const {data,error,request}=h.stream();
  assert.equal(error,undefined);
  assert.equal(data.file,'https://cdn.test/1080.mp4');
  assert.deepEqual(Object.keys(data.quality),['720p','480p','1080p']);
  assert.equal(data.quality['720p'],'https://cdn.test/720.mp4');
  assert.equal(request.method,'POST');
  assert.equal(new URLSearchParams(request.body).get('translator_id'),'702');
  assert.equal(new URLSearchParams(request.body).get('action'),'get_movie');
});

test('720p is selected when 1080p is only available as Ultra/Premium',()=>{
  const h=harness({success:true,url:
    '[1080p Ultra]https://cdn.test/ultra.mp4,'+
    '[720p]https://cdn.test/720.mp4,'+
    '[1080p Premium]https://cdn.test/paid.mp4,'+
    '[480p]https://cdn.test/480.mp4'});
  const {data,error,request}=h.stream({series:true});
  assert.equal(error,undefined);
  assert.equal(data.file,'https://cdn.test/720.mp4');
  assert.deepEqual(Object.keys(data.quality),['720p','480p']);
  assert.equal(new URLSearchParams(request.body).get('action'),'get_stream');
  assert.equal(new URLSearchParams(request.body).get('season'),'1');
  assert.equal(new URLSearchParams(request.body).get('episode'),'8');
});

test('do not play or expose paid-only quality when all returned variants are premium',()=>{
  const h=harness({success:true,url:
    '[4K]https://cdn.test/4k.mp4,'+
    '[1080p Ultra]https://cdn.test/ultra.mp4,'+
    '[1080p Premium]https://cdn.test/premium.mp4'});
  const {data,error}=h.stream();
  assert.equal(data,undefined);
  assert.match(error,/Нет доступного бесплатного качества/);
});

test('the available 480p stream is selected even when higher resolutions are paid',()=>{
  const h=harness({success:true,url:
    '[1440p]https://cdn.test/1440.mp4,'+
    '[480p]https://cdn.test/480.mp4,'+
    '[1080p Ultra]https://cdn.test/ultra.mp4'});
  const {data,error}=h.stream();
  assert.equal(error,undefined);
  assert.equal(data.file,'https://cdn.test/480.mp4');
  assert.deepEqual(Object.keys(data.quality),['480p']);
});

test('duplicate-quality CDN mirror fallback is preserved, unknown nonpremium quality remains fallback',()=>{
  const h=harness({success:true,url:
    '[HD]https://cdn.test/hd.mp4,'+
    '[720p]https://cdn1.test/720.mp4 or https://cdn2.test/720.mp4'});
  const {data,error}=h.stream();
  assert.equal(error,undefined);
  assert.equal(data.file,'https://cdn2.test/720.mp4');
  assert.equal(data.quality['720p'],'https://cdn2.test/720.mp4');
  assert.equal(data.quality.HD,'https://cdn.test/hd.mp4');
  const fallback=h.choose(h.parse('[HD]https://cdn.test/hd.mp4'));
  assert.equal(fallback.file,'https://cdn.test/hd.mp4');
});

test('missing or invalid playback URLs never get selected',()=>{
  const h=harness({success:true,url:
    '[1080p Ultra]https://cdn.test/premium.mp4,'+
    '[720p]not-a-url,'+
    '[480p]https://cdn.test/480.mp4'});
  const {data,error}=h.stream();
  assert.equal(error,undefined);
  assert.equal(data.file,'https://cdn.test/480.mp4');
  assert.deepEqual(Object.keys(data.quality),['480p']);
});
