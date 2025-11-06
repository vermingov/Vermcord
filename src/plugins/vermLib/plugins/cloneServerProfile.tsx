/*
 * Vencord, a Discord client mod
 * Fixed version — proper guildId detection, safer fallbacks, improved logging
 * Updated: bio and server-specific avatar, banner cloning
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

                showToast("Cloning server profile...", Toasts.Type.MESSAGE);
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
