/*
 * Vencord, a Discord client mod
 * Fixed version — proper guildId detection, safer fallbacks, improved logging
 * Updated: bio and server-specific avatar, banner cloning
 * Modified: Uses custom progress toast for cloning feedback
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import type { User } from "@vencord/discord-types";
import { Devs } from "../../../utils/constants";
import {
    Menu as CtxMenu,
    React,
    RestAPI,
    Toasts,
    UserStore,
    showToast,
} from "@webpack/common";

const CSP_CONFIG = {
    useMediaProxy: true,
    proxyBase: "",
} as const;

type UserContextProps = {
    user?: User;
    guildId?: string;
};

type GuildMemberProfile = {
    nick?: string | null;
    avatar?: string | null;
    banner?: string | null;
};

type FetchedProfile = {
    user?: any;
    guild_member?: GuildMemberProfile;
};

function createDeletionProgressToast(): HTMLElement {
    const container = document.createElement("div");
    container.id = "md-deletion-progress";
    container.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-accent);
        border-radius: 12px;
        padding: 16px 24px;
        min-width: 360px;
        max-width: 500px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        z-index: 10000;
        backdrop-filter: blur(10px);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif;
        transition: opacity 0.3s ease, transform 0.3s ease;
    `;

    container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 10px;">
                <svg class="md-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" style="animation: md-spin 1s linear infinite;">
                    <circle cx="12" cy="12" r="10" stroke="var(--brand-500)" stroke-width="2" stroke-dasharray="15.7 31.4" />
                </svg>
                <span style="color: var(--header-primary); font-weight: 500; font-size: 14px;">
                    Cloning Server Profile
                </span>
            </div>
            <span style="color: var(--text-muted); font-size: 12px; font-weight: 500;">
                <span id="md-progress-text">0/4</span>
            </span>
        </div>
        <div style="
            width: 100%;
            height: 4px;
            background: var(--background-tertiary);
            border-radius: 2px;
            overflow: hidden;
        ">
            <div id="md-progress-bar" style="
                height: 100%;
                background: linear-gradient(90deg, var(--brand-500, #5865F2), var(--brand-560, #4752C4));
                border-radius: 2px;
                width: 0%;
                transition: width 0.2s ease;
                box-shadow: 0 0 12px rgba(88, 101, 242, 0.6);
            "></div>
        </div>
    `;

    // Add spinning animation
    if (!document.getElementById("md-spinner-styles")) {
        const style = document.createElement("style");
        style.id = "md-spinner-styles";
        style.textContent = `
            @keyframes md-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }

    return container;
}

function updateProgressToast(current: number, total: number = 4) {
    const progressText = document.getElementById("md-progress-text");
    const progressBar = document.getElementById("md-progress-bar");

    if (progressText) {
        progressText.textContent = `${current}/${total}`;
    }

    if (progressBar) {
        const percentage = (current / total) * 100;
        progressBar.style.width = `${percentage}%`;
    }
}

function removeProgressToast() {
    const container = document.getElementById("md-deletion-progress");
    if (container) {
        container.style.opacity = "0";
        container.style.transform = "translateX(-50%) translateY(-10px)";
        setTimeout(() => container.remove(), 300);
    }
}

function extFromHash(hash?: string | null) {
    if (!hash) return "png";
    return hash.startsWith("a_") ? "gif" : "png";
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
    const attempts: string[] = [];

    const toDataUri = async (res: Response): Promise<string> => {
        const blob = await res.blob();
        return await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onloadend = () => resolve(fr.result as string);
            fr.onerror = reject;
            fr.readAsDataURL(blob);
        });
    };

    const tryFetch = async (u: string, allowWebp = true): Promise<string> => {
        attempts.push(u);
        const res = await fetch(u, {
            credentials: "omit" as any,
            cache: "no-cache" as any,
        });
        if (!res.ok) {
            if (
                allowWebp &&
                res.status === 404 &&
                /\.(png|jpg|jpeg|gif)(\?|$)/i.test(u)
            ) {
                const webpUrl = u.replace(
                    /\.(png|jpg|jpeg|gif)(\?|$)/i,
                    ".webp$2",
                );
                attempts.push(webpUrl);
                const res2 = await fetch(webpUrl, {
                    credentials: "omit" as any,
                    cache: "no-cache" as any,
                });
                if (res2.ok) {
                    return await toDataUri(res2);
                }
            }
            throw new Error(`HTTP ${res.status}`);
        }
        return await toDataUri(res);
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
            } catch {}
        }

        if (CSP_CONFIG.proxyBase) {
            const proxied = `${CSP_CONFIG.proxyBase}${encodeURIComponent(url)}`;
            try {
                return await tryFetch(proxied);
            } catch {}
        }

        console.warn("[CloneServerProfile] All image fetch attempts failed", {
            attempts,
            url,
            error: e1,
        });

        throw e1;
    }
}

function getGuildIdFromLocation(): string | null {
    try {
        const parts = location.pathname.split("/");
        if (parts[1] === "channels" && parts[2] && parts[2] !== "@me") {
            return parts[2];
        }
    } catch (e) {
        console.warn(
            "[CloneServerProfile] Failed to parse guild ID from URL",
            e,
        );
    }
    return null;
}

async function getTargetGuildProfile(targetUserId: string, guildId: string) {
    console.log("[CloneServerProfile] Fetching target profile", {
        targetUserId,
        guildId,
    });
    const res: any = await RestAPI.get?.({
        url: `/users/${targetUserId}/profile?guild_id=${guildId}&with_mutual_guilds=true`,
    });
    console.log("[CloneServerProfile] Raw API response:", res);

    let data: any = res?.body;
    if (!data && typeof res?.text === "string") {
        try {
            data = JSON.parse(res.text);
        } catch {}
    }
    if (!data) data = res ?? {};

    console.log("[CloneServerProfile] Fetched profile", {
        hasGuildMember: !!data?.guild_member,
        hasUser: !!data?.user,
    });
    return data as FetchedProfile;
}

async function setMyNick(guildId: string, nick: string | null | undefined) {
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
    const body: Record<string, unknown> = {};
    if (avatarDataUrl !== undefined) body.avatar = avatarDataUrl;
    if (bannerDataUrl !== undefined) body.banner = bannerDataUrl;

    if (Object.keys(body).length === 0) {
        console.log(
            "[CloneServerProfile] Nothing to update for guild profile media",
            { guildId },
        );
        return;
    }

    console.log("[CloneServerProfile] Setting guild profile media", {
        guildId,
        hasAvatar: avatarDataUrl != null,
        hasBanner: bannerDataUrl != null,
    });

    try {
        await RestAPI.patch?.({
            url: `/users/@me/profiles/${guildId}`,
            body,
        });
    } catch (err: any) {
        const code = err?.status ?? err?.statusCode;
        console.warn(
            "[CloneServerProfile] Primary endpoint failed, trying alternate",
            { code },
        );

        try {
            await RestAPI.patch?.({
                url: `/guilds/${guildId}/members/@me`,
                body: {
                    avatar: avatarDataUrl,
                    banner: bannerDataUrl,
                },
            });
        } catch (err2: any) {
            console.error(
                "[CloneServerProfile] All guild profile endpoints failed",
                err2,
            );
            throw err2;
        }
    }
}

async function setMyUserProfile(bio?: string | null) {
    const body: Record<string, unknown> = {};

    if (bio !== undefined) body.bio = bio ?? "";

    if (Object.keys(body).length === 0) {
        console.log("[CloneServerProfile] Nothing to update for user profile");
        return;
    }

    console.log("[CloneServerProfile] Setting user profile", {
        hasBio: bio != null,
    });

    try {
        await RestAPI.patch?.({
            url: `/users/@me`,
            body,
        });
    } catch (err: any) {
        console.error("[CloneServerProfile] Failed to set user profile", err);
        throw err;
    }
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
                        "Open this menu inside a server — no guild context available.",
                        Toasts.Type.FAILURE,
                    );
                    return;
                }

                if (me && user.id === me.id) return;

                // Create and append progress toast
                const progressToast = createDeletionProgressToast();
                document.body.appendChild(progressToast);
                updateProgressToast(0, 4);

                console.log("[CloneServerProfile] Begin cloning", {
                    targetUserId: user.id,
                    username: user.username,
                    effectiveGuildId,
                });

                let clonedNick = false;
                let clonedAvatar = false;
                let clonedBanner = false;
                let clonedBio = false;
                const failures: string[] = [];

                try {
                    // 1️⃣ Fetch target's full profile
                    const target = await getTargetGuildProfile(
                        user.id,
                        effectiveGuildId,
                    );
                    updateProgressToast(1, 4);

                    const targetUser: any = target?.user ?? {};

                    // Extract all profile fields
                    const targetNick =
                        targetUser.global_name ?? targetUser.username ?? null;
                    const targetAvatarHash = targetUser.avatar ?? null;
                    const targetBannerHash = targetUser.banner ?? null;
                    const targetBio = targetUser.bio ?? null;

                    console.log("[CloneServerProfile] Target profile values", {
                        targetNick,
                        targetAvatarHash,
                        targetBannerHash,
                        targetBio,
                    });

                    // 2️⃣ Clone nickname
                    if (targetNick != null) {
                        try {
                            await setMyNick(effectiveGuildId, targetNick);
                            clonedNick = true;
                            console.log("[CloneServerProfile] Nickname set");
                        } catch (err: any) {
                            const code = err?.status ?? err?.statusCode;
                            const reason =
                                code === 401
                                    ? "unauthorized"
                                    : code === 403
                                      ? "forbidden"
                                      : code === 429
                                        ? "rate limited"
                                        : "failed";
                            failures.push(`nickname (${reason})`);
                            console.warn(
                                "[CloneServerProfile] Failed to set nickname",
                                err,
                            );
                        }
                    }
                    updateProgressToast(2, 4);

                    // 3️⃣ Clone server-specific avatar and banner
                    let avatarDataUrl: string | undefined = undefined;
                    let bannerDataUrl: string | undefined = undefined;

                    if (targetAvatarHash) {
                        try {
                            const url = userAvatarCdnUrl(
                                user.id,
                                targetAvatarHash,
                            );
                            avatarDataUrl = await fetchAsDataUri(url);
                            console.log("[CloneServerProfile] Avatar fetched");
                        } catch (err) {
                            failures.push("server avatar (download failed)");
                            console.warn(
                                "[CloneServerProfile] Failed to fetch avatar",
                                err,
                            );
                        }
                    }

                    if (targetBannerHash) {
                        try {
                            const url = userBannerCdnUrl(
                                user.id,
                                targetBannerHash,
                            );
                            bannerDataUrl = await fetchAsDataUri(url);
                            console.log("[CloneServerProfile] Banner fetched");
                        } catch (err) {
                            failures.push("server banner (download failed)");
                            console.warn(
                                "[CloneServerProfile] Failed to fetch banner",
                                err,
                            );
                        }
                    }

                    // Set guild profile media (avatar and banner)
                    if (
                        avatarDataUrl !== undefined ||
                        bannerDataUrl !== undefined
                    ) {
                        try {
                            await setMyGuildProfileMedia(
                                effectiveGuildId,
                                avatarDataUrl,
                                bannerDataUrl,
                            );
                            clonedAvatar = avatarDataUrl != null;
                            clonedBanner = bannerDataUrl != null;
                            console.log("[CloneServerProfile] Guild media set");
                        } catch (err: any) {
                            const code = err?.status ?? err?.statusCode;
                            const reason =
                                code === 401
                                    ? "unauthorized"
                                    : code === 403
                                      ? "forbidden"
                                      : code === 429
                                        ? "rate limited"
                                        : "failed";
                            if (avatarDataUrl)
                                failures.push(`server avatar (${reason})`);
                            if (bannerDataUrl)
                                failures.push(`server banner (${reason})`);
                            console.warn(
                                "[CloneServerProfile] Failed to set guild media",
                                err,
                            );
                        }
                    }
                    updateProgressToast(3, 4);

                    // 4️⃣ Clone bio (global profile)
                    if (targetBio != null) {
                        try {
                            await setMyUserProfile(targetBio);
                            clonedBio = true;
                            console.log("[CloneServerProfile] Bio set");
                        } catch (err: any) {
                            const code = err?.status ?? err?.statusCode;
                            const reason =
                                code === 401
                                    ? "unauthorized"
                                    : code === 403
                                      ? "forbidden"
                                      : code === 429
                                        ? "rate limited"
                                        : "failed";
                            failures.push(`bio (${reason})`);
                            console.warn(
                                "[CloneServerProfile] Failed to set bio",
                                err,
                            );
                        }
                    }
                    updateProgressToast(4, 4);

                    // Remove progress toast
                    removeProgressToast();

                    // 5️⃣ Result summary
                    const parts: string[] = [];
                    if (clonedNick) parts.push("nickname");
                    if (clonedAvatar) parts.push("server avatar");
                    if (clonedBanner) parts.push("server banner");
                    if (clonedBio) parts.push("bio");

                    console.log("[CloneServerProfile] Clone summary parts", {
                        parts,
                        failures,
                    });

                    if (parts.length > 0 && failures.length === 0) {
                        showToast(
                            `Cloned ${parts.join(", ")} from ${user.username}.`,
                            Toasts.Type.SUCCESS,
                        );
                    } else if (parts.length > 0 && failures.length > 0) {
                        showToast(
                            `Cloned ${parts.join(", ")} from ${user.username}, but some failed: ${failures.join(" | ")}`,
                            Toasts.Type.MESSAGE,
                        );
                    } else {
                        showToast(
                            `Failed to clone anything. ${failures.length ? failures.join(" | ") : "No profile data available."}`,
                            Toasts.Type.FAILURE,
                        );
                    }
                } catch (err) {
                    removeProgressToast();
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
        "Right-click a member to clone their server profile (nickname, avatar, banner) and global profile (bio).",
    authors: [Devs.Vermin, Devs.Kravle],
    start() {},
    stop() {},
    contextMenus: {
        "user-context": userContextPatch,
    },
});
