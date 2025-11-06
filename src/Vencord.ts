/*!
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

// DO NOT REMOVE UNLESS YOU WISH TO FACE THE WRATH OF THE CIRCULAR DEPENDENCY DEMON!!!!!!!
import "~plugins";

export * as Api from "./api";
export * as Components from "./components";
export * as Plugins from "./plugins";
export * as Util from "./utils";
export * as QuickCss from "./utils/quickCss";
export * as Updater from "./utils/updater";
export * as Webpack from "./webpack";
export * as WebpackPatcher from "./webpack/patchWebpack";
export { PlainSettings, Settings };

import "./utils/quickCss";
import "./webpack/patchWebpack";

import { addVencordUiStyles } from "@components/css";
import { openUpdaterModal } from "@components/settings/tabs/updater";
import { IS_WINDOWS } from "@utils/constants";
import { createAndAppendStyle } from "@utils/css";
import { StartAt } from "@utils/types";

import { get as dsGet } from "./api/DataStore";
import { NotificationData, showNotification } from "./api/Notifications";
import { PlainSettings, Settings } from "./api/Settings";
import { patches, PMLogger, startAllPlugins } from "./plugins";
import { localStorage } from "./utils/localStorage";
import { relaunch } from "./utils/native";
import { getCloudSettings, putCloudSettings } from "./utils/settingsSync";
import { checkForUpdates, update, UpdateLogger } from "./utils/updater";
import { onceReady } from "./webpack";
import { SettingsRouter } from "./webpack/common";

if (IS_REPORTER) {
    require("./debug/runReporter");
}

const BUTTON_CLICK_SOUND =
    "https://cdn.discordapp.com/attachments/1287309916909867070/1435824882280698006/ButtonClick.mp3?ex=690d5fa0&is=690c0e20&hm=fff0e8251321ee626e59ba33ff948816781028ef41f008feee131f764bef5fe4&";

function playButtonSound() {
    const audio = new Audio(BUTTON_CLICK_SOUND);
    audio.volume = 0.3;
    audio.play().catch(() => {});
}

function createCustomNotification(
    title: string,
    body: string,
    onClick?: () => void,
    isUpdateNotification: boolean = false,
) {
    const container = document.createElement("div");
    container.id = `vencord-notification-${Date.now()}`;
    container.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: min(360px, calc(100vw - 40px));
        background: color-mix(in oklab, var(--background-secondary) 90%, black 10%);
        border: 1px solid rgba(255, 255, 255, 0.03);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.03);
        backdrop-filter: blur(10px);
        padding: 16px;
        z-index: 9999;
        animation: vc-notify-slide-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif;
        cursor: ${onClick ? "pointer" : "default"};
    `;

    const closeBtn = document.createElement("button");
    closeBtn.style.cssText = `
        position: absolute;
        top: 12px;
        right: 12px;
        background: transparent;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        padding: 0;
    `;
    closeBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;
    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        playButtonSound();
        container.style.animation =
            "vc-notify-slide-out 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards";
        setTimeout(() => container.remove(), 250);
    });
    closeBtn.addEventListener("mouseenter", () => {
        closeBtn.style.color = "var(--header-primary)";
    });
    closeBtn.addEventListener("mouseleave", () => {
        closeBtn.style.color = "var(--text-muted)";
    });

    const contentDiv = document.createElement("div");
    contentDiv.style.cssText = `
        padding-right: 24px;
    `;

    const titleDiv = document.createElement("div");
    titleDiv.style.cssText = `
        color: var(--header-primary);
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 4px;
    `;
    titleDiv.textContent = title;

    const bodyDiv = document.createElement("div");
    bodyDiv.style.cssText = `
        color: white;
        font-size: 13px;
        margin-bottom: ${isUpdateNotification || onClick ? "12px" : "0"};
    `;
    bodyDiv.textContent = body;

    contentDiv.appendChild(titleDiv);
    contentDiv.appendChild(bodyDiv);

    if (isUpdateNotification && onClick) {
        const actionBtn = document.createElement("button");
        actionBtn.style.cssText = `
            background: var(--brand-500);
            border: 1px solid rgba(88, 101, 242, 0.3);
            border-radius: 6px;
            color: white;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s ease;
            box-shadow: 0 0 12px rgba(88, 101, 242, 0.4);
        `;
        actionBtn.textContent = "Restart";
        actionBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            playButtonSound();
            container.style.animation =
                "vc-notify-slide-out 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards";
            setTimeout(() => {
                container.remove();
                onClick();
            }, 250);
        });
        actionBtn.addEventListener("mouseenter", () => {
            actionBtn.style.transform = "translateY(-2px)";
            actionBtn.style.boxShadow = "0 4px 16px rgba(88, 101, 242, 0.6)";
        });
        actionBtn.addEventListener("mouseleave", () => {
            actionBtn.style.transform = "translateY(0)";
            actionBtn.style.boxShadow = "0 0 12px rgba(88, 101, 242, 0.4)";
        });
        contentDiv.appendChild(actionBtn);
    } else if (onClick) {
        container.addEventListener("click", () => {
            playButtonSound();
            container.style.animation =
                "vc-notify-slide-out 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards";
            setTimeout(() => {
                container.remove();
                onClick();
            }, 250);
        });
    }

    container.appendChild(closeBtn);
    container.appendChild(contentDiv);

    // Add animations if not already present
    if (!document.getElementById("vc-notify-animations")) {
        const style = document.createElement("style");
        style.id = "vc-notify-animations";
        style.textContent = `
            @keyframes vc-notify-slide-in {
                from {
                    opacity: 0;
                    transform: translateX(400px);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }
            @keyframes vc-notify-slide-out {
                from {
                    opacity: 1;
                    transform: translateX(0);
                }
                to {
                    opacity: 0;
                    transform: translateX(400px);
                }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(container);

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        if (container.isConnected) {
            container.style.animation =
                "vc-notify-slide-out 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards";
            setTimeout(() => container.remove(), 250);
        }
    }, 5000);
}

const originalShowNotification = showNotification;
export function showNotification(data: NotificationData) {
    // If it's permanent or has a custom color, use original
    if (data.permanent || data.color) {
        return originalShowNotification(data);
    }

    // Use custom notification theme
    createCustomNotification(
        data.title || "Notification",
        data.body || "",
        data.onClick,
        false,
    );
}

async function syncSettings() {
    // pre-check for local shared settings
    if (Settings.cloud.authenticated && !(await dsGet("Vencord_cloudSecret"))) {
        createCustomNotification(
            "Cloud Integrations",
            "We've noticed you have cloud integrations enabled in another client! Due to limitations, you will need to re-authenticate to continue using them.",
            () => SettingsRouter.open("VencordCloud"),
            false,
        );
        return;
    }

    if (Settings.cloud.settingsSync && Settings.cloud.authenticated) {
        if (localStorage.Vencord_settingsDirty) {
            await putCloudSettings();
            delete localStorage.Vencord_settingsDirty;
        } else if (await getCloudSettings(false)) {
            createCustomNotification(
                "Cloud Settings",
                "Your settings have been updated! Click here to restart to fully apply changes!",
                relaunch,
                false,
            );
        }
    }
}

let notifiedForUpdatesThisSession = false;

async function runUpdateCheck() {
    const notify = (title: string, onClick: () => void) => {
        if (notifiedForUpdatesThisSession) return;
        notifiedForUpdatesThisSession = true;

        setTimeout(
            () =>
                createCustomNotification(
                    title,
                    "Click here to restart",
                    onClick,
                    true,
                ),
            10_000,
        );
    };

    try {
        const isOutdated = await checkForUpdates();
        if (!isOutdated) return;

        if (Settings.autoUpdate) {
            await update();
            if (Settings.autoUpdateNotification) {
                notify("Vermcord has been updated!", relaunch);
            }
            return;
        }

        notify("A Vencord update is available!", openUpdaterModal!);
    } catch (err) {
        UpdateLogger.error("Failed to check for updates", err);
    }
}

async function init() {
    await onceReady;
    startAllPlugins(StartAt.WebpackReady);

    syncSettings();

    if (!IS_WEB && !IS_UPDATER_DISABLED) {
        runUpdateCheck();

        if (Settings.autoUpdate && !Settings.autoUpdateNotification) {
            setInterval(runUpdateCheck, 1000 * 60 * 5);
        }
    }

    if (IS_DEV) {
        const pendingPatches = patches.filter(
            (p) => !p.all && p.predicate?.() !== false,
        );
        if (pendingPatches.length)
            PMLogger.warn(
                "Webpack has finished initialising, but some patches haven't been applied yet.",
                "This might be expected since some Modules are lazy loaded, but please verify",
                "that all plugins are working as intended.",
                "You are seeing this warning because this is a Development build of Vencord.",
                "\nThe following patches have not been applied:",
                "\n\n" +
                    pendingPatches
                        .map((p) => `${p.plugin}: ${p.find}`)
                        .join("\n"),
            );
    }
}

startAllPlugins(StartAt.Init);
init();

document.addEventListener(
    "DOMContentLoaded",
    () => {
        addVencordUiStyles();

        startAllPlugins(StartAt.DOMContentLoaded);

        if (IS_DISCORD_DESKTOP && Settings.winNativeTitleBar && IS_WINDOWS) {
            createAndAppendStyle("vencord-native-titlebar-style").textContent =
                "[class*=titleBar]{display: none!important}";
        }
    },
    { once: true },
);
