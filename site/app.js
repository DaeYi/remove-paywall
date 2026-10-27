// remove-paywall frontend. Talks to the Worker; renders a reader view or archive fallback.
"use strict";
const $ = (s) => document.querySelector(s);

const store = {
  get worker() { return (localStorage.getItem("rp_worker") || "").trim(); },
  set worker(v) { localStorage.setItem("rp_worker", (v || "").trim().replace(/\/+$/, "")); },
  get token() { return (localStorage.getItem("rp_token") || "").trim(); },
  set token(v) { localStorage.setItem("rp_token", (v || "").trim()); },
  get theme() { return localStorage.getItem("rp_theme") || ""; },
  set theme(v) { localStorage.setItem("rp_theme", v); },
};

// ---- theme -------------------------------------------------------------
function applyTheme() {
  if (store.theme) document.documentElement.dataset.theme = store.theme;
  else delete document.documentElement.dataset.theme;
}
function toggleTheme() {
  const dark = store.theme ? store.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  store.theme = dark ? "light" : "dark";
  applyTheme();
}
applyTheme();

// ---- one-time setup via query (?worker=&token=) + share_target --------
const params = new URLSearchParams(location.search);
if (params.get("worker")) store.worker = params.get("worker");
if (params.get("token")) store.token = params.get("token");
function urlFromParams() {
  for (const k of ["url", "text", "title"]) {
    const v = params.get(k);
    if (!v) continue;
    const m = v.match(/https?:\/\/[^\s]+/);
    if (m) return m[0];
  }
  return "";
}
const incomingUrl = urlFromParams();
// strip sensitive/setup params from the address bar
if (["worker", "token", "text", "title"].some((k) => params.has(k))) {
  const u = new URL(location.href);
  ["worker", "token", "text", "title"].forEach((k) => u.searchParams.delete(k));
  history.replaceState({}, "", u);
}

// ---- status / view helpers --------------------------------------------
function setStatus(msg) {
  const el = $("#status");
  el.textContent = msg || "";
  el.hidden = !msg;
}
function hide(...sel) { sel.forEach((s) => ($(s).hidden = true)); }
function setBusy(b) {
  $("#readBtn").disabled = b;
  $("#readBtn").textContent = b ? "…" : "Read";
}

// ---- rendering ---------------------------------------------------------
function renderArticle(d) {
  hide("#fallback", "#intro");
  $("#srcBadge").textContent = d.source || "reader";
  $("#origLink").href = d.url || "#";
  $("#artTitle").textContent = d.title || "(untitled)";
  const by = $("#artByline");
  by.textContent = d.byline || "";
  by.hidden = !d.byline;
  $("#artBody").innerHTML = d.html || "";
  $("#article").hidden = false;
  setStatus(`${d.wordCount || 0} words · via ${d.source}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function archiveButtons(archive, target) {
  const links = [];
  if (archive) {
    if (archive.waybackAvailable && archive.waybackUrl)
      links.push(["Wayback snapshot", archive.waybackUrl, ""]);
    if (archive.archiveTodayUrl) links.push(["archive.today", archive.archiveTodayUrl, "secondary"]);
    if (archive.archiveTodaySubmit) links.push(["Archive it now", archive.archiveTodaySubmit, "secondary"]);
  }
  links.push(["Open original", target, "secondary"]);
  return links
    .map(([t, href, cls]) => `<a class="${cls}" href="${href}" target="_blank" rel="noopener">${t}</a>`)
    .join("");
}

const REASONS = {
  "archive-first": "This site uses a hard paywall, so we go straight to an archived copy.",
  blocked: "This site blocked the server’s request — full articles are served only to logged-in or verified browsers. Try an archived copy below.",
  paywalled: "This looks paywalled and the full text wasn’t in the page. Try an archived copy.",
  "insufficient-text": "Couldn’t pull enough readable text (often a page that loads its body with JavaScript). Try an archived copy.",
  "fetch-failed": "The site blocked or dropped the request. Try an archived copy.",
  "non-html": "That URL didn’t return an article page.",
};

function renderFallback(d, target) {
  hide("#article", "#intro");
  $("#fbTitle").textContent = d.ok === false && d.partial ? "Partial text only" : "Couldn’t extract this one";
  $("#fbMsg").textContent = (REASONS[d.reason] || "Couldn’t extract this one.") + (d.status ? ` (HTTP ${d.status})` : "");
  $("#fbLinks").innerHTML = archiveButtons(d.archive, target);
  const p = $("#fbPartial");
  if (d.partial && d.partial.html) {
    p.innerHTML = `<p class="tiny muted">What we could read:</p><h1 style="font-size:1.4rem">${d.partial.title || ""}</h1><div class="article-body">${d.partial.html}</div>`;
    p.hidden = false;
  } else {
    p.hidden = true;
  }
  $("#fallback").hidden = false;
  setStatus("");
}

// ---- main read ---------------------------------------------------------
async function read(target) {
  target = (target || "").trim();
  if (!target) return;
  if (!/^https?:\/\//i.test(target)) target = "https://" + target;
  if (!store.worker || !store.token) {
    openSettings();
    setStatus("Set your Worker URL and token first (⚙).");
    return;
  }
  hide("#article", "#fallback", "#intro");
  setBusy(true);
  setStatus("Fetching…");
  try {
    const res = await fetch(store.worker + "/read?url=" + encodeURIComponent(target), {
      headers: { "X-Unwall-Token": store.token },
    });
    if (res.status === 401) {
      setStatus("Unauthorized — check your access token (⚙).");
      openSettings();
      return;
    }
    const data = await res.json();
    if (data.ok) renderArticle(data);
    else renderFallback(data, target);
  } catch (e) {
    setStatus("Request failed: " + e.message + ". Check the Worker URL is correct and deployed.");
  } finally {
    setBusy(false);
  }
}

// ---- settings ----------------------------------------------------------
function buildBookmarklet() {
  const wrap = $("#bookmarkletWrap");
  if (!store.worker) { wrap.hidden = true; return; }
  const code =
    "javascript:(function(){location.href=" +
    JSON.stringify(location.origin + location.pathname + "?url=") +
    "+encodeURIComponent(location.href);})()";
  $("#bookmarklet").setAttribute("href", code);
  wrap.hidden = false;
}
function openSettings() {
  $("#setWorker").value = store.worker;
  $("#setToken").value = store.token;
  buildBookmarklet();
  $("#settings").showModal();
}

// ---- wire up -----------------------------------------------------------
$("#readForm").addEventListener("submit", (e) => { e.preventDefault(); read($("#urlInput").value); });
$("#settingsBtn").addEventListener("click", openSettings);
$("#themeBtn").addEventListener("click", toggleTheme);
$("#settingsForm").addEventListener("submit", () => {
  store.worker = $("#setWorker").value;
  store.token = $("#setToken").value;
  setStatus("Settings saved.");
});

if (incomingUrl) {
  $("#urlInput").value = incomingUrl;
  read(incomingUrl);
}

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
