/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";

import definePlugin from "@utils/types";

import type { User } from "@vencord/discord-types";

import {
    Menu as CtxMenu,
    React,
    RestAPI,
    Toasts,
    UserStore,
    showToast,
} from "@webpack/common";

const CSP_CONFIG = {
    // If true, try media.discordapp.net as a fallback for image fetches when the CDN blocks CORS.
    useMediaProxy: true,
    // Optional external proxy base that performs server-side fetch and returns image bytes.
    // Leave empty to disable. Example: "https://r.jina.ai/http://"
    proxyBase: "",
} as const;

// Server-side Nitro/permission notes:
// - Setting a guild nickname requires you to have permission to change your own nickname in that guild.
// - Setting a server-specific avatar or banner typically requires Nitro and that the guild allows server customizations.
// - REST may respond with 401/403 if you lack permissions or are not authenticated; we surface clear reasons where possible.
type UserContextProps = {
    user?: User;
    guildId?: string;
    // channel?: Channel; // not required here
};

type GuildMemberProfile = {
    nick?: string | null;
    avatar?: string | null; // guild avatar hash
    banner?: string | null; // guild banner hash
};

type FetchedProfile = {
    user?: any;
    guild_member?: GuildMemberProfile;
};

function extFromHash(hash?: string | null) {
    if (!hash) return "png";
    return hash.startsWith("a_") ? "gif" : "png";
}

function guildAvatarCdnUrl(
    guildId: string,
    userId: string,
    avatarHash: string,
) {
    const ext = extFromHash(avatarHash);
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${avatarHash}.${ext}?size=4096`;
}

function guildBannerCdnUrl(
    guildId: string,
    userId: string,
    bannerHash: string,
) {
    const ext = extFromHash(bannerHash);
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/banners/${bannerHash}.${ext}?size=4096`;
}

function userAvatarCdnUrl(userId: string, avatarHash: string) {
    const ext = extFromHash(avatarHash);
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=4096`;
}

function userBannerCdnUrl(userId: string, bannerHash: string) {
    const ext = extFromHash(bannerHash);
    return `https://cdn.discordapp.com/banners/${userId}/${bannerHash}.${ext}?size=4096`;
}

async function fetchAsDataUri(url: string): Promise<string> {
    // Try direct fetch first; if CORS fails, try media proxy and then optional external proxy.
    const attempts: string[] = [];
    const tryFetch = async (u: string) => {
        attempts.push(u);
        const res = await fetch(u, {
            credentials: "include" as any,
            cache: "no-cache" as any,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();

        return await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();

            fr.onloadend = () => resolve(fr.result as string);

            fr.onerror = reject;

            fr.readAsDataURL(blob);
        });
    };

    try {
        return await tryFetch(url);
    } catch (e1) {
        if (CSP_CONFIG.useMediaProxy && url.includes("cdn.discordapp.com")) {
            const mediaUrl = url.replace(
                "cdn.discordapp.com",
                "media.discordapp.net",
            );

            try {
                return await tryFetch(mediaUrl);
            } catch {
                // fall through
            }
        }
        if (CSP_CONFIG.proxyBase) {
            const proxied = `${CSP_CONFIG.proxyBase}${encodeURIComponent(url)}`;
            try {
                return await tryFetch(proxied);
            } catch {
                // fall through
            }
        }
        console.warn("[CloneServerProfile] All image fetch attempts failed", {
            attempts,
            url,
            error: e1,
        });
        throw e1;
    }
}

async function getTargetGuildProfile(targetUserId: string, guildId: string) {
    // This client API is used by Discord to render profiles in guild context.
    // Example: GET /users/{userId}/profile?guild_id={guildId}&with_mutual_guilds=false
    console.log("[CloneServerProfile] Fetching target profile", {
        targetUserId,
        guildId,
    });
    const res: any = await RestAPI.get?.({
        url: `/users/${targetUserId}/profile?guild_id=${guildId}&with_mutual_guilds=false`,
    });
    console.log("[CloneServerProfile] Fetched profile", {
        hasGuildMember: !!res?.guild_member,
    });
    return res as FetchedProfile;
}

async function setMyNick(guildId: string, nick: string | null | undefined) {
    // PATCH /guilds/{guildId}/members/@me
    await RestAPI.patch?.({
        url: `/guilds/${guildId}/members/@me`,
        body: { nick: nick ?? "" },
    });
}

