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
    GuildStore,
    Parser,
    React,
    RestAPI,
    Toasts,
    UserStore,
} from "@webpack/common";

type GuildLite = {
    id: string;
    name: string;
    icon?: string | null | undefined;
    ownerId: string;
};

const BUTTON_CLICK_SOUND =
    "https://cdn.discordapp.com/attachments/1287309916909867070/1435824882280698006/ButtonClick.mp3?ex=690d5fa0&is=690c0e20&hm=fff0e8251321ee626e59ba33ff948816781028ef41f008feee131f764bef5fe4&";

function playButtonSound() {
    const audio = new Audio(BUTTON_CLICK_SOUND);
    audio.volume = 0.3;
    audio.play().catch(() => {});
}

function getGuildIconURL(g: GuildLite, size = 64) {
    if (!g.icon) return null;
    return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.${g.icon.startsWith("a_") ? "gif" : "png"}?size=${size}`;
}

async function leaveGuild(guildId: string) {
    return RestAPI.del({
        url: `/users/@me/guilds/${guildId}`,
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
            animation: ssl-fade-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
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
                "ssl-fade-out 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards";
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
    container.id = "ssl-deletion-progress";
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
                <svg class="ssl-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" style="animation: ssl-spin 1s linear infinite;">
                    <circle cx="12" cy="12" r="10" stroke="var(--brand-500)" stroke-width="2" stroke-dasharray="15.7 31.4" />
                </svg>
                <span style="color: var(--header-primary); font-weight: 500; font-size: 14px;">
                    Processing
                </span>
            </div>
            <span style="color: var(--text-muted); font-size: 12px; font-weight: 500;">
                <span id="ssl-progress-text">0/0</span>
            </span>
        </div>
        <div style="
            width: 100%;
            height: 4px;
            background: var(--background-tertiary);
            border-radius: 2px;
            overflow: hidden;
        ">
            <div id="ssl-progress-bar" style="
                height: 100%;
                background: linear-gradient(90deg, var(--brand-500, #5865F2), var(--brand-560, #4752C4));
                border-radius: 2px;
                width: 0%;
                transition: width 0.2s ease;
                box-shadow: 0 0 12px rgba(88, 101, 242, 0.6);
            "></div>
        </div>
    `;

    if (!document.getElementById("ssl-spinner-styles")) {
        const style = document.createElement("style");
        style.id = "ssl-spinner-styles";
        style.textContent = `
            @keyframes ssl-spin {
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
        "#ssl-progress-bar",
    ) as HTMLElement;
    const progressText =
        deletionProgressElement.querySelector("#ssl-progress-text");

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
    activeTab: "joined" | "owned";
    query: string;
    selectedJoined: Set<string>;
    selectedOwned: Set<string>;
    working: boolean;
}

let menuState: MenuState = {
    activeTab: "joined",
    query: "",
    selectedJoined: new Set(),
    selectedOwned: new Set(),
    working: false,
};

async function deleteGuildOnce(guildId: string, mfaCode?: string) {
    return RestAPI.del({
        url: `/guilds/${guildId}`,
        headers: mfaCode
            ? ({ "X-Discord-MFA-Code": mfaCode } as any)
            : undefined,
    } as any);
}

async function massDeleteOwned(selectedOwnedIds: string[]) {
    if (!selectedOwnedIds.length) return;

    const confirm1 = await showCustomModal(
        "Delete owned servers?",
        `You are about to delete ${selectedOwnedIds.length} server${selectedOwnedIds.length === 1 ? "" : "s"}. This action is permanent.`,
    );
    if (!confirm1) return;

    const confirm2 = await showCustomModal(
        "Are you absolutely sure?",
        "This will permanently delete all selected servers and cannot be undone.",
    );
    if (!confirm2) return;

    const confirm3 = await showCustomModal(
        "Final confirmation",
        "Type your 2FA code if enabled in the next prompt. Proceed?",
    );
    if (!confirm3) return;

    let mfaCode: string | undefined;
    try {
        const code = window
            .prompt("Enter your 2FA code (leave empty if not enabled):")
            ?.trim();
        if (code) mfaCode = code;
    } catch {}

    menuState.working = true;
    currentMenuInstance?.close();
    showDeletionProgress(0, selectedOwnedIds.length);

    let ok = 0,
        fail = 0;
    for (const gid of selectedOwnedIds) {
        try {
            await deleteGuildOnce(gid, mfaCode);
            ok++;
            FluxDispatcher.dispatch({
                type: "GUILD_DELETE",
                guild: { id: gid },
            });
        } catch {
            try {
                await new Promise((r) => setTimeout(r, 1000));
                await deleteGuildOnce(gid, mfaCode);
                ok++;
                FluxDispatcher.dispatch({
                    type: "GUILD_DELETE",
                    guild: { id: gid },
                });
            } catch {
                fail++;
            }
        }

        showDeletionProgress(ok + fail, selectedOwnedIds.length);
        await new Promise((r) => setTimeout(r, 300));
    }

    menuState.working = false;
    hideDeletionProgress();

    setTimeout(() => {
        Toasts.show({
            id: Toasts.genId(),
            type: fail ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS,
            message: fail
                ? `Deleted ${ok} server${ok === 1 ? "" : "s"}. ${fail} failed.`
                : `Successfully deleted ${ok} server${ok === 1 ? "" : "s"}.`,
        });
    }, 300);
}

async function massLeaveJoined(selectedJoinedIds: string[]) {
    if (!selectedJoinedIds.length) return;

    const confirmed = await showCustomModal(
        "Leave selected servers?",
        `You are about to leave ${selectedJoinedIds.length} server${selectedJoinedIds.length === 1 ? "" : "s"}.`,
    );
    if (!confirmed) return;

    menuState.working = true;
    currentMenuInstance?.close();
    showDeletionProgress(0, selectedJoinedIds.length);

    let ok = 0,
        fail = 0;
    for (const gid of selectedJoinedIds) {
        try {
            await leaveGuild(gid);
            ok++;
            FluxDispatcher.dispatch({
                type: "GUILD_DELETE",
                guild: { id: gid },
            });
        } catch {
            try {
                await new Promise((r) => setTimeout(r, 1000));
                await leaveGuild(gid);
                ok++;
                FluxDispatcher.dispatch({
                    type: "GUILD_DELETE",
                    guild: { id: gid },
                });
            } catch {
                fail++;
            }
        }

        showDeletionProgress(ok + fail, selectedJoinedIds.length);
        await new Promise((r) => setTimeout(r, 300));
    }

    menuState.working = false;
    hideDeletionProgress();

    setTimeout(() => {
        Toasts.show({
            id: Toasts.genId(),
            type: fail ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS,
            message: fail
                ? `Left ${ok} server${ok === 1 ? "" : "s"}. ${fail} failed.`
                : `Successfully left ${ok} server${ok === 1 ? "" : "s"}.`,
        });
    }, 300);
}

function updateSelectionUI(container: HTMLElement) {
    const meId = UserStore.getCurrentUser()?.id;
    const map = GuildStore.getGuilds?.() ?? {};
    const allGuilds: GuildLite[] = Object.values(map as Record<string, any>)
        .map((g) => ({
            id: g.id,
            name: g.name,
            icon: g.icon,
            ownerId: g.ownerId,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const ownedGuilds = allGuilds.filter((g) => g.ownerId === meId);
    const joinedGuilds = allGuilds.filter((g) => g.ownerId !== meId);

    const selectedJoinedIds = [...menuState.selectedJoined].filter((id) =>
        joinedGuilds.some((g) => g.id === id),
    );
    const selectedOwnedIds = [...menuState.selectedOwned].filter((id) =>
        ownedGuilds.some((g) => g.id === id),
    );

    const selectedSpan = container.querySelector("span");
    if (selectedSpan) {
        selectedSpan.textContent = `Selected: ${menuState.activeTab === "joined" ? selectedJoinedIds.length : selectedOwnedIds.length}`;
    }

    const actionBtn = container.querySelector(
        "#action-btn",
    ) as HTMLButtonElement;
    if (actionBtn) {
        const count =
            menuState.activeTab === "joined"
                ? selectedJoinedIds.length
                : selectedOwnedIds.length;
        actionBtn.textContent = menuState.working
            ? menuState.activeTab === "joined"
                ? "Leaving..."
                : "Deleting..."
            : menuState.activeTab === "joined"
              ? `Leave selected (${count})`
              : `Delete selected (${count})`;
        actionBtn.style.opacity =
            count === 0 || menuState.working ? "0.5" : "1";
        actionBtn.style.cursor =
            count === 0 || menuState.working ? "not-allowed" : "pointer";
        actionBtn.disabled = count === 0 || menuState.working;
    }

    container.querySelectorAll(".guild-item").forEach((item) => {
        const id = item.getAttribute("data-id");
        const isSelected =
            menuState.activeTab === "joined"
                ? menuState.selectedJoined.has(id!)
                : menuState.selectedOwned.has(id!);

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
    const meId = UserStore.getCurrentUser()?.id;
    const map = GuildStore.getGuilds?.() ?? {};
    const allGuilds: GuildLite[] = Object.values(map as Record<string, any>)
        .map((g) => ({
            id: g.id,
            name: g.name,
            icon: g.icon,
            ownerId: g.ownerId,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const ownedGuilds = allGuilds.filter((g) => g.ownerId === meId);
    const joinedGuilds = allGuilds.filter((g) => g.ownerId !== meId);

    const q = menuState.query.trim().toLowerCase();
    const filteredOwned = !q
        ? ownedGuilds
        : ownedGuilds.filter(
              (g) => g.name.toLowerCase().includes(q) || g.id.includes(q),
          );
    const filteredJoined = !q
        ? joinedGuilds
        : joinedGuilds.filter(
              (g) => g.name.toLowerCase().includes(q) || g.id.includes(q),
          );

    const currentList =
        menuState.activeTab === "joined" ? filteredJoined : filteredOwned;
    const currentSelected =
        menuState.activeTab === "joined"
            ? menuState.selectedJoined
            : menuState.selectedOwned;
    const selectedJoinedIds = [...menuState.selectedJoined].filter((id) =>
        joinedGuilds.some((g) => g.id === id),
    );
    const selectedOwnedIds = [...menuState.selectedOwned].filter((id) =>
        ownedGuilds.some((g) => g.id === id),
    );

    container.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, var(--background-primary) 0%, var(--background-secondary) 100%); backdrop-filter: blur(10px); z-index: 9997; animation: ssl-fade-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); display: flex; align-items: center; justify-content: center;" id="ssl-overlay">
            <div style="width: min(840px, calc(100vw - 64px)); max-height: calc(100vh - 64px); background: color-mix(in oklab, var(--background-secondary) 90%, black 10%); border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 16px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.03); backdrop-filter: blur(10px); display: flex; flex-direction: column; overflow: hidden; padding: 24px; gap: 16px;">
                <div style="font-size: 20px; font-weight: 600; color: var(--header-primary); letter-spacing: 0.5px;">
                    Selective Server Leaver
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <button id="tab-joined" style="background: ${menuState.activeTab === "joined" ? "var(--brand-500)" : "color-mix(in oklab, var(--background-secondary) 90%, black 10%)"}; border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 8px; color: var(--header-primary); padding: 8px 12px; cursor: pointer; transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); box-shadow: ${menuState.activeTab === "joined" ? "0 0 12px rgba(88, 101, 242, 0.6)" : "0 2px 10px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.03)"}; font-size: 14px; font-weight: 500;">Joined Servers</button>
                    <button id="tab-owned" style="background: ${menuState.activeTab === "owned" ? "var(--brand-500)" : "color-mix(in oklab, var(--background-secondary) 90%, black 10%)"}; border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 8px; color: var(--header-primary); padding: 8px 12px; cursor: pointer; transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); box-shadow: ${menuState.activeTab === "owned" ? "0 0 12px rgba(88, 101, 242, 0.6)" : "0 2px 10px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.03)"}; font-size: 14px; font-weight: 500;">Owned Servers</button>
                </div>

                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: var(--header-primary); font-size: 14px; font-weight: 500;">
                        Selected: ${menuState.activeTab === "joined" ? selectedJoinedIds.length : selectedOwnedIds.length}
                    </span>
                    <div style="flex: 1;"></div>
                    <button id="select-all" style="background: color-mix(in oklab, var(--background-secondary) 90%, black 10%); border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 8px; color: var(--header-primary); padding: 6px 12px; cursor: pointer; font-size: 12px; font-weight: 500;">Select visible</button>
                    <button id="clear-all" style="background: color-mix(in oklab, var(--background-secondary) 90%, black 10%); border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 8px; color: var(--header-primary); padding: 6px 12px; cursor: pointer; font-size: 12px; font-weight: 500;">Clear</button>
                </div>

                <input id="search-input" placeholder="Search by server name or ID..." style="background: color-mix(in oklab, var(--background-secondary) 90%, black 10%); border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 8px; color: var(--header-primary); padding: 8px 10px; transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); backdrop-filter: blur(10px); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.03); outline: none; font-size: 14px;" value="${menuState.query}">

                <div id="guild-list" style="display: grid; gap: 8px; height: 420px; overflow-y: auto; overflow-x: hidden; padding: 8px; background: color-mix(in oklab, var(--background-secondary) 90%, black 10%); border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.03); backdrop-filter: blur(10px);">
                    ${
                        currentList.length
                            ? currentList
                                  .map((g) => {
                                      const isOwner = g.ownerId === meId;
                                      const isSelected = currentSelected.has(
                                          g.id,
                                      );
                                      const icon = getGuildIconURL(g, 64);
                                      return `
                            <div class="guild-item" data-id="${g.id}" style="display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 8px; background: ${isSelected ? "rgba(88, 101, 242, 0.15)" : "transparent"}; border: 1px solid ${isSelected ? "rgba(88, 101, 242, 0.3)" : "rgba(255, 255, 255, 0.03)"}; cursor: pointer; transition: all 0.12s cubic-bezier(0.34, 1.56, 0.64, 1);">
                                <div style="width: 32px; height: 32px; border-radius: 8px; overflow: hidden; flex: 0 0 auto; background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.05); display: flex; align-items: center; justify-content: center;">
                                    ${icon ? `<img src="${icon}" alt="" width="32" height="32" style="width: 100%; height: 100%;">` : `<span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">${g.name.slice(0, 2).toUpperCase()}</span>`}
                                </div>
                                <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
                                    <div style="color: var(--header-primary); font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">${g.name}</div>
                                    <div style="color: var(--text-muted); font-size: 12px;">${g.id}${isOwner ? " • Owner" : ""}</div>
                                </div>
                            </div>
                        `;
                                  })
                                  .join("")
                            : `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 14px;">No servers match your search.</div>`
                    }
                </div>

                <div style="color: var(--text-danger); font-size: 12px; padding: 8px 0;">
                    Warning: Leaving servers is permanent. You will lose access until re-invited.
                </div>

                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button id="cancel-btn" style="background: transparent; border: none; color: var(--header-primary); cursor: pointer; padding: 6px 12px; font-size: 14px; font-weight: 500;">Cancel</button>
                    <button id="action-btn" style="background: rgba(237, 66, 69, 0.1); border: 1px solid rgba(237, 66, 69, 0.15); border-radius: 8px; color: #ED4245; padding: 6px 12px; cursor: pointer; transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); font-size: 14px; font-weight: 500;">
                        ${menuState.working ? (menuState.activeTab === "joined" ? "Leaving..." : "Deleting...") : menuState.activeTab === "joined" ? `Leave selected (${selectedJoinedIds.length})` : `Delete selected (${selectedOwnedIds.length})`}
                    </button>
                </div>
            </div>
            <style>
                @keyframes ssl-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes ssl-fade-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(8px); } }
                div::-webkit-scrollbar { display: none; }
                .guild-item:hover { transform: translateY(-1px); background: rgba(88, 101, 242, 0.08) !important; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(88, 101, 242, 0.1) !important; border-color: rgba(88, 101, 242, 0.2) !important; }
            </style>
        </div>
    `;

    const overlay = container.querySelector("#ssl-overlay");
    const tabJoined = container.querySelector("#tab-joined");
    const tabOwned = container.querySelector("#tab-owned");
    const selectAllBtn = container.querySelector("#select-all");
    const clearAllBtn = container.querySelector("#clear-all");
    const searchInput = container.querySelector(
        "#search-input",
    ) as HTMLInputElement;
    const guildList = container.querySelector("#guild-list");
    const cancelBtn = container.querySelector("#cancel-btn");
    const actionBtn = container.querySelector("#action-btn");

    function closeMainMenu() {
        overlay?.style.animation === "ssl-fade-out" ||
            (overlay!.style.animation =
                "ssl-fade-out 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards");
        setTimeout(() => currentMenuInstance?.close(), 250);
    }

    overlay?.addEventListener("click", (e) => {
        if (e.target === overlay) {
            playButtonSound();
            closeMainMenu();
        }
    });
    tabJoined?.addEventListener("click", () => {
        playButtonSound();
        menuState.activeTab = "joined";
        renderMenu(container);
    });
    tabOwned?.addEventListener("click", () => {
        playButtonSound();
        menuState.activeTab = "owned";
        renderMenu(container);
    });

    selectAllBtn?.addEventListener("click", () => {
        playButtonSound();
        const current =
            menuState.activeTab === "joined"
                ? menuState.selectedJoined
                : menuState.selectedOwned;
        for (const g of currentList) current.add(g.id);
        updateSelectionUI(container);
    });

    clearAllBtn?.addEventListener("click", () => {
        playButtonSound();
        const current =
            menuState.activeTab === "joined"
                ? menuState.selectedJoined
                : menuState.selectedOwned;
        current.clear();
        updateSelectionUI(container);
    });

    searchInput?.addEventListener("input", (e) => {
        menuState.query = (e.target as HTMLInputElement).value;

        // Update filtered list without re-rendering entire UI
        const meId = UserStore.getCurrentUser()?.id;
        const map = GuildStore.getGuilds?.() ?? {}; // or RelationshipStore for friend remover
        const allGuilds = Object.values(map as Record<string, any>)
            .map((g) => ({
                id: g.id,
                name: g.name,
                icon: g.icon,
                ownerId: g.ownerId,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const ownedGuilds = allGuilds.filter((g) => g.ownerId === meId);
        const joinedGuilds = allGuilds.filter((g) => g.ownerId !== meId);

        const q = menuState.query.trim().toLowerCase();
        const filteredOwned = !q
            ? ownedGuilds
            : ownedGuilds.filter(
                  (g) => g.name.toLowerCase().includes(q) || g.id.includes(q),
              );
        const filteredJoined = !q
            ? joinedGuilds
            : joinedGuilds.filter(
                  (g) => g.name.toLowerCase().includes(q) || g.id.includes(q),
              );

        const currentList =
            menuState.activeTab === "joined" ? filteredJoined : filteredOwned;
        const currentSelected =
            menuState.activeTab === "joined"
                ? menuState.selectedJoined
                : menuState.selectedOwned;

        // Update only the guild list element
        const guildListElement = container.querySelector("#guild-list");
        if (guildListElement) {
            guildListElement.innerHTML = currentList.length
                ? currentList
                      .map((g) => {
                          const isOwner = g.ownerId === meId;
                          const isSelected = currentSelected.has(g.id);
                          const icon = getGuildIconURL(g, 64);
                          return `
                            <div class="guild-item" data-id="${g.id}" style="display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 8px; background: ${isSelected ? "rgba(88, 101, 242, 0.15)" : "transparent"}; border: 1px solid ${isSelected ? "rgba(88, 101, 242, 0.3)" : "rgba(255, 255, 255, 0.03)"}; cursor: pointer; transition: all 0.12s cubic-bezier(0.34, 1.56, 0.64, 1);">
                                <div style="width: 32px; height: 32px; border-radius: 8px; overflow: hidden; flex: 0 0 auto; background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.05); display: flex; align-items: center; justify-content: center;">
                                    ${icon ? `<img src="${icon}" alt="" width="32" height="32" style="width: 100%; height: 100%;">` : `<span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">${g.name.slice(0, 2).toUpperCase()}</span>`}
                                </div>
                                <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
                                    <div style="color: var(--header-primary); font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">${g.name}</div>
                                    <div style="color: var(--text-muted); font-size: 12px;">${g.id}${isOwner ? " • Owner" : ""}</div>
                                </div>
                            </div>
                        `;
                      })
                      .join("")
                : `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 14px;">No results match your search.</div>`;

            // Re-attach event listeners to new items
            guildListElement.querySelectorAll(".guild-item").forEach((item) => {
                item.addEventListener("click", () => {
                    playButtonSound();
                    const id = item.getAttribute("data-id");
                    if (id) {
                        const current =
                            menuState.activeTab === "joined"
                                ? menuState.selectedJoined
                                : menuState.selectedOwned;
                        if (current.has(id)) current.delete(id);
                        else current.add(id);
                        updateSelectionUI(container);
                    }
                });
            });
        }
    });

    guildList?.querySelectorAll(".guild-item").forEach((item) => {
        item.addEventListener("click", () => {
            playButtonSound();
            const id = item.getAttribute("data-id");
            if (id) {
                const current =
                    menuState.activeTab === "joined"
                        ? menuState.selectedJoined
                        : menuState.selectedOwned;
                if (current.has(id)) current.delete(id);
                else current.add(id);
                updateSelectionUI(container);
            }
        });
    });

    cancelBtn?.addEventListener("click", () => {
        playButtonSound();
        closeMainMenu();
    });
    actionBtn?.addEventListener("click", () => {
        playButtonSound();
        const selectedJoined = [...menuState.selectedJoined].filter((id) =>
            joinedGuilds.some((g) => g.id === id),
        );
        const selectedOwned = [...menuState.selectedOwned].filter((id) =>
            ownedGuilds.some((g) => g.id === id),
        );
        if (menuState.activeTab === "joined") massLeaveJoined(selectedJoined);
        else massDeleteOwned(selectedOwned);
    });
}

