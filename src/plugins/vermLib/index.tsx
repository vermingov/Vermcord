/**
 * Vencord, a Discord client mod
 * vermLib: Plugin hub to manage multiple small utilities as sub-plugins.
 * Revamped: Modern dashboard settings with sections, animations, and a single dashboard component.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { React } from "@webpack/common";

// Audio URLs
const AUDIO_URLS = {
    on: "https://cdn.discordapp.com/attachments/1287309916909867070/1435816283319828510/toggleon.mp3?ex=690d579e&is=690c061e&hm=9cfc4657bb83919b8f63b0cbb6624cf6ef2f25523df496f9f723fc8709f5c426",
    off: "https://cdn.discordapp.com/attachments/1287309916909867070/1435816283030425631/toggleoff.mp3?ex=690d579e&is=690c061e&hm=ffc78525956915420a52c12ab192e66b56ef59b1cbe49a8f82f855cfcc26649b",
};

// Sub-plugins
import FakeDeafen from "./plugins/fakeDeafen";
import FollowUser from "./plugins/followUser";
import GoXLRCensorIndicator from "./plugins/goxlrCensorIndicator";
import HideMicErrorNotice from "./plugins/hideMicErrorNotice";
import RawMic from "./plugins/rawMic";
import VCReturn from "./plugins/vcReturn";
import CloneServerProfile from "./plugins/cloneServerProfile";
import RandomVCJoiner from "./plugins/randomVCJoiner";
import RobloxLookup from "./plugins/robloxLookup";
import VermcordUserCounter from "./plugins/vermcordUserCounter";
import MessageDeleter from "./plugins/messageDeleter";

// Credits
import { Devs } from "../../utils/constants";

type SubPlugin = {
    name?: string;
    start?: () => void | Promise<void>;
    stop?: () => void | Promise<void>;
    updateSettings?: (settings: any) => void;
    settings?: any;
    flux?: Record<string, (payload: any) => void>;
    contextMenus?: Record<string, (...args: any[]) => any>;
    FakeDeafenToggleButton?: (props?: any) => React.ReactElement | null;
    UserCounterComponent?: (props?: any) => React.ReactElement | null;
};

interface PluginConfig {
    key: string;
    name: string;
    module: SubPlugin;
    description?: string;
    tag?: string;
    section: "voice" | "qol" | "social";
    settings?: Record<string, any>;
    required?: boolean;
}

// Define all plugins in one place - just add new entries here!
const PLUGINS: PluginConfig[] = [
    {
        key: "fakeDeafen",
        name: "Fake Deafen",
        module: FakeDeafen as unknown as SubPlugin,
        description:
            "Allows you to appear deafened to others, while still being able to hear and talk.",
        tag: "Voice",
        section: "voice",
    },
    {
        key: "rawMic",
        name: "Raw Mic",
        module: RawMic as unknown as SubPlugin,
        description: "Completely disables all microphone post-processing.",
        tag: "Voice",
        section: "voice",
    },
    {
        key: "goxlr",
        name: "GoXLR Mic Color",
        module: GoXLRCensorIndicator as unknown as SubPlugin,
        description: "GoXLR Indicators [LINUX ONLY]",
        tag: "Voice",
        section: "voice",
    },
    {
        key: "hideMicErrorNotice",
        name: "Hide Mic Error Notice",
        module: HideMicErrorNotice as unknown as SubPlugin,
        description:
            "Hides Discord's mic input warning banner (Error 3002) automatically.",
        tag: "QoL",
        section: "qol",
    },
    {
        key: "vcReturn",
        name: "VC Return",
        module: VCReturn as unknown as SubPlugin,
        description:
            "Auto-clicks Discord's Reconnect button on startup to rejoin the last voice channel.",
        tag: "QoL",
        section: "qol",
    },
    {
        key: "randomVCJoiner",
        name: "Random VC Joiner",
        module: RandomVCJoiner as unknown as SubPlugin,
        description:
            "Adds a toolbar button next to Inbox to join a random accessible voice channel across your servers.",
        tag: "QoL",
        section: "qol",
    },
    {
        key: "selectiveServerLeaver",
        name: "Selective Server Leaver",
        module: (require("./plugins/selectiveServerLeaver") as any)
            .default as SubPlugin,
        description: "Allows you to leave multiple servers at once.",
        tag: "QoL",
        section: "qol",
    },
    {
        key: "selectiveFriendRemover",
        name: "Selective Friend Remover",
        module: (require("./plugins/selectiveFriendRemover") as any)
            .default as SubPlugin,
        description: "Remove multiple friends at once.",
        tag: "QoL",
        section: "qol",
    },
    {
        key: "cloneServerProfile",
        name: "Clone Server Profile",
        module: CloneServerProfile as unknown as SubPlugin,
        description:
            "Right-click a member to clone their server profile (nickname, server avatar, server banner) into yours in this server.",
        tag: "Social",
        section: "social",
    },
    {
        key: "followUser",
        name: "Follow User",
        module: FollowUser as unknown as SubPlugin,
        description:
            "Right-click a user to follow their voice channel; optionally disconnect when they leave.",
        tag: "Social",
        section: "social",
        settings: {
            disconnectFollow: false,
            enableDebugLogs: false,
        },
    },
    {
        key: "robloxLookup",
        name: "Roblox Lookup",
        module: RobloxLookup as unknown as SubPlugin,
        description:
            "Shows RAP, value, and more from Rolimons when a Roblox account is connected to this profile.",
        tag: "Social",
        section: "social",
    },
    {
        key: "vermcordUserCounter",
        name: "Vermcord User Counter",
        module: VermcordUserCounter as unknown as SubPlugin,
        description: "Shows the number of online Vermcord users.",
        tag: "QoL",
        section: "qol",
        required: true,
    },
    {
        key: "messageDeleter",
        name: "Message Deleter",
        module: MessageDeleter as unknown as SubPlugin,
        description:
            "Adds a button to quickly delete your messages in the current channel with random delays.",
        tag: "QoL",
        section: "qol",
    },
];

type SubKey = (typeof PLUGINS)[number]["key"];
type PrivateState = Record<`enable${string}`, boolean> & Record<string, any>;

const DEFAULTS: PrivateState = PLUGINS.reduce((acc, p) => {
    acc[`enable${p.key}`] = p.required ?? false;
    if (p.settings) {
        Object.assign(acc, p.settings);
    }
    return acc;
}, {} as PrivateState);

// Add audio settings to defaults
DEFAULTS.enableToggleSounds = true;
DEFAULTS.toggleSoundVolume = 0.5;

const subs: Record<string, SubPlugin> = PLUGINS.reduce(
    (acc, p) => {
        acc[p.key] = p.module;
        return acc;
    },
    {} as Record<string, SubPlugin>,
);

const started: Record<string, boolean> = PLUGINS.reduce(
    (acc, p) => {
        acc[p.key] = false;
        return acc;
    },
    {} as Record<string, boolean>,
);

// Audio cache and playback functions
const audioCache: Record<string, HTMLAudioElement> = {};

function getAudioElement(type: "on" | "off"): HTMLAudioElement | null {
    try {
        if (!audioCache[type]) {
            const audio = new Audio(AUDIO_URLS[type]);
            audio.preload = "auto";
            audioCache[type] = audio;
        }
        return audioCache[type];
    } catch (err) {
        console.error(`[vermLib] Failed to load audio for type: ${type}`, err);
        return null;
    }
}

function playToggleSound(type: "on" | "off", volume: number = 1) {
    try {
        const audio = getAudioElement(type);
        if (audio) {
            audio.volume = Math.max(0, Math.min(1, volume));
            audio.currentTime = 0;
            audio.play().catch((err) => {
                console.warn("[vermLib] Failed to play toggle sound:", err);
            });
        }
    } catch (err) {
        console.warn("[vermLib] Error playing toggle sound:", err);
    }
}

function safeStart(key: string) {
    if (started[key]) return;
    try {
        subs[key]?.start?.();
        started[key] = true;
    } catch {
        // swallow to avoid crashing hub
    }
}

function safeStop(key: string) {
    if (!started[key]) return;
    try {
        subs[key]?.stop?.();
    } catch {
        // swallow to avoid crashing hub
    } finally {
        started[key] = false;
    }
}

// Dashboard component
function Dashboard() {
    React.useEffect(() => {
        const id = "vermLib-dashboard-styles";
        if (document.getElementById(id)) return;
        const style = document.createElement("style");
        style.id = id;
        style.textContent = `
#vermLibDashboard {
    --vl-bg: color-mix(in oklab, var(--background-tertiary) 100%, black 0%);
    --vl-card: color-mix(in oklab, var(--background-secondary) 90%, black 10%);
    --vl-accent: var(--brand-experiment);
    --vl-ok: #57F287;
    --vl-warn: #FEE75C;
    --vl-bad: #ED4245;
    --vl-fg: var(--header-primary);
    --vl-fg-dim: var(--text-muted);
    display: flex;
    flex-direction: column;
    gap: 16px;
    animation: vl-fade-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes vl-fade-in {
    from {
        opacity: 0;
        transform: translateY(8px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

#vermLibDashboard .vl-hero {
    position: relative;
    padding: 24px;
    border-radius: 12px;
    overflow: hidden;
    background: var(--vl-card);
    border: 1px solid rgba(255, 255, 255, 0.04);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(88, 101, 242, 0.2);
    backdrop-filter: blur(10px);
}

#vermLibDashboard .vl-hero::before {
    content: "";
    position: absolute;
    inset: -40% -10% auto auto;
    width: 65%;
    height: 220%;
    background: radial-gradient(ellipse at center, color-mix(in oklab, var(--brand-500) 40%, transparent 60%) 0%, transparent 60%);
    filter: blur(28px);
    transform: rotate(8deg);
    animation: vl-aurora 9s ease-in-out infinite alternate;
    pointer-events: none;
}

@keyframes vl-aurora {
    0% {
        transform: rotate(8deg) translateX(0);
        opacity: 0.65;
    }
    100% {
        transform: rotate(2deg) translateX(-6%);
        opacity: 0.9;
    }
}

#vermLibDashboard .vl-hero h2 {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
    font-size: 18px;
    color: var(--vl-fg);
    margin: 0 0 8px 0;
}

#vermLibDashboard .vl-hero p {
    position: relative;
    z-index: 1;
    margin: 0;
    color: var(--vl-fg-dim);
    font-size: 13px;
}

#vermLibDashboard .vl-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
}

#vermLibDashboard .vl-card {
    background: var(--vl-card);
    border: 1px solid rgba(255, 255, 255, 0.03);
    border-radius: 12px;
    padding: 16px;
    position: relative;
    overflow: hidden;
    transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.03);
    backdrop-filter: blur(10px);
}

#vermLibDashboard .vl-card::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(88, 101, 242, 0.3), transparent);
    opacity: 0;
    transition: opacity 0.25s ease;
}

#vermLibDashboard .vl-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), inset 0 0 0 1px rgba(88, 101, 242, 0.15);
    border-color: rgba(88, 101, 242, 0.2);
}

#vermLibDashboard .vl-card:hover::before {
    opacity: 1;
}

#vermLibDashboard .vl-card h3 {
    margin: 0 0 6px 0;
    font-weight: 600;
    font-size: 14px;
    color: var(--vl-fg);
}

#vermLibDashboard .vl-desc {
    font-size: 12.75px;
    color: var(--vl-fg-dim);
    line-height: 1.4;
    margin-bottom: 12px;
}

#vermLibDashboard .vl-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

#vermLibDashboard .vl-left {
    display: flex;
    align-items: center;
    gap: 8px;
}

#vermLibDashboard .vl-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vl-bad);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45) inset, 0 0 8px rgba(237, 66, 69, 0.3);
    transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    flex-shrink: 0;
}

#vermLibDashboard .vl-dot.on {
    background: var(--vl-ok);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45) inset, 0 0 12px rgba(87, 242, 135, 0.5);
    transform: scale(1.1);
}

#vermLibDashboard .vl-tag {
    font-size: 11.5px;
    padding: 3px 8px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--brand-500) 15%, transparent 85%);
    color: var(--vl-fg);
    border: 1px solid rgba(88, 101, 242, 0.3);
    font-weight: 500;
}

#vermLibDashboard .vl-switch {
    --w: 48px;
    --h: 24px;
    width: var(--w);
    height: var(--h);
    background: var(--background-modifier-accent);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    position: relative;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    flex-shrink: 0;
}

#vermLibDashboard .vl-switch:hover {
    border-color: rgba(255, 255, 255, 0.12);
}

#vermLibDashboard .vl-switch.on {
    background: var(--brand-500);
    border-color: var(--brand-560, var(--brand-500));
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.06) inset, 0 0 12px rgba(88, 101, 242, 0.6);
}

#vermLibDashboard .vl-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: calc(var(--h) - 4px);
    height: calc(var(--h) - 4px);
    background: #ffffff;
    border-radius: 50%;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 0, 0, 0.35) inset;
    transform: translateX(0);
    transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    z-index: 1;
    will-change: transform;
}

#vermLibDashboard .vl-switch.on .vl-knob {
    transform: translateX(calc(var(--w) - var(--h)));
    background: #ffffff;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--brand-600, #4752C4) inset, 0 0 8px var(--brand-500, #5865F2);
}

#vermLibDashboard .vl-section-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--header-primary);
    letter-spacing: 0.5px;
    margin: 8px 2px 8px 2px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    text-transform: uppercase;
}

#vermLibDashboard .vl-section-title::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--brand-500);
    box-shadow: 0 0 12px var(--brand-500);
    animation: vl-pulse 2s ease-in-out infinite;
}

@keyframes vl-pulse {
    0%, 100% {
        box-shadow: 0 0 12px var(--brand-500);
    }
    50% {
        box-shadow: 0 0 20px var(--brand-500);
    }
}

#vermLibDashboard .vl-divider {
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
    border-radius: 999px;
    margin: 8px 0 12px 0;
}

#vermLibDashboard .vl-note {
    font-size: 12px;
    color: var(--vl-fg-dim);
    margin-top: 8px;
}
`;
        document.head.appendChild(style);
        return () => style.remove();
    }, []);

    const sInit = (settings.store as any) ?? {};
    const [state, setState] = React.useState<PrivateState>({
        ...DEFAULTS,
        ...Object.keys(DEFAULTS).reduce((acc, k) => {
            acc[k] = sInit[k] ?? DEFAULTS[k];
            return acc;
        }, {} as PrivateState),
    });

    const update = <K extends keyof PrivateState>(
        key: K,
        value: PrivateState[K],
    ) => {
        setState((s) => ({ ...s, [key]: value }));
        (settings.store as any)[key] = value;

        // Auto start/stop based on enable flag
        const plugin = PLUGINS.find((p) => `enable${p.key}` === key);
        if (plugin) {
            const enabled = value as boolean;
            // Always play sound (no toggle check)
            playToggleSound(enabled ? "on" : "off", 0.5);
            enabled ? safeStart(plugin.key) : safeStop(plugin.key);
        }

        // Handle special settings
        if (
            key === "followUser_disconnectFollow" ||
            key === "followUser_enableDebugLogs"
        ) {
            try {
                if (subs.followUser?.updateSettings) {
                    subs.followUser.updateSettings({
                        disconnectFollow: state.followUser_disconnectFollow,
                        enableDebugLogs: state.followUser_enableDebugLogs,
                    });
                }
            } catch {}
        }
    };

    React.useEffect(() => {
        const s = (settings.store as any) || {};
        setState((prev) =>
            Object.keys(DEFAULTS).reduce((acc, k) => {
                acc[k] = s[k] ?? prev[k];
                return acc;
            }, {} as PrivateState),
        );
    }, []);

    React.useEffect(() => {
        const s = settings.store as any;
        if (!s) return;
        Object.assign(s, state);
    }, [state]);

    const Card = (props: {
        title: string;
        description?: string;
        enabled?: boolean;
        right?: React.ReactNode;
        tag?: string;
        children?: React.ReactNode;
    }) => (
        <div className="vl-card">
            <div className="vl-row" style={{ marginBottom: 8 }}>
                <div className="vl-left">
                    <div className={`vl-dot ${props.enabled ? "on" : ""}`} />
                    <h3>{props.title}</h3>
                    {props.tag ? (
                        <span className="vl-tag">{props.tag}</span>
                    ) : null}
                </div>
                {props.right}
            </div>
            {props.description ? (
                <div className="vl-desc">{props.description}</div>
            ) : null}
            {props.children}
        </div>
    );

    const Switch = (props: {
        checked: boolean;
        onChange: (v: boolean) => void;
        ariaLabel?: string;
    }) => (
        <div
            role="switch"
            aria-checked={props.checked}
            aria-label={props.ariaLabel}
            className={`vl-switch ${props.checked ? "on" : ""}`}
            onClick={() => props.onChange(!props.checked)}
        >
            <div className="vl-knob" />
        </div>
    );

    const renderSection = (section: "voice" | "qol" | "social") => {
        const plugins = PLUGINS.filter(
            (p) => p.section === section && !p.required,
        );
        const sectionNames = {
            voice: "Voice",
            qol: "Quality of Life",
            social: "Social & Identity",
        };

        if (plugins.length === 0) return null;

        return (
            <>
                <div className="vl-section-title">{sectionNames[section]}</div>
                <div className="vl-divider" role="separator" />
                <div className="vl-grid" aria-label={sectionNames[section]}>
                    {plugins.map((plugin) => (
                        <Card
                            key={plugin.key}
                            title={plugin.name}
                            description={plugin.description}
                            enabled={state[`enable${plugin.key}`]}
                            right={
                                <Switch
                                    checked={state[`enable${plugin.key}`]}
                                    onChange={(v) =>
                                        update(
                                            `enable${plugin.key}` as keyof PrivateState,
                                            v,
                                        )
                                    }
                                    ariaLabel={`Enable ${plugin.name}`}
                                />
                            }
                            tag={plugin.tag}
                        >
                            {plugin.key === "followUser" && (
                                <>
                                    <div
                                        className="vl-row"
                                        style={{ marginTop: 8 }}
                                    >
                                        <div
                                            style={{
                                                fontSize: 12.75,
                                                color: "var(--vl-fg)",
                                            }}
                                        >
                                            Disconnect when target leaves
                                        </div>
                                        <Switch
                                            checked={
                                                state.followUser_disconnectFollow
                                            }
                                            onChange={(v) =>
                                                update(
                                                    "followUser_disconnectFollow",
                                                    v,
                                                )
                                            }
                                            ariaLabel="Follow User: Disconnect When Target Leaves"
                                        />
                                    </div>
                                    <div
                                        className="vl-row"
                                        style={{ marginTop: 8 }}
                                    >
                                        <div
                                            style={{
                                                fontSize: 12.75,
                                                color: "var(--vl-fg)",
                                            }}
                                        >
                                            Enable debug logs
                                        </div>
                                        <Switch
                                            checked={
                                                state.followUser_enableDebugLogs
                                            }
                                            onChange={(v) =>
                                                update(
                                                    "followUser_enableDebugLogs",
                                                    v,
                                                )
                                            }
                                            ariaLabel="Follow User: Enable Debug Logs"
                                        />
                                    </div>
                                </>
                            )}
                        </Card>
                    ))}
                </div>
            </>
        );
    };

    return (
        <div id="vermLibDashboard">
            <div className="vl-hero">
                <h2>
                    <span
                        style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: "var(--vl-accent)",
                            display: "inline-block",
                            boxShadow: "0 0 18px var(--vl-accent)",
                        }}
                    />
                    vermLib Dashboard
                </h2>
                <p>Manage all Verm's plugins in one place.</p>
            </div>

            {renderSection("voice")}
            {renderSection("qol")}
            {renderSection("social")}
        </div>
    );
}

const settings = definePluginSettings({
    dashboard: {
        type: OptionType.COMPONENT,
        component: ErrorBoundary.wrap(Dashboard, { noop: true }),
    },
});

function FDButton(props: any) {
    const s = (settings.store as any) ?? {};
    if (!s.enablefakeDeafen) return null;
    const Comp = subs.fakeDeafen?.FakeDeafenToggleButton;
    if (typeof Comp === "function") {
        return Comp(props);
    }
    return null;
}

export default definePlugin({
    name: "vermLib",
    description: "The brain, heart, and soul of Vermcord.",
    required: true,
    authors: [Devs.Vermin, Devs.Kravle, Devs.Blacksmith],

    settings,

    patches: [
        {
            find: "#{intl::ACCOUNT_SPEAKING_WHILE_MUTED}",
            replacement: {
                match: /className:\i\.buttons,.{0,50}children:\[/,
                replace: "$&$self.FDButton(arguments[0]),",
            },
        },
        {
            find: "Quick Switcher",
            replacement: {
                match: /(<div[^>]*className=\{[^}]*title[^}]*\}[^<]*<[^>]*role="button"[^>]*>.*?<\/div>)/,
                replace: "$1$self.renderUserCounter()",
            },
        },
        {
            find: "streamerPaused()",
            predicate: () => settings.store.enableNeverPausePreviews,
            replacement: {
                match: /streamerPaused\(\)\{/,
                replace: "$&return false;",
            },
        },
        {
            find: "StreamTile",
            predicate: () => settings.store.enableNeverPausePreviews,
            replacement: {
                match: /\i\.\i\.isFocused\(\)/,
                replace: "true",
            },
        },
    ],

    FDButton: ErrorBoundary.wrap(FDButton, { noop: true }),

    renderUserCounter() {
        const { UserCounterComponent } = subs.vermcordUserCounter || {};
        if (typeof UserCounterComponent === "function") {
            return UserCounterComponent();
        }
        return null;
    },

    contextMenus: {
        "user-context"(children: any[], args: any) {
            const s = (settings.store as any) ?? {};
            if (s.enablefollowUser) {
                try {
                    subs.followUser?.contextMenus?.["user-context"]?.(
                        children,
                        args,
                    );
                } catch {
                    // ignore
                }
            }
            if (s.enablecloneServerProfile) {
                try {
                    subs.cloneServerProfile?.contextMenus?.["user-context"]?.(
                        children,
                        args,
                    );
                } catch {
                    // ignore
                }
            }
        },
    },

    flux: {
        VOICE_STATE_UPDATES(payload: any) {
            const s = (settings.store as any) ?? {};
            try {
                if (s.enablefollowUser) {
                    subs.followUser?.flux?.VOICE_STATE_UPDATES?.call(
                        subs.followUser,
                        payload,
                    );
                }
            } catch {}
            try {
                if (s.enablevcReturn) {
                    subs.vcReturn?.flux?.VOICE_STATE_UPDATES?.call(
                        subs.vcReturn,
                        payload,
                    );
                }
            } catch {}
        },
    },

    start() {
        const s = (settings.store as any) ?? {};
        for (const [k, v] of Object.entries(DEFAULTS)) {
            if (!(k in s)) (s as any)[k] = v;
        }
        const S: PrivateState = s as PrivateState;

        try {
            if (subs.followUser?.updateSettings) {
                subs.followUser.updateSettings({
                    disconnectFollow: S.followUser_disconnectFollow,
                    enableDebugLogs: S.followUser_enableDebugLogs,
                    preloadDelay: 300,
                });
            }
        } catch {}

        PLUGINS.forEach((p) => {
            if (S[`enable${p.key}`]) safeStart(p.key);
        });

        // ===== NEW: Export plugin data to window for Performance Monitor =====
        (window as any).__VERMLIB_DATA__ = {
            PLUGINS,
            subs,
            started,
            safeStart,
            safeStop,
        };

        console.log("[vermLib] Exported plugin data for Performance Monitor");
        // =====================================================================
    },

    stop() {
        PLUGINS.forEach((p) => {
            if (started[p.key]) safeStop(p.key);
        });

        try {
            clearInterval((window as any).__vermLibUpdateTimer);
        } catch {}

        // Clean up exported data
        delete (window as any).__VERMLIB_DATA__;
    },
});
