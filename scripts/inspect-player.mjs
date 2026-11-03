const target="https://flymaterez.net/series/fiction/51560-periferiynye-ustroystva-2022.html";
const hdr={"User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",Accept:"text/html,application/xhtml+xml,*/*","Accept-Language":"ru-RU,ru;q=0.9"};
async function check(url){const r=await fetch(url,{redirect:"manual",headers:hdr,signal:AbortSignal.timeout(16000)});
const html=(await r.text()).slice(0,350000);
const signals=["initCDNSeriesEvents","initCDNMoviesEvents","b-simple_seasons__list","b-simple_episodes__list","b-translator__list","b-player","sof =","player","iframe","/login/","loginForm","location.href","window.location","data-id","data-film_id","trailer"];
const counts={};const samples={};
for(const signal of signals){let at=html.indexOf(signal);counts[signal]=at<0?0:html.split(signal).length-1;
if(at>=0)samples[signal]=html.slice(Math.max(0,at-110),at+240).replace(/<[^>]+>/g," ").replace(/\s+/g," ").slice(0,270)}
const meta={status:r.status,finalLocation:r.headers.get("location"),ct:r.headers.get("content-type"),title:(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1],htmlLength:html.length,scriptSrc:[...html.matchAll(/<script\b[^>]*src=['"]([^'"]+)/gi)].slice(0,25).map(m=>m[1]),signals:counts,samples};
console.log("PLAYER_PUBLIC_DIAGNOSTIC:"+JSON.stringify(meta));}
await check(target);