function openSelectiveLeaveMenu() {
    const container = document.createElement("div");
    container.id = "vermLib-ssl-menu-container";
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

function createNavButton(onClick: () => void) {
    const questsAnchor = document.querySelector<HTMLElement>(
        'a[href="/quest-home"]',
    );
    const questsItem = questsAnchor?.closest("li") as HTMLLIElement | null;
    const questsWrapper = questsItem?.parentElement as HTMLElement | null;
    const getClass = (selector: string) =>
        questsItem?.querySelector<HTMLElement>(selector)?.className || "";

    const wrapper = document.createElement("div");
    wrapper.id = "vermLib-selective-server-leaver-entry";
    wrapper.className = questsWrapper?.className || "wrapper_ebee1d";
    if (questsWrapper?.getAttribute("style"))
        wrapper.setAttribute("style", questsWrapper.getAttribute("style")!);

    const li = document.createElement("li");
    li.setAttribute("role", "listitem");
    li.className = questsItem?.className || "channel__972a0 container_e45859";

    const interactive = document.createElement("div");
    interactive.className =
        getClass('div[class*="interactive"]') ||
        "interactive_bf202d interactive__972a0 linkButton__972a0";
    li.appendChild(interactive);

    const linkLike = document.createElement("div");
    linkLike.className = getClass('a[class*="link_"]') || "link__972a0";
    linkLike.setAttribute("role", "button");
    linkLike.setAttribute("tabindex", "0");
    interactive.appendChild(linkLike);

    const layout = document.createElement("div");
    layout.className =
        getClass('div[class*="layout_"]') +
        " " +
        (getClass('div[class*="avatarWithText_"]') || "avatarWithText__972a0");
    linkLike.appendChild(layout);

    const avatar = document.createElement("div");
    avatar.className = getClass('div[class*="avatar_"]') || "avatar__20a53";
    layout.appendChild(avatar);

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute(
        "class",
        questsItem?.querySelector("svg")?.getAttribute("class") ||
            "linkButtonIcon__972a0",
    );
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("role", "img");
    icon.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    icon.setAttribute("width", "20");
    icon.setAttribute("height", "20");
    icon.setAttribute("fill", "none");
    icon.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute(
        "d",
        "M10 3a1 1 0 1 1 2 0v7h4l-5 5-5-5h4V3Zm9 6a1 1 0 0 1 1 1v8.5A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5V16a1 1 0 1 1 2 0v2.5c0 .276.224.5.5.5h11a.5.5 0 0 0 .5-.5V10a1 1 0 0 1 1-1Z",
    );
    icon.appendChild(path);
    avatar.appendChild(icon);

    const content = document.createElement("div");
    content.className = getClass('div[class*="content_"]') || "content__20a53";
    layout.appendChild(content);

    const nameAndDecorators = document.createElement("div");
    nameAndDecorators.className =
        getClass('div[class*="nameAndDecorators_"]') ||
        "nameAndDecorators__20a53";
    content.appendChild(nameAndDecorators);

    const name = document.createElement("div");
    name.className = getClass('div[class*="name_"]') || "name__20a53";
    name.textContent = "Leave servers";
    nameAndDecorators.appendChild(name);

    linkLike.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        playButtonSound();
        onClick();
    });
    linkLike.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            playButtonSound();
            onClick();
        }
    });

    wrapper.appendChild(li);
    return wrapper;
}

