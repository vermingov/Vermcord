import definePlugin from "@utils/types";
import { Devs } from "../../../utils/constants";

/**
 * vermLib sub-plugin: Roblox Rolimons
 *
 * Shows Rolimons data (RAP, Value, etc.) on a user's profile if they have a Roblox Connected Account.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* -------------------------- Tunable constants --------------------------- */

const PLUGIN_NAME = "RobloxRolimons";
const STYLE_ID = "verm-rolimons-styles";
const CARD_CLASS = "verm-rolimons-card";
const CARD_ATTR = "data-verm-rolimons-card";
const CONTAINER_MARK_ATTR = "data-verm-rolimons-bound";

/** Rolimons API endpoint for a Roblox user by id */
const ROLIMONS_USER_API = (robloxId: string | number) =>
    `https://api.rolimons.com/players/v1/playerinfo/${robloxId}`;

/** Rolimons player page link */
const ROLIMONS_PLAYER_PAGE = (robloxId: string | number) =>
    `https://www.rolimons.com/player/${robloxId}`;

/** Optional: CORS proxy to bypass Rolimons restrictions */
const CORS_PROXY = "https://api.allorigins.win/get?url=";

/* --------------------------------- State -------------------------------- */

let mo: MutationObserver | null = null;
const cache = new Map<string, { t: number; data: any | null; err?: string }>();
const FETCH_TTL_MS = 1000 * 60 * 5; // 5 min cache

/* ------------------------------- Utilities ------------------------------- */

function $(root: ParentNode, sel: string): Element | null {
    try {
        return root.querySelector(sel);
    } catch {
        return null;
    }
}
function $all(root: ParentNode, sel: string): Element[] {
    try {
        return Array.from(root.querySelectorAll(sel));
    } catch {
        return [];
    }
}

