/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import "./fixDiscordBadgePadding.css";

import {
    _getBadges,
    BadgePosition,
    BadgeUserArgs,
    ProfileBadge,
} from "@api/Badges";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Heart } from "@components/Heart";
import DonateButton from "@components/settings/DonateButton";
import { openContributorModal } from "@components/settings/tabs";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import { copyWithToast, shouldShowContributorBadge } from "@utils/misc";
import {
    closeModal,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalRoot,
    openModal,
} from "@utils/modal";
import definePlugin from "@utils/types";
import { User } from "@vencord/discord-types";
import {
    ContextMenuApi,
    Forms,
    Menu,
    Toasts,
    UserStore,
    FluxDispatcher,
} from "@webpack/common";

const CONTRIBUTOR_BADGE =
    "https://cdn.discordapp.com/emojis/1434994932686262282.webp?size=64";

const ContributorBadge: ProfileBadge = {
    description: "Vermcord Developer",
    image: CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId)),
};

let DonorBadges = {} as Record<
    string,
    Array<Record<"tooltip" | "badge", string>>
>;

let CustomBadges = {} as Record<
    string,
    Array<{ description: string; imageUrl: string }>
>;

// Badge version tracking for forcing React updates
let badgeVersions = {} as Record<string, number>;

// Cache timestamp tracking with TTL (time-to-live) in milliseconds
let badgeTimestamps = {} as Record<string, number>;
const BADGE_CACHE_TTL = 3000; // 3 seconds - adjust as needed

let wsConnection: WebSocket | null = null;
const logger = new Logger("BadgeAPI");
const pendingBadgeRequests = new Set<string>();
const requestThrottleTimers = {} as Record<string, NodeJS.Timeout>;

// Get current badge version for a user
function getBadgeVersion(userId: string): number {
    return badgeVersions[userId] || 0;
}

// Increment badge version to trigger React updates
function incrementBadgeVersion(userId: string) {
    badgeVersions[userId] = (badgeVersions[userId] || 0) + 1;
    console.log(
        `%c[BadgeAPI] Badge version for ${userId} incremented to ${badgeVersions[userId]}`,
        "color: #00aaff; font-weight: bold;",
    );
}

// Check if cache is stale and needs refresh
function isCacheStale(userId: string): boolean {
    const lastFetch = badgeTimestamps[userId];
    if (!lastFetch) return true;

    const now = Date.now();
    const age = now - lastFetch;
    const isStale = age > BADGE_CACHE_TTL;

    if (isStale) {
        console.log(
            `%c[BadgeAPI] Cache for ${userId} is stale (${age}ms old, TTL: ${BADGE_CACHE_TTL}ms)`,
            "color: #ffaa00; font-weight: bold;",
        );
    }

    return isStale;
}

// Update cache timestamp
function updateCacheTimestamp(userId: string) {
    badgeTimestamps[userId] = Date.now();
}

// Check if badges have actually changed
function haveBadgesChanged(
    userId: string,
    newBadges: Array<{ description: string; imageUrl: string }>,
): boolean {
    const oldBadges = CustomBadges[userId];

    // If no old badges exist, it's a change
    if (!oldBadges || oldBadges.length !== newBadges.length) {
        return true;
    }

    // Compare each badge
    for (let i = 0; i < newBadges.length; i++) {
        const oldBadge = oldBadges[i];
        const newBadge = newBadges[i];

        if (
            oldBadge.description !== newBadge.description ||
            oldBadge.imageUrl !== newBadge.imageUrl
        ) {
            console.log(
                `%c[BadgeAPI] Badge change detected for ${userId}:`,
                "color: #ffaa00; font-weight: bold;",
            );
            console.log(
                `  Old: ${oldBadge.description} (${oldBadge.imageUrl})`,
            );
            console.log(
                `  New: ${newBadge.description} (${newBadge.imageUrl})`,
            );
            return true;
        }
    }

    return false;
}

