/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findByPropsLazy } from "@webpack";
import {
    Alerts,
    Button,
    FluxDispatcher,
    Forms,
    MessageStore,
    Parser,
    React,
    RestAPI,
    Toasts,
    UserStore,
} from "@webpack/common";

const SelectedChannelStore = findByPropsLazy(
    "getChannelId",
    "getVoiceChannelId",
);
const ChannelStore = findByPropsLazy("getChannel", "getDMFromUserId");

const BUTTON_CLICK_SOUND =
    "https://cdn.discordapp.com/attachments/1287309916909867070/1435824882280698006/ButtonClick.mp3?ex=690d5fa0&is=690c0e20&hm=fff0e8251321ee626e59ba33ff948816781028ef41f008feee131f764bef5fe4&";

function playButtonSound() {
    const audio = new Audio(BUTTON_CLICK_SOUND);
    audio.volume = 0.3;
    audio.play().catch(() => {});
}

interface Channel {
    id: string;
    name?: string;
    recipients?: string[];
    guild_id?: string;
    type: number;
}

function randomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getChannelName(channel: Channel): string {
    if (channel.name) {
        return `#${channel.name}`;
    }

    if (channel.recipients && channel.recipients.length > 0) {
        const recipientId = channel.recipients[0];
        const user = UserStore.getUser(recipientId);
        return user ? `@${user.username}` : "DM";
    }

    return "Unknown Channel";
}

function isSystemMessage(message: any): boolean {
    if (!message.content && (!message.embeds || message.embeds.length === 0)) {
        return true;
    }

    if (message.type !== 0) {
        return true;
    }

    return false;
}

