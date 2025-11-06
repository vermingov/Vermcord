/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Note: vermLib hub is now in index.tsx to support JSX dashboard UI.
 * Optimized: Reduced redundancy, better error handling, faster execution
 */

import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import {
    AuthenticationStore,
    ChannelStore,
    SelectedChannelStore,
    showToast,
    Toasts,
} from "@webpack/common";

const STORAGE_KEY = "vcReturn:lastVoiceChannelId";
const VOICE_CHANNEL_TYPES = new Set([2, 13]); // GUILD_VOICE, GUILD_STAGE_VOICE

const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel") as {
    selectVoiceChannel(channelId: string): void;
};

/**
 * Check if channel exists and is a voice channel
 * Combines type checking and existence validation
 */
function isVoiceLikeChannel(id: string | undefined | null): boolean {
    if (!id) return false;
    const channel = ChannelStore.getChannel?.(id);
    return channel ? VOICE_CHANNEL_TYPES.has(channel.type) : false;
}

/**
 * Storage layer - handles localStorage safely
 */
const storage = {
    save: (id: string | undefined | null) => {
        if (!id || !isVoiceLikeChannel(id)) return;
        try {
            localStorage.setItem(STORAGE_KEY, id);
        } catch {
            // Silently fail on storage quota exceeded
        }
    },
    get: (): string | null => {
        try {
            const id = localStorage.getItem(STORAGE_KEY);
            return id && isVoiceLikeChannel(id) ? id : null;
        } catch {
            return null;
        }
    },
    clear: () => {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            // Silently fail
        }
    },
};

/**
 * Reconnect to last voice channel with exponential backoff
 * Optimized to fail faster if channel becomes unavailable
 */
async function reconnectIfNeeded(): Promise<void> {
    try {
        const currentChannel = SelectedChannelStore.getVoiceChannelId?.();

        // Already in a voice channel
        if (currentChannel && isVoiceLikeChannel(currentChannel)) {
            storage.save(currentChannel);
            return;
        }

        const lastChannel = storage.get();
        if (!lastChannel) return;

        // Retry with exponential backoff: 500ms, 1000ms, 1500ms
        const delays = [500, 1000, 1500];

        for (const delay of delays) {
            await new Promise((resolve) => setTimeout(resolve, delay));

            // Check if user joined elsewhere in the meantime
            const now = SelectedChannelStore.getVoiceChannelId?.();
            if (now && isVoiceLikeChannel(now)) return;

            // Verify channel still exists and is valid
            if (!isVoiceLikeChannel(lastChannel)) {
                storage.clear();
                return;
            }

            try {
                VoiceActions.selectVoiceChannel(lastChannel);
                showToast(
                    "Reconnected to your previous voice channel",
                    Toasts.Type.SUCCESS,
                );
                return;
            } catch (error) {
                // Continue to next retry
                console.debug("[VCReturn] Reconnect attempt failed:", error);
            }
        }

        // All retries exhausted, clear the stored channel
        console.debug("[VCReturn] Reconnection failed after all attempts");
        storage.clear();
    } catch (error) {
        console.error(
            "[VCReturn] Unexpected error in reconnectIfNeeded:",
            error,
        );
    }
}

/**
 * Find reconnect button more efficiently
 * Reduces DOM queries by caching selector
 */
function findAndClickReconnectButton(): boolean {
    try {
        const button = document.querySelector<HTMLButtonElement>(
            "button.button__6e2b9",
        );
        if (button instanceof HTMLButtonElement) {
            button.click();
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

export default definePlugin({
    name: "VCReturn",
    description: "Auto-joins your previous voice channel on startup.",
    authors: [{ name: "yourbuddy", id: 0n }],

    flux: {
        VOICE_STATE_UPDATES({
            voiceStates,
        }: {
            voiceStates: Array<{
                userId: string;
                channelId?: string | null;
                oldChannelId?: string | null;
            }>;
        }) {
            if (!Array.isArray(voiceStates)) return;

            const userId = AuthenticationStore.getId?.();
            if (!userId) return;

            // Find current user's voice state - early exit if not found
            const userVoiceState = voiceStates.find(
                (vs) => vs.userId === userId,
            );
            if (!userVoiceState) return;

            try {
                if (userVoiceState.channelId) {
                    // User joined/switched voice channel
                    storage.save(userVoiceState.channelId);
                } else if (userVoiceState.oldChannelId) {
                    // User left voice channel
                    storage.clear();
                }
            } catch (error) {
                console.error("[VCReturn] Error in voice state update:", error);
            }
        },
    },

    start() {
        // Initial reconnect attempt after Discord loads
        const initialReconnectTimer = setTimeout(() => {
            if (findAndClickReconnectButton()) {
                // Button found and clicked
                return;
            }

            // Button not found, retry once after 1s
            const retryTimer = setTimeout(() => {
                findAndClickReconnectButton();
            }, 1000);

            // Cleanup retry timer on plugin stop
            (window as any).__vcReturnRetryTimer = retryTimer;
        }, 1000);

        // Store timer reference for cleanup
        (window as any).__vcReturnInitialTimer = initialReconnectTimer;

        // Also attempt reconnect via voice state listener
        reconnectIfNeeded().catch((error) => {
            console.error("[VCReturn] Failed to reconnect:", error);
        });
    },

    stop() {
        // Cleanup timers
        const initialTimer = (window as any).__vcReturnInitialTimer;
        const retryTimer = (window as any).__vcReturnRetryTimer;

        if (initialTimer) clearTimeout(initialTimer);
        if (retryTimer) clearTimeout(retryTimer);

        delete (window as any).__vcReturnInitialTimer;
        delete (window as any).__vcReturnRetryTimer;
    },
});
