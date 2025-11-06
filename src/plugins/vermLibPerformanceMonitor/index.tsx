/**
 * Vencord Plugin: VermLib Performance Monitor
 * Real-time performance profiling with accurate memory, CPU, and optimization analysis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { React } from "@webpack/common";

interface PluginMetrics {
    key: string;
    name: string;
    executionTimes: number[];
    totalExecutions: number;
    totalTime: number;
    lastExecuted: number;
    avgExecutionTime: number;
    maxExecutionTime: number;
    memoryAllocated: number;
    memoryFreed: number;
    avgMemoryPerCall: number;
    peakMemoryPerCall: number;
    fluxEventCount: number;
}

interface PerformanceStore {
    metrics: Record<string, PluginMetrics>;
    startTime: number;
    isMonitoring: boolean;
    systemMemory: {
        jsHeapSize: number;
        jsHeapSizeLimit: number;
        externalMemoryUsage: number;
    };
}

const performanceStore: PerformanceStore = {
    metrics: {},
    startTime: Date.now(),
    isMonitoring: false,
    systemMemory: {
        jsHeapSize: 0,
        jsHeapSizeLimit: 0,
        externalMemoryUsage: 0,
    },
};

const MAX_HISTORY = 100;
const originalFunctions: Record<string, any> = {};
let updateListeners: Set<() => void> = new Set();

// Get memory info safely
function getMemoryInfo() {
    if ((performance as any).memory) {
        return {
            jsHeapSize: (performance as any).memory.usedJSHeapSize,
            jsHeapSizeLimit: (performance as any).memory.jsHeapSizeLimit,
            externalMemoryUsage: (performance as any).memory
                .externalMemoryUsage,
        };
    }
    return null;
}

// Update system memory info for display
function updateSystemMemory() {
    const mem = getMemoryInfo();
    if (mem) {
        performanceStore.systemMemory = mem;
    }
}

function notifyUpdates() {
    updateListeners.forEach((fn) => fn());
}

function getMetrics(key: string, name: string): PluginMetrics {
    if (!performanceStore.metrics[key]) {
        performanceStore.metrics[key] = {
            key,
            name,
            executionTimes: [],
            totalExecutions: 0,
            totalTime: 0,
            lastExecuted: 0,
            avgExecutionTime: 0,
            maxExecutionTime: 0,
            memoryAllocated: 0,
            memoryFreed: 0,
            avgMemoryPerCall: 0,
            peakMemoryPerCall: 0,
            fluxEventCount: 0,
        };
    }
    return performanceStore.metrics[key];
}

function recordExecution(
    key: string,
    name: string,
    duration: number,
    memoryBefore: number,
    memoryAfter: number,
) {
    const metrics = getMetrics(key, name);
    metrics.executionTimes.push(duration);
    metrics.totalExecutions++;
    metrics.totalTime += duration;
    metrics.lastExecuted = Date.now();
    metrics.fluxEventCount++;

    // Calculate memory delta
    const memoryDelta = memoryAfter - memoryBefore;

    if (memoryDelta > 0) {
        metrics.memoryAllocated += memoryDelta;
    } else {
        metrics.memoryFreed += Math.abs(memoryDelta);
    }

    metrics.peakMemoryPerCall = Math.max(
        metrics.peakMemoryPerCall,
        Math.abs(memoryDelta),
    );
    metrics.avgMemoryPerCall =
        (metrics.memoryAllocated - metrics.memoryFreed) /
        metrics.totalExecutions;

    if (metrics.executionTimes.length > MAX_HISTORY) {
        metrics.executionTimes.shift();
    }

    metrics.avgExecutionTime =
        metrics.executionTimes.reduce((a, b) => a + b, 0) /
        metrics.executionTimes.length;
    metrics.maxExecutionTime = Math.max(...metrics.executionTimes);

    updateSystemMemory();
    notifyUpdates();
}

function wrapFunction(key: string, name: string, fn: any): any {
    if (!fn || typeof fn !== "function") return fn;

    return function (...args: any[]) {
        if (!performanceStore.isMonitoring) return fn.apply(this, args);

        const start = performance.now();
        const memBefore = getMemoryInfo()?.jsHeapSize || 0;

        try {
            const result = fn.apply(this, args);

            if (result instanceof Promise) {
                return result
                    .then((res) => {
                        const duration = performance.now() - start;
                        const memAfter = getMemoryInfo()?.jsHeapSize || 0;
                        recordExecution(
                            key,
                            name,
                            duration,
                            memBefore,
                            memAfter,
                        );
                        return res;
                    })
                    .catch((err) => {
                        const duration = performance.now() - start;
                        const memAfter = getMemoryInfo()?.jsHeapSize || 0;
                        recordExecution(
                            key,
                            name,
                            duration,
                            memBefore,
                            memAfter,
                        );
                        throw err;
                    });
            }

            const duration = performance.now() - start;
            const memAfter = getMemoryInfo()?.jsHeapSize || 0;
            recordExecution(key, name, duration, memBefore, memAfter);
            return result;
        } catch (e) {
            const duration = performance.now() - start;
            const memAfter = getMemoryInfo()?.jsHeapSize || 0;
            recordExecution(key, name, duration, memBefore, memAfter);
            throw e;
        }
    };
}

// Real-time Performance Metrics Component
function PerformanceMetricsSettings() {
    const [metrics, setMetrics] = React.useState(performanceStore.metrics);
    const [sortBy, setSortBy] = React.useState<
        "exec" | "memory" | "freq" | "name"
    >("exec");
    const [forceUpdate, setForceUpdate] = React.useState(0);
    const [systemMem, setSystemMem] = React.useState(
        performanceStore.systemMemory,
    );

    React.useEffect(() => {
        const style = document.createElement("style");
        style.id = "vl-perf-monitor-styles";
        style.textContent = `
#vlPerfSettings {
    --pm-ok: #57F287;
    --pm-warn: #FEE75C;
    --pm-bad: #ED4245;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
#vlPerfSettings .pm-header {
    margin-bottom: 16px;
    padding: 14px;
    background: linear-gradient(135deg, rgba(88, 101, 242, 0.2), rgba(88, 101, 242, 0.05));
    border-radius: 8px;
    border: 1px solid rgba(88, 101, 242, 0.3);
}
#vlPerfSettings .pm-header h3 {
    margin: 0 0 6px 0;
    font-size: 16px;
    font-weight: 700;
    color: #ffffff;
}
#vlPerfSettings .pm-header p {
    margin: 0;
    font-size: 12px;
    color: #b5bac1;
}
#vlPerfSettings .pm-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(87, 242, 135, 0.1);
    border: 1px solid rgba(87, 242, 135, 0.3);
    border-radius: 6px;
    color: #57F287;
    font-size: 11px;
    font-weight: 600;
    margin-top: 8px;
}
#vlPerfSettings .pm-status.inactive {
    background: rgba(237, 66, 69, 0.1);
    border-color: rgba(237, 66, 69, 0.3);
    color: #ED4245;
}
#vlPerfSettings .pm-status.warning {
    background: rgba(254, 231, 92, 0.1);
    border-color: rgba(254, 231, 92, 0.3);
    color: #FEE75C;
}
#vlPerfSettings .pm-controls {
    display: flex;
    gap: 6px;
    margin: 12px 0;
    flex-wrap: wrap;
}
#vlPerfSettings .pm-control-btn {
    padding: 8px 12px;
    background: rgba(88, 101, 242, 0.1);
    border: 2px solid rgba(88, 101, 242, 0.3);
    border-radius: 6px;
    color: #ffffff;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all .2s ease;
}
#vlPerfSettings .pm-control-btn:hover {
    background: rgba(88, 101, 242, 0.25);
    border-color: #5865F2;
}
#vlPerfSettings .pm-control-btn.active {
    background: #5865F2;
    border-color: #5865F2;
    box-shadow: 0 0 12px rgba(88, 101, 242, 0.6);
}
#vlPerfSettings .pm-metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
}
#vlPerfSettings .pm-stat-card {
    background: rgba(88, 101, 242, 0.08);
    padding: 12px;
    border-radius: 8px;
    border: 1px solid rgba(88, 101, 242, 0.2);
}
#vlPerfSettings .pm-stat-label {
    font-size: 10px;
    color: #949ba4;
    text-transform: uppercase;
    letter-spacing: .6px;
    margin-bottom: 6px;
    font-weight: 600;
}
#vlPerfSettings .pm-stat-value {
    font-size: 20px;
    font-weight: 700;
    color: #ffffff;
    font-variant-numeric: tabular-nums;
}
#vlPerfSettings .pm-stat-subtext {
    font-size: 10px;
    color: #949ba4;
    margin-top: 4px;
}
#vlPerfSettings .pm-table-container {
    overflow-x: auto;
    border-radius: 8px;
    border: 1px solid rgba(88, 101, 242, 0.2);
    background: rgba(0, 0, 0, 0.15);
}
#vlPerfSettings .pm-plugins-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
}
#vlPerfSettings .pm-plugins-table thead {
    background: rgba(88, 101, 242, 0.15);
    position: sticky;
    top: 0;
}
#vlPerfSettings .pm-plugins-table th {
    padding: 10px;
    text-align: left;
    font-weight: 700;
    color: #ffffff;
    text-transform: uppercase;
    letter-spacing: .3px;
    cursor: pointer;
    user-select: none;
    font-size: 10px;
    white-space: nowrap;
}
#vlPerfSettings .pm-plugins-table th:hover {
    background: rgba(88, 101, 242, 0.25);
}
#vlPerfSettings .pm-plugins-table td {
    padding: 10px;
    border-top: 1px solid rgba(88, 101, 242, 0.1);
    color: #dbdee1;
}
#vlPerfSettings .pm-plugin-name {
    font-weight: 600;
    color: #ffffff;
}
#vlPerfSettings .pm-value-ok {
    color: var(--pm-ok);
    font-weight: 700;
}
#vlPerfSettings .pm-value-warn {
    color: var(--pm-warn);
    font-weight: 700;
}
#vlPerfSettings .pm-value-bad {
    color: var(--pm-bad);
    font-weight: 700;
}
#vlPerfSettings .pm-indicator {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 4px;
}
#vlPerfSettings .pm-indicator.ok { background: var(--pm-ok); }
#vlPerfSettings .pm-indicator.warn { background: var(--pm-warn); }
#vlPerfSettings .pm-indicator.bad { background: var(--pm-bad); }
#vlPerfSettings .pm-empty {
    padding: 32px;
    text-align: center;
    color: #949ba4;
    font-size: 13px;
}
#vlPerfSettings .pm-memory-warning {
    padding: 10px 12px;
    background: rgba(254, 231, 92, 0.1);
    border: 1px solid rgba(254, 231, 92, 0.3);
    border-radius: 6px;
    color: #FEE75C;
    font-size: 11px;
    margin-bottom: 12px;
}
`;
        document.head.appendChild(style);
        return () => style.remove();
    }, []);

    // Real-time update listener with memory refresh
    React.useEffect(() => {
        const updateFn = () => {
            updateSystemMemory();
            setForceUpdate((x) => x + 1);
            setMetrics({ ...performanceStore.metrics });
            setSystemMem({ ...performanceStore.systemMemory });
        };

        updateListeners.add(updateFn);

        // Also refresh system memory every 500ms
        const memInterval = setInterval(() => {
            updateSystemMemory();
            setSystemMem({ ...performanceStore.systemMemory });
        }, 500);

        return () => {
            updateListeners.delete(updateFn);
            clearInterval(memInterval);
        };
    }, []);

    const getOptimizationStatus = (metric: PluginMetrics) => {
        let score = 0;

        // Execution time: max 3 points
        if (metric.avgExecutionTime < 2) score += 3;
        else if (metric.avgExecutionTime < 5) score += 2;
        else if (metric.avgExecutionTime < 10) score += 1;

        // Memory per call: max 3 points
        if (metric.avgMemoryPerCall < 10 * 1024) score += 3;
        else if (metric.avgMemoryPerCall < 50 * 1024) score += 2;
        else if (metric.avgMemoryPerCall < 200 * 1024) score += 1;

        // Frequency: max 2 points
        if (metric.fluxEventCount < 100) score += 2;
        else if (metric.fluxEventCount < 500) score += 1;

        // CPU (total time): max 2 points
        if (metric.totalTime < 10) score += 2;
        else if (metric.totalTime < 50) score += 1;

        return score;
    };

    const getStatusClass = (metric: PluginMetrics) => {
        const score = getOptimizationStatus(metric);
        if (score >= 8) return "ok";
        if (score >= 5) return "warn";
        return "bad";
    };

    const sortedMetrics = Object.values(metrics).sort((a, b) => {
        switch (sortBy) {
            case "exec":
                return b.avgExecutionTime - a.avgExecutionTime;
            case "memory":
                return b.avgMemoryPerCall - a.avgMemoryPerCall;
            case "freq":
                return b.fluxEventCount - a.fluxEventCount;
            case "name":
                return a.name.localeCompare(b.name);
            default:
                return 0;
        }
    });

    const totalMetrics = {
        plugins: sortedMetrics.length,
        totalCalls: sortedMetrics.reduce((a, m) => a + m.totalExecutions, 0),
        avgExec: sortedMetrics.length
            ? sortedMetrics.reduce((a, m) => a + m.avgExecutionTime, 0) /
              sortedMetrics.length
            : 0,
        totalMemory: sortedMetrics.reduce(
            (a, m) => a + m.memoryAllocated - m.memoryFreed,
            0,
        ),
        totalCPU: sortedMetrics.reduce((a, m) => a + m.totalTime, 0),
    };

    const vermLibData = (window as any).__VERMLIB_DATA__;
    const memAvailable = getMemoryInfo() !== null;

    return (
        <div id="vlPerfSettings">
            <div className="pm-header">
                <h3>⚡ VermLib Performance Monitor</h3>
                <p>
                    Real-time optimization analysis for all vermLib sub-plugins
                </p>
                {vermLibData ? (
                    <div className="pm-status">
                        ✅ Connected to vermLib ({vermLibData.PLUGINS?.length}{" "}
                        plugins)
                    </div>
                ) : (
                    <div className="pm-status inactive">
                        ⏳ Waiting for vermLib to initialize...
                    </div>
                )}
                {!memAvailable && (
                    <div className="pm-status warning">
                        ⚠️ Memory API not available - using limited memory
                        tracking
                    </div>
                )}
            </div>

            <div className="pm-controls">
                <button
                    className={`pm-control-btn ${sortBy === "exec" ? "active" : ""}`}
                    onClick={() => setSortBy("exec")}
                >
                    ⚙️ Exec Time
                </button>
                <button
                    className={`pm-control-btn ${sortBy === "memory" ? "active" : ""}`}
                    onClick={() => setSortBy("memory")}
                >
                    💾 Memory
                </button>
                <button
                    className={`pm-control-btn ${sortBy === "freq" ? "active" : ""}`}
                    onClick={() => setSortBy("freq")}
                >
                    📊 Frequency
                </button>
                <button
                    className={`pm-control-btn ${sortBy === "name" ? "active" : ""}`}
                    onClick={() => setSortBy("name")}
                >
                    📋 Name
                </button>
                <button
                    className="pm-control-btn"
                    onClick={() => {
                        performanceStore.metrics = {};
                        setMetrics({});
                        notifyUpdates();
                    }}
                >
                    🔄 Reset
                </button>
            </div>

            {memAvailable && (
                <div className="pm-metrics-grid">
                    <div className="pm-stat-card">
                        <div className="pm-stat-label">System Heap Used</div>
                        <div className="pm-stat-value">
                            {(systemMem.jsHeapSize / 1024 / 1024).toFixed(1)}MB
                        </div>
                        <div className="pm-stat-subtext">
                            of{" "}
                            {(systemMem.jsHeapSizeLimit / 1024 / 1024).toFixed(
                                0,
                            )}
                            MB
                        </div>
                    </div>
                </div>
            )}

            <div className="pm-metrics-grid">
                <div className="pm-stat-card">
                    <div className="pm-stat-label">Active Plugins</div>
                    <div className="pm-stat-value">{totalMetrics.plugins}</div>
                </div>
                <div className="pm-stat-card">
                    <div className="pm-stat-label">Total Calls</div>
                    <div className="pm-stat-value">
                        {totalMetrics.totalCalls.toLocaleString()}
                    </div>
                </div>
                <div className="pm-stat-card">
                    <div className="pm-stat-label">Avg Exec Time</div>
                    <div className="pm-stat-value">
                        {totalMetrics.avgExec.toFixed(2)}ms
                    </div>
                </div>
                <div className="pm-stat-card">
                    <div className="pm-stat-label">Total Memory</div>
                    <div className="pm-stat-value">
                        {(totalMetrics.totalMemory / 1024).toFixed(1)}KB
                    </div>
                </div>
                <div className="pm-stat-card">
                    <div className="pm-stat-label">Total CPU Time</div>
                    <div className="pm-stat-value">
                        {totalMetrics.totalCPU.toFixed(1)}ms
                    </div>
                </div>
                <div className="pm-stat-card">
                    <div className="pm-stat-label">Monitoring</div>
                    <div
                        className="pm-stat-value"
                        style={{
                            color: performanceStore.isMonitoring
                                ? "#57F287"
                                : "#ED4245",
                        }}
                    >
                        {performanceStore.isMonitoring ? "ON" : "OFF"}
                    </div>
                </div>
            </div>

            {sortedMetrics.length === 0 ? (
                <div className="pm-empty">
                    📊 No metrics yet. Interact with vermLib plugins to start
                    monitoring.
                </div>
            ) : (
                <div className="pm-table-container">
                    <table className="pm-plugins-table">
                        <thead>
                            <tr>
                                <th onClick={() => setSortBy("name")}>
                                    Plugin
                                </th>
                                <th onClick={() => setSortBy("exec")}>
                                    Avg (ms)
                                </th>
                                <th onClick={() => setSortBy("exec")}>
                                    Peak (ms)
                                </th>
                                <th onClick={() => setSortBy("freq")}>Calls</th>
                                <th onClick={() => setSortBy("memory")}>
                                    Avg Mem (KB)
                                </th>
                                <th>Peak Mem (KB)</th>
                                <th>CPU (ms)</th>
                                <th>Score</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedMetrics.map((m) => {
                                const status = getStatusClass(m);
                                const score = getOptimizationStatus(m);
                                return (
                                    <tr key={m.key}>
                                        <td className="pm-plugin-name">
                                            <span
                                                className={`pm-indicator ${status}`}
                                            />
                                            {m.name}
                                        </td>
                                        <td className={`pm-value-${status}`}>
                                            {m.avgExecutionTime.toFixed(2)}
                                        </td>
                                        <td>{m.maxExecutionTime.toFixed(2)}</td>
                                        <td>{m.totalExecutions}</td>
                                        <td>
                                            {(
                                                m.avgMemoryPerCall / 1024
                                            ).toFixed(2)}
                                        </td>
                                        <td>
                                            {(
                                                m.peakMemoryPerCall / 1024
                                            ).toFixed(2)}
                                        </td>
                                        <td>{m.totalTime.toFixed(1)}</td>
                                        <td className={`pm-value-${status}`}>
                                            {score}/10
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <div style={{ marginTop: 16, fontSize: 11, color: "#949ba4" }}>
                <strong>📈 Optimization Score (per plugin):</strong>
                <br />
                🟢 <strong>8-10:</strong> Optimized - Fast and efficient
                <br />
                🟡 <strong>5-7:</strong> Warning - Consider optimization
                <br />
                🔴 <strong>0-4:</strong> Unoptimized - Needs improvement
                <br />
                <br />
                <strong>📊 Memory Metrics:</strong>
                <br />• <strong>Avg Mem:</strong> Average memory allocated per
                call
                <br />• <strong>Peak Mem:</strong> Largest single allocation
                <br />• <strong>System Heap:</strong> Total JS heap usage
            </div>
        </div>
    );
}

const settings = definePluginSettings({
    performanceMetrics: {
        type: OptionType.COMPONENT,
        component: ErrorBoundary.wrap(PerformanceMetricsSettings, {
            noop: true,
        }),
        description: "Live performance metrics for vermLib plugins",
    },
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable performance monitoring",
        default: true,
    },
});

export default definePlugin({
    name: "VermLib Performance Monitor",
    description:
        "Real-time optimization analysis with accurate memory profiling",
    authors: [{ name: "Monitor", id: "0n" }],

    settings,

    start() {
        performanceStore.isMonitoring = true;
        const vermLibData = (window as any).__VERMLIB_DATA__;

        if (!vermLibData) {
            console.warn(
                "[VermLib Monitor] vermLib data not found, retrying...",
            );
            setTimeout(() => this.start?.(), 1000);
            return;
        }

        const memAvailable = getMemoryInfo() !== null;
        console.log(
            `[VermLib Monitor] 🚀 Monitoring ${vermLibData.PLUGINS.length} plugins` +
                (memAvailable
                    ? " with memory profiling"
                    : " (memory API unavailable)"),
        );

        const { PLUGINS, subs } = vermLibData;

        PLUGINS.forEach((config: any) => {
            const sub = subs[config.key];
            if (!sub) return;

            getMetrics(config.key, config.name);

            // Wrap start
            if (sub.start && !originalFunctions[`${config.key}_start`]) {
                originalFunctions[`${config.key}_start`] = sub.start;
                sub.start = wrapFunction(
                    `${config.key}_start`,
                    `${config.name}::start`,
                    sub.start,
                );
            }

            // Wrap stop
            if (sub.stop && !originalFunctions[`${config.key}_stop`]) {
                originalFunctions[`${config.key}_stop`] = sub.stop;
                sub.stop = wrapFunction(
                    `${config.key}_stop`,
                    `${config.name}::stop`,
                    sub.stop,
                );
            }

            // Wrap flux handlers
            if (sub.flux && typeof sub.flux === "object") {
                Object.keys(sub.flux).forEach((eventName) => {
                    const wrappedKey = `${config.key}_${eventName}`;
                    if (!originalFunctions[wrappedKey]) {
                        originalFunctions[wrappedKey] = sub.flux[eventName];
                        sub.flux[eventName] = wrapFunction(
                            wrappedKey,
                            `${config.name}::${eventName}`,
                            sub.flux[eventName],
                        );
                    }
                });
            }
        });

        notifyUpdates();
    },

    stop() {
        performanceStore.isMonitoring = false;
        updateListeners.clear();
        console.log(`[VermLib Monitor] Stopped monitoring`);
    },
});