async function loadAllMessages(
    channelId: string,
    userId: string,
    maxBatches = 10,
    onBatchProgress?: (batchCount: number, totalBatches: number) => void,
): Promise<string[]> {
    const userMessageIds = new Set<string>();
    let oldestMessageId: string | null = null;
    let batchCount = 0;

    console.log(
        `[MessageDeleter] Starting to load messages for user ${userId} in channel ${channelId}`,
    );

    const currentMessages = MessageStore.getMessages(channelId);
    if (currentMessages?._array) {
        currentMessages._array.forEach((msg: any) => {
            if (msg.author.id === userId && !isSystemMessage(msg)) {
                userMessageIds.add(msg.id);
            }
        });

        if (currentMessages._array.length > 0) {
            oldestMessageId = currentMessages._array[0].id;
        }

        console.log(
            `[MessageDeleter] Found ${userMessageIds.size} messages in loaded cache`,
        );
    }

    while (batchCount < maxBatches) {
        try {
            const query: any = {
                limit: 100,
            };

            if (oldestMessageId) {
                query.before = oldestMessageId;
            }

            const response = await RestAPI.get({
                url: `/channels/${channelId}/messages`,
                query,
            });

            if (!response.body || response.body.length === 0) {
                console.log(
                    `[MessageDeleter] No more messages to load after ${batchCount} batches`,
                );
                break;
            }

            let foundUserMessages = 0;
            response.body.forEach((msg: any) => {
                if (msg.author.id === userId && !isSystemMessage(msg)) {
                    userMessageIds.add(msg.id);
                    foundUserMessages++;
                }
                oldestMessageId = msg.id;
            });

            console.log(
                `[MessageDeleter] Batch ${batchCount + 1}: Found ${foundUserMessages} user messages (total: ${userMessageIds.size})`,
            );

            batchCount++;

            if (onBatchProgress) {
                onBatchProgress(batchCount, maxBatches);
            }

            if (response.body.length < 100) {
                console.log(`[MessageDeleter] Reached end of channel history`);
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
            console.error(
                `[MessageDeleter] Failed to load message batch:`,
                error,
            );
            break;
        }
    }

    const result = Array.from(userMessageIds);
    console.log(
        `[MessageDeleter] Loaded ${result.length} total messages from user`,
    );
    return result;
}

let deletionProgressElement: HTMLElement | null = null;

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
                    Deleting Messages
                </span>
            </div>
            <span style="color: var(--text-muted); font-size: 12px; font-weight: 500;">
                <span id="md-progress-text">0/0</span>
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

function showDeletionProgress(deleted: number, total: number) {
    if (!deletionProgressElement) {
        deletionProgressElement = createDeletionProgressToast();
        document.body.appendChild(deletionProgressElement);
    }

    const percentage = (deleted / total) * 100;
    const progressBar = deletionProgressElement.querySelector(
        "#md-progress-bar",
    ) as HTMLElement;
    const progressText =
        deletionProgressElement.querySelector("#md-progress-text");

    if (progressBar) {
        progressBar.style.width = `${percentage}%`;
    }
    if (progressText) {
        progressText.textContent = `${deleted}/${total}`;
    }
}

function hideDeletionProgress() {
    if (deletionProgressElement) {
        deletionProgressElement.style.opacity = "0";
        deletionProgressElement.style.transform =
            "translateX(-50%) translateY(-10px)";

        setTimeout(() => {
            deletionProgressElement?.remove();
            deletionProgressElement = null;
        }, 300);
    }
}

async function deleteMessagesWithDelay(
    channelId: string,
    messageIds: string[],
    onProgress?: (deleted: number, total: number) => void,
): Promise<number> {
    let deleted = 0;
    const total = messageIds.length;

    const minDelay = 200;
    const maxDelay = 400;

    for (const messageId of messageIds) {
        try {
            const messageElement = document.querySelector(
                `li[id*="${messageId}"]`,
            );
            if (
                messageElement?.classList.contains("messagelogger-deleted") ||
                messageElement?.classList.contains("messagelogger-edited")
            ) {
                console.log(
                    `[MessageDeleter] Skipping ${messageId} - already deleted`,
                );
                continue;
            }

            try {
                const response = await RestAPI.del({
                    url: `/channels/${channelId}/messages/${messageId}`,
                });

                if (
                    response &&
                    (response.status === 204 ||
                        response.status === 200 ||
                        response.ok)
                ) {
                    deleted++;

                    if (onProgress) {
                        onProgress(deleted, total);
                    }
                }
            } catch (error: any) {
                const errorCode = error?.status || error?.code;

                if (errorCode === 404) {
                    console.log(
                        `[MessageDeleter] Message ${messageId} already deleted (404)`,
                    );
                    continue;
                }

                if (errorCode === 403) {
                    console.log(
                        `[MessageDeleter] No permission to delete ${messageId} (403)`,
                    );
                    continue;
                }

                if (errorCode === 429) {
                    console.warn(
                        `[MessageDeleter] Rate limited! Waiting 5s...`,
                    );
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                    try {
                        await RestAPI.del({
                            url: `/channels/${channelId}/messages/${messageId}`,
                        });
                        deleted++;
                        if (onProgress) {
                            onProgress(deleted, total);
                        }
                    } catch (retryError) {
                        console.error(
                            `[MessageDeleter] Failed even after retry: ${messageId}`,
                        );
                    }
                    continue;
                }

                throw error;
            }

            const delay = randomDelay(minDelay, maxDelay);
            await new Promise((resolve) => setTimeout(resolve, delay));
        } catch (error: any) {
            console.error(
                `[MessageDeleter] Error processing ${messageId}:`,
                error?.message,
            );
        }
    }

    return deleted;
}

function showCustomModal(title: string, body: string): Promise<boolean> {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.id = `custom-modal-overlay-${Date.now()}`;
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(5px);
            z-index: 9998;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: md-fade-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        `;

        const modal = document.createElement("div");
        modal.style.cssText = `
            background: color-mix(in oklab, var(--background-secondary) 90%, black 10%);
            border: 1px solid rgba(255, 255, 255, 0.03);
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.03);
            backdrop-filter: blur(10px);
            padding: 24px;
            min-width: 400px;
            max-width: 500px;
            gap: 16px;
            display: flex;
            flex-direction: column;
        `;

        const titleEl = document.createElement("div");
        titleEl.style.cssText = `
            font-size: 20px;
            font-weight: 600;
            color: var(--header-primary);
            letter-spacing: 0.5px;
        `;
        titleEl.textContent = title;
        modal.appendChild(titleEl);

        const bodyEl = document.createElement("div");
        bodyEl.style.cssText = `
            font-size: 14px;
            color: white;
            line-height: 1.5;
        `;
        bodyEl.textContent = body;
        modal.appendChild(bodyEl);

        const buttonContainer = document.createElement("div");
        buttonContainer.style.cssText = `
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            margin-top: 16px;
        `;

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.style.cssText = `
            background: transparent;
            border: none;
            color: var(--header-primary);
            cursor: pointer;
            padding: 8px 16px;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s ease;
        `;
        cancelBtn.addEventListener("click", () => {
            playButtonSound();
            closeModal();
            resolve(false);
        });
        cancelBtn.addEventListener("mouseenter", () => {
            cancelBtn.style.color = "var(--text-muted)";
        });
        cancelBtn.addEventListener("mouseleave", () => {
            cancelBtn.style.color = "var(--header-primary)";
        });
        buttonContainer.appendChild(cancelBtn);

        const confirmBtn = document.createElement("button");
        confirmBtn.textContent = "Delete";
        confirmBtn.style.cssText = `
            background: #ED4245;
            border: 1px solid rgba(237, 66, 69, 0.5);
            border-radius: 8px;
            color: white;
            cursor: pointer;
            padding: 8px 16px;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s ease;
            box-shadow: 0 0 12px rgba(237, 66, 69, 0.4);
        `;
        confirmBtn.addEventListener("click", () => {
            playButtonSound();
            closeModal();
            resolve(true);
        });
        confirmBtn.addEventListener("mouseenter", () => {
            confirmBtn.style.transform = "translateY(-2px)";
            confirmBtn.style.boxShadow = "0 4px 16px rgba(237, 66, 69, 0.6)";
        });
        confirmBtn.addEventListener("mouseleave", () => {
            confirmBtn.style.transform = "translateY(0)";
            confirmBtn.style.boxShadow = "0 0 12px rgba(237, 66, 69, 0.4)";
        });
        buttonContainer.appendChild(confirmBtn);

        modal.appendChild(buttonContainer);
        overlay.appendChild(modal);

        function closeModal() {
            overlay.style.animation =
                "md-fade-out 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards";
            setTimeout(() => overlay.remove(), 250);
        }

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                playButtonSound();
                closeModal();
                resolve(false);
            }
        });

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                playButtonSound();
                document.removeEventListener("keydown", handleEscape);
                closeModal();
                resolve(false);
            }
        };
        document.addEventListener("keydown", handleEscape);

        if (!document.getElementById("md-modal-styles")) {
            const style = document.createElement("style");
            style.id = "md-modal-styles";
            style.textContent = `
                @keyframes md-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes md-fade-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(8px); } }
                @keyframes md-icon-pulse {
                    0%, 100% {
                        transform: scale(1);
                        opacity: 1;
                    }
                    50% {
                        transform: scale(1.1);
                        opacity: 0.8;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(overlay);
    });
}

