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
