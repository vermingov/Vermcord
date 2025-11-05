/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, Text, Tooltip } from "@webpack/common";

type StatsMessage = {
    totalClients?: number;
};

// Endpoint (fetched via IPC in main process): https://api.krno.net:8443/ws/stats

function useVermcordUserCount() {
    const [count, setCount] = React.useState<number | null>(null);
    const [status, setStatus] = React.useState<
        "idle" | "connecting" | "connected" | "error"
    >("idle");
    const [lastUpdate, setLastUpdate] = React.useState<number | null>(null);
    const wsRef = React.useRef<WebSocket | null>(null);
    const timerRef = React.useRef<number | null>(null);
    const didAskCsp = React.useRef(false);

    const cleanup = React.useCallback(() => {
        if (timerRef.current != null) {
            window.clearInterval(timerRef.current);

            timerRef.current = null;
        }
    }, []);

    const connect = React.useCallback(async () => {
        // One-shot poll using IPC to avoid CORS, then ensure interval runs every minute
        setStatus("connecting");

        try {
            const Native = (globalThis as any).VencordNative?.pluginHelpers
                ?.vermLib;
            const res = await Native?.getVermcordStats?.();
            if (res && res.ok) {
                let data: any = res.json;
                if (!data && res.text) {
                    try {
                        data = JSON.parse(res.text);
                    } catch {}
                }
                const n =
                    typeof data?.totalClients === "number"
                        ? data.totalClients
                        : null;
                if (typeof n === "number") setCount(n);
                setStatus("connected");
                setLastUpdate(Date.now());
            } else {
                setStatus("error");
            }
        } catch {
            setStatus("error");
        }

        if (timerRef.current == null) {
            timerRef.current = window.setInterval(() => {
                connect().catch(() => {});
            }, 60_000);
        }
    }, []);

    React.useEffect(() => {
        connect();
        return () => cleanup();
    }, [connect, cleanup]);

    return {
        count,
        status,
        lastUpdate,
        reconnect: connect,
    };
}

function PeopleIcon(props: { className?: string }) {
    return (
        <svg
            aria-hidden="true"
            role="img"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            className={props.className}
        >
            <path
                fill="currentColor"
                d="M16 11c1.657 0 3-1.79 3-4s-1.343-4-3-4-3 1.79-3 4 1.343 4 3 4Zm-8 0c1.657 0 3-1.79 3-4S9.657 3 8 3 5 4.79 5 7s1.343 4 3 4Zm0 2c-2.673 0-8 1.338-8 4v2h10v-2c0-.739.251-1.425.691-2.03C9.72 13.9 7.79 13 8 13Zm8 0c-.233 0-.452.014-.66.036A6.077 6.077 0 0 1 18 17v2h6v-2c0-2.662-5.327-4-8-4Z"
            />
        </svg>
    );
}

function Container({
    children,
    onClick,
}: {
    children: React.ReactNode;
    onClick?: () => void;
}) {
    // Minimal inline styles to keep footprint small and match Discord aesthetics
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onClick}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 8px",
                borderRadius: 6,
                marginLeft: 8,
                background: "var(--background-tertiary)",
                color: "var(--interactive-normal)",
                cursor: "pointer",
                userSelect: "none",
                transition: "background 150ms ease",
            }}
            onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                    "color-mix(in oklab, var(--background-tertiary) 90%, white 10%)";
            }}
            onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                    "var(--background-tertiary)";
            }}
        >
            {children}
        </div>
    );
}

function CounterPill() {
    const { count, status, lastUpdate, reconnect } = useVermcordUserCount();

    const label =
        status === "connected" && typeof count === "number"
            ? `${count.toLocaleString()} online`
            : status === "connecting"
              ? "Connecting…"
              : "Unavailable";

    const tooltip = [
        "Vermcord users online",
        typeof count === "number" ? `Count: ${count}` : undefined,
        lastUpdate
            ? `Updated: ${new Date(lastUpdate).toLocaleTimeString()}`
            : undefined,
        status !== "connected" ? "Click to retry" : undefined,
    ]
        .filter(Boolean)
        .join("\n");

    return (
        <Tooltip text={tooltip}>
            {({ onMouseEnter, onMouseLeave }) => (
                <Container
                    onClick={() => {
                        if (status !== "connected") reconnect();
                    }}
                >
                    <div
                        onMouseEnter={onMouseEnter}
                        onMouseLeave={onMouseLeave}
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                        }}
                    >
                        <PeopleIcon />
                        <Text
                            variant="text-sm/semibold"
                            color="header-primary"
                            style={{ lineHeight: 1, whiteSpace: "nowrap" }}
                        >
                            {label}
                        </Text>
                    </div>
                </Container>
            )}
        </Tooltip>
    );
}

export default {
    // Rendered by vermLib's Quick Switcher patch via $self.renderUserCounter()

    UserCounterComponent() {
        try {
            return <CounterPill />;
        } catch {
            return null;
        }
    },
};