function createDeleteMessageModal() {
    const container = document.createElement("div");
    container.id = "vermLib-md-modal-container";
    container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, var(--background-primary) 0%, var(--background-secondary) 100%);
        backdrop-filter: blur(10px);
        z-index: 9997;
        animation: md-fade-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const modal = document.createElement("div");
    modal.style.cssText = `
        width: min(520px, calc(100vw - 64px));
        max-height: calc(100vh - 64px);
        background: color-mix(in oklab, var(--background-secondary) 90%, black 10%);
        border: 1px solid rgba(255, 255, 255, 0.03);
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.03);
        backdrop-filter: blur(10px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding: 24px;
        gap: 16px;
    `;

    container.appendChild(modal);
    document.body.appendChild(container);

    return { container, modal, close: () => container.remove() };
}

let currentModalInstance: { container: HTMLElement; close: () => void } | null =
    null;

function openDeleteMessageModal() {
    const { container, modal, close } = createDeleteMessageModal();
    currentModalInstance = { container, close };

    const channelId = SelectedChannelStore.getChannelId();
    const channel = channelId
        ? (ChannelStore.getChannel(channelId) as Channel)
        : null;
    const channelName = channel ? getChannelName(channel) : "Unknown Channel";
    const currentUserId = UserStore.getCurrentUser()?.id;
    const isGuildChannel = channel?.guild_id ? true : false;

    let userMessageIds: string[] = [];
    let loading = true;
    let loadingProgress = 0;
    let count = "10";

    function renderModal() {
        modal.innerHTML = `
            <div style="font-size: 20px; font-weight: 600; color: var(--header-primary); letter-spacing: 0.5px;">
                Delete Messages
            </div>

            <div style="display: flex; flex-direction: column; gap: 16px; flex: 1; overflow-y: auto;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style="animation: md-icon-pulse 2s ease-in-out infinite; flex-shrink: 0;">
                        <path d="M3 3h2v2H3V3zm0 4h2v2H3V7zm0 4h2v2H3v-2zm0 4h2v2H3v-2zm0 4h2v2H3v-2zm4-16h2v2H7V3zm0 4h2v2H7V7zm0 4h2v2H7v-2zm0 4h2v2H7v-2zm0 4h2v2H7v-2zm4-16h2v2h-2V3zm0 4h2v2h-2V7zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2zm4-16h2v2h-2V3zm0 4h2v2h-2V7zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2zm4-16h2v2h-2V3zm0 4h2v2h-2V7zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2z" fill="var(--brand-500)" opacity="0.8"/>
                        <circle cx="12" cy="12" r="3" fill="var(--brand-500)" />
                    </svg>
                    <div>
                        <div style="color: white; font-size: 14px; font-weight: 500;">
                            Delete from <strong>${channelName}</strong>
                        </div>
                        <div style="color: var(--text-muted); font-size: 12px; margin-top: 2px;">
                            Messages will be permanently removed
                        </div>
                    </div>
                </div>

                ${
                    loading
                        ? `
                    <div style="text-align: center; padding: 20px 0;">
                        <div style="width: 100%; height: 6px; background: var(--background-tertiary); border-radius: 3px; overflow: hidden; margin: 8px 0;">
                            <div id="md-load-bar" style="
                                height: 100%;
                                background: linear-gradient(90deg, var(--brand-500, #5865F2), var(--brand-560, #4752C4));
                                border-radius: 3px;
                                transition: width 0.3s ease;
                                box-shadow: 0 0 8px rgba(88, 101, 242, 0.6);
                                width: ${loadingProgress}%;
                            "></div>
                        </div>
                        <div style="color: var(--text-muted); font-size: 13px; text-align: center; margin-top: 12px;">
                            Loading messages...
                        </div>
                    </div>
                `
                        : `
                    <div style="background: var(--background-tertiary); border: 1px solid var(--background-modifier-accent); border-radius: 8px; padding: 12px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <div>
                            <div style="color: var(--text-muted); font-size: 12px; margin-bottom: 4px;">
                                Your messages loaded${isGuildChannel ? " (up to 1,000 checked)" : ""}
                            </div>
                            <div style="color: var(--header-primary); font-size: 20px; font-weight: 600;">
                                ${userMessageIds.length.toLocaleString()}
                            </div>
                        </div>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="var(--text-muted)" opacity="0.3" />
                        </svg>
                    </div>

                    <div>
                        <div style="color: var(--header-primary); font-size: 14px; font-weight: 500; margin-bottom: 8px;">
                            Number of Messages to Delete
                        </div>
                        <input id="md-count-input" type="number" value="${count}" placeholder="Enter number of messages" min="1" max="${userMessageIds.length}" style="
                            width: 100%;
                            background: var(--background-tertiary);
                            color: var(--header-primary);
                            border: 1px solid var(--background-modifier-accent);
                            border-radius: 8px;
                            outline: none;
                            padding: 8px 10px;
                            box-sizing: border-box;
                            transition: all 0.2s ease;
                            font-size: 14px;
                        " />
                    </div>
                `
                }

                <div style="color: var(--text-danger); font-size: 12px; padding: 8px 0;">
                    Warning: Deleted messages cannot be recovered.
                </div>
            </div>

            <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button id="md-cancel-btn" style="background: transparent; border: none; color: var(--header-primary); cursor: pointer; padding: 6px 12px; font-size: 14px; font-weight: 500;">
                    Cancel
                </button>
                <button id="md-delete-btn" style="background: #ED4245; border: 1px solid rgba(237, 66, 69, 0.5); border-radius: 8px; color: white; padding: 6px 12px; cursor: pointer; transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); font-size: 14px; font-weight: 500; box-shadow: 0 0 12px rgba(237, 66, 69, 0.4);" ${loading ? "disabled" : ""}>
                    Delete ${count} message${parseInt(count) === 1 ? "" : "s"}
                </button>
            </div>
        `;

        const cancelBtn = modal.querySelector(
            "#md-cancel-btn",
        ) as HTMLButtonElement;
        const deleteBtn = modal.querySelector(
            "#md-delete-btn",
        ) as HTMLButtonElement;
        const countInput = modal.querySelector(
            "#md-count-input",
        ) as HTMLInputElement;

        if (cancelBtn) {
            cancelBtn.addEventListener("click", () => {
                playButtonSound();
                close();
            });
            cancelBtn.addEventListener("mouseenter", () => {
                cancelBtn.style.color = "var(--text-muted)";
            });
            cancelBtn.addEventListener("mouseleave", () => {
                cancelBtn.style.color = "var(--header-primary)";
            });
        }

        if (countInput) {
            countInput.addEventListener("input", (e) => {
                count = (e.target as HTMLInputElement).value;
                if (deleteBtn) {
                    deleteBtn.textContent = `Delete ${count} message${parseInt(count) === 1 ? "" : "s"}`;
                }
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener("mouseenter", () => {
                deleteBtn.style.transform = "translateY(-2px)";
                deleteBtn.style.boxShadow = "0 4px 16px rgba(237, 66, 69, 0.6)";
            });
            deleteBtn.addEventListener("mouseleave", () => {
                deleteBtn.style.transform = "translateY(0)";
                deleteBtn.style.boxShadow = "0 0 12px rgba(237, 66, 69, 0.4)";
            });
            deleteBtn.addEventListener("click", async () => {
                playButtonSound();
                await handleDelete();
            });
        }
    }

    async function handleDelete() {
        if (!channelId) {
            Toasts.show({
                message: "No channel selected",
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
            return;
        }

        const messageCount = parseInt(count);

        if (isNaN(messageCount) || messageCount <= 0) {
            Toasts.show({
                message: "Please enter a valid number of messages",
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
            return;
        }

        if (messageCount > userMessageIds.length) {
            Toasts.show({
                message: `You only have ${userMessageIds.length} loaded message${userMessageIds.length === 1 ? "" : "s"}`,
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
            return;
        }

        const confirmed = await showCustomModal(
            "Delete your messages?",
            `You are about to delete ${messageCount} message${messageCount === 1 ? "" : "s"} in ${channelName}. This action cannot be undone.`,
        );
        if (!confirmed) return;

        close();
        showDeletionProgress(0, messageCount);

        const startTime = Date.now();

        try {
            const messagesToDelete = userMessageIds
                .sort((a, b) => a.localeCompare(b))
                .slice(0, messageCount);

            const deletedCount = await deleteMessagesWithDelay(
                channelId,
                messagesToDelete,
                (deleted, total) => {
                    showDeletionProgress(deleted, total);
                },
            );

            const endTime = Date.now();
            const durationMs = endTime - startTime;
            const durationSec = (durationMs / 1000).toFixed(1);
            const durationMin = (durationMs / 60000).toFixed(1);

            let timeString = "";
            if (durationMs < 1000) {
                timeString = `${durationMs}ms`;
            } else if (durationMs < 60000) {
                timeString = `${durationSec}s`;
            } else {
                timeString = `${durationMin}m`;
            }

            hideDeletionProgress();

            setTimeout(() => {
                Toasts.show({
                    message: `Successfully deleted ${deletedCount} message${deletedCount !== 1 ? "s" : ""} in ${channelName} (took ${timeString})`,
                    type: Toasts.Type.SUCCESS,
                    id: Toasts.genId(),
                });
            }, 300);
        } catch (error) {
            console.error("[MessageDeleter] Error:", error);

            const endTime = Date.now();
            const durationMs = endTime - startTime;
            const durationSec = (durationMs / 1000).toFixed(1);

            hideDeletionProgress();

            setTimeout(() => {
                Toasts.show({
                    message: `Failed to delete messages after ${durationSec}s. Check console for details.`,
                    type: Toasts.Type.FAILURE,
                    id: Toasts.genId(),
                });
            }, 300);
        }
    }

    renderModal();

    // Load messages
    if (!channelId || !currentUserId) {
        loading = false;
        renderModal();
        return;
    }

    const maxBatches = isGuildChannel ? 10 : 50;

    loadAllMessages(
        channelId,
        currentUserId,
        maxBatches,
        (batchCount, totalBatches) => {
            loadingProgress = (batchCount / totalBatches) * 100;
            const loadBar = modal.querySelector("#md-load-bar") as HTMLElement;
            if (loadBar) {
                loadBar.style.width = `${loadingProgress}%`;
            }
        },
    )
        .then((messageIds) => {
            userMessageIds = messageIds;
            loading = false;
            renderModal();
        })
        .catch((error) => {
            console.error("[MessageDeleter] Failed to load messages:", error);
            loading = false;
            Toasts.show({
                message: "Failed to load messages. Using cached messages only.",
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
            renderModal();
        });

    // Handle overlay click and escape
    const handleOverlayClick = (e: MouseEvent) => {
        if (e.target === container) {
            playButtonSound();
            close();
        }
    };

    const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            playButtonSound();
            close();
        }
    };

    container.addEventListener("click", handleOverlayClick);
    document.addEventListener("keydown", handleEscape);

    const originalClose = close;
    const wrappedClose = () => {
        container.removeEventListener("click", handleOverlayClick);
        document.removeEventListener("keydown", handleEscape);
        originalClose();
        currentModalInstance = null;
    };

    currentModalInstance.close = wrappedClose;
}

let mountedNode: HTMLElement | null = null;
let mo: MutationObserver | null = null;
let hb: number | null = null;

const REINJECT_EVENTS = ["CHANNEL_SELECT", "WINDOW_FOCUS"] as const;

const reinjectHandler = () => ensureInjected();

function subscribeReinjection() {
    try {
        for (const ev of REINJECT_EVENTS) {
            FluxDispatcher.subscribe(ev, reinjectHandler);
        }
    } catch {}
}

function unsubscribeReinjection() {
    try {
        for (const ev of REINJECT_EVENTS) {
            FluxDispatcher.unsubscribe(ev, reinjectHandler);
        }
    } catch {}
}

function createButton(onClick: () => void): HTMLElement {
    const container = document.createElement("div");
    container.id = "vermLib-message-deleter-button";
    container.className =
        "expression-picker-chat-input-button buttonContainer__74017";
    container.style.cursor = "pointer";

    container.innerHTML = `
        <div class="button__74017 button__24af7 vermcord-delete-btn" aria-label="Delete Messages" role="button" tabindex="0">
            <div class="buttonWrapper__24af7">
                <svg class="vermcord-delete-icon" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" style="pointer-events: none;">
                    <path fill="currentColor" d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z"/>
                </svg>
            </div>
        </div>
    `;

    const styleId = "vermcord-delete-btn-styles";
    if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
#vermLib-message-deleter-button .vermcord-delete-icon path {
    transition: fill 0.2s ease !important;
}
#vermLib-message-deleter-button .vermcord-delete-btn:hover .vermcord-delete-icon path {
    fill: #ed4245 !important;
}
        `;
        document.head.appendChild(style);
    }

    const activate = () => {
        playButtonSound();
        onClick();
    };

    const buttonDiv = container.querySelector(".button__74017") as HTMLElement;
    if (buttonDiv) {
        buttonDiv.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            activate();
        });

        buttonDiv.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                activate();
            }
        });
    }

    return container;
}

function ensureInjected() {
    const existingButton = document.getElementById(
        "vermLib-message-deleter-button",
    );
    if (existingButton && existingButton.parentElement) {
        return;
    }

    const buttonsContainer = document.querySelector("div.buttons__74017");
    if (!buttonsContainer) return;

    if (existingButton) {
        existingButton.remove();
    }

    const firstChild = buttonsContainer.firstElementChild;

    const node = createButton(() => {
        openDeleteMessageModal();
    });

    if (firstChild) {
        buttonsContainer.insertBefore(node, firstChild);
    } else {
        buttonsContainer.appendChild(node);
    }

    mountedNode = node;
}

function cleanupInjected() {
    mountedNode?.remove();
    mountedNode = null;
    document.getElementById("vermcord-delete-btn-styles")?.remove();
}

function startObserve() {
    mo = new MutationObserver(() => {
        if (!document.getElementById("vermLib-message-deleter-button")) {
            ensureInjected();
        }
    });
    mo.observe(document.body, { childList: true, subtree: true });
}

function stopObserve() {
    mo?.disconnect();
    mo = null;
}

export default {
    name: "MessageDeleter",

    start() {
        console.log("[MessageDeleter] Starting...");
        ensureInjected();
        startObserve();
        subscribeReinjection();
        hb = window.setInterval(() => ensureInjected(), 1000);
    },

    stop() {
        console.log("[MessageDeleter] Stopping...");
        if (hb) {
            clearInterval(hb);
            hb = null;
        }
        unsubscribeReinjection();
        stopObserve();
        cleanupInjected();
        currentModalInstance?.close();
        hideDeletionProgress();
    },
} as const;
