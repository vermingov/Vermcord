/**
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { Devs } from "@utils/constants";

let backgroundBlur: HTMLElement | null = null;
let loadingElement: HTMLElement | null = null;
let checkmarkElement: HTMLElement | null = null;
let progressBar: HTMLElement | null = null;
let progressInterval: NodeJS.Timeout | null = null;
let currentProgress = 0;

const CHECKMARK_SOUND_URL =
    "https://cdn.discordapp.com/attachments/1287309916909867070/1435820138795634729/checkmark.mp3?ex=690d5b35&is=690c09b5&hm=11d4c9d96baed0d10d64946e3d07c91de82d8efd1e4fd8e20228a56046d07045";

function playCheckmarkSound() {
    try {
        const audio = new Audio(CHECKMARK_SOUND_URL);
        audio.volume = 0.5;
        audio.play().catch((err) => {
            console.warn(
                "[VermcordLoader] Failed to play checkmark sound:",
                err,
            );
        });
    } catch (err) {
        console.warn("[VermcordLoader] Error playing sound:", err);
    }
}

function createBackgroundBlur(): HTMLElement {
    const blur = document.createElement("div");
    blur.id = "vermcord-bg-blur";
    blur.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, var(--background-primary) 0%, var(--background-secondary) 100%);
        z-index: 9997;
        backdrop-filter: blur(10px);
        opacity: 1;
        transition: opacity 0.5s ease;
    `;
    return blur;
}

function createLoadingScreen(): HTMLElement {
    const container = document.createElement("div");
    container.id = "vermcord-loading-screen";
    container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 9998;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif;
        opacity: 1;
        transition: opacity 0.5s ease;
    `;

    container.innerHTML = `
        <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 40px;
        ">
            <div style="
                position: relative;
                width: 80px;
                height: 80px;
                display: flex;
                align-items: center;
                justify-content: center;
            ">
                <svg id="vc-spinner" width="80" height="80" viewBox="0 0 80 80" fill="none" style="animation: vc-spin 2s linear infinite;">
                    <circle cx="40" cy="40" r="35" stroke="var(--brand-500)" stroke-width="3" stroke-dasharray="55 165" stroke-linecap="round"/>
                </svg>
            </div>

            <div style="
                display: flex;
                align-items: center;
                gap: 8px;
            ">
                <span style="
                    color: var(--header-primary);
                    font-size: 24px;
                    font-weight: 600;
                    letter-spacing: 0.5px;
                ">Vermcord Is Loading</span>
                <span id="vc-loading-dots" style="
                    color: var(--header-primary);
                    font-size: 24px;
                    font-weight: 600;
                    min-width: 12px;
                    animation: vc-blink 1s steps(1, end) infinite;
                ">.</span>
            </div>

            <div style="
                width: 320px;
                display: flex;
                flex-direction: column;
                gap: 16px;
            ">
                <div style="
                    width: 100%;
                    height: 6px;
                    background: var(--background-tertiary);
                    border-radius: 3px;
                    overflow: hidden;
                    box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.2);
                ">
                    <div id="vc-progress-bar" style="
                        height: 100%;
                        background: linear-gradient(90deg, var(--brand-500, #5865F2), var(--brand-560, #4752C4));
                        border-radius: 3px;
                        width: 0%;
                        transition: width 0.3s ease;
                        box-shadow: 0 0 12px rgba(88, 101, 242, 0.6);
                    "></div>
                </div>

                <div style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                ">
                    <span style="
                        color: var(--text-muted);
                        font-size: 12px;
                        font-weight: 500;
                    ">Loading components...</span>
                    <span id="vc-progress-text" style="
                        color: var(--text-muted);
                        font-size: 12px;
                        font-weight: 500;
                    ">0%</span>
                </div>
            </div>
        </div>
    `;

    return container;
}

function createCheckmarkScreen(): HTMLElement {
    const container = document.createElement("div");
    container.id = "vermcord-checkmark-screen";
    container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9998;
        opacity: 0;
        transition: opacity 0.5s ease;
    `;

    container.innerHTML = `
        <div id="vc-checkmark-container" style="
            position: relative;
            width: 150px;
            height: 150px;
            display: flex;
            align-items: center;
            justify-content: center;
        ">
            <svg id="vc-checkmark-svg" width="150" height="150" viewBox="0 0 150 150" fill="none" style="position: absolute;">
                <circle id="vc-circle" cx="75" cy="75" r="60" stroke="var(--brand-500)" stroke-width="3" fill="none" style="stroke-dasharray: 377; stroke-dashoffset: 377; opacity: 0;"/>
                <polyline id="vc-checkmark" points="55,75 70,90 105,55" stroke="var(--brand-500)" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="stroke-dasharray: 60; stroke-dashoffset: 60; opacity: 0;"/>
            </svg>
        </div>
    `;

    return container;
}

function showLoadingScreen() {
    backgroundBlur = createBackgroundBlur();
    document.body.appendChild(backgroundBlur);

    loadingElement = createLoadingScreen();
    document.body.appendChild(loadingElement);

    if (!document.getElementById("vc-loading-styles")) {
        const style = document.createElement("style");
        style.id = "vc-loading-styles";
        style.textContent = `
            @keyframes vc-spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            @keyframes vc-blink {
                0% { opacity: 1; }
                50% { opacity: 0.3; }
                100% { opacity: 1; }
            }

            @keyframes vc-draw-circle {
                0% {
                    stroke-dashoffset: 377;
                    opacity: 0;
                }
                10% { opacity: 1; }
                100% {
                    stroke-dashoffset: 0;
                    opacity: 1;
                }
            }

            @keyframes vc-draw-checkmark {
                0% {
                    stroke-dashoffset: 60;
                    opacity: 0;
                }
                20% { opacity: 1; }
                100% {
                    stroke-dashoffset: 0;
                    opacity: 1;
                }
            }

            @keyframes vc-scale-pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.2); }
                100% { transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
    }

    currentProgress = 0;
    progressBar = document.getElementById("vc-progress-bar");

    progressInterval = setInterval(() => {
        currentProgress += Math.random() * 15 + 5;
        if (currentProgress > 90) currentProgress = 90;

        if (progressBar) {
            progressBar.style.width = `${currentProgress}%`;
        }

        const progressText = document.getElementById("vc-progress-text");
        if (progressText) {
            progressText.textContent = `${Math.floor(currentProgress)}%`;
        }
    }, 200);
}

function fadeOutLoadingScreen() {
    return new Promise<void>((resolve) => {
        if (progressInterval) clearInterval(progressInterval);

        if (progressBar) progressBar.style.width = "100%";

        const progressText = document.getElementById("vc-progress-text");
        if (progressText) progressText.textContent = "100%";

        setTimeout(() => {
            if (loadingElement) {
                loadingElement.style.opacity = "0";

                setTimeout(() => {
                    loadingElement?.remove();
                    loadingElement = null;
                    resolve();
                }, 500);
            } else {
                resolve();
            }
        }, 300);
    });
}

function showCheckmarkAnimation() {
    return new Promise<void>((resolve) => {
        checkmarkElement = createCheckmarkScreen();
        document.body.appendChild(checkmarkElement);

        setTimeout(() => {
            if (checkmarkElement) {
                checkmarkElement.style.opacity = "1";
            }
        }, 50);

        const container = document.getElementById("vc-checkmark-container");
        const circle = document.getElementById("vc-circle");
        const checkmark = document.getElementById("vc-checkmark");

        setTimeout(() => {
            if (circle) {
                circle.style.animation =
                    "vc-draw-circle 0.7s ease-out forwards";
            }

            if (checkmark) {
                checkmark.style.animation =
                    "vc-draw-checkmark 0.9s ease-out 0.2s forwards";
            }

            if (container) {
                container.style.animation =
                    "vc-scale-pulse 0.8s ease-in-out 0.5s forwards";
            }

            setTimeout(() => {
                playCheckmarkSound();
            }, 500);
        }, 300);

        setTimeout(() => {
            if (checkmarkElement) {
                checkmarkElement.style.opacity = "0";

                setTimeout(() => {
                    checkmarkElement?.remove();
                    checkmarkElement = null;
                    resolve();
                }, 500);
            } else {
                resolve();
            }
        }, 2300);
    });
}

function fadeOutBackgroundBlur() {
    return new Promise<void>((resolve) => {
        if (backgroundBlur) {
            backgroundBlur.style.opacity = "0";

            setTimeout(() => {
                backgroundBlur?.remove();
                backgroundBlur = null;
                resolve();
            }, 500);
        } else {
            resolve();
        }
    });
}

export default definePlugin({
    name: "VermcordLoader",
    description: "Loadingscreen for Vermcord",
    authors: [Devs.Vermin],
    required: true,

    start() {
        console.log("[VermcordLoader] Starting...");
        showLoadingScreen();

        setTimeout(async () => {
            // Fade out loading screen FIRST
            await fadeOutLoadingScreen();

            // THEN show checkmark animation
            const checkmarkPromise = showCheckmarkAnimation();
            await checkmarkPromise;

            // Finally fade out blur
            await fadeOutBackgroundBlur();
            console.log("[VermcordLoader] Loading complete!");
        }, 2000);
    },

    stop() {
        console.log("[VermcordLoader] Stopping...");

        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }

        if (backgroundBlur) {
            backgroundBlur.remove();
            backgroundBlur = null;
        }

        if (loadingElement) {
            loadingElement.remove();
            loadingElement = null;
        }

        if (checkmarkElement) {
            checkmarkElement.remove();
            checkmarkElement = null;
        }

        const styleEl = document.getElementById("vc-loading-styles");
        if (styleEl) styleEl.remove();
    },
});
