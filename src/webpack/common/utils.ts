/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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

import type * as t from "@vencord/discord-types";
import {
    _resolveReady,
    filters,
    findByCodeLazy,
    findByPropsLazy,
    findLazy,
    mapMangledModuleLazy,
    waitFor,
} from "@webpack";

export let FluxDispatcher: t.FluxDispatcher;
waitFor(["dispatch", "subscribe"], (m) => {
    FluxDispatcher = m;
    // Non import access to avoid circular dependency
    Vencord.Plugins.subscribeAllPluginsFluxEvents(m);

    const cb = () => {
        m.unsubscribe("CONNECTION_OPEN", cb);
        _resolveReady();
    };
    m.subscribe("CONNECTION_OPEN", cb);
});

export let ComponentDispatch: any;
waitFor(["dispatchToLastSubscribed"], (m) => (ComponentDispatch = m));

export const Constants: t.Constants = mapMangledModuleLazy('ME:"/users/@me"', {
    Endpoints: filters.byProps("USER", "ME"),
    UserFlags: filters.byProps("STAFF", "SPAMMER"),
    FriendsSections: (m) => m.PENDING === "PENDING" && m.ADD_FRIEND,
});

export const RestAPI: t.RestAPI = findLazy(
    (m) => typeof m === "object" && m.del && m.put,
);
export const moment: typeof import("moment") =
    findByPropsLazy("parseTwoDigitYear");

export const hljs: typeof import("highlight.js").default = findByPropsLazy(
    "highlight",
    "registerLanguage",
);

export const { match, P }: Pick<typeof import("ts-pattern"), "match" | "P"> =
    mapMangledModuleLazy("@ts-pattern/matcher", {
        match: filters.byCode("return new"),
        P: filters.byProps("when"),
    });

export const lodash: typeof import("lodash") = findByPropsLazy(
    "debounce",
    "cloneDeep",
);

export const i18n = mapMangledModuleLazy(
    'defaultLocale:"en-US"',
    {
        t: (m) => m?.[Symbol.toStringTag] === "IntlMessagesProxy",
        intl: (m) =>
            m != null && Object.getPrototypeOf(m)?.withFormatters != null,
    },
    true,
);

export let SnowflakeUtils: t.SnowflakeUtils;
waitFor(["fromTimestamp", "extractTimestamp"], (m) => (SnowflakeUtils = m));

export let Parser: t.Parser;
waitFor("parseTopic", (m) => (Parser = m));
export let Alerts: t.Alerts;
waitFor(["show", "close"], (m) => (Alerts = m));

const ToastType = {
    MESSAGE: "message",
    SUCCESS: "success",
    FAILURE: "failure",
    CUSTOM: "custom",
    CLIP: "clip",
    LINK: "link",
    FORWARD: "forward",
    BOOKMARK: "bookmark",
    CLOCK: "clock",
};

const ToastPosition = {
    TOP: 0,
    BOTTOM: 1,
};

export interface ToastData {
    message: string;
    id: string;
    type: string;
    options?: ToastOptions;
}

export interface ToastOptions {
    position?: number;
    component?: React.ReactNode;
    duration?: number;
}

// Custom toast styling system
function getToastTypeIcon(type: string): string {
    switch (type) {
        case ToastType.SUCCESS:
            return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="var(--status-positive)"/></svg>';
        case ToastType.FAILURE:
            return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="var(--status-danger)" stroke-width="2"/><path d="M8 8l8 8M16 8l-8 8" stroke="var(--status-danger)" stroke-width="2"/></svg>';
        case ToastType.MESSAGE:
        default:
            return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="animation: md-spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke="var(--brand-500)" stroke-width="2" stroke-dasharray="15.7 31.4" /></svg>';
    }
}

function createCustomToastElement(message: string, type: string): HTMLElement {
    const container = document.createElement("div");
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
        animation: toast-enter 0.3s ease;
    `;

    container.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
                ${getToastTypeIcon(type)}
            </div>
            <span style="color: var(--header-primary); font-weight: 500; font-size: 14px; flex: 1; word-break: break-word;">
                ${message}
            </span>
        </div>
    `;

    // Add animation styles if not present
    if (!document.getElementById("toast-animation-styles")) {
        const style = document.createElement("style");
        style.id = "toast-animation-styles";
        style.textContent = `
            @keyframes md-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            @keyframes toast-enter {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            }
            @keyframes toast-exit {
                from {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
                to {
                    opacity: 0;
                    transform: translateX(-50%) translateY(-10px);
                }
            }
        `;
        document.head.appendChild(style);
    }

    return container;
}

function showCustomToast(
    message: string,
    type: string,
    duration: number = 3000,
) {
    const toastElement = createCustomToastElement(message, type);
    document.body.appendChild(toastElement);

    if (duration > 0) {
        setTimeout(() => {
            toastElement.style.animation = "toast-exit 0.3s ease forwards";
            setTimeout(() => toastElement.remove(), 300);
        }, duration);
    }

    return toastElement;
}

export const Toasts = {
    Type: ToastType,
    Position: ToastPosition,
    genId: () => (Math.random() || Math.random()).toString(36).slice(2),

    ...({} as {
        show(data: ToastData): void;
        pop(): void;
        create(
            message: string,
            type: string,
            options?: ToastOptions,
        ): ToastData;
    }),
};