async function setMyGuildProfileMedia(
    guildId: string,
    avatarDataUrl?: string | null,
    bannerDataUrl?: string | null,
) {
    // PATCH /users/@me/guilds/{guildId}/profile
    // Only send fields we intend to modify to avoid resetting unrelated values.
    const body: Record<string, unknown> = {};
    if (avatarDataUrl !== undefined) body.avatar = avatarDataUrl;
    if (bannerDataUrl !== undefined) body.banner = bannerDataUrl;

    if (Object.keys(body).length === 0) {
        console.log(
            "[CloneServerProfile] Nothing to update for guild profile media",
            { guildId },
        );
        return;
    } // nothing to change

    console.log("[CloneServerProfile] Setting guild profile media", {
        guildId,
        hasAvatar: avatarDataUrl != null,
        hasBanner: bannerDataUrl != null,
    });

    await RestAPI.patch?.({
        url: `/users/@me/guilds/${guildId}/profile`,

        body,
    });
}

function getGuildIdFromLocation(): string | null {
    try {
        const parts = location.pathname.split("/");
        if (parts[1] === "channels" && parts[2] && parts[2] !== "@me") {
            return parts[2];
        }
    } catch {}
    return null;
}

const userContextPatch: NavContextMenuPatchCallback = (
    children,
    { user, guildId }: UserContextProps,
) => {
    const me = UserStore.getCurrentUser();
    const effectiveGuildId = guildId ?? getGuildIdFromLocation();
    const disabled = !user || !effectiveGuildId || (me && user?.id === me.id);
    console.log("[CloneServerProfile] Context", {
        targetUserId: user?.id,
        effectiveGuildId,
        disabled,
    });

    children.push(
        <CtxMenu.MenuSeparator />,
        <CtxMenu.MenuItem
            id="verm-clone-server-profile"
            label="Clone Server Profile"
            disabled={!!disabled}
            action={async () => {
                if (!user || !effectiveGuildId) {
                    showToast(
                        "Open this menu inside a server (guild) — no guild context available.",
                        Toasts.Type.FAILURE,
                    );

                    return;
                }

                if (me && user.id === me.id) return;

                showToast("Cloning server profile...", Toasts.Type.MESSAGE);
                console.log("[CloneServerProfile] Begin cloning", {
                    targetUserId: user.id,
                    username: user.username,
                    effectiveGuildId,
                });

                let clonedNick = false;

                let clonedAvatar = false;

                let clonedBanner = false;
                const failures: string[] = [];

                try {
                    // 1) Fetch target's server profile
                    const target = await getTargetGuildProfile(
                        user.id,
                        effectiveGuildId,
                    );
                    const gm = target?.guild_member;
                    if (!gm) {
                        // No server-specific profile found; we'll fall back to global user data instead of aborting.
                        console.warn(
                            "[CloneServerProfile] Target has no guild_member in fetched profile; using global fallbacks",
                            { targetUserId: user.id, effectiveGuildId },
                        );
                    }
                    const targetUser: any = (target as any)?.user ?? {};
                    // Prefer server-specific values; otherwise fall back to global display/username and global avatar/banner
                    const targetNick =
                        gm?.nick ??
                        targetUser.global_name ??
                        targetUser.username ??
                        null;
                    const targetAvatarHash =
                        gm?.avatar ?? targetUser.avatar ?? null;
                    const targetBannerHash =
                        gm?.banner ?? targetUser.banner ?? null;
                    console.log(
                        "[CloneServerProfile] Target profile values (with fallback)",
                        { targetNick, targetAvatarHash, targetBannerHash },
                    );

                    // 2) Attempt to clone nickname (best-effort)
                    if (targetNick != null) {
                        try {
                            console.log(
                                "[CloneServerProfile] Attempting to set nickname",
                                { effectiveGuildId, targetNick },
                            );
                            await setMyNick(effectiveGuildId, targetNick);
                            console.log("[CloneServerProfile] Nickname set");
                            clonedNick = true;
                        } catch (err: any) {
                            const code = (err &&
                                (err.status ?? err.statusCode)) as
                                | number
                                | undefined;
                            const reason =
                                code === 401
                                    ? "unauthorized (401)"
                                    : code === 403
                                      ? "forbidden (403)"
                                      : "request failed";
                            failures.push(`nickname (${reason})`);
                            console.warn(
                                "[CloneServerProfile] Failed to set nickname",
                                { effectiveGuildId, targetNick, err },
                            );
                            // ignore, show granular result after
                        }
                    }

                    // 3) Attempt to clone server avatar/banner if present
                    let avatarDataUrl: string | null | undefined = undefined;
                    let bannerDataUrl: string | null | undefined = undefined;

                    // If target has a server avatar, fetch and convert to data URI

                    if (targetAvatarHash) {
                        let avatarCdnUrl: string = "";
                        try {
                            console.log(
                                "[CloneServerProfile] Building avatar CDN URL",

                                {
                                    effectiveGuildId,

                                    targetUserId: user.id,

                                    targetAvatarHash,
                                },
                            );

                            avatarCdnUrl = guildAvatarCdnUrl(
                                effectiveGuildId,

                                user.id,

                                targetAvatarHash,
                            );

                            console.log(
                                "[CloneServerProfile] Fetching avatar CDN",

                                { url: avatarCdnUrl },
                            );

                            avatarDataUrl = await fetchAsDataUri(avatarCdnUrl);
                            console.log(
                                "[CloneServerProfile] Avatar fetched as data URI",
                            );
                        } catch (err) {
                            // failed to fetch avatar; skip

                            avatarDataUrl = undefined;

                            failures.push(
                                "server avatar (download failed: CORS or unavailable)",
                            );

                            console.warn(
                                "[CloneServerProfile] Failed to fetch avatar CDN",

                                { url: avatarCdnUrl, err },
                            );
                        }
                    } else {
                        console.log(
                            "[CloneServerProfile] Target has no server avatar - trying global avatar",
                        );
                        const globalAvatarHash: string | null =
                            targetUser?.avatar ?? null;
                        if (globalAvatarHash) {
                            const globalAvatarUrl = userAvatarCdnUrl(
                                user.id,
                                globalAvatarHash,
                            );
                            try {
                                console.log(
                                    "[CloneServerProfile] Fetching global avatar",
                                    { url: globalAvatarUrl },
                                );
                                avatarDataUrl =
                                    await fetchAsDataUri(globalAvatarUrl);
                                console.log(
                                    "[CloneServerProfile] Global avatar fetched as data URI",
                                );
                            } catch (err) {
                                avatarDataUrl = undefined;
                                failures.push(
                                    "global avatar (download failed: CORS or unavailable)",
                                );
                                console.warn(
                                    "[CloneServerProfile] Failed to fetch global avatar",
                                    { url: globalAvatarUrl, err },
                                );
                            }
                        } else {
                            avatarDataUrl = undefined; // no global avatar available
                        }
                    }

                    // If target has a server banner, fetch and convert to data URI

                    if (targetBannerHash) {
                        let bannerCdnUrl: string = "";
                        try {
                            console.log(
                                "[CloneServerProfile] Building banner CDN URL",

                                {
                                    effectiveGuildId,

                                    targetUserId: user.id,

                                    targetBannerHash,
                                },
                            );

                            bannerCdnUrl = guildBannerCdnUrl(
                                effectiveGuildId,

                                user.id,

                                targetBannerHash,
                            );

                            console.log(
                                "[CloneServerProfile] Fetching banner CDN",

                                { url: bannerCdnUrl },
                            );

                            bannerDataUrl = await fetchAsDataUri(bannerCdnUrl);
                            console.log(
                                "[CloneServerProfile] Banner fetched as data URI",
                            );
                        } catch (err) {
                            // failed to fetch banner; skip

                            bannerDataUrl = undefined;

                            failures.push(
                                "server banner (download failed: CORS or unavailable)",
                            );

                            console.warn(
                                "[CloneServerProfile] Failed to fetch banner CDN",

                                { url: bannerCdnUrl, err },
                            );
                        }
                    } else {
                        console.log(
                            "[CloneServerProfile] Target has no server banner - trying global banner",
                        );
                        const globalBannerHash: string | null =
                            targetUser?.banner ?? null;
                        if (globalBannerHash) {
                            const globalBannerUrl = userBannerCdnUrl(
                                user.id,
                                globalBannerHash,
                            );
                            try {
                                console.log(
                                    "[CloneServerProfile] Fetching global banner",
                                    { url: globalBannerUrl },
                                );
                                bannerDataUrl =
                                    await fetchAsDataUri(globalBannerUrl);
                                console.log(
                                    "[CloneServerProfile] Global banner fetched as data URI",
                                );
                            } catch (err) {
                                bannerDataUrl = undefined;
                                failures.push(
                                    "global banner (download failed: CORS or unavailable)",
                                );
                                console.warn(
                                    "[CloneServerProfile] Failed to fetch global banner",
                                    { url: globalBannerUrl, err },
                                );
                            }
                        } else {
                            bannerDataUrl = undefined; // no global banner available
                        }
                    }

                    // Only attempt PATCH if we have something to set
                    if (
                        avatarDataUrl !== undefined ||
                        bannerDataUrl !== undefined
                    ) {
                        try {
                            console.log(
                                "[CloneServerProfile] Attempting to set guild profile media",
                                {
                                    effectiveGuildId,
                                    hasAvatar: avatarDataUrl != null,
                                    hasBanner: bannerDataUrl != null,
                                },
                            );
                            await setMyGuildProfileMedia(
                                effectiveGuildId,
                                avatarDataUrl,

                                bannerDataUrl,
                            );

                            clonedAvatar = avatarDataUrl != null;
                            clonedBanner = bannerDataUrl != null;
                            console.log(
                                "[CloneServerProfile] Guild profile media set (both)",
                                { clonedAvatar, clonedBanner },
                            );
                        } catch (err) {
                            console.warn(
                                "[CloneServerProfile] Failed to set both media, attempting partial",

                                { err },
                            );
                            failures.push(
                                "server avatar and banner (combined request failed)",
                            );

                            // If setting both failed, try each individually so partial success is possible
                            if (avatarDataUrl !== undefined) {
                                try {
                                    console.log(
                                        "[CloneServerProfile] Attempting avatar-only guild media set",
                                    );
                                    await setMyGuildProfileMedia(
                                        effectiveGuildId,
                                        avatarDataUrl,
                                        undefined,
                                    );

                                    clonedAvatar = avatarDataUrl != null;
                                    console.log(
                                        "[CloneServerProfile] Avatar-only guild media set",
                                        { clonedAvatar },
                                    );
                                } catch (err: any) {
                                    const code = (err &&
                                        (err.status ?? err.statusCode)) as
                                        | number
                                        | undefined;
                                    const reason =
                                        code === 401
                                            ? "unauthorized (401)"
                                            : code === 403
                                              ? "forbidden (403)"
                                              : "request failed";
                                    failures.push(`server avatar (${reason})`);
                                    console.warn(
                                        "[CloneServerProfile] Failed to set avatar-only guild media",
                                        { err },
                                    );
                                }
                            }
                            if (bannerDataUrl !== undefined) {
                                try {
                                    console.log(
                                        "[CloneServerProfile] Attempting banner-only guild media set",
                                    );
                                    await setMyGuildProfileMedia(
                                        effectiveGuildId,
                                        undefined,
                                        bannerDataUrl,
                                    );

                                    clonedBanner = bannerDataUrl != null;
                                    console.log(
                                        "[CloneServerProfile] Banner-only guild media set",
                                        { clonedBanner },
                                    );
                                } catch (err: any) {
                                    const code = (err &&
                                        (err.status ?? err.statusCode)) as
                                        | number
                                        | undefined;
                                    const reason =
                                        code === 401
                                            ? "unauthorized (401)"
                                            : code === 403
                                              ? "forbidden (403)"
                                              : "request failed";
                                    failures.push(`server banner (${reason})`);
                                    console.warn(
                                        "[CloneServerProfile] Failed to set banner-only guild media",
                                        { err },
                                    );
                                }
                            }
                        }
                    }

                    // 4) Summarize result
                    const parts: string[] = [];
                    if (clonedNick) parts.push("nickname");
                    if (clonedAvatar) parts.push("server avatar");
                    if (clonedBanner) parts.push("server banner");
                    console.log("[CloneServerProfile] Clone summary parts", {
                        parts,
                    });

                    if (parts.length > 0 && failures.length === 0) {
                        showToast(
                            `Cloned ${parts.join(", ")} from ${user.username}.`,

                            Toasts.Type.SUCCESS,
                        );
                    } else if (parts.length > 0 && failures.length > 0) {
                        showToast(
                            `Cloned ${parts.join(", ")} from ${user.username}, but some items failed: ${failures.join(" | ")}`,
                            Toasts.Type.MESSAGE,
                        );
                    } else {
                        const reason = failures.length
                            ? failures.join(" | ")
                            : "Operation not permitted (permissions/Nitro).";
                        showToast(
                            `Failed to clone: ${reason}`,
                            Toasts.Type.FAILURE,
                        );
                    }
                } catch (err) {
                    showToast(
                        "Failed to clone server profile.",
                        Toasts.Type.FAILURE,
                    );
                    console.error("[CloneServerProfile] Error:", err);
                }
            }}
        />,
    );
};

export default definePlugin({
    name: "CloneServerProfile",
    description:
        "Right-click a member to clone their server profile onto yours in the current guild.",
    authors: [{ name: "Vermin", id: 1287307742805229608n }],

    start() {
        // no-op
    },
    stop() {
        // no-op
    },

    contextMenus: {
        "user-context": userContextPatch,
    },
});
