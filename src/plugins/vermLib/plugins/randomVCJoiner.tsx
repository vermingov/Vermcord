/*

 * Vencord, a Discord client mod

 * Copyright (c) 2025

 * SPDX-License-Identifier: GPL-3.0-or-later

 *

 * Random VC Joiner: Adds a toolbar button next to Inbox that joins a random accessible voice channel.

 */

import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Devs } from "../../../utils/constants";

import {
    ChannelStore,
    GuildStore,
    PermissionStore,
    SelectedChannelStore,
    showToast,
    Toasts,
} from "@webpack/common";

const CHANNEL_TYPE_GUILD_VOICE = 2;
const CHANNEL_TYPE_GUILD_STAGE_VOICE = 13;
// Permission bit for CONNECT (1 << 20)
const PERM_CONNECT = 1 << 20;

const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel") as {
    selectVoiceChannel(channelId: string): void;
};

function isVoiceLikeChannel(ch: any): boolean {
    if (!ch) return false;
    return (
        ch.type === CHANNEL_TYPE_GUILD_VOICE ||
        ch.type === CHANNEL_TYPE_GUILD_STAGE_VOICE
    );
}

function shuffleInPlace<T>(arr: T[]) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function canConnect(ch: any): boolean {
    try {
        const can = (PermissionStore as any)?.can;
        if (typeof can !== "function") return true; // best-effort

        return !!can(PERM_CONNECT, ch);
    } catch {
        return true;
    }
}

function collectAllVoiceChannels(): Array<any> {
    const chans: any[] = [];
    try {
        const guilds = GuildStore?.getGuilds?.();
        const guildIds: string[] = guilds ? Object.keys(guilds) : [];

        // Several possible APIs that Discord might expose; try in order
        const GCS: any = ChannelStore as any;
        const getChannelsFns: Array<((g: string) => any) | null> = [
            GCS && typeof GCS.getChannels === "function"
                ? (gid: string) => GCS.getChannels(gid)
                : null,
            GCS &&
            typeof (GCS as any).getMutableGuildChannelsForGuild === "function"
                ? (gid: string) =>
                      (GCS as any).getMutableGuildChannelsForGuild(gid)
                : null,
        ].filter(Boolean) as Array<(g: string) => any>;

        for (const gid of guildIds) {
            let group: any = null;
            for (const fn of getChannelsFns) {
                try {
                    group = fn(gid);
                    if (group) break;
                } catch {}
            }
            // Attempt to extract voice channels from various possible shapes
            if (group) {
                // Common: group.VOICE.channels: Array<{ channel }>
                const maybeVoice = group.VOICE ?? group.voice ?? null;

                if (
                    maybeVoice?.channels &&
                    Array.isArray(maybeVoice.channels)
                ) {
                    for (const c of maybeVoice.channels) {
                        const ch = c.channel ?? c;
                        if (isVoiceLikeChannel(ch)) chans.push(ch);
                    }
                } else if (Array.isArray(maybeVoice)) {
                    for (const ch of maybeVoice) {
                        if (isVoiceLikeChannel(ch)) chans.push(ch);
                    }
                } else {
                    // Fallback: iterate over possible props
                    for (const key of Object.keys(group)) {
                        const val = group[key];
                        if (!val) continue;
                        if (Array.isArray(val)) {
                            for (const ch of val) {
                                const real = ch.channel ?? ch;
                                if (isVoiceLikeChannel(real)) chans.push(real);
                            }
                        } else if (val && Array.isArray(val.channels)) {
                            for (const ch of val.channels) {
                                const real = ch.channel ?? ch;
                                if (isVoiceLikeChannel(real)) chans.push(real);
                            }
                        }
                    }
                }
            }
        }
    } catch {
        // best-effort
    }

    // As an additional safety, dedupe by id
    const seen = new Set<string>();
    const unique: any[] = [];
    for (const ch of chans) {
        const id = ch?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        unique.push(ch);
    }
    return unique;
}

async function tryJoinRandomVC() {
    try {
        const all = collectAllVoiceChannels().filter(canConnect);
        if (!all.length) {
            showToast(
                "No accessible voice channels found",
                Toasts.Type.FAILURE,
            );
            return;
        }

        shuffleInPlace(all);

        showToast(
            "Trying to join a random voice channel…",
            Toasts.Type.MESSAGE,
        );

        for (const ch of all) {
            try {
                VoiceActions.selectVoiceChannel(ch.id);
                // Wait a short moment and verify we actually joined
                const ok = await waitForJoin(ch.id, 800);
                if (ok) {
                    const guildName = safeGuildName(ch.guild_id);
                    const name = ch.name || "Voice";
                    showToast(
                        `Joined ${name}${guildName ? ` — ${guildName}` : ""}`,
                        Toasts.Type.SUCCESS,
                    );
                    return;
                }
            } catch {
                // Try next
            }
        }

        showToast(
            "Failed to join any random voice channel",
            Toasts.Type.FAILURE,
        );
    } catch {
        showToast("Random VC Joiner encountered an error", Toasts.Type.FAILURE);
    }
}

