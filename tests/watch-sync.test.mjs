import test from "node:test";
import assert from "node:assert/strict";
import handler, {__test} from "../netlify/functions/bridge.mjs";

process.env.REZKA_BRIDGE_TOKEN="a".repeat(64);
process.env.REZKA_BRIDGE_KEY="b".repeat(64);
process.env.REZKA_ORIGIN="https://flymaterez.net/";

const base=new URL("https://flymaterez.net/");

test("the real HDRezka /continue/ account history is whitelisted read only",()=>{
  assert.equal(__test.allowedPath("/continue/","GET"),true);
  assert.equal(__test.allowedPath("/continue/page/2/","GET"),true);
  assert.equal(__test.allowedPath("/continue/","POST"),false);
  assert.equal(__test.allowedPath("/admin/","GET"),false);
});

test("viewing record is normalized and allows real episode/translator IDs",()=>{
  const output=__test.normalizedWatch({
    url:"https://flymaterez.net/series/fiction/51560-nocturne.html?from=lampa",
    title:"Ноктюрн",season:"1",episode:"2",translator:"408",
    voice:"TVShows",position:1200,duration:3600,status:"progress"
  },base);
  assert.equal(output.url,"https://flymaterez.net/series/fiction/51560-nocturne.html");
  assert.equal(output.episode,"2");
  assert.equal(output.translator,"408");
  assert.equal(output.position,1200);
  assert.equal(output.voice,"TVShows");
});

test("watch progress rejects external origins, malformed status and impossible timecodes",()=>{
  const rec={
    url:"https://flymaterez.net/series/fiction/51560-nocturne.html",
    title:"Тест",season:"1",episode:"2",translator:"408",status:"started"
  };
  assert.throws(()=>__test.normalizedWatch({...rec,url:"https://evil.example/a"},base),/Upstream/);
  assert.throws(()=>__test.normalizedWatch({...rec,status:"hack"},base),/Invalid playback status/);
  assert.throws(()=>__test.normalizedWatch({...rec,position:-2},base),/Invalid playback position/);
  assert.throws(()=>__test.normalizedWatch({...rec,season:"abc"},base),/Invalid episode/);
});

test("all watch endpoints require the bridge token",async()=>{
  for(const [method,path] of [["GET","/v1/watch/progress"],["POST","/v1/watch/progress"]]){
    const r=await handler(new Request("https://demo.netlify.app"+path,{method}));
    assert.equal(r.status,401);
  }
});

test("invalid watch writes are rejected before hitting storage",async()=>{
  const request=new Request("https://demo.netlify.app/v1/watch/progress",{
    method:"POST",
    headers:{"X-Rezka-Bridge-Token":"a".repeat(64),"Content-Type":"application/json"},
    body:JSON.stringify({url:"https://flymaterez.net/admin/",title:"no",status:"started"})
  });
  const r=await handler(request);
  assert.equal(r.status,400);
});
