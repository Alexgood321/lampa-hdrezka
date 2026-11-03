import { getStore } from "@netlify/blobs";
import { createDecipheriv } from "node:crypto";

// Temporary public diagnosis endpoint: only boolean, media-agnostic parser facts.
// No credentials, cookies, media title, URL or HTML ever leave the server.
export const config = { path: "/__rezka_parser_probe", method: "GET" };
export default async function handler() {
  const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Robots-Tag":"noindex"};
  try{
    const raw=Netlify.env.get("REZKA_BRIDGE_KEY")||"";
    if(!/^[a-f0-9]{64}$/i.test(raw))throw Error("key missing");
    const store=getStore({name:"rezka-private-session",consistency:"strong"});
    const blob=await store.get("primary",{type:"json",consistency:"strong"});
    if(!blob || blob.v!==1)throw Error("session missing");
    const decipher=createDecipheriv("aes-256-gcm",Buffer.from(raw,"hex"),Buffer.from(blob.iv,"base64"));
    decipher.setAuthTag(Buffer.from(blob.tag,"base64"));
    const cookies=JSON.parse(Buffer.concat([decipher.update(Buffer.from(blob.ciphertext,"base64")),decipher.final()]).toString("utf8"));
    const origin=new URL(Netlify.env.get("REZKA_ORIGIN")||"https://rezka.fi/");
    const target=new URL("/series/fiction/51560-periferiynye-ustroystva-2022.html",origin);
    if(target.origin!==origin.origin||origin.protocol!=="https:")throw Error("invalid origin");
    const response=await fetch(target,{redirect:"manual",signal:AbortSignal.timeout(15000),headers:{
      Accept:"text/html,application/xhtml+xml,*/*",
      "Accept-Language":"ru-RU,ru;q=0.9,en;q=0.7",
      "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
      Referer:origin.href,
      Cookie:Object.entries(cookies).map(([k,v])=>k+"="+v).join("; ")
    }});
    const html=(await response.text()).slice(0,350000);
    const title=(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"";
    const clues={
      loginForm:/id=["']loginForm["']|name=["']login_password["']/.test(html),
      isLoginTitle:/вход|login|авторизац/i.test(title),
      isCloudflare:/just a moment|checking your browser|cf-challenge/.test(html),
      initCDNSeriesEvents:html.includes("initCDNSeriesEvents"),
      initCDNMoviesEvents:html.includes("initCDNMoviesEvents"),
      initCDNGeneric:/initCDN/i.test(html),
      exactPluginRegex:/initCDN(?:Series|Movies)Events\(\s*(\d+)\s*,\s*(\d+)\s*,\s*([01])\s*,\s*([01])\s*(?:,\s*([01]))?/.test(html),
      simplifiedInitRegex:/initCDN(?:Series|Movies)Events\s*\(\s*(\d+)\s*,\s*(\d+)/.test(html),
      getCdnSeries:html.includes("get_cdn_series"),
      bPlayer:/b-player/.test(html),
      translatorList:/b-translator__list/.test(html),
      seasonsList:/b-simple_seasons__list/.test(html),
      iframe:/<iframe\b/i.test(html),
      videoTag:/<video\b/i.test(html),
      scriptsCount:(html.match(/<script\b/g)||[]).length,
      externalScriptCount:(html.match(/<script\b[^>]*src=/g)||[]).length,
      dataMovieId:/data-(?:movie|film|player)_?id/.test(html)
    };
    const initializers=[...html.matchAll(/initCDN(?:Series|Movies)Events\s*\(([^)]{0,350})\)/g)].slice(0,5).map(m=>{
      const rawArgs=m[1].split(",").map(x=>x.trim());
      const kinds=rawArgs.map(x=>/^\d+$/.test(x)?"number":
        /^(?:true|false|null|undefined)$/.test(x)?x:
        /^['"]/.test(x)?"string":/^\d+\s*[+\-*/]/.test(x)?"expression":"other");
      return {count:rawArgs.length,kinds,legacyRegexMatch:/^\s*\d+\s*,\s*\d+\s*,\s*[01]\s*,\s*[01]/.test(m[1])};
    });
    const mask=txt=>txt.replace(/\p{L}/gu,"L").replace(/\d/g,"0");
    const contextMasks=[];
    let cursor=0;
    while(contextMasks.length<4){
      const at=html.indexOf("initCDNSeriesEvents",cursor);
      if(at<0)break;
      contextMasks.push({
        prefix:mask(html.slice(Math.max(0,at-90),at)),
        suffix:mask(html.slice(at+"initCDNSeriesEvents".length,at+"initCDNSeriesEvents".length+260))
      });
      cursor=at+19;
    }
    // No cookie names/values, title, page body, URL, or media metadata in response.
    return new Response(JSON.stringify({
      httpStatus:response.status,
      redirectsToLogin:/\/login[/?#]|\/logout[/?#]/.test(response.headers.get("location")||""),
      htmlSizeBucket:html.length<25000?"small":html.length<150000?"medium":"large",clues,initializers,contextMasks
    }),{headers});
  }catch(err){
    return new Response(JSON.stringify({diagnosticError:err?.name||"Error"}),{status:502,headers});
  }
}
