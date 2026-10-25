// Extraction cascade: Readability -> JSON-LD articleBody -> embedded JSON.
// Returns the richest candidate plus a paywall hint. All returned HTML is sanitized.
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

export interface Extracted {
  source: "readability" | "jsonld" | "embedded";
  title: string;
  byline: string;
  html: string;
  text: string;
  wordCount: number;
}

const MIN_WORDS = 250;

function wc(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Remove scripts/handlers and absolutize URLs in an extracted HTML fragment.
function sanitize(fragmentHtml: string, baseUrl: string): string {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${fragmentHtml}</body></html>`);
  const body = document.body;
  body
    .querySelectorAll("script,style,iframe,noscript,form,link,meta,object,embed,svg")
    .forEach((n: any) => n.remove());
  body.querySelectorAll("*").forEach((el: any) => {
    for (const attr of Array.from(el.attributes) as any[]) {
      if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
    }
    for (const a of ["href", "src"]) {
      const v = el.getAttribute?.(a);
      if (!v) continue;
      if (/^\s*javascript:/i.test(v)) {
        el.removeAttribute(a);
        continue;
      }
      try {
        el.setAttribute(a, new URL(v, baseUrl).toString());
      } catch {
        /* leave as-is */
      }
    }
    const srcset = el.getAttribute?.("srcset");
    if (srcset) {
      try {
        el.setAttribute(
          "srcset",
          srcset
            .split(",")
            .map((part: string) => {
              const seg = part.trim().split(/\s+/);
              if (seg[0]) {
                try {
                  seg[0] = new URL(seg[0], baseUrl).toString();
                } catch {
                  /* keep */
                }
              }
              return seg.join(" ");
            })
            .join(", "),
        );
      } catch {
        /* keep */
      }
    }
  });
  return body.innerHTML;
}

function detectPaywall(html: string): boolean {
  const h = html.toLowerCase();
  if (/["']?isaccessibleforfree["']?\s*:\s*(false|"false"|no)/i.test(html)) return true;
  const markers = [
    "subscribe to continue",
    "subscribe to read",
    "already a subscriber",
    "create a free account to continue",
    "this content is for subscribers",
    "to continue reading",
    "piano.io",
    "tinypass",
    "poool",
    "zephr",
    "blaize",
    "pelcro",
    "sophi.io",
  ];
  return markers.some((m) => h.includes(m));
}

function tryReadability(
  html: string,
  baseUrl: string,
  removeSelectors?: string[],
): Extracted | null {
  try {
    const { document } = parseHTML(html);
    if (removeSelectors) {
      for (const sel of removeSelectors) {
        try {
          document.querySelectorAll(sel).forEach((n: any) => n.remove());
        } catch {
          /* bad selector, ignore */
        }
      }
    }
    const art = new Readability(document as any, { charThreshold: 200 }).parse();
    if (!art || !art.content) return null;
    const text = (art.textContent || "").trim();
    return {
      source: "readability",
      title: (art.title || "").trim(),
      byline: (art.byline || "").trim(),
      html: sanitize(art.content, baseUrl),
      text,
      wordCount: wc(text),
    };
  } catch {
    return null;
  }
}

function tryJsonLd(html: string): Extracted | null {
  const { document } = parseHTML(html);
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  let best: { it: any; body: string } | null = null;
  for (const s of Array.from(scripts) as any[]) {
    let data: any;
    try {
      data = JSON.parse(s.textContent || "");
    } catch {
      continue;
    }
    const items = Array.isArray(data)
      ? data
      : data && data["@graph"]
        ? data["@graph"]
        : [data];
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      const type = it["@type"];
      const isArticle =
        typeof type === "string"
          ? /Article|NewsArticle|Report|BlogPosting/i.test(type)
          : Array.isArray(type)
            ? type.some((t: string) => /Article|NewsArticle|BlogPosting/i.test(t))
            : false;
      const body = it.articleBody || it.text;
      if (isArticle && typeof body === "string" && body.length > (best?.body.length ?? 0)) {
        best = { it, body };
      }
    }
  }
  if (!best) return null;
  const paras = String(best.body)
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const htmlBody = (paras.length ? paras : [String(best.body)])
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n");
  const author = best.it.author;
  const byline = Array.isArray(author)
    ? author.map((a: any) => a?.name || a).filter(Boolean).join(", ")
    : author?.name || (typeof author === "string" ? author : "");
  const text = String(best.body);
  return {
    source: "jsonld",
    title: String(best.it.headline || best.it.name || "").trim(),
    byline: String(byline || "").trim(),
    html: htmlBody,
    text,
    wordCount: wc(text),
  };
}

function harvest(node: any, acc: string[], depth = 0): void {
  if (depth > 14 || node == null || acc.length > 600) return;
  if (Array.isArray(node)) {
    for (const x of node) harvest(x, acc, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  // Arc Publishing "content_elements" style blocks.
  if (
    typeof node.type === "string" &&
    (node.type === "text" || node.type === "paragraph") &&
    typeof node.content === "string"
  ) {
    acc.push(node.content);
  }
  for (const k of ["articleBody", "body", "bodyText", "body_html", "bodyHtml"]) {
    if (typeof node[k] === "string" && node[k].length > 200) acc.push(node[k]);
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") harvest(v, acc, depth + 1);
  }
}

function tryEmbedded(html: string): Extracted | null {
  const { document } = parseHTML(html);
  const acc: string[] = [];
  for (const s of Array.from(document.querySelectorAll("script")) as any[]) {
    const txt = s.textContent || "";
    if (!/articleBody|content_elements|__NEXT_DATA__|PRELOADED_STATE|globalContent/.test(txt))
      continue;
    let jsonText = txt;
    if (s.getAttribute?.("id") !== "__NEXT_DATA__") {
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) jsonText = m[0];
    }
    try {
      harvest(JSON.parse(jsonText), acc);
    } catch {
      /* not valid JSON */
    }
    if (acc.length > 400) break;
  }
  const seen = new Set<string>();
  const paras = acc
    .map((p) => stripTags(p))
    .filter((p) => {
      if (p.length < 40) return false;
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });
  if (!paras.length) return null;
  const text = paras.join("\n\n");
  return {
    source: "embedded",
    title: "",
    byline: "",
    html: paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n"),
    text,
    wordCount: wc(text),
  };
}

export function extract(
  html: string,
  baseUrl: string,
  removeSelectors?: string[],
): { best: Extracted | null; paywalled: boolean } {
  const paywalled = detectPaywall(html);
  const candidates: Extracted[] = [];
  const rb = tryReadability(html, baseUrl, removeSelectors);
  if (rb) candidates.push(rb);
  const jl = tryJsonLd(html);
  if (jl) candidates.push(jl);
  const em = tryEmbedded(html);
  if (em) candidates.push(em);
  if (!candidates.length) return { best: null, paywalled };

  candidates.sort((a, b) => b.wordCount - a.wordCount);
  let best = candidates[0];
  // Prefer Readability's cleaner HTML when it is reasonably complete.
  if (rb && rb.wordCount >= MIN_WORDS && rb.wordCount >= best.wordCount * 0.6) best = rb;
  // Fill a missing title/byline from Readability if a JSON source won.
  if (rb && best.source !== "readability") {
    if (!best.title) best = { ...best, title: rb.title };
    if (!best.byline) best = { ...best, byline: rb.byline };
  }
  return { best, paywalled };
}
