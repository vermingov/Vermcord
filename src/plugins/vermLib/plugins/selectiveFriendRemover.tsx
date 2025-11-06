/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    Alerts,
    Button,
    FluxDispatcher,
    Forms,
    Parser,
    React,
    RelationshipStore,
    RestAPI,
    Toasts,
    UserStore,
} from "@webpack/common";

type FriendLite = {
    id: string;
    username: string;
    discriminator?: string | null;
    avatar?: string | null;
    globalName?: string | null;
};

const BUTTON_CLICK_SOUND =
    "https://cdn.discordapp.com/attachments/1287309916909867070/1435824882280698006/ButtonClick.mp3?ex=690d5fa0&is=690c0e20&hm=fff0e8251321ee626e59ba33ff948816781028ef41f008feee131f764bef5fe4&";

function playButtonSound() {
    const audio = new Audio(BUTTON_CLICK_SOUND);
    audio.volume = 0.3;
    audio.play().catch(() => {});
}

function getUserAvatarURL(u: FriendLite, size = 64) {
    if (!u.avatar) return null;
    const ext = u.avatar.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${ext}?size=${size}`;
}

async function removeFriend(userId: string) {
    return RestAPI.del({
        url: `/users/@me/relationships/${userId}`,
    });
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
            animation: sfr-fade-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
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
        confirmBtn.textContent = "Continue";
        confirmBtn.style.cssText = `
            background: var(--brand-500);
            border: 1px solid rgba(88, 101, 242, 0.3);
            border-radius: 8px;
            color: white;
            cursor: pointer;
            padding: 8px 16px;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s ease;
            box-shadow: 0 0 12px rgba(88, 101, 242, 0.4);
        `;
        confirmBtn.addEventListener("click", () => {
            playButtonSound();
            closeModal();
            resolve(true);
        });
        confirmBtn.addEventListener("mouseenter", () => {
            confirmBtn.style.transform = "translateY(-2px)";
            confirmBtn.style.boxShadow = "0 4px 16px rgba(88, 101, 242, 0.6)";
        });
        confirmBtn.addEventListener("mouseleave", () => {
            confirmBtn.style.transform = "translateY(0)";
            confirmBtn.style.boxShadow = "0 0 12px rgba(88, 101, 242, 0.4)";
        });
        buttonContainer.appendChild(confirmBtn);

        modal.appendChild(buttonContainer);
        overlay.appendChild(modal);

        function closeModal() {
            overlay.style.animation =
                "sfr-fade-out 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards";
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

        document.body.appendChild(overlay);
    });
}

let deletionProgressElement: HTMLElement | null = null;

function createDeletionProgressToast(): HTMLElement {
    const container = document.createElement("div");
    container.id = "sfr-deletion-progress";
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
                <svg class="sfr-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" style="animation: sfr-spin 1s linear infinite;">
                    <circle cx="12" cy="12" r="10" stroke="var(--brand-500)" stroke-width="2" stroke-dasharray="15.7 31.4" />
                </svg>
                <span style="color: var(--header-primary); font-weight: 500; font-size: 14px;">
                    Removing Friends
                </span>
            </div>
            <span style="color: var(--text-muted); font-size: 12px; font-weight: 500;">
                <span id="sfr-progress-text">0/0</span>
            </span>
        </div>
        <div style="
            width: 100%;
            height: 4px;
            background: var(--background-tertiary);
            border-radius: 2px;
            overflow: hidden;
        ">
            <div id="sfr-progress-bar" style="
                height: 100%;
                background: linear-gradient(90deg, var(--brand-500, #5865F2), var(--brand-560, #4752C4));
                border-radius: 2px;
                width: 0%;
                transition: width 0.2s ease;
                box-shadow: 0 0 12px rgba(88, 101, 242, 0.6);
            "></div>
        </div>
    `;

    if (!document.getElementById("sfr-spinner-styles")) {
        const style = document.createElement("style");
        style.id = "sfr-spinner-styles";
        style.textContent = `
            @keyframes sfr-spin {
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
        "#sfr-progress-bar",
    ) as HTMLElement;
    const progressText =
        deletionProgressElement.querySelector("#sfr-progress-text");

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

let currentMenuInstance: {
    close: () => void;
    container: HTMLElement;
} | null = null;

interface MenuState {
    query: string;
    selected: Set<string>;
    working: boolean;
}

let menuState: MenuState = {
    query: "",
    selected: new Set(),
    working: false,
};

async function massRemoveFriends(allFriends: FriendLite[]) {
    const ids = [...menuState.selected].filter((id) =>
        allFriends.some((u) => u.id === id),
    );
    if (!ids.length) return;

    const confirmed = await showCustomModal(
        "Remove selected friends?",
        `You are about to remove ${ids.length} friend${ids.length === 1 ? "" : "s"}.`,
    );
    if (!confirmed) return;

    menuState.working = true;
    currentMenuInstance?.close();
    showDeletionProgress(0, ids.length);

    let ok = 0;
    let fail = 0;

    for (const uid of ids) {
        try {
            await removeFriend(uid);
            ok++;
            FluxDispatcher.dispatch({
                type: "RELATIONSHIP_REMOVE",
                relationship: { id: uid, nickname: "", type: 1 },
            });
        } catch {
            try {
                await new Promise((r) => setTimeout(r, 1000));
                await removeFriend(uid);
                ok++;
                FluxDispatcher.dispatch({
                    type: "RELATIONSHIP_REMOVE",
                    relationship: { id: uid, nickname: "", type: 1 },
                });
            } catch {
                fail++;
            }
        }

        showDeletionProgress(ok + fail, ids.length);
        await new Promise((r) => setTimeout(r, 300));
    }

    menuState.working = false;
    hideDeletionProgress();

    setTimeout(() => {
        Toasts.show({
            id: Toasts.genId(),
            type: fail ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS,
            message: fail
                ? `Removed ${ok} friend${ok === 1 ? "" : "s"}. ${fail} failed.`
                : `Successfully removed ${ok} friend${ok === 1 ? "" : "s"}.`,
        });
    }, 300);
}

function updateSelectionUI(container: HTMLElement, allFriends: FriendLite[]) {
    const selectedCount = [...menuState.selected].filter((id) =>
        allFriends.some((u) => u.id === id),
    ).length;

    const selectedSpan = container.querySelector("span");
    if (selectedSpan) {
        selectedSpan.textContent = `Selected: ${selectedCount}`;
    }

    const actionBtn = container.querySelector(
        "#action-btn",
    ) as HTMLButtonElement;
    if (actionBtn) {
        actionBtn.textContent = menuState.working
            ? "Removing..."
            : `Remove selected (${selectedCount})`;
        actionBtn.style.opacity =
            selectedCount === 0 || menuState.working ? "0.5" : "1";
        actionBtn.style.cursor =
            selectedCount === 0 || menuState.working
                ? "not-allowed"
                : "pointer";
        actionBtn.disabled = selectedCount === 0 || menuState.working;
    }

    container.querySelectorAll(".friend-item").forEach((item) => {
        const id = item.getAttribute("data-id");
        const isSelected = menuState.selected.has(id!);

        if (isSelected) {
            item.style.background = "rgba(88, 101, 242, 0.15)";
            item.style.borderColor = "rgba(88, 101, 242, 0.3)";
        } else {
            item.style.background = "transparent";
            item.style.borderColor = "rgba(255, 255, 255, 0.03)";
        }
    });
}

function renderMenu(container: HTMLElement) {
    const ids = RelationshipStore.getFriendIDs?.() ?? [];
    const allFriends: FriendLite[] = ids
        .map((id) => {
            const u = UserStore.getUser?.(id) ?? ({} as any);
            return {
                id,
                username: u?.username ?? "Unknown",
                discriminator: u?.discriminator ?? null,
                avatar: u?.avatar ?? null,
                globalName: u?.globalName ?? null,
            };
        })
        .sort((a, b) => {
            const an = (a.globalName || a.username || "").toLowerCase();
            const bn = (b.globalName || b.username || "").toLowerCase();
            return an.localeCompare(bn);
        });

    const q = menuState.query.trim().toLowerCase();
    const filtered = !q
        ? allFriends
        : allFriends.filter((u) => {
              const a = (u.globalName || "").toLowerCase();
              const b = (u.username || "").toLowerCase();
              return a.includes(q) || b.includes(q) || u.id.includes(q);
          });

    const selectedCount = [...menuState.selected].filter((id) =>
        allFriends.some((u) => u.id === id),
    ).length;

    container.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, var(--background-primary) 0%, var(--background-secondary) 100%); backdrop-filter: blur(10px); z-index: 9997; animation: sfr-fade-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); display: flex; align-items: center; justify-content: center;" id="sfr-overlay">
            <div style="width: min(840px, calc(100vw - 64px)); max-height: calc(100vh - 64px); background: color-mix(in oklab, var(--background-secondary) 90%, black 10%); border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 16px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.03); backdrop-filter: blur(10px); display: flex; flex-direction: column; overflow: hidden; padding: 24px; gap: 16px;">
                <div style="font-size: 20px; font-weight: 600; color: var(--header-primary); letter-spacing: 0.5px;">
                    Selective Friend Remover
                </div>

                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: var(--header-primary); font-size: 14px; font-weight: 500;">
                        Selected: ${selectedCount}
                    </span>
                    <div style="flex: 1;"></div>
                    <button id="select-all" style="background: color-mix(in oklab, var(--background-secondary) 90%, black 10%); border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 8px; color: var(--header-primary); padding: 6px 12px; cursor: pointer; font-size: 12px; font-weight: 500;">Select visible</button>
                    <button id="clear-all" style="background: color-mix(in oklab, var(--background-secondary) 90%, black 10%); border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 8px; color: var(--header-primary); padding: 6px 12px; cursor: pointer; font-size: 12px; font-weight: 500;">Clear</button>
                </div>

                <input id="search-input" placeholder="Search by name or ID..." style="background: color-mix(in oklab, var(--background-secondary) 90%, black 10%); border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 8px; color: var(--header-primary); padding: 8px 10px; transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); backdrop-filter: blur(10px); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.03); outline: none; font-size: 14px;" value="${menuState.query}">

                <div id="friend-list" style="display: grid; gap: 8px; height: 420px; overflow-y: auto; overflow-x: hidden; padding: 8px; background: color-mix(in oklab, var(--background-secondary) 90%, black 10%); border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.03); backdrop-filter: blur(10px);">
                    ${
                        filtered.length
                            ? filtered
                                  .map((u) => {
                                      const isSelected = menuState.selected.has(
                                          u.id,
                                      );
                                      const icon = getUserAvatarURL(u, 64);
                                      const name =
                                          u.globalName || u.username || u.id;
                                      const initials = (u.username || "?")
                                          .slice(0, 2)
                                          .toUpperCase();
                                      return `
                            <div class="friend-item" data-id="${u.id}" style="display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 8px; background: ${isSelected ? "rgba(88, 101, 242, 0.15)" : "transparent"}; border: 1px solid ${isSelected ? "rgba(88, 101, 242, 0.3)" : "rgba(255, 255, 255, 0.03)"}; cursor: pointer; transition: all 0.12s cubic-bezier(0.34, 1.56, 0.64, 1);">
                                <div style="width: 32px; height: 32px; border-radius: 16px; overflow: hidden; flex: 0 0 auto; background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.05); display: flex; align-items: center; justify-content: center;">
                                    ${icon ? `<img src="${icon}" alt="" width="32" height="32" style="width: 100%; height: 100%;">` : `<span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">${initials}</span>`}
                                </div>
                                <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
                                    <div style="color: var(--header-primary); font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">${name}</div>
                                    <div style="color: var(--text-muted); font-size: 12px;">${u.username}${u.discriminator ? `#${u.discriminator}` : ""} • ${u.id}</div>
                                </div>
                            </div>
                        `;
                                  })
                                  .join("")
                            : `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 14px;">No friends match your search.</div>`
                    }
                </div>

                <div style="color: var(--text-danger); font-size: 12px; padding: 8px 0;">
                    Warning: Removing friends is permanent. You will have to send a new friend request to add them again.
                </div>

                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button id="cancel-btn" style="background: transparent; border: none; color: var(--header-primary); cursor: pointer; padding: 6px 12px; font-size: 14px; font-weight: 500;">Cancel</button>
                    <button id="action-btn" style="background: #ED4245; border: 1px solid rgba(237, 66, 69, 0.5); border-radius: 8px; color: white; padding: 6px 12px; cursor: pointer; transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); font-size: 14px; font-weight: 500; box-shadow: 0 0 12px rgba(237, 66, 69, 0.4);">
                        ${menuState.working ? "Removing..." : `Remove selected (${selectedCount})`}
                    </button>
                </div>
            </div>
            <style>
                @keyframes sfr-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes sfr-fade-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(8px); } }
                div::-webkit-scrollbar { display: none; }
                .friend-item:hover { transform: translateY(-1px); background: rgba(88, 101, 242, 0.08) !important; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(88, 101, 242, 0.1) !important; border-color: rgba(88, 101, 242, 0.2) !important; }
                #action-btn:hover { background: #DC2630; box-shadow: 0 4px 16px rgba(237, 66, 69, 0.6); transform: translateY(-2px); }
                #action-btn:active { transform: translateY(0); }
            </style>
        </div>
    `;

    const overlay = container.querySelector("#sfr-overlay");
    const selectAllBtn = container.querySelector("#select-all");
    const clearAllBtn = container.querySelector("#clear-all");
    const searchInput = container.querySelector(
        "#search-input",
    ) as HTMLInputElement;
    const friendList = container.querySelector("#friend-list");
    const cancelBtn = container.querySelector("#cancel-btn");
    const actionBtn = container.querySelector("#action-btn");

    function closeMainMenu() {
        overlay?.style.animation === "sfr-fade-out" ||
            (overlay!.style.animation =
                "sfr-fade-out 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards");
        setTimeout(() => currentMenuInstance?.close(), 250);
    }

    overlay?.addEventListener("click", (e) => {
        if (e.target === overlay) {
            playButtonSound();
            closeMainMenu();
        }
    });

    selectAllBtn?.addEventListener("click", () => {
        playButtonSound();
        for (const u of filtered) menuState.selected.add(u.id);
        updateSelectionUI(container, allFriends);
    });

    clearAllBtn?.addEventListener("click", () => {
        playButtonSound();
        menuState.selected.clear();
        updateSelectionUI(container, allFriends);
    });

    searchInput?.addEventListener("input", (e) => {
        menuState.query = (e.target as HTMLInputElement).value;

        const ids = RelationshipStore.getFriendIDs?.() ?? [];
        const allFriends = ids
            .map((id) => {
                const u = UserStore.getUser?.(id) ?? ({} as any);
                return {
                    id,
                    username: u?.username ?? "Unknown",
                    discriminator: u?.discriminator ?? null,
                    avatar: u?.avatar ?? null,
                    globalName: u?.globalName ?? null,
                };
            })
            .sort((a, b) => {
                const an = (a.globalName || a.username || "").toLowerCase();
                const bn = (b.globalName || b.username || "").toLowerCase();
                return an.localeCompare(bn);
            });

        const q = menuState.query.trim().toLowerCase();
        const filtered = !q
            ? allFriends
            : allFriends.filter((u) => {
                  const a = (u.globalName || "").toLowerCase();
                  const b = (u.username || "").toLowerCase();
                  return a.includes(q) || b.includes(q) || u.id.includes(q);
              });

        // Update only the friend list element
        const friendListElement = container.querySelector("#friend-list");
        if (friendListElement) {
            friendListElement.innerHTML = filtered.length
                ? filtered
                      .map((u) => {
                          const isSelected = menuState.selected.has(u.id);
                          const icon = getUserAvatarURL(u, 64);
                          const name = u.globalName || u.username || u.id;
                          const initials = (u.username || "?")
                              .slice(0, 2)
                              .toUpperCase();
                          return `
                            <div class="friend-item" data-id="${u.id}" style="display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 8px; background: ${isSelected ? "rgba(88, 101, 242, 0.15)" : "transparent"}; border: 1px solid ${isSelected ? "rgba(88, 101, 242, 0.3)" : "rgba(255, 255, 255, 0.03)"}; cursor: pointer; transition: all 0.12s cubic-bezier(0.34, 1.56, 0.64, 1);">
                                <div style="width: 32px; height: 32px; border-radius: 16px; overflow: hidden; flex: 0 0 auto; background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.05); display: flex; align-items: center; justify-content: center;">
                                    ${icon ? `<img src="${icon}" alt="" width="32" height="32" style="width: 100%; height: 100%;">` : `<span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">${initials}</span>`}
                                </div>
                                <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
                                    <div style="color: var(--header-primary); font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">${name}</div>
                                    <div style="color: var(--text-muted); font-size: 12px;">${u.username}${u.discriminator ? `#${u.discriminator}` : ""} • ${u.id}</div>
                                </div>
                            </div>
                        `;
                      })
                      .join("")
                : `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 14px;">No friends match your search.</div>`;

            // Re-attach event listeners to new items
            friendListElement
                .querySelectorAll(".friend-item")
                .forEach((item) => {
                    item.addEventListener("click", () => {
                        playButtonSound();
                        const id = item.getAttribute("data-id");
                        if (id) {
                            if (menuState.selected.has(id))
                                menuState.selected.delete(id);
                            else menuState.selected.add(id);
                            updateSelectionUI(container, allFriends);
                        }
                    });
                });
        }
    });

    friendList?.querySelectorAll(".friend-item").forEach((item) => {
        item.addEventListener("click", () => {
            playButtonSound();
            const id = item.getAttribute("data-id");
            if (id) {
                if (menuState.selected.has(id)) menuState.selected.delete(id);
                else menuState.selected.add(id);
                updateSelectionUI(container, allFriends);
            }
        });
    });

    cancelBtn?.addEventListener("click", () => {
        playButtonSound();
        closeMainMenu();
    });
    actionBtn?.addEventListener("click", () => {
        playButtonSound();
        massRemoveFriends(allFriends);
    });
}

