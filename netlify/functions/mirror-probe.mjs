// Temporary public-only form structure diagnostic, no cookies or credentials.
// Delete after identifying the mirror's actual login implementation.
export default async function handler(request) {
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const configured = Netlify.env.get("REZKA_ORIGIN") || "";
  let base;
  try { base = new URL(configured); } catch { return Response.json({ error: "Invalid origin" }, {status:500}); }
  if (base.protocol !== "https:") return Response.json({ error: "Origin must be HTTPS" }, {status:500});
  try {
    const response = await fetch(base.href, {redirect:"manual",signal:AbortSignal.timeout(12000),headers:{
      Accept:"text/html", "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15"
    }});
    const html = (await response.text()).slice(0, 300000);
    const tagAttr=(tag,name)=>{const m=new RegExp("(?:^|\\s)"+name+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i").exec(tag);
      return m?(m[1]||m[2]||m[3]||"").slice(0,100):"";};
    const forms=[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].slice(0,5).map(m=>({
      action:tagAttr(m[1],"action"),method:tagAttr(m[1],"method"),id:tagAttr(m[1],"id"),
      inputs:[...m[2].matchAll(/<input\b[^>]*>/gi)].slice(0,12).map(x=>({
        name:tagAttr(x[0],"name"),type:tagAttr(x[0],"type"),id:tagAttr(x[0],"id"),
        placeholder:tagAttr(x[0],"placeholder")
      })),buttons:[...m[2].matchAll(/<button\b[^>]*>/gi)].slice(0,4).map(x=>({
        type:tagAttr(x[0],"type"),id:tagAttr(x[0],"id"),name:tagAttr(x[0],"name")
      }))
    }));
    const standaloneInputs=[...html.matchAll(/<input\b[^>]*>/gi)].slice(0,20).map(x=>({
      name:tagAttr(x[0],"name"),type:tagAttr(x[0],"type"),id:tagAttr(x[0],"id"),
      placeholder:tagAttr(x[0],"placeholder")
    }));
    const scripts=[...html.matchAll(/<script\b[^>]*>/gi)].slice(0,20).map(x=>tagAttr(x[0],"src")).filter(Boolean);
    const body=JSON.stringify({upstreamStatus:response.status,location:response.headers.get("location")?.slice(0,200)||null,
      title:(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]?.slice(0,100)||null,
      htmlLength:html.length,forms,standaloneInputs,scripts});
    return new Response(body,{status:200,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  } catch(e) {return Response.json({error:String(e).slice(0,160)},{status:502});}
}
