import definePlugin from "@utils/types";
import { Devs } from "../../../utils/constants";

/**
 * vermLib sub-plugin: Roblox Rolimons
 * Ultra-reliable version with better dialog detection
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const PLUGIN_NAME = "RobloxRolimons";
const STYLE_ID = "verm-rolimons-styles";
const CARD_CLASS = "verm-rolimons-card";
const ROLIMONS_USER_API = (id: string | number) =>
    `https://api.rolimons.com/players/v1/playerinfo/${id}`;
const ROLIMONS_PLAYER_PAGE = (id: string | number) =>
    `https://www.rolimons.com/player/${id}`;
const CORS_PROXY = "https://api.allorigins.win/get?url=";
const FETCH_TTL_MS = 300000; // 5 min cache

/* --------------------------------- State -------------------------------- */

let mo: MutationObserver | null = null;
const cache = new Map<string, { t: number; data: any | null; err?: string }>();
const processedAnchors = new WeakSet<Element>(); // Track processed Roblox links

/* ------------------------------- Utilities ------------------------------- */

const $ = (root: ParentNode, sel: string): Element | null => {
    try {
        return root.querySelector(sel);
    } catch {
        return null;
    }
};

const $all = (root: ParentNode, sel: string): Element[] => {
    try {
        return Array.from(root.querySelectorAll(sel));
    } catch {
        return [];
    }
};

const escapeHtml = (() => {
    const escapeMap: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    };
    const escapeRegex = /[&<>"']/g;
    return (s: string) => s.replace(escapeRegex, (c) => escapeMap[c]);
})();

const currencyFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
});

const currency = (n: number | null | undefined): string => {
    if (n == null || Number.isNaN(Number(n))) return "Unknown";
    try {
        return currencyFormatter.format(Number(n));
    } catch {
        return String(n);
    }
};

const robloxIdRegex = /roblox\.com\/users\/(\d+)/i;

function getRobloxIdFromLink(anchor: Element): string | null {
    const href =
        (anchor as HTMLAnchorElement).href || anchor.getAttribute("href") || "";
    const match = robloxIdRegex.exec(href);
    return match?.[1] || null;
}

/* ------------------------------ Data Fetching ---------------------------- */

