/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import "./styles.css";

import { useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import {
    React,
    useEffect,
    useMemo,
    useState,
    useStateFromStores,
    WindowStore,
} from "@webpack/common";

import { NotificationData } from "./Notifications";

export default ErrorBoundary.wrap(
    function NotificationComponent({
        title,
        body,
        richBody,
        color,
        icon,
        onClick,
        onClose,
        image,
        permanent,
        className,
        dismissOnClick,
    }: NotificationData & { className?: string }) {
        const { timeout, position } = useSettings([
            "notifications.timeout",
            "notifications.position",
        ]).notifications;
        const hasFocus = useStateFromStores([WindowStore], () =>
            WindowStore.isFocused(),
        );

        const [isHover, setIsHover] = useState(false);
        const [elapsed, setElapsed] = useState(0);

        const start = useMemo(() => Date.now(), [timeout, isHover, hasFocus]);

        useEffect(() => {
            if (isHover || !hasFocus || timeout === 0 || permanent)
                return void setElapsed(0);

            const intervalId = setInterval(() => {
                const elapsed = Date.now() - start;
                if (elapsed >= timeout) onClose!();
                else setElapsed(elapsed);
            }, 10);

            return () => clearInterval(intervalId);
        }, [timeout, isHover, hasFocus]);

        const timeoutProgress = elapsed / timeout;

        // Add custom styles if not already present
        useEffect(() => {
            if (!document.getElementById("vc-notification-styles")) {
                const style = document.createElement("style");
                style.id = "vc-notification-styles";
                style.textContent = `
                .vc-notification-root {
                    background: color-mix(in oklab, var(--background-secondary) 90%, black 10%) !important;
                    border: 1px solid rgba(255, 255, 255, 0.03) !important;
                    border-radius: 12px !important;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.03) !important;
                    backdrop-filter: blur(10px) !important;
                    padding: 16px !important;
                    animation: vc-notify-slide-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
                }

                .vc-notification {
                    display: flex !important;
                    gap: 12px !important;
                    align-items: flex-start !important;
                }

                .vc-notification-icon {
                    width: 32px !important;
                    height: 32px !important;
                    border-radius: 6px !important;
                    flex-shrink: 0 !important;
                }

                .vc-notification-content {
                    display: flex !important;
                    flex-direction: column !important;
                    gap: 4px !important;
                    flex: 1 !important;
                    min-width: 0 !important;
                }

                .vc-notification-header {
                    display: flex !important;
                    align-items: center !important;
                    justify-content: space-between !important;
                    gap: 12px !important;
                }

                .vc-notification-title {
                    color: var(--header-primary) !important;
                    font-size: 14px !important;
                    font-weight: 600 !important;
                    margin: 0 !important;
                }

                .vc-notification-p {
                    color: white !important;
                    font-size: 13px !important;
                    margin: 0 !important;
                    line-height: 1.4 !important;
                }

                .vc-notification-close-btn {
                    background: transparent !important;
                    border: none !important;
                    color: var(--text-muted) !important;
                    cursor: pointer !important;
                    width: 20px !important;
                    height: 20px !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    padding: 0 !important;
                    transition: all 0.2s ease !important;
                    flex-shrink: 0 !important;
                }

                .vc-notification-close-btn:hover {
                    color: var(--header-primary) !important;
                }

                .vc-notification-img {
                    width: 100% !important;
                    height: auto !important;
                    border-radius: 6px !important;
                    margin-top: 8px !important;
                }

                .vc-notification-progressbar {
                    height: 3px !important;
                    background: var(--brand-500) !important;
                    border-radius: 0 0 12px 12px !important;
                    margin: 16px -16px -16px -16px !important;
                    transition: width 0.1s linear !important;
                    box-shadow: 0 0 12px rgba(88, 101, 242, 0.6) !important;
                }

                @keyframes vc-notify-slide-in {
                    from {
                        opacity: 0;
                        transform: translateX(400px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }

                @keyframes vc-notify-slide-out {
                    from {
                        opacity: 1;
                        transform: translateX(0);
                    }
                    to {
                        opacity: 0;
                        transform: translateX(400px);
                    }
                }

                @media (hover: hover) {
                    .vc-notification-root:hover {
                        background: color-mix(in oklab, var(--background-secondary) 95%, black 5%) !important;
                        box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.05) !important;
                    }
                }
            `;
                document.head.appendChild(style);
            }
        }, []);

        return (
            <button
                className={classes("vc-notification-root", className)}
                style={
                    position === "bottom-right"
                        ? { bottom: "1rem" }
                        : { top: "3rem" }
                }
                onClick={() => {
                    onClick?.();
                    if (dismissOnClick !== false) onClose!();
                }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onClose!();
                }}
                onMouseEnter={() => setIsHover(true)}
                onMouseLeave={() => setIsHover(false)}
            >
                <div className="vc-notification">
                    {icon && (
                        <img
                            className="vc-notification-icon"
                            src={icon}
                            alt=""
                        />
                    )}
                    <div className="vc-notification-content">
                        <div className="vc-notification-header">
                            <h2 className="vc-notification-title">{title}</h2>
                            <button
                                className="vc-notification-close-btn"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onClose!();
                                }}
                            >
                                <svg
                                    width="24"
                                    height="24"
                                    viewBox="0 0 24 24"
                                    role="img"
                                    aria-labelledby="vc-notification-dismiss-title"
                                >
                                    <title id="vc-notification-dismiss-title">
                                        Dismiss Notification
                                    </title>
                                    <path
                                        fill="currentColor"
                                        d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z"
                                    />
                                </svg>
                            </button>
                        </div>
                        {richBody ?? (
                            <p className="vc-notification-p">{body}</p>
                        )}
                    </div>
                </div>
                {image && (
                    <img className="vc-notification-img" src={image} alt="" />
                )}
                {timeout !== 0 && !permanent && (
                    <div
                        className="vc-notification-progressbar"
                        style={{
                            width: `${(1 - timeoutProgress) * 100}%`,
                            backgroundColor: color || "var(--brand-500)",
                        }}
                    />
                )}
            </button>
        );
    },
    {
        onError: ({ props }) => props.onClose!(),
    },
);