function findGuildsNavList(): HTMLElement | null {
    const list = document.querySelector<HTMLElement>(
        '[data-list-id="guildsnav"]',
    );
    if (list) return list;
    return (
        document.querySelector<HTMLElement>('nav[aria-label="Servers"]') ?? null
    );
}

let mountedNode: HTMLElement | null = null;
let mo: MutationObserver | null = null;
let hb: number | null = null;
const REINJECT_EVENTS = [
    "CHANNEL_SELECT",
    "SIDEBAR_VIEW_GUILD",
    "GUILD_CREATE",
    "GUILD_DELETE",
    "CONNECTION_OPEN",
    "WINDOW_FOCUS",
] as const;
const reinjectHandler = () => ensureInjected();

function subscribeReinjection() {
    try {
        for (const ev of REINJECT_EVENTS)
            FluxDispatcher.subscribe(ev, reinjectHandler);
    } catch {}
}

function unsubscribeReinjection() {
    try {
        for (const ev of REINJECT_EVENTS)
            FluxDispatcher.unsubscribe(ev, reinjectHandler);
    } catch {}
}

function ensureInjected() {
    const questsAnchor = document.querySelector<HTMLElement>(
        'a[href="/quest-home"]',
    );
    const questsItem = questsAnchor?.closest("li") as HTMLLIElement | null;
    const questsWrapper = questsItem?.parentElement as HTMLElement | null;
    const parent =
        (questsWrapper?.parentElement as HTMLElement | null) ??
        findGuildsNavList();
    if (!parent) return;
    document.getElementById("vermLib-selective-server-leaver-entry")?.remove();
    const node = createNavButton(() => openSelectiveLeaveMenu());
    if (questsWrapper) questsWrapper.insertAdjacentElement("afterend", node);
    else if (parent) parent.appendChild(node);
    mountedNode = node;
}

function cleanupInjected() {
    mountedNode?.remove();
    mountedNode = null;
}

function startObserve() {
    mo = new MutationObserver(() => {
        if (!document.getElementById("vermLib-selective-server-leaver-entry"))
            ensureInjected();
    });
    mo.observe(document.body, { childList: true, subtree: true });
}

function stopObserve() {
    mo?.disconnect();
    mo = null;
}

export default {
    name: "SelectiveServerLeaver",
    start() {
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
        cleanupInjected();
        currentMenuInstance?.close();
        hideDeletionProgress();
    },
} as const;
