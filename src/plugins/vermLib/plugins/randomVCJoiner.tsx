/*
 * Vencord, a Discord client mod
 * vermLib sub-plugin: Random VC Joiner
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Adds a small button next to the Inbox button (top-right toolbar)
 * that, when clicked, joins a random accessible voice/stage channel
 * across all joined servers.
 */

import { findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    FluxDispatcher,
    GuildChannelStore,
    GuildStore,
    PermissionStore,
    PermissionsBits,
    Toasts,
    VoiceStateStore,
    showToast,
} from "@webpack/common";

// Types and constants
const CHANNEL_TYPE_GUILD_VOICE = 2;
const CHANNEL_TYPE_GUILD_STAGE_VOICE = 13;

const BTN_ID = "vermLib-random-vc-joiner-btn";
const STYLE_ID = "vermLib-rvj-style";

const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel") as {
    selectVoiceChannel(channelId: string): void;
};

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#${BTN_ID} {
    --rvj-size: 24px;
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--rvj-size);
    height: var(--rvj-size);
    cursor: pointer;
    border-radius: 8px;
    transition: background-color .15s ease, transform .08s ease, box-shadow .2s ease;
    color: var(--interactive-normal);
    margin-right: 6px; /* spacing from Inbox */
}
#${BTN_ID}:hover {
    background-color: var(--background-modifier-hover);
    color: var(--interactive-hover);
    box-shadow: 0 0 12px rgba(88,101,242,.25);
}
#${BTN_ID}:active {
    transform: translateY(1px) scale(.98);
}
#${BTN_ID} .rvj-icon {
    width: 20px;
    height: 20px;
    pointer-events: none;
    display: inline-block;
}
#${BTN_ID}[data-state="busy"] {
    filter: grayscale(.4);
    opacity: .7;
    pointer-events: none;
}
`;
    document.head.appendChild(style);
}

function makeIcon() {
    // Simple "shuffle/dice-ish" mixed icon
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "rvj-icon");
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute(
        "d",
        // Material-ish shuffle icon with slight tweaks
        "M14.5 4l2.5 2.5L14.5 9H17l4-4-4-4h-2.5zM4 20h2l6.59-6.59-1.42-1.42L4 18v2zm0-14h1.59l4.7 4.7 1.41-1.41L7 4H4v2zm10 9l3.5 3.5H20v-2h-1.5L15 13l-1 1z",
    );
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
    return svg;
}

function createButton(onClick: () => void) {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.setAttribute("type", "button");
    btn.setAttribute("aria-label", "Join a random voice channel");
    btn.setAttribute("title", "Join a random voice channel");

    btn.appendChild(makeIcon());
    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
    });

    return btn;
}

function findInboxButton(): HTMLElement | null {
    // Prefer explicit Inbox aria-label (common on English locales)
    let el =
        document.querySelector<HTMLElement>(
            '[role="button"][aria-label="Inbox"]',
        ) ||
        document.querySelector<HTMLElement>(
            'div[role="button"][aria-label="Inbox"]',
        );

    // Fallback: Discord sometimes tags the inbox button with data-jump-section="global"
    if (!el) {
        el = document.querySelector<HTMLElement>(
            '[role="button"][data-jump-section="global"]',
        );
    }

    // As a final fallback, try to locate by SVG path used in Inbox icon (fragile; best-effort)
    if (!el) {
        const candidates = Array.from(
            document.querySelectorAll<HTMLElement>('div[role="button"]'),
        );
        el =
            candidates.find((n) => {
                const label = n.getAttribute("aria-label") ?? "";
                // Any localized "Inbox" equivalent often contains the idea of "mentions" or "inbox".
                // We keep it strict to avoid mis-detection.
                return /inbox/i.test(label);
            }) ?? null;
    }

    return el ?? null;
}

function isVoiceLike(ch: any) {
    return (
        ch &&
        (ch.type === CHANNEL_TYPE_GUILD_VOICE ||
            ch.type === CHANNEL_TYPE_GUILD_STAGE_VOICE)
    );
}

function canView(channel: any) {
    try {
        return PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel);
    } catch {
        return false;
    }
}

function canConnect(channel: any) {
    try {
        const CONNECT = (PermissionsBits as any).CONNECT as bigint | undefined;
        if (!CONNECT) return true; // If we cannot detect bit, be optimistic and rely on VoiceActions to fail if not allowed.
        return PermissionStore.can(CONNECT, channel);
    } catch {
        return false;
    }
}

function isFull(channel: any) {
    try {
        const limit = (channel?.userLimit ?? channel?.user_limit) as
            | number
            | undefined;
        if (!limit || limit <= 0) return false;

        const states =
            VoiceStateStore.getVoiceStatesForChannel?.(channel.id) ?? {};
        const count = Object.keys(states).length;
        return count >= limit;
    } catch {
        return false;
    }
}

function collectJoinableVoiceChannels(): Array<any> {
    const result: Array<any> = [];

    try {
        const guilds = GuildStore.getGuilds?.() ?? {};
        for (const g of Object.values<any>(guilds)) {
            const all = GuildChannelStore.getChannels?.(g.id);
            // VOCAL usually contains voice/stage entries of shape { channel, comparator }
            const voc: Array<{ channel: any }> = Array.isArray(all?.VOCAL)
                ? all!.VOCAL
                : [];

            for (const entry of voc) {
                const ch = entry?.channel;
                if (!isVoiceLike(ch)) continue;
                if (!canView(ch)) continue;
                if (!canConnect(ch)) continue;
                if (isFull(ch)) continue;

                result.push(ch);
            }
        }
    } catch {
        // ignore and return whatever we got
    }

    // As a fallback if VOCAL was empty or missing, scan all channels in ChannelStore
    if (!result.length) {
        try {
            const map = (ChannelStore as any)._channelMap ?? {};
            for (const ch of Object.values<any>(map)) {
                if (!isVoiceLike(ch)) continue;
                if (!canView(ch)) continue;
                if (!canConnect(ch)) continue;
                if (isFull(ch)) continue;
                result.push(ch);
            }
        } catch {
            /* ignore */
        }
    }

    return result;
}

function joinRandomVC() {
    try {
        const candidates = collectJoinableVoiceChannels();
        if (!candidates.length) {
            showToast(
                "No accessible voice channels found",
                Toasts.Type.FAILURE,
            );
            return;
        }

        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        try {
            VoiceActions.selectVoiceChannel(pick.id);
            showToast(`Joining: #${pick.name ?? pick.id}`, Toasts.Type.SUCCESS);
        } catch {
            showToast(
                "Failed to join the selected voice channel",
                Toasts.Type.FAILURE,
            );
        }
    } catch {
        showToast(
            "Something went wrong picking a channel",
            Toasts.Type.FAILURE,
        );
    }
}

