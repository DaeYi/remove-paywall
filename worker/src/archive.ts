// Archive fallback: Wayback availability lookup + archive.today links.
export interface ArchiveLinks {
  waybackAvailable: boolean;
  waybackUrl: string | null;
  archiveTodayUrl: string;    // newest snapshot (may 404 if none exists yet)
  archiveTodaySubmit: string; // trigger a fresh capture
}

export async function archiveLinks(url: string): Promise<ArchiveLinks> {
  const archiveTodayUrl = "https://archive.ph/newest/" + url;
  const archiveTodaySubmit = "https://archive.ph/?run=1&url=" + encodeURIComponent(url);
  let waybackAvailable = false;
  let waybackUrl: string | null = null;
  try {
    const r = await fetch(
      "https://archive.org/wayback/available?url=" + encodeURIComponent(url),
      { signal: AbortSignal.timeout(8000) },
    );
    if (r.ok) {
      const j: any = await r.json();
      const snap = j?.archived_snapshots?.closest;
      if (snap?.available && snap.url) {
        waybackAvailable = true;
        waybackUrl = String(snap.url).replace(/^http:/, "https:");
      }
    }
  } catch {
    /* availability API unreachable; still return archive.today links */
  }
  return { waybackAvailable, waybackUrl, archiveTodayUrl, archiveTodaySubmit };
}