// Override with custom toast styling
waitFor("showToast", (m) => {
    Toasts.show = (data: ToastData) => {
        const duration = data.options?.duration ?? 3000;
        showCustomToast(data.message, data.type, duration);
    };

    Toasts.pop = m.popToast;
    Toasts.create = m.createToast;
});

/**
 * Show a simple toast. If you need more options, use Toasts.show manually
 */
export function showToast(
    message: string,
    type = ToastType.MESSAGE,
    options?: ToastOptions,
) {
    const duration = options?.duration ?? 3000;
    showCustomToast(message, type, duration);
}

export const UserUtils = {
    getUser: findByCodeLazy(".USER("),
};

export const UploadManager = findByPropsLazy("clearAll", "addFile");
export const UploadHandler = {
    promptToUpload: findByCodeLazy("=!0,showLargeMessageDialog:") as (
        files: File[],
        channel: t.Channel,
        draftType: Number,
    ) => void,
};

export const ApplicationAssetUtils = mapMangledModuleLazy(
    "getAssetImage: size must === [",
    {
        fetchAssetIds: filters.byCode('.startsWith("http:")', ".dispatch({"),
        getAssetFromImageURL: filters.byCode("].serialize(", ',":"'),
        getAssetImage: filters.byCode("getAssetImage: size must === ["),
        getAssets: filters.byCode(".assets"),
    },
);

export const NavigationRouter: t.NavigationRouter = mapMangledModuleLazy(
    "Transitioning to ",
    {
        transitionTo: filters.byCode("transitionTo -"),
        transitionToGuild: filters.byCode("transitionToGuild -"),
        back: filters.byCode("goBack()"),
        forward: filters.byCode("goForward()"),
    },
);

export const ChannelRouter: t.ChannelRouter = mapMangledModuleLazy(
    '"Thread must have a parent ID."',
    {
        transitionToChannel: filters.byCode(".preload"),
        transitionToThread: filters.byCode('"Thread must have a parent ID."'),
    },
);

export let SettingsRouter: any;
waitFor(["open", "saveAccountChanges"], (m) => (SettingsRouter = m));

export const PermissionsBits: t.PermissionsBits = findLazy(
    (m) => typeof m.ADMINISTRATOR === "bigint",
);

export const { zustandCreate } = mapMangledModuleLazy(
    ["useSyncExternalStoreWithSelector:", "Object.assign"],
    {
        zustandCreate: filters.byCode(/=>(\i)\?\i\(\1/),
    },
);

export const { zustandPersist } = mapMangledModuleLazy(
    ".onRehydrateStorage)?",
    {
        zustandPersist: filters.byCode(/(\(\i,\i\))=>.+?\i\1/),
    },
);

export const MessageActions = findByPropsLazy("editMessage", "sendMessage");
export const MessageCache = findByPropsLazy("clearCache", "_channelMessages");
export const UserProfileActions = findByPropsLazy(
    "openUserProfileModal",
    "closeUserProfileModal",
);
export const InviteActions = findByPropsLazy("resolveInvite");
export const ChannelActionCreators = findByPropsLazy("openPrivateChannel");

export const IconUtils: t.IconUtils = findByPropsLazy(
    "getGuildBannerURL",
    "getUserAvatarURL",
);

export const ExpressionPickerStore: t.ExpressionPickerStore =
    mapMangledModuleLazy("expression-picker-last-active-view", {
        openExpressionPicker: filters.byCode(
            /setState\({activeView:(?:(?!null)\i),activeViewType:/,
        ),
        closeExpressionPicker: filters.byCode("setState({activeView:null"),
        toggleMultiExpressionPicker: filters.byCode(".EMOJI,"),
        toggleExpressionPicker: filters.byCode(
            /getState\(\)\.activeView===\i\?\i\(\):\i\(/,
        ),
        setExpressionPickerView: filters.byCode(
            /setState\({activeView:\i,lastActiveView:/,
        ),
        setSearchQuery: filters.byCode("searchQuery:"),
        useExpressionPickerStore: filters.byCode(/\(\i,\i=\i\)=>/),
    });

export const PopoutActions: t.PopoutActions = mapMangledModuleLazy(
    'type:"POPOUT_WINDOW_OPEN"',
    {
        open: filters.byCode('type:"POPOUT_WINDOW_OPEN"'),
        close: filters.byCode('type:"POPOUT_WINDOW_CLOSE"'),
        setAlwaysOnTop: filters.byCode(
            'type:"POPOUT_WINDOW_SET_ALWAYS_ON_TOP"',
        ),
    },
);

export const UsernameUtils: t.UsernameUtils = findByPropsLazy(
    "useName",
    "getGlobalName",
);
export const DisplayProfileUtils: t.DisplayProfileUtils = mapMangledModuleLazy(
    /=\i\.getUserProfile\(\i\),\i=\i\.getGuildMemberProfile\(/,
    {
        getDisplayProfile: filters.byCode(".getGuildMemberProfile("),
        useDisplayProfile: filters.byCode(/\[\i\.\i,\i\.\i],\(\)=>/),
    },
);

export const DateUtils: t.DateUtils = mapMangledModuleLazy(
    "millisecondsInUnit:",
    {
        calendarFormat: filters.byCode("sameElse"),
        dateFormat: filters.byCode('":'),
        isSameDay: filters.byCode(/Math\.abs\(\+?\i-\+?\i\)/),
        diffAsUnits: filters.byCode("days:0", "millisecondsInUnit"),
    },
);

export const MessageTypeSets: t.MessageTypeSets = findByPropsLazy(
    "REPLYABLE",
    "FORWARDABLE",
);