function openSelectiveFriendRemover() {
    const container = document.createElement("div");
    container.id = "vermLib-sfr-menu-container";
    document.body.appendChild(container);
    const close = () => {
        container.remove();
        currentMenuInstance = null;
    };
    currentMenuInstance = { close, container };
    document.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            playButtonSound();
            close();
        }
    });
    renderMenu(container);
}

function createFriendsActionButton(onClick: () => void) {
    const addFriend = document.querySelector<HTMLElement>(".addFriend__133bf");
    if (!addFriend) return null;

    const node = addFriend.cloneNode(true) as HTMLElement;
    node.id = "vermLib-selective-friend-remover-button";
    node.className = node.className.replace(/addFriend__[a-z0-9]+/, "").trim();
    node.setAttribute("aria-label", "Remove Friends");

    const labelSpan = node.querySelector("span");
    if (labelSpan) {
        labelSpan.textContent = "Remove Friends";
    }

    const activate = () => {
        playButtonSound();
        onClick();
    };
    node.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        activate();
    });
    node.addEventListener("keydown", (e) => {
        if (
            (e as KeyboardEvent).key === "Enter" ||
            (e as KeyboardEvent).key === " "
        ) {
            e.preventDefault();
            e.stopPropagation();
            activate();
        }
    });

    return node;
}

