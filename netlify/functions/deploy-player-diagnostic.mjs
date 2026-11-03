import { getStore } from "@netlify/blobs";
import { createDecipheriv } from "node:crypto";

// Temporary post-deploy diagnosis. No browser route, passwords or cookies logged.
export default {
  async deploySucceeded() {
    try {
      const raw = Netlify.env.get("REZKA_BRIDGE_KEY") || "";
      if (!/^[0-9a-f]{64}$/i.test(raw)) throw Error("bridge encryption key unavailable");
      const blob = await getStore({ name: "rezka-private-session", consistency:"strong" })
        .get("primary", {type:"json", consistency:"strong"});
      if (!blob || blob.v !== 1) throw Error("stored session missing");
      const decipher=createDecipheriv("aes-256-gcm",Buffer.from(raw,"hex"),Buffer.from(blob.iv,"base64"));
      decipher.setAuthTag(Buffer.from(blob.tag,"base64"));
      const jar=JSON.parse(Buffer.concat([
        decipher.update(Buffer.from(blob.ciphertext,"base64")),decipher.final()
      ]).toString("utf8"));
      const cookie=Object.entries(jar).map(([k,v])=>k+"="+v).join("; ");
      const origin=new URL(Netlify.env.get("REZKA_ORIGIN") || "https://rezka.fi/");
      const route="/series/fiction/51560-periferiynye-ustroystva-2022.html";
      const result=await fetch(new URL(route,origin),{redirect:"manual",
        signal:AbortSignal.timeout(16000),
        headers:{"Accept":"text/html, application/json, */*","Accept-Language":"ru-RU,ru;q=0.9,en;q=0.7",
          "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
          "Referer":origin.href,"Cookie":cookie}});
      const html=(await result.text()).slice(0,400000);
      const title=(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1] || "";
      const facts={
        upstreamStatus:result.status,
        redirectToLogin:/\/login\//.test(result.headers.get("location")||""),
        htmlLength:html.length,
        titleKind:/вход|login|авторизац/i.test(title)?"login":/cloudflare|attention required/i.test(title)?"challenge":"other",
        hasLoginForm:/id=["']loginForm["']|name=["']login_password["']/.test(html),
        hasCdnEvents:/initCDN(?:Series|Movies)Events/.test(html),
        hasCdnInit:/initCDN/i.test(html),
        hasPlayerMarkup:/b-player|b-simple_seasons__list|b-translator__list/.test(html),
        hasPlayerScripts:/get_cdn_series|cdn_series/i.test(html),
        hasIframe:/<iframe\b/i.test(html),
        cookieKeysCount:Object.keys(jar).length
      };
      console.log("HDREZKA_SAFE_PLAYER_DIAGNOSTIC",JSON.stringify(facts));
    } catch (error) {
      console.log("HDREZKA_SAFE_PLAYER_DIAGNOSTIC_ERROR",error instanceof Error ? error.message : "error");
    }
  }
};