// Notify all systems that badges have changed
function notifyBadgeUpdate(userId: string) {
    console.log(
        `%c[BadgeAPI] 🔄 Notifying badge update for ${userId}`,
        "color: #0099ff; font-weight: bold;",
    );

    // Increment version to trigger React updates
    incrementBadgeVersion(userId);

    // Dispatch multiple event types to ensure updates are caught
    FluxDispatcher.dispatch({
        type: "USER_UPDATE",
        user: { id: userId },
    });

    FluxDispatcher.dispatch({
        type: "USER_PROFILE_UPDATE",
        userId: userId,
    });

    FluxDispatcher.dispatch({
        type: "PROFILE_UPDATE",
        userId: userId,
    });

    // Also dispatch a custom event
    FluxDispatcher.dispatch({
        type: "BADGE_UPDATE",
        userId: userId,
        version: badgeVersions[userId],
    });

    // Force a delayed update as well
    setTimeout(() => {
        FluxDispatcher.dispatch({
            type: "USER_UPDATE",
            user: { id: userId },
        });
    }, 50);

    setTimeout(() => {
        FluxDispatcher.dispatch({
            type: "USER_UPDATE",
            user: { id: userId },
        });
    }, 150);
}

// Initialize WebSocket connection
function initializeWebSocket() {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        console.log(
            "[BadgeAPI] WebSocket already connected, skipping initialization",
        );
        return;
    }

    try {
        const userId = UserStore.getCurrentUser()?.id || "anonymous";
        const wsUrl = `wss://api.krno.net:8443/ws?id=${encodeURIComponent(userId)}`;

        console.log(
            `%c[Vermcord] Attempting to connect to Badge Server`,
            "color: #0099ff; font-weight: bold;",
        );

        wsConnection = new WebSocket(wsUrl);

        wsConnection.onopen = () => {
            const userId = UserStore.getCurrentUser()?.id;
            console.log(
                `%c[BadgeAPI] ✓ WebSocket connected successfully! User ID: ${userId}`,
                "color: #00ff00; font-weight: bold;",
            );

            // Request badges for current user on connection
            if (userId) {
                requestUserBadgesThrottled(userId, true); // Force immediate request
            }
        };

        wsConnection.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                // Handle getUserBadges response (client request)
                if (message.type === "getUserBadges" && message.payload?.id) {
                    const userId = message.payload.id;
                    const badges = message.badges || [];

                    console.log(
                        `%c[BadgeAPI] Received badge response for user ${userId}: ${badges.length} badges`,
                        "color: #00ff00; font-weight: bold;",
                    );

                    const newBadges = badges.map((b: any) => ({
                        description: b.description,
                        imageUrl: b.imageUrl,
                    }));

                    // Check if badges actually changed
                    if (haveBadgesChanged(userId, newBadges)) {
                        console.log(
                            `%c[BadgeAPI] ✓ Badges changed, updating...`,
                            "color: #00ff00; font-weight: bold;",
                        );
                        CustomBadges[userId] = newBadges;
                        updateCacheTimestamp(userId);
                        notifyBadgeUpdate(userId);
                    } else {
                        console.log(
                            `%c[BadgeAPI] ℹ No badge changes detected for ${userId}`,
                            "color: #888888;",
                        );
                        // Still update in case this is the first load
                        if (!CustomBadges[userId]) {
                            CustomBadges[userId] = newBadges;
                        }
                        updateCacheTimestamp(userId);
                        notifyBadgeUpdate(userId);
                    }

                    pendingBadgeRequests.delete(userId);
                }

                // Handle server-initiated badge push (for badge updates)
                if (
                    message.type === "badgeUpdate" ||
                    message.type === "updateBadge"
                ) {
                    const userId = message.userId;
                    const badges = message.badges || [];

                    console.log(
                        `%c[BadgeAPI] 📡 Server pushed badge update for user ${userId}: ${badges.length} badges`,
                        "color: #ffaa00; font-weight: bold;",
                    );

                    const newBadges = badges.map((b: any) => ({
                        description: b.description,
                        imageUrl: b.imageUrl,
                    }));

                    // Log the badges
                    badges.forEach((b: any, i: number) => {
                        console.log(
                            `%c  [${i + 1}] ${b.description} - ${b.imageUrl}`,
                            "color: #ffaa00;",
                        );
                    });

                    // Always update on server push and notify
                    if (haveBadgesChanged(userId, newBadges)) {
                        console.log(
                            `%c[BadgeAPI] ✓ Server push contains changes, updating...`,
                            "color: #00ff00; font-weight: bold;",
                        );
                    }

                    CustomBadges[userId] = newBadges;
                    updateCacheTimestamp(userId);
                    notifyBadgeUpdate(userId);
                }

                // Handle ping/pong
                if (message.type === "ping" && wsConnection) {
                    wsConnection.send(JSON.stringify({ type: "pong" }));
                }
            } catch (error) {
                console.error(
                    "[BadgeAPI] Error parsing WebSocket message:",
                    error,
                );
            }
        };

        wsConnection.onerror = (error) => {
            console.error(
                "%c[BadgeAPI] ✗ WebSocket error:",
                "color: #ff0000; font-weight: bold;",
                error,
            );
        };

        wsConnection.onclose = () => {
            console.warn(
                "%c[BadgeAPI] ⚠ WebSocket disconnected, attempting reconnect in 5s",
                "color: #ffaa00; font-weight: bold;",
            );
            wsConnection = null;
            setTimeout(initializeWebSocket, 5000);
        };
    } catch (error) {
        console.error(
            "%c[BadgeAPI] ✗ Failed to initialize WebSocket:",
            "color: #ff0000; font-weight: bold;",
            error,
        );
    }
}