function ensureInjected() {
    const existing = document.getElementById(
        "vermLib-selective-friend-remover-button",
    );
    if (existing && existing.isConnected) return;

    const addFriend = document.querySelector<HTMLElement>(".addFriend__133bf");
    if (!addFriend) return;

    existing?.remove();

    const node = createFriendsActionButton(() => openSelectiveFriendRemover());
    if (!node) return;

    addFriend.insertAdjacentElement("afterend", node);
}

let mo: MutationObserver | null = null;
let hb: number | null = null;

const REINJECT_EVENTS = [
    "FRIENDS_SET_SECTION",
    "LOAD_RELATIONSHIPS_SUCCESS",
    "RELATIONSHIP_ADD",
    "RELATIONSHIP_UPDATE",
    "RELATIONSHIP_REMOVE",
    "WINDOW_FOCUS",
] as const;

const reinjectHandler = () => ensureInjected();

function subscribeReinjection() {
    try {
        for (const ev of REINJECT_EVENTS) {
            FluxDispatcher.subscribe(ev as any, reinjectHandler as any);
        }
    } catch {}
}

function unsubscribeReinjection() {
    try {
        for (const ev of REINJECT_EVENTS) {
            FluxDispatcher.unsubscribe(ev as any, reinjectHandler as any);
        }
    } catch {}
}

function startObserve() {
    mo = new MutationObserver(() => {
        if (
            !document.getElementById("vermLib-selective-friend-remover-button")
        ) {
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
    name: "SelectiveFriendRemover",

    start() {
        const styleId = "vermLib-sfr-button-style";
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `
                #vermLib-selective-friend-remover-button {
                    background: #ED4245 !important;
                    color: white !important;
                    box-shadow: 0 0 12px rgba(237, 66, 69, 0.4) !important;
                }
                #vermLib-selective-friend-remover-button:hover {
                    background: #DC2630 !important;
                    box-shadow: 0 4px 16px rgba(237, 66, 69, 0.6) !important;
                }
            `;
            document.head.appendChild(style);
        }

        ensureInjected();
        startObserve();
        subscribeReinjection();
        hb = window.setInterval(() => ensureInjected(), 1000);
    },

    stop() {
        if (hb) {
            clearInterval(hb);
            hb = null;
        }
        unsubscribeReinjection();
        stopObserve();
        document
            .getElementById("vermLib-selective-friend-remover-button")
            ?.remove();
        document.getElementById("vermLib-sfr-button-style")?.remove();
        hideDeletionProgress();
    },
} as const;