async function fetchRolimonsUser(
    robloxId: string,
): Promise<{ data: any | null; err?: string }> {
    const now = Date.now();
    const cached = cache.get(robloxId);

    if (cached && !cached.err && now - cached.t < FETCH_TTL_MS) {
        return { data: cached.data };
    }

    try {
        const url = `${CORS_PROXY}${encodeURIComponent(ROLIMONS_USER_API(robloxId))}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Vencord-Rolimons/1.0",
                Accept: "application/json",
            },
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
            const msg = `HTTP ${res.status}`;
            cache.set(robloxId, { t: now, data: null, err: msg });
            return { data: null, err: msg };
        }

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

function getOrCreateCard(anchor: Element, robloxId: string): HTMLElement {
    const parent = anchor.parentElement;
    if (!parent) throw new Error("Anchor has no parent");

    // Check if card already exists nearby
    let card = parent.querySelector<HTMLElement>(
        `.${CARD_CLASS}[data-roblox-id='${robloxId}']`,
    );

    if (!card) {
        card = document.createElement("div");
        card.className = CARD_CLASS;
        card.setAttribute("data-roblox-id", robloxId);
        parent.insertAdjacentElement("afterend", card);
    }

    return card;
}

const renderTemplates = {
    loading: (robloxId: string) =>
        `<div class="vr-head"><div class="vr-title"><span class="vr-dot"></span>Rolimons</div><a class="vr-link" href="${ROLIMONS_PLAYER_PAGE(robloxId)}" target="_blank" rel="noreferrer">Open</a></div><div class="vr-note">Loading…</div>`,

    error: (robloxId: string, msg: string) =>
        `<div class="vr-head"><div class="vr-title"><span class="vr-dot"></span>Rolimons</div><a class="vr-link" href="${ROLIMONS_PLAYER_PAGE(robloxId)}" target="_blank" rel="noreferrer">Open</a></div><div class="vr-err">Failed: ${escapeHtml(msg)}</div>`,

    privacy: (robloxId: string) =>
        `<div class="vr-head"><div class="vr-title"><span class="vr-dot"></span>Rolimons</div><a class="vr-link" href="${ROLIMONS_PLAYER_PAGE(robloxId)}" target="_blank" rel="noreferrer">Open</a></div><div class="vr-note">Privacy enabled</div>`,

    data: (robloxId: string, data: any) => {
        const rap = data.rap ?? null;
        const value = data.value ?? null;
        const lastUpdated = data.last_scan ?? data.stats_updated ?? null;
        const username = data.name ?? "Unknown";

        return `
<div class="vr-head"><div class="vr-title"><span class="vr-dot"></span>Rolimons</div><a class="vr-link" href="${ROLIMONS_PLAYER_PAGE(robloxId)}" target="_blank" rel="noreferrer">Open</a></div>
<div class="vr-grid">
<div class="vr-item"><div class="vr-k">User</div><div class="vr-v">${escapeHtml(username)}</div></div>
<div class="vr-item"><div class="vr-k">RAP</div><div class="vr-v">${currency(rap)}</div></div>
<div class="vr-item"><div class="vr-k">Value</div><div class="vr-v">${currency(value)}</div></div>
</div>
${lastUpdated ? `<div class="vr-note">Updated: ${new Date(lastUpdated * 1000).toLocaleString()}</div>` : ""}`;
    },
};

/* ----------------------------- Main workflow ----------------------------- */

async function processRobloxLink(anchor: Element) {
    const robloxId = getRobloxIdFromLink(anchor);
    if (!robloxId) return;

    try {
        const card = getOrCreateCard(anchor, robloxId);
        card.innerHTML = renderTemplates.loading(robloxId);

        const { data, err } = await fetchRolimonsUser(robloxId);

        // Check if anchor still exists in DOM
        if (!anchor.isConnected) return;

        if (err || !data) {
            card.innerHTML = renderTemplates.error(robloxId, err || "No data");
        } else {
            card.innerHTML = data.privacy_enabled
                ? renderTemplates.privacy(robloxId)
                : renderTemplates.data(robloxId, data);
        }
    } catch (e) {
        console.error("[RobloxRolimons] Error processing link:", e);
    }
}

function startObserver() {
    stopObserver();

    mo = new MutationObserver((mutations) => {
        // Look for newly added Roblox links
        for (const m of mutations) {
            if (m.type !== "childList") continue;

            for (const node of Array.from(m.addedNodes)) {
                if (!(node instanceof Element)) continue;

                // Check if this node or its children contain Roblox links
                const links = $all(node, "a[href*='roblox.com/users/']");
                for (const link of links) {
                    if (!processedAnchors.has(link)) {
                        processedAnchors.add(link);
                        processRobloxLink(link);
                    }
                }
            }
        }
    });

    try {
        mo.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    } catch (e) {
        console.error("[RobloxRolimons] Observer setup failed:", e);
    }

    // Initial scan for any existing Roblox links
    const existingLinks = $all(document, "a[href*='roblox.com/users/']");
    for (const link of existingLinks) {
        if (!processedAnchors.has(link)) {
            processedAnchors.add(link);
            processRobloxLink(link);
        }
    }
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
    style.textContent = `.${CARD_CLASS}{--vl-bg:color-mix(in oklab,var(--background-secondary) 92%,black 8%);--vl-border:rgba(255,255,255,.08);--vl-fg:var(--header-primary);--vl-dim:var(--text-muted);background:var(--vl-bg);color:var(--vl-fg);border:1px solid var(--vl-border);border-radius:12px;padding:10px 12px;margin-top:10px;box-shadow:0 1px 6px rgba(0,0,0,.22),0 0 0 1px rgba(0,0,0,.03) inset;animation:verm-rolimons-fade .25s ease-out both}.${CARD_CLASS} .vr-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.${CARD_CLASS} .vr-title{font-weight:700;font-size:14px;display:inline-flex;align-items:center;gap:8px}.${CARD_CLASS} .vr-dot{width:8px;height:8px;border-radius:999px;background:#19A1FF;box-shadow:0 0 10px rgba(25,161,255,.6)}.${CARD_CLASS} .vr-link{font-size:12px;color:var(--brand-500);text-decoration:none}.${CARD_CLASS} .vr-grid{display:grid;grid-template-columns:repeat(2,minmax(90px,1fr));gap:8px}.${CARD_CLASS} .vr-item{background:color-mix(in oklab,var(--vl-bg) 85%,black 15%);border:1px solid var(--vl-border);border-radius:10px;padding:8px}.${CARD_CLASS} .vr-k{font-size:11px;color:var(--vl-dim);margin-bottom:2px}.${CARD_CLASS} .vr-v{font-size:13px;font-weight:600}.${CARD_CLASS} .vr-note{font-size:11px;color:var(--vl-dim);margin-top:6px}.${CARD_CLASS} .vr-err{font-size:12px;color:#ED4245;word-break:break-word}@keyframes verm-rolimons-fade{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:translateY(0)}}`;
    document.head.appendChild(style);
}

function removeStyles() {
    document.getElementById(STYLE_ID)?.remove();
}

/* --------------------------------- Plugin -------------------------------- */

export default definePlugin({
    name: PLUGIN_NAME,
    description: "Shows Rolimons data on Roblox connected accounts.",
    authors: [Devs.Vermin, Devs.Kravle],

    start() {
        injectStyles();
        startObserver();
    },

    stop() {
        stopObserver();
        removeStyles();
        $all(document, `.${CARD_CLASS}`).forEach((el) => el.remove());
        cache.clear();
    },
});
