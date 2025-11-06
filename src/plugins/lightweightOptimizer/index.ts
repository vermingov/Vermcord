/*
 * Vencord, a modification for Discord's desktop app
 * PERFORMANCE ENHANCER
 * Fixes UI lag + removes 50+ hidden channels per server
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { showToast, Toasts } from "@webpack/common";

const logger = new Logger("PerformanceEnhancer");

interface CacheEntry {
    data: any;
    time: number;
}

export default definePlugin({
    name: "PerformanceFix",
    description: "Provides significant performance enhancements.",
    authors: [Devs.Vermin],
    required: true,

    currentGuildId: null as string | null,
    guildsWithHiddenChannels: new Map<string, number>(),
    removalInterval: null as NodeJS.Timeout | null,

    start() {
        logger.log("🚀 PERFORMANCE ENHANCER STARTING...");

        this.fixNumberRendering();
        this.optimizeNetwork();
        this.throttleDOM();
        this.optimizeScrolling();
        this.lazyLoadImages();
        this.setupGuildTracking();
        this.startHiddenChannelRemoval();

        logger.log("✅ PERFORMANCE ENHANCER ACTIVE!");
    },

    fixNumberRendering() {
        const style = document.createElement("style");
        style.id = "perf-number-rendering";
        style.textContent = `
            * {
                font-variant-numeric: tabular-nums !important;
            }

            .timestamp, .time, [class*="time"], [class*="counter"],
            .badge, .pill, .tag, .label {
                font-feature-settings: "tnum" 1 !important;
            }
        `;
        document.head.appendChild(style);
        logger.log("✅ Number Rendering: FIXED");
    },

    optimizeNetwork() {
        const cache = new Map<string, CacheEntry>();
        const originalFetch = window.fetch;

        (window as any).fetch = function (
            resource: RequestInfo | URL,
            init?: RequestInit,
        ) {
            const key = JSON.stringify({
                resource,
                method: init?.method || "GET",
            });
            const cached = cache.get(key);
            const now = Date.now();

            if (cached && now - cached.time < 20000) {
                if (cached.data instanceof Response) {
                    return Promise.resolve(cached.data.clone());
                }
            }

            return originalFetch(resource, init)
                .then((response) => {
                    if (init?.method === "GET" || !init?.method) {
                        cache.set(key, { data: response.clone(), time: now });
                    }
                    return response;
                })
                .catch((err) => {
                    throw err;
                });
        };

        logger.log("✅ Network Caching: Active");
    },

    throttleDOM() {
        const originalObserverCallback = MutationObserver.prototype.observe;
        MutationObserver.prototype.observe = function (target, options) {
            return originalObserverCallback.call(this, target, {
                ...options,
                subtree: options.subtree ?? false,
                characterData: false,
            });
        };

        let resizeTimeout: NodeJS.Timeout | null = null;
        const originalAddEventListener = window.addEventListener;
        window.addEventListener = function (type, listener, options) {
            if (type === "resize") {
                const throttledListener = function (...args: any[]) {
                    if (resizeTimeout) clearTimeout(resizeTimeout);
                    resizeTimeout = setTimeout(
                        () => (listener as any).apply(this, args),
                        150,
                    );
                };
                return originalAddEventListener.call(
                    this,
                    type,
                    throttledListener,
                    options,
                );
            }
            return originalAddEventListener.call(this, type, listener, options);
        };

        logger.log("✅ DOM Throttling: Active");
    },

    optimizeScrolling() {
        const style = document.createElement("style");
        style.id = "perf-scroll-opt";
        style.textContent = `
            /* Instant scrolling */
            * {
                scroll-behavior: auto !important;
            }

            /* GPU acceleration */
            .scroller, .channels, .memberList, .guildChannels {
                transform: translateZ(0) !important;
                -webkit-transform: translateZ(0) !important;
                will-change: scroll-position;
            }

            /* Simple scrollbar */
            ::-webkit-scrollbar {
                width: 8px;
                height: 8px;
            }

            ::-webkit-scrollbar-track {
                background: transparent;
            }

            ::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.2);
                border-radius: 4px;
            }

            ::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.3);
            }

            /* Reduce repaints during scroll */
            .channels, .memberList {
                contain: layout;
                max-height: 100vh;
                overflow-y: auto;
            }

            /* Hide overflow for performance */
            .channel:not(:nth-child(-n+100)),
            .member:not(:nth-child(-n+100)) {
                visibility: hidden;
                height: 32px;
                pointer-events: none;
            }

            /* Show nearby items */
            .channel:nth-child(-n+150),
            .channel:nth-last-child(-n+50),
            .member:nth-child(-n+150),
            .member:nth-last-child(-n+50) {
                visibility: visible;
                height: auto;
            }

            /* Reduce complexity */
            .categoryCollapse {
                transition: none !important;
            }

            .categoryCollapsed + .channel,
            .categoryCollapsed ~ .channel {
                display: none !important;
            }
        `;
        document.head.appendChild(style);

        logger.log("✅ Scrolling: Optimized");
    },

    lazyLoadImages() {
        const lazyImages = () => {
            document
                .querySelectorAll("img:not([loading])")
                .forEach((img: any) => {
                    img.loading = "lazy";
                    img.decoding = "async";
                });
        };

        lazyImages();
        setInterval(lazyImages, 15000);

        logger.log("✅ Image Lazy Loading: Active");
    },

    setupGuildTracking() {
        // Track current guild - reset when switching servers
        setInterval(() => {
            try {
                // Get current guild ID from URL or active element
                const href = window.location.pathname;
                const parts = href.split("/");
                const guildId = parts[2]; // /channels/GUILD_ID/CHANNEL_ID

                if (guildId && guildId !== this.currentGuildId) {
                    logger.log(
                        `[PerformanceEnhancer] Switched guild: ${this.currentGuildId} → ${guildId}`,
                    );
                    this.currentGuildId = guildId;
                }
            } catch (e) {
                // Ignore
            }
        }, 1000);

        logger.log("✅ Guild Tracking: Active");
    },

    startHiddenChannelRemoval() {
        let toastShown = false;

        // Continuously remove excessive hidden channels from current guild
        this.removalInterval = setInterval(() => {
            try {
                if (!this.currentGuildId) return;

                const channels = document.querySelectorAll(
                    "[data-list-item-id^='channels___']",
                );
                const hiddenChannels: HTMLElement[] = [];

                // Find all hidden channels (those with lock icons)
                channels.forEach((ch: any) => {
                    try {
                        const href = ch.getAttribute("href");
                        if (!href) return;

                        const parts = href.split("/");
                        if (parts.length < 3) return;

                        const guildId = parts[2];

                        // Only process current guild
                        if (guildId !== this.currentGuildId) return;

                        // Check for lock icon
                        const hasLockIcon = ch.querySelector(
                            "svg path[fill-rule='evenodd']",
                        );
                        if (hasLockIcon) {
                            hiddenChannels.push(ch);
                        }
                    } catch (e) {
                        // Ignore
                    }
                });

                // If more than 50, remove them all
                if (hiddenChannels.length > 50) {
                    if (
                        !this.guildsWithHiddenChannels.has(
                            this.currentGuildId,
                        ) ||
                        this.guildsWithHiddenChannels.get(
                            this.currentGuildId,
                        ) !== hiddenChannels.length
                    ) {
                        logger.log(
                            `[PerformanceEnhancer] Guild ${this.currentGuildId}: ${hiddenChannels.length} hidden channels - REMOVING`,
                        );
                        this.guildsWithHiddenChannels.set(
                            this.currentGuildId,
                            hiddenChannels.length,
                        );

                        // Show toast only once per guild
                        if (!toastShown) {
                            showToast(
                                "Excessive hidden channels detected, stabilizing performance...",
                            );
                            toastShown = true;
                        }
                    }

                    // Remove them from DOM
                    hiddenChannels.forEach((ch) => {
                        ch.remove();
                    });
                } else {
                    // Clear cache if under 50
                    if (
                        this.guildsWithHiddenChannels.has(this.currentGuildId)
                    ) {
                        logger.log(
                            `[PerformanceEnhancer] Guild ${this.currentGuildId}: Hidden channels reduced to ${hiddenChannels.length} - RESTORED`,
                        );
                        this.guildsWithHiddenChannels.delete(
                            this.currentGuildId,
                        );
                        toastShown = false;
                    }
                }
            } catch (e) {
                console.error("[PerformanceEnhancer] Error:", e);
            }
        }, 2000); // Run every 2 seconds

        logger.log("✅ Hidden Channel Removal: Active");
    },

    stop() {
        ["perf-number-rendering", "perf-scroll-opt"].forEach((id) =>
            document.getElementById(id)?.remove(),
        );

        if (this.removalInterval) {
            clearInterval(this.removalInterval);
        }

        logger.log("🛑 PERFORMANCE ENHANCER DISABLED");
    },
});
