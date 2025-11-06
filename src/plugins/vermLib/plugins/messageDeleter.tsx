/**
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Divider } from "@components/Divider";
import {
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalRoot,
    ModalSize,
    openModal,
} from "@utils/modal";
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

// Global deletion progress element
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

    // FAST: 200-400ms per message
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

                // 429 = rate limited - WAIT 5 SECONDS
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

function DeleteMessageModal(props: { modalProps: any }) {
    const { onClose } = props.modalProps;
    const FIXED_MODAL_WIDTH = "min(520px, calc(100vw - 64px))";

    const [count, setCount] = React.useState("10");
    const [loading, setLoading] = React.useState(true);
    const [userMessageIds, setUserMessageIds] = React.useState<string[]>([]);
    const [loadingProgress, setLoadingProgress] = React.useState(0);

    const channelId = SelectedChannelStore.getChannelId();
    const channel = channelId
        ? (ChannelStore.getChannel(channelId) as Channel)
        : null;
    const channelName = channel ? getChannelName(channel) : "Unknown Channel";
    const currentUserId = UserStore.getCurrentUser()?.id;
    const isGuildChannel = channel?.guild_id ? true : false;

    React.useEffect(() => {
        if (!channelId || !currentUserId) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setLoadingProgress(0);

        const maxBatches = isGuildChannel ? 10 : 50;

        loadAllMessages(
            channelId,
            currentUserId,
            maxBatches,
            (batchCount, totalBatches) => {
                const progressPercent = (batchCount / totalBatches) * 100;
                setLoadingProgress(progressPercent);
            },
        )
            .then((messageIds) => {
                setUserMessageIds(messageIds);
                setLoading(false);
                setLoadingProgress(100);
                console.log(
                    `[MessageDeleter] Ready with ${messageIds.length} messages`,
                );
            })
            .catch((error) => {
                console.error(
                    "[MessageDeleter] Failed to load messages:",
                    error,
                );
                setLoading(false);
                Toasts.show({
                    message:
                        "Failed to load messages. Using cached messages only.",
                    type: Toasts.Type.FAILURE,
                    id: Toasts.genId(),
                });
            });
    }, [channelId, currentUserId, isGuildChannel]);

    const totalMessages = userMessageIds.length;

    React.useEffect(() => {
        const id = "vermLib-md-styles";
        if (document.getElementById(id)) return;
        const style = document.createElement("style");
        style.id = id;
        style.textContent = `
    .md-root { animation: md-fade-in .25s ease-out; }
    @keyframes md-fade-in { from { opacity: 0; transform: translateY(4px);} to { opacity: 1; transform: translateY(0);} }
    .md-input input {
        box-shadow: 0 0 0 0 rgba(0,0,0,0);
        transition: box-shadow .2s ease, border-color .2s ease;
        color: var(--header-primary);
        -webkit-text-fill-color: var(--header-primary);
        caret-color: var(--header-primary);
    }
    .md-input input::placeholder { color: var(--text-muted); opacity: 1; }
    .md-input input:focus {
        box-shadow: 0 0 0 2px var(--brand-500, #5865F2) inset;
        border-color: var(--brand-560, var(--brand-500));
    }
    .md-stat-card {
        background: var(--background-tertiary);
        border: 1px solid var(--background-modifier-accent);
        border-radius: 8px;
        padding: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .md-stat-label {
        color: var(--text-muted);
        font-size: 12px;
        margin-bottom: 4px;
    }
    .md-stat-value {
        color: var(--header-primary);
        font-size: 20px;
        font-weight: 600;
    }
    .md-progress-container {
        width: 165%;
        height: 6px;
        background: var(--background-secondary);
        border-radius: 3px;
        overflow: hidden;
        margin: 8px 0;
    }
    .md-progress-bar {
        height: 100%;
        background: linear-gradient(90deg, var(--brand-500, #5865F2), var(--brand-560, #4752C4));
        border-radius: 3px;
        transition: width 0.3s ease;
        box-shadow: 0 0 8px rgba(88, 101, 242, 0.6);
    }
    .md-loading-text {
        color: var(--text-muted);
        font-size: 13px;
        text-align: center;
        margin-top: 12px;
    }
        `;
        document.head.appendChild(style);
        return () => style.remove();
    }, []);

    const handleDelete = async () => {
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

        let confirmed = false;
        await new Promise<void>((resolve) => {
            Alerts.show({
                title: "Delete your messages?",
                body: Parser.parse(
                    `You are about to delete ${messageCount} of your message${messageCount === 1 ? "" : "s"} in **${channelName}**. This action cannot be undone.`,
                ),
                confirmText: `Delete ${messageCount}`,
                cancelText: "Cancel",
                onConfirm: () => {
                    confirmed = true;
                    resolve();
                },
                onCancel: () => resolve(),
            });
        });
        if (!confirmed) return;

        // Close modal and show progress
        onClose?.();
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
    };

    return (
        <ModalRoot
            {...props.modalProps}
            size={ModalSize.SMALL}
            style={{ width: FIXED_MODAL_WIDTH }}
        >
            <ModalHeader>
                <Forms.FormTitle
                    tag="h2"
                    style={{ margin: 0, color: "var(--header-primary)" }}
                >
                    Delete Messages
                </Forms.FormTitle>
            </ModalHeader>

            <ModalContent>
                <div
                    className="md-root"
                    style={{ width: "100%", maxWidth: FIXED_MODAL_WIDTH }}
                >
                    <Forms.FormSection>
                        <Forms.FormText style={{ marginBottom: 12 }}>
                            Delete your messages from{" "}
                            <strong>{channelName}</strong>
                        </Forms.FormText>

                        {loading ? (
                            <div
                                style={{
                                    textAlign: "center",
                                    padding: "20px 0",
                                }}
                            >
                                <div className="md-progress-container">
                                    <div
                                        className="md-progress-bar"
                                        style={{ width: `${loadingProgress}%` }}
                                    />
                                </div>
                                <Forms.FormText className="md-loading-text">
                                    Loading messages...
                                </Forms.FormText>
                            </div>
                        ) : (
                            <>
                                <div
                                    className="md-stat-card"
                                    style={{ marginBottom: 16 }}
                                >
                                    <div>
                                        <div className="md-stat-label">
                                            Your messages loaded
                                            {isGuildChannel && (
                                                <span>
                                                    {" "}
                                                    (up to 1,000 checked)
                                                </span>
                                            )}
                                        </div>
                                        <div className="md-stat-value">
                                            {totalMessages.toLocaleString()}
                                        </div>
                                    </div>
                                    <svg
                                        width="32"
                                        height="32"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                    >
                                        <path
                                            d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"
                                            fill="var(--text-muted)"
                                            opacity="0.3"
                                        />
                                    </svg>
                                </div>

                                <Forms.FormTitle
                                    tag="h5"
                                    style={{ marginBottom: 8 }}
                                >
                                    Number of Messages to Delete
                                </Forms.FormTitle>

                                <div className="md-input">
                                    <input
                                        type="number"
                                        value={count}
                                        onChange={(e) =>
                                            setCount(e.currentTarget.value)
                                        }
                                        placeholder="Enter number of messages"
                                        min="1"
                                        max={totalMessages}
                                        style={{
                                            width: "100%",
                                            background:
                                                "var(--background-tertiary)",
                                            color: "var(--header-primary)",
                                            border: "1px solid var(--background-modifier-accent)",
                                            borderRadius: 8,
                                            outline: "none",
                                            padding: "8px 10px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>
                            </>
                        )}

                        <Divider className="marginTop16 marginBottom16" />

                        <Forms.FormText style={{ color: "var(--text-danger)" }}>
                            Warning: Deleted messages cannot be recovered.
                        </Forms.FormText>
                    </Forms.FormSection>
                </div>
            </ModalContent>

            <ModalFooter>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        width: "100%",
                        gap: 12,
                    }}
                >
                    <Button
                        look={Button.Looks.LINK}
                        color={Button.Colors.PRIMARY}
                        onClick={onClose}
                    >
                        Cancel
                    </Button>
                    <div style={{ flex: 1 }} />
                    <Button
                        color={Button.Colors.RED}
                        disabled={loading || !count || parseInt(count) <= 0}
                        onClick={handleDelete}
                    >
                        {`Delete ${count || "0"} message${parseInt(count) === 1 ? "" : "s"}`}
                    </Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
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

    const activate = () => onClick();

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
        openModal((mProps) => <DeleteMessageModal modalProps={mProps} />);
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
    },
} as const;
