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
    // Check if message has content or embeds (real messages have these)
    if (!message.content && (!message.embeds || message.embeds.length === 0)) {
        return true;
    }

    // Check if message type is not 0 (0 = normal message)
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

    // First, get currently loaded messages
    const currentMessages = MessageStore.getMessages(channelId);
    if (currentMessages?._array) {
        currentMessages._array.forEach((msg: any) => {
            if (msg.author.id === userId && !isSystemMessage(msg)) {
                userMessageIds.add(msg.id);
            }
        });

        // Get oldest message ID for pagination
        if (currentMessages._array.length > 0) {
            oldestMessageId = currentMessages._array[0].id;
        }

        console.log(
            `[MessageDeleter] Found ${userMessageIds.size} messages in loaded cache`,
        );
    }

    // Load more messages by fetching older batches
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
                // Update oldest message ID
                oldestMessageId = msg.id;
            });

            console.log(
                `[MessageDeleter] Batch ${batchCount + 1}: Found ${foundUserMessages} user messages (total: ${userMessageIds.size})`,
            );

            batchCount++;

            // Notify progress callback
            if (onBatchProgress) {
                onBatchProgress(batchCount, maxBatches);
            }

            // If we got less than 100 messages, we've reached the end
            if (response.body.length < 100) {
                console.log(`[MessageDeleter] Reached end of channel history`);
                break;
            }

            // Small delay to avoid rate limiting
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

async function deleteMessagesWithDelay(
    channelId: string,
    messageIds: string[],
    onProgress?: (deleted: number, total: number) => void,
) {
    let deleted = 0;
    const total = messageIds.length;

    // Calculate dynamic delay based on message count
    // More messages = faster (min 5ms), fewer messages = slower (max 30ms)
    const maxDelay = Math.max(5, Math.min(30, 30 - total / 100));
    const minDelay = Math.max(5, maxDelay - 15);

    for (const messageId of messageIds) {
        try {
            // Double-check: verify the message isn't marked as deleted by messagelogger before attempting deletion
            const messageElement = document.querySelector(
                `li[id*="${messageId}"]`,
            );
            if (
                messageElement?.classList.contains("messagelogger-deleted") ||
                messageElement?.classList.contains("messagelogger-edited")
            ) {
                console.log(
                    `[MessageDeleter] Skipping ${messageId} - message logger detected`,
                );
                continue;
            }

            await RestAPI.del({
                url: `/channels/${channelId}/messages/${messageId}`,
            });
            deleted++;

            if (onProgress) {
                onProgress(deleted, total);
            }

            const delay = randomDelay(minDelay, maxDelay);
            await new Promise((resolve) => setTimeout(resolve, delay));
        } catch (error) {
            console.error(
                `[MessageDeleter] Failed to delete message ${messageId}:`,
                error,
            );
        }
    }

    return deleted;
}

function DeleteMessageModal(props: { modalProps: any }) {
    const { onClose } = props.modalProps;
    const FIXED_MODAL_WIDTH = "min(520px, calc(100vw - 64px))";

    const [count, setCount] = React.useState("10");
    const [working, setWorking] = React.useState(false);
    const [progress, setProgress] = React.useState<string>("");
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

    // Preload messages on mount
    React.useEffect(() => {
        if (!channelId || !currentUserId) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setProgress("Loading your messages...");
        setLoadingProgress(0);

        // For guild channels, load up to 10 batches (1000 messages checked)
        // For DMs, load up to 50 batches (5000 messages checked)
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
                setProgress("");
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
                setProgress("");
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

        setWorking(true);
        setProgress(`Deleting 0/${messageCount} messages...`);

        try {
            // Sort messages by ID (older first) and take the requested count
            const messagesToDelete = userMessageIds
                .sort((a, b) => a.localeCompare(b))
                .slice(0, messageCount);

            const deletedCount = await deleteMessagesWithDelay(
                channelId,
                messagesToDelete,
                (deleted, total) => {
                    setProgress(`Deleting ${deleted}/${total} messages...`);
                },
            );

            setWorking(false);
            Toasts.show({
                message: `Successfully deleted ${deletedCount} message${deletedCount !== 1 ? "s" : ""} in ${channelName}`,
                type: Toasts.Type.SUCCESS,
                id: Toasts.genId(),
            });

            onClose?.();
        } catch (error) {
            console.error("[MessageDeleter] Error:", error);
            Toasts.show({
                message:
                    "Failed to delete messages. Check console for details.",
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
            setWorking(false);
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
                                    {progress || "Loading messages..."}
                                </Forms.FormText>
                            </div>
                        ) : (
                            <>
                                {/* Total messages stat card */}
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
                                        disabled={working}
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

                                {working && (
                                    <Forms.FormText
                                        style={{
                                            color: "var(--text-muted)",
                                            marginTop: 12,
                                        }}
                                    >
                                        {progress}
                                    </Forms.FormText>
                                )}
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
                        disabled={working}
                    >
                        Cancel
                    </Button>
                    <div style={{ flex: 1 }} />
                    <Button
                        color={Button.Colors.RED}
                        disabled={
                            loading || working || !count || parseInt(count) <= 0
                        }
                        onClick={handleDelete}
                    >
                        {working
                            ? "Deleting..."
                            : `Delete ${count || "0"} message${parseInt(count) === 1 ? "" : "s"}`}
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

    // Bigger icon (24x24 instead of 20x20) with hover color transition
    container.innerHTML = `
        <div class="button__74017 button__24af7 vermcord-delete-btn" aria-label="Delete Messages" role="button" tabindex="0">
            <div class="buttonWrapper__24af7">
                <svg class="vermcord-delete-icon" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" style="pointer-events: none;">
                    <path fill="currentColor" d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z"/>
                </svg>
            </div>
        </div>
    `;

    // Add styles for smooth hover animation with higher specificity
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
    // Check if button already exists and is properly mounted
    const existingButton = document.getElementById(
        "vermLib-message-deleter-button",
    );
    if (existingButton && existingButton.parentElement) {
        // Button exists and is in the DOM, no need to re-inject
        return;
    }

    const buttonsContainer = document.querySelector("div.buttons__74017");
    if (!buttonsContainer) return;

    // Only remove if it exists but is not mounted properly
    if (existingButton) {
        existingButton.remove();
    }

    // Insert at the beginning (leftmost position)
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
