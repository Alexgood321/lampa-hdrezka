const target="https://flymaterez.net/";
const r=await fetch(target,{redirect:"manual",headers:{
  "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  Accept:"text/html,*/*",
},signal:AbortSignal.timeout(16000)});
const body=(await r.text()).slice(0,500000);
function attr(tag,k){
 const m=new RegExp("(?:^|\\s)"+k+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i").exec(tag);
 return m?(m[1]||m[2]||m[3]||"").slice(0,150):"";
}
const forms=[...body.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].slice(0,10).map(x=>({
 id:attr(x[1],"id"),class:attr(x[1],"class"),action:attr(x[1],"action"),method:attr(x[1],"method"),
 inputs:[...x[2].matchAll(/<input\b[^>]*>/gi)].slice(0,30).map(a=>({
 name:attr(a[0],"name"),id:attr(a[0],"id"),type:attr(a[0],"type"),placeholder:attr(a[0],"placeholder")
 })),buttons:[...x[2].matchAll(/<button\b[^>]*>/gi)].map(a=>({type:attr(a[0],"type"),id:attr(a[0],"id")}))
}));
const inputs=[...body.matchAll(/<input\b[^>]*>/gi)].slice(0,20).map(a=>({
 name:attr(a[0],"name"),id:attr(a[0],"id"),type:attr(a[0],"type"),placeholder:attr(a[0],"placeholder")
}));
const scripts=[...body.matchAll(/<script\b[^>]*>/gi)].slice(0,35).map(a=>attr(a[0],"src")).filter(Boolean);
const meta={status:r.status,location:r.headers.get("location"),htmlLength:body.length,title:(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1],forms,inputs,scripts};
console.log("MIRROR_PUBLIC_LOGIN_STRUCTURE:"+JSON.stringify(meta,null,2));


const inlineScripts=[...body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].slice(0,30).filter(x=>!/<script\b[^>]*src\s*=/i.test(x[0])).map(x=>x[1]);
const clues=["loginForm","loginSubmit","login_password","/ajax/login/","csrf","login_not_save","DOMContentLoaded"];
const fragments=[];
for(const code of inlineScripts){
  for(const needle of clues){
    const index=code.indexOf(needle);
    if(index>=0){fragments.push({source:"inline",needle,content:code.slice(Math.max(0,index-500),index+650)});}
  }
}
const scriptURL=new URL("/j/andt.js",target);
const asset=await fetch(scriptURL,{signal:AbortSignal.timeout(16000),headers:{"User-Agent":"Mozilla/5.0"}});
const assetBody=(await asset.text()).slice(0,350000);
const assetFragments=[];
for(const needle of clues){
 const index=assetBody.indexOf(needle);
 if(index>=0)assetFragments.push({needle,content:assetBody.slice(Math.max(0,index-500),index+650)});
}
console.log("LOGIN_SCRIPT_HINTS:"+JSON.stringify({inlineCount:inlineScripts.length,fragments:fragments.slice(0,15),assetStatus:asset.status,assetSize:assetBody.length,assetFragments},null,2));

for(const code of inlineScripts){
 const idx=code.indexOf("function ajaxPost");
 if(idx>=0)console.log("AJAX_CLIENT_SIGNATURE:"+code.slice(idx,idx+1800));
 const ok=code.indexOf("if (result.success)");
 if(ok>=0)console.log("LOGIN_SUCCESS_BRANCH:"+code.slice(ok,ok+1300));
}
const invalidPayload="login_name=netlify-diagnostic-nonexistent%40example.invalid&login_password=invalidtestpassword&login_not_save=0";
const probeResponse=await fetch(new URL("/ajax/login/",target),{
 method:"POST",headers:{
 "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
 "Accept":"application/json,text/plain,*/*",
 "Content-Type":"application/x-www-form-urlencoded; charset=utf-8",
 "X-Requested-With":"XMLHttpRequest",
 "Referer":target,"Origin":new URL(target).origin
 },body:invalidPayload,signal:AbortSignal.timeout(14000),redirect:"manual"
});
const badBody=(await probeResponse.text()).slice(0,1400);
const badCookies=(probeResponse.headers.getSetCookie?.()||[]).map(x=>x.split("=")[0]);
console.log("INVALID_LOGIN_DIAGNOSTIC:"+JSON.stringify({
 status:probeResponse.status,ct:probeResponse.headers.get("content-type"),
 location:probeResponse.headers.get("location"),cookieNames:badCookies,
 body:badBody.replace(/netlify-diagnostic-nonexistent/g,"[TEST]"),
}));