let mountedBtn: HTMLButtonElement | null = null;
let mo: MutationObserver | null = null;
let hb: number | null = null;

const REINJECT_EVENTS = [
    "CHANNEL_SELECT",
    "SIDEBAR_VIEW_GUILD",
    "GUILD_CREATE",
    "GUILD_DELETE",
    "CONNECTION_OPEN",
    "WINDOW_FOCUS",
] as const;

function ensureInjected() {
    ensureStyle();

    // If already there and still next to an Inbox button, leave it
    const existing = document.getElementById(
        BTN_ID,
    ) as HTMLButtonElement | null;
    const inbox = findInboxButton();

    if (existing && inbox && existing.parentElement === inbox.parentElement) {
        return;
    }

    // Clean up stale copies
    existing?.remove();

    if (!inbox || !inbox.parentElement) return;

    const parent = inbox.parentElement;
    const btn = createButton(() => {
        // lock to prevent spam-click to multiple joins
        btn.dataset.state = "busy";
        Promise.resolve()
            .then(() => joinRandomVC())
            .finally(() => {
                delete btn.dataset.state;
            });
    });

    parent.insertBefore(btn, inbox); // place immediately to the left of Inbox
    mountedBtn = btn;
}

function cleanup() {
    mountedBtn?.remove();
    mountedBtn = null;

    const style = document.getElementById(STYLE_ID);
    style?.remove();
}

function reinjectHandler() {
    ensureInjected();
}

function subscribeReinjection() {
    try {
        for (const ev of REINJECT_EVENTS) {
            FluxDispatcher.subscribe(ev, reinjectHandler);
        }
    } catch {
        /* ignore */
    }
}

function unsubscribeReinjection() {
    try {
        for (const ev of REINJECT_EVENTS) {
            FluxDispatcher.unsubscribe(ev, reinjectHandler);
        }
    } catch {
        /* ignore */
    }
}

function startObserve() {
    mo = new MutationObserver(() => {
        // If we lost the button or Inbox was re-rendered, re-inject
        const inbox = findInboxButton();
        const btn = document.getElementById(BTN_ID);
        if (!inbox || !btn || btn.parentElement !== inbox.parentElement) {
            ensureInjected();
        }
    });
    mo.observe(document.body, { subtree: true, childList: true });
}

function stopObserve() {
    mo?.disconnect();
    mo = null;
}

export default {
    name: "RandomVCJoiner",

    start() {
        // Initial delayed inject to give the app time to mount UI
        setTimeout(() => ensureInjected(), 500);

        // Observe DOM rerenders
        startObserve();

        // Subscribe to common navigation/state change events
        subscribeReinjection();

        // Heartbeat reinjection in case of route changes that dodge our observer
        hb = window.setInterval(() => ensureInjected(), 1500);
    },

    stop() {
        if (hb) {
            clearInterval(hb);
            hb = null;
        }
        stopObserve();
        unsubscribeReinjection();
        cleanup();
    },
} as const;
