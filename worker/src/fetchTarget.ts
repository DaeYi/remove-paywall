// Per-site rule lookup and server-side fetch with a chosen header profile.
import rulesData from "../rules.json";

export interface SiteRule {
  profile?: string;
  cookie?: string;          // sent as a Cookie header (e.g. consent / "isBot" cookies)
  userAgent?: string;       // optional UA override
  removeSelectors?: string[]; // CSS selectors stripped before extraction
  archiveFirst?: boolean;   // skip extraction, go straight to archive fallback
}

interface Rules {
  profiles: Record<string, Record<string, string>>;
  default: SiteRule;
  sites: Record<string, SiteRule>;
}

const R = rulesData as unknown as Rules;

// Longest-suffix match: "www.sub.nytimes.com" -> rule for "nytimes.com".
export function ruleFor(hostname: string): SiteRule {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  let best: SiteRule | null = null;
  let bestLen = -1;
  for (const domain of Object.keys(R.sites)) {
    if (host === domain || host.endsWith("." + domain)) {
      if (domain.length > bestLen) {
        best = R.sites[domain];
        bestLen = domain.length;
      }
    }
  }
  return { ...R.default, ...(best ?? {}) };
}

export function headersFor(rule: SiteRule): Record<string, string> {
  const name = rule.profile || R.default.profile || "googlebot";
  const profile = R.profiles[name] || R.profiles["googlebot"] || {};
  const h: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    ...profile,
  };
  if (rule.userAgent) h["User-Agent"] = rule.userAgent;
  if (rule.cookie) h["Cookie"] = rule.cookie;
  return h;
}

export interface FetchResult {
  status: number;
  finalUrl: string;
  contentType: string;
  html: string;
}

export async function fetchTarget(
  url: string,
  rule: SiteRule,
  timeoutMs = 15000,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: headersFor(rule),
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = res.headers.get("content-type") || "";
    const html = await res.text();
    return { status: res.status, finalUrl: res.url || url, contentType, html };
  } finally {
    clearTimeout(timer);
  }
}