function safeGuildName(gid?: string | null) {
    try {
        if (!gid) return "";
        const g = GuildStore?.getGuild?.(gid);
        return g?.name ?? "";
    } catch {
        return "";
    }
}

function waitForJoin(targetId: string, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    return new Promise((res) => {
        const tick = () => {
            try {
                const cur = SelectedChannelStore?.getVoiceChannelId?.();
                if (cur === targetId) return res(true);
                if (Date.now() - start >= timeoutMs) return res(false);
                setTimeout(tick, 100);
            } catch {
                res(false);
            }
        };
        tick();
    });
}

// ---------- UI Injection (near Inbox button) ----------

const BUTTON_ID = "verm-random-vc-btn";
let mo: MutationObserver | null = null;

function createIconSVG(): SVGElement {
    // Simple dice icon to convey "random"
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");

    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute(
        "d",
        // Dice-like icon
        "M4 3h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1.75 3.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zM9 8.75A1.25 1.25 0 1 0 9 6.25a1.25 1.25 0 0 0 0 2.5zm-3.25 6a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5zM9 14.75a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5zm10.5-9.5h1.75A1.75 1.75 0 0 1 23 7.0v1.75A3.25 3.25 0 0 1 19.75 12H18v-1.5h1.75c.966 0 1.75-.784 1.75-1.75V7a.25.25 0 0 0-.25-.25H19.5V5.25z",
    );
    svg.appendChild(path);
    return svg;
}

function cloneInboxClasses(inboxBtn: HTMLElement, el: HTMLElement) {
    try {
        el.className = inboxBtn.className; // copy all hashed classes for consistent style
        // Copy some sizing styles if present
        const cs = getComputedStyle(inboxBtn);
        el.style.width = cs.width;
        el.style.height = cs.height;
        el.style.display = cs.display || "inline-flex";
        el.style.alignItems = cs.alignItems || "center";
        el.style.justifyContent = cs.justifyContent || "center";
    } catch {
        // ignore
    }
}

function buildRandomButton(inboxBtn: HTMLElement): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.type = "button";
    btn.setAttribute("aria-label", "Join Random VC");
    btn.setAttribute("tabindex", "0");
    btn.style.cursor = "pointer";

    // Copy className/style to match Discord look-and-feel
    cloneInboxClasses(inboxBtn, btn);

    // Try to mimic inner icon wrapper classes if present
    const inboxInner = inboxBtn.firstElementChild as HTMLElement | null;
    const inner = document.createElement("div");
    if (inboxInner) inner.className = inboxInner.className;
    inner.appendChild(createIconSVG());
    btn.appendChild(inner);

    btn.addEventListener("keydown", (e) => {
        tryJoinRandomVC();
    });

    // Prevent focus ring anomalies
    btn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            tryJoinRandomVC();
        }
    });

    // Spacing: place to the immediate left of Inbox
    btn.style.marginRight = "6px";

    return btn;
}

function ensureButtonNearInbox(root: ParentNode = document) {
    try {
        const inbox: HTMLElement | null =
            (root.querySelector(
                'button[aria-label="Inbox"]',
            ) as HTMLElement | null) ||
            (root.querySelector(
                '[aria-label="Inbox"] button',
            ) as HTMLElement | null) ||
            null;

        if (!inbox || !inbox.parentElement) return;

        // If already injected for this toolbar instance, skip
        if (inbox.parentElement.querySelector(`#${BUTTON_ID}`)) return;

        const btn = buildRandomButton(inbox);
        inbox.parentElement.insertBefore(btn, inbox);
    } catch {
        // ignore
    }
}

function startObserving() {
    stopObserving();

    mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type === "childList") {
                for (const n of m.addedNodes) {
                    if (!(n instanceof HTMLElement)) continue;
                    // Search within added subtree
                    ensureButtonNearInbox(n);
                }
            }
        }
        // Also check document in case of soft re-render without nodes passed
        ensureButtonNearInbox(document);
    });

    mo.observe(document.body, {
        childList: true,
        subtree: true,
    });

    // Initial attempt
    ensureButtonNearInbox(document);
}

function stopObserving() {
    try {
        mo?.disconnect();
    } catch {}
    mo = null;
    // Remove stray buttons
    try {
        document.querySelectorAll(`#${BUTTON_ID}`).forEach((el) => el.remove());
    } catch {}
}

export default definePlugin({
    name: "RandomVCJoiner",
    description:
        "Adds a button next to Inbox that joins a random accessible voice channel across all your servers.",
    authors: [Devs.Vermin, Devs.Kravle],

    start() {
        startObserving();
    },

    stop() {
        stopObserving();
    },
});