function escapeHtml(s: string) {
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function currency(n: number | null | undefined): string {
    if (n == null || Number.isNaN(Number(n))) return "Unknown";
    try {
        return new Intl.NumberFormat(undefined, {
            maximumFractionDigits: 0,
        }).format(Number(n));
    } catch {
        return String(n);
    }
}

function findProfileContainersIn(doc: Document | Element): Element[] {
    const dialogs = $all(doc, 'div[role="dialog"]');
    const likelyProfiles: Element[] = [];
    for (const d of dialogs) {
        if ((d as HTMLElement).getAttribute(CONTAINER_MARK_ATTR) === "1") {
            likelyProfiles.push(d);
            continue;
        }
        const hasRobloxLink =
            $all(d, "a[href*='roblox.com/users/']").length > 0;
        const textContent = (d.textContent || "").toLowerCase();
        const hasConnections = textContent.includes("connection");
        if (hasRobloxLink || hasConnections) likelyProfiles.push(d);
    }
    return likelyProfiles;
}

function parseRobloxIdFromContainer(container: Element): string | null {
    const anchors = $all(container, "a[href*='roblox.com/users/']");
    for (const a of anchors) {
        const href =
            (a as HTMLAnchorElement).href || a.getAttribute("href") || "";
        const m = href.match(/roblox\.com\/users\/(\d+)/i);
        if (m?.[1]) return m[1];
    }
    return null;
}

/* ------------------------------ Data Fetching ---------------------------- */

/* ------------------------------ Data Fetching ---------------------------- */

async function fetchRolimonsUser(
    robloxId: string,
): Promise<{ data: any | null; err?: string }> {
    const now = Date.now();
    const cached = cache.get(robloxId);

    if (cached && !cached.err && now - cached.t < FETCH_TTL_MS)
        return { data: cached.data };

    try {
        // Use AllOrigins proxy to bypass CORS
        const url = `https://api.allorigins.win/get?url=${encodeURIComponent(
            ROLIMONS_USER_API(robloxId),
        )}`;

        const res = await fetch(url, {
            headers: {
                "User-Agent": "Vencord-Rolimons/1.0",
                Accept: "application/json",
            },
        });

        if (!res.ok) {
            const msg = `HTTP ${res.status}`;
            cache.set(robloxId, { t: now, data: null, err: msg });
            return { data: null, err: msg };
        }

        // AllOrigins wraps the actual API response in "contents"
        const wrapper = await res.json();
        const json = JSON.parse(wrapper.contents);

        cache.set(robloxId, { t: now, data: json });
        return { data: json };
    } catch (e: any) {
        const msg = e?.message || "Network error";
        cache.set(robloxId, { t: now, data: null, err: msg });
        return { data: null, err: msg };
    }
}

/* ------------------------------ Rendering UI ----------------------------- */

function ensureCard(container: Element, robloxId: string): HTMLElement {
    let slotParent: Element | null = null;
    const robloxAnchor = $(container, "a[href*='roblox.com/users/']");
    if (robloxAnchor) {
        let p: Element | null = robloxAnchor;
        for (let i = 0; i < 6 && p; i++) {
            p = p.parentElement;
            if (p && p.children.length >= 1) slotParent = p;
        }
    }
    if (!slotParent) slotParent = container;
    let card = slotParent.querySelector<HTMLElement>(
        `.${CARD_CLASS}[${CARD_ATTR}='${robloxId}']`,
    );
    if (!card) {
        card = document.createElement("div");
        card.className = CARD_CLASS;
        card.setAttribute(CARD_ATTR, robloxId);
        if (robloxAnchor?.parentElement) robloxAnchor.parentElement.after(card);
        else slotParent.appendChild(card);
    }
    return card;
}

function renderLoading(card: HTMLElement, robloxId: string) {
    card.innerHTML = `
    <div class="vr-head">
      <div class="vr-title"><span class="vr-dot"></span>Rolimons</div>
      <a class="vr-link" href="${ROLIMONS_PLAYER_PAGE(robloxId)}" target="_blank" rel="noreferrer">Open on Rolimons</a>
    </div>
    <div class="vr-note">Loading Rolimons data…</div>`;
}

function renderError(card: HTMLElement, robloxId: string, msg: string) {
    card.innerHTML = `
    <div class="vr-head">
      <div class="vr-title"><span class="vr-dot"></span>Rolimons</div>
      <a class="vr-link" href="${ROLIMONS_PLAYER_PAGE(robloxId)}" target="_blank" rel="noreferrer">Open on Rolimons</a>
    </div>
    <div class="vr-err">Failed to load: ${escapeHtml(msg)}</div>`;
}

function renderData(card: HTMLElement, robloxId: string, raw: any) {
    // The actual Rolimons user data is inside raw.contents (if coming directly from proxy)
    const root = raw; // Already parsed in fetchRolimonsUser

    // Extract fields safely
    const rap = root.rap ?? null;
    const value = root.value ?? null;
    const lastUpdated = root.last_scan ?? root.stats_updated ?? null;
    const privacyEnabled = root.privacy_enabled ?? false;
    const username = root.name ?? "Unknown";

    // Build inner HTML
    if (privacyEnabled) {
        card.innerHTML = `
        <div class="vr-head">
          <div class="vr-title"><span class="vr-dot"></span>Rolimons</div>
          <a class="vr-link" href="${ROLIMONS_PLAYER_PAGE(
              robloxId,
          )}" target="_blank" rel="noreferrer">Open on Rolimons</a>
        </div>
        <div class="vr-note">User has privacy enabled. Data is not publicly available.</div>
      `;
        return;
    }

    card.innerHTML = `
    <div class="vr-head">
      <div class="vr-title"><span class="vr-dot"></span>Rolimons</div>
      <a class="vr-link" href="${ROLIMONS_PLAYER_PAGE(
          robloxId,
      )}" target="_blank" rel="noreferrer">Open on Rolimons</a>
    </div>
    <div class="vr-grid">
      <div class="vr-item"><div class="vr-k">Username</div><div class="vr-v">${escapeHtml(
          username,
      )}</div></div>
      <div class="vr-item"><div class="vr-k">RAP</div><div class="vr-v">${
          rap !== null ? currency(rap) : "Unknown"
      }</div></div>
      <div class="vr-item"><div class="vr-k">Value</div><div class="vr-v">${
          value !== null ? currency(value) : "Unknown"
      }</div></div>
    </div>
    ${
        lastUpdated
            ? `<div class="vr-note">Last updated: ${new Date(
                  lastUpdated * 1000,
              ).toLocaleString()}</div>`
            : ""
    }
  `;
}

/* ----------------------------- Main workflow ----------------------------- */

async function handleProfileContainer(container: Element) {
    const el = container as HTMLElement;
    const mark = el.getAttribute(CONTAINER_MARK_ATTR);
    if (mark === "1" || mark === "w") return;
    el.setAttribute(CONTAINER_MARK_ATTR, "w");

    const robloxId = await waitForRobloxId(container, 40, 150); // wait up to ~6s for the Roblox link
    if (!robloxId) {
        // Allow future attempts when content finishes loading later
        el.removeAttribute(CONTAINER_MARK_ATTR);
        return;
    }

    // Mark as fully handled
    el.setAttribute(CONTAINER_MARK_ATTR, "1");

    const card = ensureCard(container, robloxId);
    renderLoading(card, robloxId);

    const { data, err } = await fetchRolimonsUser(robloxId);
    if (err || !data) return renderError(card, robloxId, err || "No data");
    renderData(card, robloxId, data);
}

// Retry helper: waits for the Roblox link to appear
async function waitForRobloxId(
    container: Element,
    attempts: number,
    intervalMs: number,
): Promise<string | null> {
    for (let i = 0; i < attempts; i++) {
        const id = parseRobloxIdFromContainer(container);
        if (id) return id;
        await new Promise((res) => setTimeout(res, intervalMs));
    }
    return null;
}

function startObserver() {
    stopObserver();

    const processContainers = (root: ParentNode) => {
        const containers = findProfileContainersIn(root);
        for (const c of containers) handleProfileContainer(c);
    };

    mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type !== "childList") continue;
            for (const n of Array.from(m.addedNodes)) {
                if (!(n instanceof Element)) continue;
                processContainers(n);
                // Also handle cases where the dialog already exists and children get added later
                let p: Element | null = n;
                for (let i = 0; i < 8 && p; i++) {
                    if (
                        p instanceof Element &&
                        (p as Element).matches &&
                        (p as Element).matches('div[role="dialog"]')
                    ) {
                        handleProfileContainer(p);
                        break;
                    }
                    p = p.parentElement;
                }
            }
        }
    });

    try {
        mo.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    } catch {}

    // Initial scan
    processContainers(document);
}

