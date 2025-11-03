/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Divider } from "@components/Divider";
import {
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalRoot,
    ModalSize,
    openModal,
} from "@utils/modal";
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

function SelectiveFriendModal(props: { modalProps: any }) {
    const { onClose } = props.modalProps;
    const FIXED_MODAL_WIDTH = "min(840px, calc(100vw - 64px))";

    const allFriends = React.useMemo<FriendLite[]>(() => {
        const ids = RelationshipStore.getFriendIDs?.() ?? [];
        const list: FriendLite[] = ids
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
        return list;
    }, []);

    const [query, setQuery] = React.useState("");
    const [selected, setSelected] = React.useState<Set<string>>(new Set());
    const [working, setWorking] = React.useState(false);

    const filtered = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return allFriends;
        return allFriends.filter((u) => {
            const a = (u.globalName || "").toLowerCase();
            const b = (u.username || "").toLowerCase();
            return a.includes(q) || b.includes(q) || u.id.includes(q);
        });
    }, [allFriends, query]);

    const toggleSel = (id: string) => {
        setSelected((prev) => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
    };
    const selectAllVisible = () => {
        const s = new Set(selected);
        for (const u of filtered) s.add(u.id);
        setSelected(s);
    };
    const deselectAll = () => setSelected(new Set());

    React.useEffect(() => {
        const id = "vermLib-sfr-styles";
        if (document.getElementById(id)) return;
        const style = document.createElement("style");
        style.id = id;
        style.textContent = `
.sfr-root { animation: sfr-fade-in .25s ease-out; }
@keyframes sfr-fade-in { from { opacity: 0; transform: translateY(4px);} to { opacity: 1; transform: translateY(0);} }

/* Top toolbar spacing and interactive feedback */
.sfr-toolbar { padding: 6px 4px; }
.sfr-toolbar button { box-shadow: 0 0 0 0 rgba(88,101,242,.0); transition: box-shadow .2s ease, transform .08s ease; }
.sfr-toolbar button:hover { box-shadow: 0 0 12px rgba(88,101,242,.35); }
.sfr-toolbar button:active { transform: translateY(1px) scale(.99); }

/* Search input focus glow */
.sfr-search input { box-shadow: 0 0 0 0 rgba(0,0,0,0); transition: box-shadow .2s ease, border-color .2s ease; color: var(--header-primary); -webkit-text-fill-color: var(--header-primary); caret-color: var(--header-primary); box-sizing: border-box; max-width: 100%; }
.sfr-search input::placeholder { color: var(--text-muted); opacity: 1; }
.sfr-search input:focus { box-shadow: 0 0 0 2px var(--brand-500, #5865F2) inset; border-color: var(--brand-560, var(--brand-500)); }

/* List surface, hover animation, and hidden scrollbars */
.sfr-list {
  border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0,0,0,.25), 0 0 0 1px rgba(255,255,255,.03) inset;
  scrollbar-width: none;
}
.sfr-list::-webkit-scrollbar { display: none; }
.sfr-list label { transition: transform .12s ease, background .12s ease, box-shadow .12s ease; }
.sfr-list label:hover { transform: translateY(-1px); background: var(--background-modifier-hover); box-shadow: 0 2px 12px rgba(0,0,0,.2); }
        `;
        document.head.appendChild(style);
        return () => {
            style.remove();
        };
    }, []);

    async function massRemoveFriends() {
        const ids = [...selected].filter((id) =>
            allFriends.some((u) => u.id === id),
        );
        if (!ids.length) return;

        let confirmed = false;
        await new Promise<void>((resolve) => {
            Alerts.show({
                title: "Remove selected friends?",
                body: Parser.parse(
                    `You are about to remove ${ids.length} friend${ids.length === 1 ? "" : "s"}.`,
                ),
                confirmText: `Remove ${ids.length}`,
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
        let ok = 0;
        let fail = 0;

        for (const uid of ids) {
            try {
                await removeFriend(uid);
                ok++;
                FluxDispatcher.dispatch({
                    type: "RELATIONSHIP_REMOVE",
                    relationship: {
                        id: uid,
                        nickname: "",
                        // RelationshipTypes.FRIEND
                        type: 1,
                    },
                });
            } catch {
                try {
                    await new Promise((r) => setTimeout(r, 1000));
                    await removeFriend(uid);
                    ok++;
                    FluxDispatcher.dispatch({
                        type: "RELATIONSHIP_REMOVE",
                        relationship: {
                            id: uid,
                            nickname: "",
                            type: 1,
                        },
                    });
                } catch {
                    fail++;
                }
            }
            await new Promise((r) => setTimeout(r, 300));
        }

        setWorking(false);
        Toasts.show({
            id: Toasts.genId(),
            type: fail ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS,
            message: fail
                ? `Removed ${ok} friend${ok === 1 ? "" : "s"}. ${fail} failed.`
                : `Successfully removed ${ok} friend${ok === 1 ? "" : "s"}.`,
        });
        onClose?.();
    }

    return (
        <ModalRoot
            {...props.modalProps}
            size={ModalSize.LARGE}
            style={{ width: FIXED_MODAL_WIDTH }}
        >
            <ModalHeader>
                <Forms.FormTitle
                    tag="h2"
                    style={{ margin: 0, color: "var(--header-primary)" }}
                >
                    Selective Friend Remover
                </Forms.FormTitle>
            </ModalHeader>

            <ModalContent>
                <div
                    className="sfr-root"
                    style={{ width: "100%", maxWidth: FIXED_MODAL_WIDTH }}
                >
                    <div
                        className="sfr-toolbar"
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "initial",
                            marginBottom: 8,
                            gap: 8,
                        }}
                    >
                        <Forms.FormText
                            style={{
                                color: "var(--header-primary)",
                                margin: 0,
                            }}
                        >
                            Selected: {selected.size}
                        </Forms.FormText>
                        <div
                            style={{
                                display: "flex",
                                gap: 16,
                                marginLeft: "auto",
                            }}
                        >
                            <Button
                                size={Button.Sizes.MEDIUM}
                                onClick={selectAllVisible}
                                disabled={working || filtered.length === 0}
                            >
                                Select visible
                            </Button>
                            <Button
                                size={Button.Sizes.MEDIUM}
                                onClick={deselectAll}
                                disabled={working || selected.size === 0}
                            >
                                Clear
                            </Button>
                        </div>
                    </div>

                    <div
                        className="sfr-search"
                        style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 1,
                            background: "var(--background-secondary)",
                            paddingBottom: 8,
                        }}
                    >
                        <input
                            aria-label="Search friends"
                            placeholder="Search by name or ID..."
                            value={query}
                            onChange={(e) => setQuery(e.currentTarget.value)}
                            style={{
                                width: "100%",
                                maxWidth: "100%",
                                boxSizing: "border-box",
                                background: "var(--background-tertiary)",
                                color: "var(--header-primary)",
                                WebkitTextFillColor: "var(--header-primary)",
                                caretColor: "var(--header-primary)",
                                border: "1px solid var(--background-modifier-accent)",
                                borderRadius: 8,
                                outline: "none",
                                padding: "8px 10px",
                            }}
                        />
                    </div>

                    <div
                        role="list"
                        className="sfr-list"
                        style={{
                            marginTop: 8,
                            display: "grid",
                            gridTemplateColumns: "minmax(220px, 1fr)",
                            gap: 8,
                            height: 420,
                            overflowY: "auto",
                            overflowX: "hidden",
                            border: "1px solid var(--background-modifier-accent)",
                            borderRadius: 12,
                            padding: 8,
                            background: "var(--background-secondary)",
                        }}
                    >
                        {filtered.map((u) => {
                            const isSelected = selected.has(u.id);
                            const icon = getUserAvatarURL(u, 64);
                            const name = u.globalName || u.username || u.id;
                            const initials = (u.username || "?")
                                .slice(0, 2)
                                .toUpperCase();
                            return (
                                <label
                                    key={u.id}
                                    role="listitem"
                                    tabIndex={0}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        padding: 8,
                                        borderRadius: 8,
                                        width: "100%",
                                        background: isSelected
                                            ? "var(--background-modifier-selected)"
                                            : "transparent",
                                        cursor: "pointer",
                                        border: "1px solid var(--background-modifier-accent)",
                                    }}
                                    onClick={(e) => {
                                        if (
                                            (e.target as HTMLElement).closest(
                                                "a",
                                            )
                                        )
                                            return;
                                        toggleSel(u.id);
                                    }}
                                    onKeyDown={(e) => {
                                        if (
                                            e.key === " " ||
                                            e.key === "Enter"
                                        ) {
                                            e.preventDefault();
                                            toggleSel(u.id);
                                        }
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 32,
                                            height: 32,
                                            borderRadius: 16,
                                            overflow: "hidden",
                                            flex: "0 0 auto",
                                            background:
                                                "var(--background-tertiary)",
                                        }}
                                    >
                                        {icon ? (
                                            <img
                                                src={icon}
                                                alt=""
                                                width={32}
                                                height={32}
                                            />
                                        ) : (
                                            <div
                                                style={{
                                                    width: "100%",
                                                    height: "100%",
                                                    display: "grid",
                                                    placeItems: "center",
                                                    fontSize: 12,
                                                    color: "var(--text-muted)",
                                                }}
                                            >
                                                {initials}
                                            </div>
                                        )}
                                    </div>
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            minWidth: 0,
                                        }}
                                    >
                                        <div
                                            style={{
                                                color: "var(--header-primary)",
                                                textOverflow: "ellipsis",
                                                overflow: "hidden",
                                                whiteSpace: "nowrap",
                                                maxWidth: "100%",
                                            }}
                                        >
                                            {name}
                                        </div>
                                        <Forms.FormText
                                            style={{
                                                fontSize: 12,
                                                color: "var(--text-muted)",
                                            }}
                                        >
                                            {u.username}
                                            {u.discriminator
                                                ? `#${u.discriminator}`
                                                : ""}
                                            {" • "}
                                            {u.id}
                                        </Forms.FormText>
                                    </div>
                                </label>
                            );
                        })}
                        {!filtered.length && (
                            <div
                                style={{
                                    padding: 12,
                                    textAlign: "center",
                                    color: "var(--text-muted)",
                                }}
                            >
                                No friends match your search.
                            </div>
                        )}
                    </div>

                    <Divider className="marginTop8 marginBottom8" />
                    <Forms.FormText style={{ color: "var(--text-danger)" }}>
                        Warning: Removing friends is permanent. You will have to
                        send a new friend request to add them again.
                    </Forms.FormText>
                </div>
            </ModalContent>

            <ModalFooter>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        width: "100%",
                        maxWidth: FIXED_MODAL_WIDTH,
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
                        disabled={!selected.size || working}
                        onClick={massRemoveFriends}
                    >
                        {working
                            ? "Removing..."
                            : `Remove selected (${selected.size})`}
                    </Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function createFriendsActionButton(onClick: () => void) {
    const addFriend =
        document.querySelector<HTMLElement>(
            '[role="tab"][aria-label="Add Friend"]',
        ) ||
        document.querySelector<HTMLElement>(
            '[aria-label="Add Friend"][role="tab"]',
        );
    if (!addFriend) return null;

    const node = addFriend.cloneNode(true) as HTMLElement;
    node.id = "vermLib-selective-friend-remover-button";
    node.setAttribute("aria-label", "Remove Friends");
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "tab");

    const labelSpan =
        node.querySelector("span") || node.querySelector("[class*='label']");
    if (labelSpan) {
        labelSpan.textContent = "Remove Friends";
    } else {
        node.textContent = "Remove Friends";
    }

    const activate = () => onClick();
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

    const addFriend =
        document.querySelector<HTMLElement>(
            '[role="tab"][aria-label="Add Friend"]',
        ) ||
        document.querySelector<HTMLElement>(
            '[aria-label="Add Friend"][role="tab"]',
        );

    if (!addFriend) return;

    existing?.remove();

    const node = createFriendsActionButton(() => {
        openModal((mProps) => <SelectiveFriendModal modalProps={mProps} />);
    });
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
    },
} as const;
