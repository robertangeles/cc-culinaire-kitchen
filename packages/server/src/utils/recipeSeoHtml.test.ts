import { describe, it, expect } from "vitest";
import { injectRecipeSeo } from "./recipeSeoHtml.js";

const SHELL = `<html><head>
<title>CulinAIre Kitchen</title>
<meta name="description" content="x" />
<meta property="og:title" content="x" />
<meta property="og:description" content="x" />
<meta property="og:type" content="website" />
<meta property="og:url" content="x" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="x" />
<meta name="twitter:description" content="x" />
<script type="application/ld+json">{"@type":"Organization"}</script>
</head><body></body></html>`;

const seo = (over: Partial<Parameters<typeof injectRecipeSeo>[1]> = {}) => ({
  title: "Soup | CulinAIre Kitchen",
  description: "Warm",
  image: "",
  url: "https://culinaire.kitchen/kitchen-shelf/soup",
  jsonLd: JSON.stringify({ name: "Soup" }),
  ...over,
});

describe("injectRecipeSeo", () => {
  it("does not let a recipe title close the <title> tag or open a script", () => {
    const html = injectRecipeSeo(SHELL, seo({ title: `</title><script>alert(1)</script>` }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("does not let a description break out of a meta attribute", () => {
    const html = injectRecipeSeo(SHELL, seo({ description: `x" onload="alert(1)` }));
    expect(html).not.toMatch(/content="x" onload=/);
    expect(html).toContain("x&quot; onload=&quot;alert(1)");
  });

  it("does not let an image url break out of the og:image attribute", () => {
    const html = injectRecipeSeo(SHELL, seo({ image: `https://x/a.png" /><script>alert(1)</script>` }));
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("does not let JSON-LD text close its own script element", () => {
    const html = injectRecipeSeo(SHELL, seo({ jsonLd: JSON.stringify({ name: "</script><script>alert(1)</script>" }) }));
    expect(html).not.toContain("<script>alert(1)</script>");
    // still valid JSON for a crawler
    const body = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(body).name).toBe("</script><script>alert(1)</script>");
  });

  it("treats $-sequences in recipe text literally", () => {
    const html = injectRecipeSeo(SHELL, seo({ title: "Cost $& $1 $'", description: "$&" }));
    expect(html).toContain("<title>Cost $&amp; $1 $&#39;</title>");
    expect(html).toContain(`<meta name="description" content="$&amp;"`);
  });
});
