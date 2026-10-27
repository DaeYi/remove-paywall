// remove-paywall Worker: GET /read?url=<article> with a private token.
// Fetches server-side, extracts readable text, falls back to archives.
import { ruleFor, fetchTarget } from "./fetchTarget";
import { extract } from "./extract";
import { archiveLinks } from "./archive";

export interface Env {
  UNWALL_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
}

const MIN_WORDS = 250;

function cors(env: Env, origin: string | null): Record<string, string> {
  const allow = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let allowOrigin = "*";
  if (allow.length) allowOrigin = origin && allow.includes(origin) ? origin : allow[0];
  else if (origin) allowOrigin = origin;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "X-Unwall-Token, Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  };
}

function json(obj: unknown, status: number, extra: Record<string, string>): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

// Reject requests to internal / private / metadata addresses (SSRF hygiene).
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal"))
    return true;
  if (h === "metadata.google.internal" || h === "metadata") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split(".").map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] >= 224) return true; // multicast / reserved
  }
  if (h.includes(":")) {
    if (h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80"))
      return true;
  }
  return false;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const ch = cors(env, req.headers.get("Origin"));

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });

    if (url.pathname === "/health")
      return json({ ok: true, service: "remove-paywall", time: new Date().toISOString() }, 200, ch);

    if (url.pathname !== "/read") return json({ ok: false, error: "not found" }, 404, ch);

    if (!env.UNWALL_TOKEN)
      return json({ ok: false, error: "server token not configured" }, 500, ch);
    const token = req.headers.get("X-Unwall-Token") || url.searchParams.get("token") || "";
    if (token !== env.UNWALL_TOKEN) return json({ ok: false, error: "unauthorized" }, 401, ch);

    const target = url.searchParams.get("url") || "";
    let tu: URL;
    try {
      tu = new URL(target);
    } catch {
      return json({ ok: false, error: "invalid url" }, 400, ch);
    }
    if (tu.protocol !== "http:" && tu.protocol !== "https:")
      return json({ ok: false, error: "unsupported protocol" }, 400, ch);
    if (isBlockedHost(tu.hostname)) return json({ ok: false, error: "blocked host" }, 400, ch);

    const rule = ruleFor(tu.hostname);

    if (rule.archiveFirst) {
      const archive = await archiveLinks(tu.toString());
      return json({ ok: false, reason: "archive-first", url: tu.toString(), archive }, 200, ch);
    }

    let fr;
    try {
      fr = await fetchTarget(tu.toString(), rule);
    } catch (e: any) {
      const archive = await archiveLinks(tu.toString());
      return json(
        { ok: false, reason: "fetch-failed", detail: String(e?.message || e), url: tu.toString(), archive },
        200,
        ch,
      );
    }

    if (!/text\/html|application\/xhtml/.test(fr.contentType) && fr.html.length < 500)
      return json(
        { ok: false, reason: "non-html", status: fr.status, contentType: fr.contentType, url: tu.toString() },
        200,
        ch,
      );

    const { best, paywalled } = extract(fr.html, fr.finalUrl || tu.toString(), rule.removeSelectors);

    if (best && best.wordCount >= MIN_WORDS)
      return json(
        {
          ok: true,
          source: best.source,
          title: best.title,
          byline: best.byline,
          html: best.html,
          wordCount: best.wordCount,
          url: tu.toString(),
          finalUrl: fr.finalUrl,
          status: fr.status,
        },
        200,
        ch,
      );

    const archive = await archiveLinks(tu.toString());
    return json(
      {
        ok: false,
        reason: fr.status >= 400 ? "blocked" : paywalled ? "paywalled" : "insufficient-text",
        status: fr.status,
        url: tu.toString(),
        finalUrl: fr.finalUrl,
        partial: best
          ? { source: best.source, title: best.title, byline: best.byline, html: best.html, wordCount: best.wordCount }
          : null,
        archive,
      },
      200,
      ch,
    );
  },
};
