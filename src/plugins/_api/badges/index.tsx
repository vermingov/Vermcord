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
let wsConnection: WebSocket | null = null;
const logger = new Logger("BadgeAPI");
const pendingBadgeRequests = new Set<string>();

// Track badge hashes to detect changes
const badgeHashes = new Map<string, string>();

function hashBadges(badges: Array<{ description: string; imageUrl: string }>) {
    return JSON.stringify(badges);
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

        console.log(`[Vermcord] Attempting to connect to Server`);

        wsConnection = new WebSocket(wsUrl);

        wsConnection.onopen = () => {
            const userId = UserStore.getCurrentUser()?.id;
            console.log(
                `%c[BadgeAPI] ✓ WebSocket connected successfully! User ID: ${userId}`,
                "color: #00ff00; font-weight: bold;",
            );

            // Request badges for current user on connection
            if (userId) {
                requestUserBadges(userId);
            }
        };

        wsConnection.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log("[BadgeAPI] WebSocket message received:", message);

                // Handle getUserBadges response
                if (message.type === "getUserBadges") {
                    const userId = message.payload?.id;
                    if (userId) {
                        let badgesChanged = false;

                        if (message.badges && message.badges.length > 0) {
                            const newBadges = message.badges.map(
                                (badge: any) => ({
                                    description: badge.description,
                                    imageUrl: badge.imageUrl,
                                }),
                            );

                            const newHash = hashBadges(newBadges);
                            const oldHash = badgeHashes.get(userId);

                            // Check if badges actually changed
                            if (oldHash !== newHash) {
                                badgesChanged = true;
                                badgeHashes.set(userId, newHash);
                                CustomBadges[userId] = newBadges;

                                console.log(
                                    `%c[BadgeAPI] ✓ Badge update for user ${userId}: ${newBadges.length} badge(s)`,
                                    "color: #00ff00; font-weight: bold;",
                                );

                                newBadges.forEach(
                                    (badge: any, index: number) => {
                                        console.log(
                                            `  [${index + 1}] ${badge.description} - ${badge.imageUrl}`,
                                        );
                                    },
                                );
                            } else {
                                console.log(
                                    `%c[BadgeAPI] ℹ Badges unchanged for user ${userId}`,
                                    "color: #0099ff; font-weight: bold;",
                                );
                            }
                        } else {
                            // No badges - check if this is a change
                            const oldHash = badgeHashes.get(userId);
                            if (oldHash !== undefined) {
                                badgesChanged = true;
                                badgeHashes.delete(userId);
                            }

                            delete CustomBadges[userId];
                            console.log(
                                `%c[BadgeAPI] ✓ User ${userId} has no badges, cleared cache`,
                                "color: #00ff00; font-weight: bold;",
                            );
                        }

                        // Only dispatch if badges actually changed
                        if (badgesChanged) {
                            console.log(
                                `[BadgeAPI] Dispatching PROFILE_UPDATE for user ${userId}`,
                            );
                            FluxDispatcher.dispatch({
                                type: "PROFILE_UPDATE",
                                user: { id: userId },
                            });
                        }

                        // Remove from pending requests
                        pendingBadgeRequests.delete(userId);
                    }
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
                "%c[BadgeAPI] ⚠ WebSocket disconnected from badge server",
                "color: #ffaa00; font-weight: bold;",
            );
            wsConnection = null;
            // Attempt to reconnect after 5 seconds
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

// Request badges for a specific user
function requestUserBadges(userId: string) {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        console.warn(
            `%c[BadgeAPI] ⚠ WebSocket not connected, cannot request badges for user ${userId}`,
            "color: #ffaa00; font-weight: bold;",
        );
        return;
    }

    // Avoid duplicate requests
    if (pendingBadgeRequests.has(userId)) {
        return;
    }

    try {
        console.log(`[BadgeAPI] Requesting badges for user: ${userId}`);
        pendingBadgeRequests.add(userId);
        wsConnection.send(
            JSON.stringify({
                type: "getUserBadges",
                payload: { id: userId },
            }),
        );
    } catch (error) {
        console.error(
            `%c[BadgeAPI] ✗ Failed to request user badges for ${userId}:`,
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
                    ";$1=$2.useMemo(()=>[...$self.getBadges(arguments[0].displayProfile),...$1],[$1])",
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
            Toasts.show({
                id: Toasts.genId(),
                message: "Successfully refetched badges!",
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
        if (wsConnection) {
            wsConnection.close();
            wsConnection = null;
        }
        console.log(
            "%c[BadgeAPI] ✓ Plugin stopped",
            "color: #00ff00; font-weight: bold;",
        );
    },

    getBadges(props: { userId: string; user?: User; guildId: string }) {
        if (!props) return [];

        try {
            props.userId ??= props.user?.id!;
            console.log(
                `%c[BadgeAPI] getBadges called for user: ${props.userId}`,
                "color: #0099ff; font-weight: bold;",
            );

            // Request badges if we don't have them yet
            if (!CustomBadges[props.userId]) {
                console.log(
                    `%c[BadgeAPI] No cached badges for ${props.userId}, requesting from server`,
                    "color: #ffaa00; font-weight: bold;",
                );
                requestUserBadges(props.userId);
            }

            // Get donor badges and custom badges
            const donorBadges = this.getDonorBadges(props.userId) || [];
            const customBadges = this.getCustomBadges(props.userId) || [];

            const badges = _getBadges(props);
            const allBadges = [...badges, ...customBadges, ...donorBadges];

            console.log(
                `%c[BadgeAPI] Total badges for ${props.userId}: ${allBadges.length} (Vencord: ${badges.length}, Custom: ${customBadges.length}, Donor: ${donorBadges.length})`,
                "color: #0099ff; font-weight: bold;",
            );

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
            `%c[BadgeAPI] Found ${customBadgeList.length} custom badge(s) for user ${userId}`,
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
