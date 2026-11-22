/**
 * @module utils/recipeSeoHtml
 *
 * Rewrites the SPA shell's meta tags and JSON-LD for a public recipe page.
 *
 * Recipe titles, descriptions and images are user-authored and the page is
 * served to anyone, so every value is escaped for the place it lands: HTML
 * text/attributes for the meta tags, and `<` as `<` inside the JSON-LD
 * script (a literal `</script>` in a recipe name would otherwise close it).
 * Replacements use functions, not strings, so `$&` / `$1` in recipe text stay literal.
 */
import { escapeHtml } from "./escapeHtml.js";

export interface RecipeSeo {
  title: string;
  description: string;
  image: string;
  url: string;
  /** Output of JSON.stringify; escaped here before it goes into the page. */
  jsonLd: string;
}

export function injectRecipeSeo(shell: string, seo: RecipeSeo): string {
  const title = escapeHtml(seo.title);
  const description = escapeHtml(seo.description);
  const url = escapeHtml(seo.url);
  const image = escapeHtml(seo.image);
  const jsonLd = seo.jsonLd.replace(/</g, "\\u003c");

  const setMeta = (html: string, attr: string, value: string) =>
    html.replace(new RegExp(`(<meta\\s+${attr}\\s+content=")[^"]*"`), (_m, head: string) => `${head}${value}"`);

  let html = shell.replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`);
  html = setMeta(html, 'name="description"', description);
  html = setMeta(html, 'property="og:title"', title);
  html = setMeta(html, 'property="og:description"', description);
  html = setMeta(html, 'property="og:type"', "article");
  html = setMeta(html, 'property="og:url"', url);
  html = setMeta(html, 'name="twitter:card"', "summary_large_image");
  html = setMeta(html, 'name="twitter:title"', title);
  html = setMeta(html, 'name="twitter:description"', description);

  if (image) {
    html = html.replace(
      "</head>",
      () => `  <meta property="og:image" content="${image}" />\n  <meta name="twitter:image" content="${image}" />\n</head>`,
    );
  }

  return html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    () => `<script type="application/ld+json">${jsonLd}</script>`,
  );
}