function stopObserver() {
    try {
        mo?.disconnect();
    } catch {}
    mo = null;
}

/* ------------------------------ Styles ----------------------------- */

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.${CARD_CLASS} {
  --vl-bg: color-mix(in oklab, var(--background-secondary) 92%, black 8%);
  --vl-border: rgba(255,255,255,.08);
  --vl-fg: var(--header-primary);
  --vl-dim: var(--text-muted);
  background: var(--vl-bg);
  color: var(--vl-fg);
  border: 1px solid var(--vl-border);
  border-radius: 12px;
  padding: 10px 12px;
  margin-top: 10px;
  box-shadow: 0 1px 6px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.03) inset;
  animation: verm-rolimons-fade .25s ease-out both;
}
@keyframes verm-rolimons-fade {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}
.${CARD_CLASS} .vr-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.${CARD_CLASS} .vr-title { font-weight: 700; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; }
.${CARD_CLASS} .vr-title .vr-dot { width: 8px; height: 8px; border-radius: 999px; background: #19A1FF; box-shadow: 0 0 10px rgba(25,161,255,.6); }
.${CARD_CLASS} .vr-link { font-size: 12px; color: var(--brand-500); text-decoration: none; }
.${CARD_CLASS} .vr-grid { display: grid; grid-template-columns: repeat(2, minmax(90px, 1fr)); gap: 8px; }
.${CARD_CLASS} .vr-item { background: color-mix(in oklab, var(--vl-bg) 85%, black 15%); border: 1px solid var(--vl-border); border-radius: 10px; padding: 8px; }
.${CARD_CLASS} .vr-k { font-size: 11px; color: var(--vl-dim); margin-bottom: 2px; }
.${CARD_CLASS} .vr-v { font-size: 13px; font-weight: 600; }
.${CARD_CLASS} .vr-note { font-size: 11px; color: var(--vl-dim); margin-top: 6px; }
.${CARD_CLASS} .vr-err { font-size: 12px; color: #ED4245; word-break: break-word; }
`;
    document.head.appendChild(style);
}

function removeStyles() {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
}

/* --------------------------------- Plugin -------------------------------- */

export default definePlugin({
    name: PLUGIN_NAME,
    description:
        "Shows Rolimons data (RAP, Value, etc.) on a user's profile when they have a Roblox connection.",
    authors: [Devs.Vermin, Devs.Kravle],
    start() {
        injectStyles();
        startObserver();
    },
    stop() {
        stopObserver();
        removeStyles();
        for (const el of document.querySelectorAll(`.${CARD_CLASS}`))
            el.remove();
    },
});