// Request badges with throttling to prevent spam
function requestUserBadgesThrottled(userId: string, immediate = false) {
    // Clear existing throttle timer if immediate is true
    if (immediate && requestThrottleTimers[userId]) {
        clearTimeout(requestThrottleTimers[userId]);
        delete requestThrottleTimers[userId];
    }

    // If there's already a pending throttled request, don't create another
    if (requestThrottleTimers[userId] && !immediate) {
        console.log(
            `%c[BadgeAPI] Request for ${userId} is throttled, will execute soon`,
            "color: #888888;",
        );
        return;
    }

    // Immediate execution or throttled
    const executeRequest = () => {
        delete requestThrottleTimers[userId];
        requestUserBadges(userId);
    };

    if (immediate) {
        executeRequest();
    } else {
        // Throttle requests by 500ms
        requestThrottleTimers[userId] = setTimeout(executeRequest, 500);
    }
}

// Request badges for a specific user
function requestUserBadges(userId: string) {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        console.warn(
            `%c[BadgeAPI] ⚠ WebSocket not connected, cannot request badges for ${userId}`,
            "color: #ffaa00; font-weight: bold;",
        );
        return;
    }

    if (pendingBadgeRequests.has(userId)) {
        console.log(`[BadgeAPI] Badge request already pending for ${userId}`);
        return;
    }

    try {
        console.log(
            `%c[BadgeAPI] 📤 Requesting badges for user: ${userId}`,
            "color: #0099ff; font-weight: bold;",
        );
        pendingBadgeRequests.add(userId);
        wsConnection.send(
            JSON.stringify({
                type: "getUserBadges",
                payload: { id: userId },
            }),
        );
    } catch (error) {
        console.error(
            `%c[BadgeAPI] ✗ Failed to request badges for ${userId}:`,
            "color: #ff0000; font-weight: bold;",
            error,
        );
        pendingBadgeRequests.delete(userId);
    }
}

async function loadBadges(noCache = false) {
    const init = {} as RequestInit;
    if (noCache) init.cache = "no-cache";

    try {
        DonorBadges = await fetch(
            "https://badges.vencord.dev/badges.json",
            init,
        ).then((r) => r.json());
        console.log(
            "%c[BadgeAPI] ✓ Successfully loaded donor badges",
            "color: #00ff00; font-weight: bold;",
        );
    } catch (error) {
        console.error(
            "%c[BadgeAPI] ✗ Failed to load donor badges:",
            "color: #ff0000; font-weight: bold;",
            error,
        );
    }
}

let intervalId: any;
let wsReconnectInterval: any;

function BadgeContextMenu({ badge }: { badge: ProfileBadge & BadgeUserArgs }) {
    return (
        <Menu.Menu
            navId="vc-badge-context"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Badge Options"
        >
            {badge.description && (
                <Menu.MenuItem
                    id="vc-badge-copy-name"
                    label="Copy Badge Name"
                    action={() => copyWithToast(badge.description!)}
                />
            )}
            {badge.image && (
                <Menu.MenuItem
                    id="vc-badge-copy-link"
                    label="Copy Badge Image Link"
                    action={() => copyWithToast(badge.image!)}
                />
            )}
        </Menu.Menu>
    );
}

