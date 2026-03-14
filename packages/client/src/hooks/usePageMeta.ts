/**
 * @module usePageMeta
 *
 * Custom hook that applies site settings (page title, meta description,
 * robots meta, favicon) to the document head. Runs as a side effect
 * whenever the provided settings object changes.
 */

import { useEffect } from "react";

/**
 * Applies site-wide metadata from settings to the document `<head>`.
 *
 * Supported keys:
 * - `page_title` — sets `document.title`
 * - `meta_description` — sets/creates `<meta name="description">`
 * - `robots_meta` — sets/creates `<meta name="robots">`
 * - `favicon_path` — sets the `<link rel="icon">` href
 *
 * @param settings - Key-value map of site settings.
 */
export function usePageMeta(settings: Record<string, string>) {
  useEffect(() => {
    if (settings.page_title) {
      const separator = settings.title_separator || "|";
      const parts = [settings.page_title, settings.tagline].filter(Boolean);
      document.title = parts.join(` ${separator} `);
    }

    if (settings.meta_description) {
      upsertMeta("description", settings.meta_description);
    }

    if (settings.robots_meta) {
      upsertMeta("robots", settings.robots_meta);
    }

    if (settings.favicon_path) {
      upsertFavicon(settings.favicon_path);
    }

    // Set canonical URL
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = window.location.origin + window.location.pathname;

    // Update OG tags
    if (settings.page_title) {
      upsertMetaProperty("og:title", settings.page_title);
    }
    if (settings.meta_description) {
      upsertMetaProperty("og:description", settings.meta_description);
    }
  }, [settings]);
}

/**
 * Creates or updates a `<meta>` tag with the given name and content.
 */
function upsertMeta(name: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

/**
 * Creates or updates a `<meta>` tag with the given property attribute and content.
 */
function upsertMetaProperty(property: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.content = content;
}

/**
 * Creates or updates the favicon `<link>` tag.
 */
function upsertFavicon(href: string) {
  let el = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!el) {
    el = document.createElement("link");
    el.rel = "icon";
    document.head.appendChild(el);
  }
  el.href = href;
}