export default definePlugin({
    name: "BadgeAPI",
    description: "API to add badges to users",
    authors: [Devs.Megu, Devs.Ven, Devs.TheSun],
    required: true,
    patches: [
        {
            find: ".MODAL]:26",
            replacement: {
                match: /(?=;return 0===(\i)\.length\?)(?<=(\i)\.useMemo.+?)/,
                replace:
                    ";$1=$2.useMemo(()=>[...$self.getBadges(arguments[0].displayProfile),...$1],[$1,$self.getBadgeVersion(arguments[0].displayProfile?.userId)])",
            },
        },
        {
            find: "#{intl::PROFILE_USER_BADGES}",
            replacement: [
                {
                    match: /(alt:" ","aria-hidden":!0,src:)(.+?)(?=,)(?<=href:(\i)\.link.+?)/,
                    replace: (_, rest, originalSrc, badge) =>
                        `...${badge}.props,${rest}${badge}.image??(${originalSrc})`,
                },
                {
                    match: /(?<="aria-label":(\i)\.description,.{0,200})children:/,
                    replace:
                        "children:$1.component?$self.renderBadgeComponent({...$1}) :",
                },
                {
                    match: /href:(\i)\.link/,
                    replace: "...$self.getBadgeMouseEventHandlers($1),$&",
                },
            ],
        },
        {
            find: "profileCardUsernameRow,children:",
            replacement: {
                match: /badges:(\i)(?<=displayProfile:(\i).+?)/,
                replace: "badges:[...$self.getBadges($2),...$1]",
            },
        },
    ],

    get DonorBadges() {
        return DonorBadges;
    },

    get CustomBadges() {
        return CustomBadges;
    },

    toolboxActions: {
        async "Refetch Badges"() {
            await loadBadges(true);
            // Clear all cache timestamps to force fresh requests
            badgeTimestamps = {};
            Toasts.show({
                id: Toasts.genId(),
                message: "Successfully refetched badges! Cache cleared.",
                type: Toasts.Type.SUCCESS,
            });
        },
        "Reconnect Badge Server"() {
            console.log(
                "%c[BadgeAPI] Manual reconnect triggered",
                "color: #0099ff; font-weight: bold;",
            );
            if (wsConnection) {
                wsConnection.close();
            }
            initializeWebSocket();
            Toasts.show({
                id: Toasts.genId(),
                message: "Attempting to reconnect to badge server...",
                type: Toasts.Type.INFO,
            });
        },
    },

    userProfileBadge: ContributorBadge,

    async start() {
        console.log(
            "%c[BadgeAPI] Starting BadgeAPI plugin...",
            "color: #0099ff; font-weight: bold;",
        );
        await loadBadges();
        initializeWebSocket();

        clearInterval(intervalId);
        intervalId = setInterval(loadBadges, 1000 * 60 * 5); // 5 minutes

        clearInterval(wsReconnectInterval);
        wsReconnectInterval = setInterval(() => {
            if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
                console.warn(
                    "%c[BadgeAPI] WebSocket not connected, attempting reconnection",
                    "color: #ffaa00; font-weight: bold;",
                );
                initializeWebSocket();
            }
        }, 1000 * 60); // Check every minute

        console.log(
            "%c[BadgeAPI] ✓ Plugin started successfully",
            "color: #00ff00; font-weight: bold;",
        );
    },

    async stop() {
        console.log(
            "%c[BadgeAPI] Stopping BadgeAPI plugin...",
            "color: #0099ff; font-weight: bold;",
        );
        clearInterval(intervalId);
        clearInterval(wsReconnectInterval);

        // Clear all throttle timers
        Object.values(requestThrottleTimers).forEach((timer) =>
            clearTimeout(timer),
        );

        if (wsConnection) {
            wsConnection.close();
            wsConnection = null;
        }

        badgeVersions = {};
        badgeTimestamps = {};
        console.log(
            "%c[BadgeAPI] ✓ Plugin stopped",
            "color: #00ff00; font-weight: bold;",
        );
    },

    // Expose badge version getter
    getBadgeVersion(userId: string) {
        return getBadgeVersion(userId);
    },

    getBadges(props: { userId: string; user?: User; guildId: string }) {
        if (!props) return [];

        try {
            props.userId ??= props.user?.id!;

            // Check if cache is stale and request fresh badges
            if (isCacheStale(props.userId)) {
                console.log(
                    `%c[BadgeAPI] Cache stale for ${props.userId}, requesting fresh badges`,
                    "color: #ffaa00; font-weight: bold;",
                );
                requestUserBadgesThrottled(props.userId);
            }

            // Get all badge types
            const donorBadges = this.getDonorBadges(props.userId) || [];
            const customBadges = this.getCustomBadges(props.userId) || [];
            const badges = _getBadges(props);

            const allBadges = [...badges, ...customBadges, ...donorBadges];

            return allBadges;
        } catch (e) {
            console.error("[BadgeAPI] Error in getBadges:", e);
            return [];
        }
    },

    renderBadgeComponent: ErrorBoundary.wrap(
        (badge: ProfileBadge & BadgeUserArgs) => {
            const Component = badge.component!;
            return <Component {...badge} />;
        },
        { noop: true },
    ),

    getBadgeMouseEventHandlers(badge: ProfileBadge & BadgeUserArgs) {
        const handlers = {} as Record<string, (e: React.MouseEvent) => void>;

        if (!badge) return handlers;

        const { onClick, onContextMenu } = badge;

        if (onClick) handlers.onClick = (e) => onClick(e, badge);
        if (onContextMenu)
            handlers.onContextMenu = (e) => onContextMenu(e, badge);

        return handlers;
    },

    getDonorBadges(userId: string) {
        return DonorBadges[userId]?.map(
            (badge) =>
                ({
                    image: badge.badge,
                    description: badge.tooltip,
                    position: BadgePosition.START,
                    props: {
                        style: {
                            borderRadius: "50%",
                            transform: "scale(0.9)",
                        },
                    },
                    onContextMenu(event, badge) {
                        ContextMenuApi.openContextMenu(event, () => (
                            <BadgeContextMenu badge={badge} />
                        ));
                    },
                    onClick() {
                        const modalKey = openModal((props) => (
                            <ErrorBoundary
                                noop
                                onError={() => {
                                    closeModal(modalKey);
                                    VencordNative.native.openExternal(
                                        "https://www.youtube.com/watch?v=xvFZjo5PgG0",
                                    );
                                }}
                            >
                                <ModalRoot {...props}>
                                    <ModalHeader>
                                        <Forms.FormTitle
                                            tag="h2"
                                            style={{
                                                width: "100%",
                                                textAlign: "center",
                                                margin: 0,
                                            }}
                                        >
                                            <Flex
                                                style={{
                                                    justifyContent: "center",
                                                    alignItems: "center",
                                                    gap: "0.5em",
                                                }}
                                            >
                                                <Heart />
                                                Vencord Donor
                                            </Flex>
                                        </Forms.FormTitle>
                                    </ModalHeader>
                                    <ModalContent>
                                        <Flex>
                                            <img
                                                role="presentation"
                                                src="https://cdn.discordapp.com/emojis/1026533070955872337.png"
                                                alt=""
                                                style={{ margin: "auto" }}
                                            />
                                            <img
                                                role="presentation"
                                                src="https://cdn.discordapp.com/emojis/1026533090627174460.png"
                                                alt=""
                                                style={{ margin: "auto" }}
                                            />
                                        </Flex>
                                        <div style={{ padding: "1em" }}>
                                            <Forms.FormText>
                                                This Badge is a special perk for
                                                Vencord Donors
                                            </Forms.FormText>
                                            <Forms.FormText
                                                className={Margins.top20}
                                            >
                                                Please consider supporting the
                                                development of Vencord by
                                                becoming a donor. It would mean
                                                a lot to them!!
                                            </Forms.FormText>
                                        </div>
                                    </ModalContent>
                                    <ModalFooter>
                                        <Flex
                                            style={{
                                                width: "100%",
                                                justifyContent: "center",
                                            }}
                                        >
                                            <DonateButton />
                                        </Flex>
                                    </ModalFooter>
                                </ModalRoot>
                            </ErrorBoundary>
                        ));
                    },
                }) satisfies ProfileBadge,
        );
    },

    getCustomBadges(userId: string) {
        const customBadgeList = CustomBadges[userId];

        if (!customBadgeList || customBadgeList.length === 0) {
            return [];
        }

        console.log(
            `%c[BadgeAPI] Getting ${customBadgeList.length} custom badge(s) for ${userId}`,
            "color: #00ff00; font-weight: bold;",
        );

        return customBadgeList.map(
            (badge) =>
                ({
                    image: badge.imageUrl,
                    description: badge.description,
                    position: BadgePosition.START,
                    props: {
                        style: {
                            borderRadius: "50%",
                            transform: "scale(0.9)",
                        },
                    },
                    onContextMenu(event, badgeObj) {
                        ContextMenuApi.openContextMenu(event, () => (
                            <BadgeContextMenu badge={badgeObj} />
                        ));
                    },
                }) as ProfileBadge,
        );
    },
});
