/*
 * Vencord HTTP Updater for Release-based updates
 */

import { execSync } from "child_process";
import { app, ipcMain } from "electron";
import { mkdir, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";

import { IpcEvents } from "@shared/IpcEvents";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";

const GITHUB_OWNER = "vermingov";
const GITHUB_REPO = "Vermcord";
const API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;

interface Release {
    name: string;
    assets: Array<{ name: string; browser_download_url: string }>;
    author?: { login?: string };
}

let isOutdated = false;
let pendingUpdates: any[] = [];

function parseShortCommitFromReleaseName(name: string): string | undefined {
    const parts = name.trim().split(/\s+/);
    const last = parts[parts.length - 1] || "";
    if (/^[0-9a-f]{7,}$/i.test(last)) return last;
    return undefined;
}

function getLocalGitHash(): string {
    try {
        // First try to read from the release marker (most recent update)
        const vencordPath = join(app.getPath("appData"), "Vencord");
        const markerPath = join(vencordPath, "dist", "release.json");

        try {
            const fs = require("fs");
            const data = JSON.parse(fs.readFileSync(markerPath, "utf-8"));
            if (data?.shortCommit) {
                console.log(
                    `✓ Got local commit from marker: ${data.shortCommit}`,
                );
                return data.shortCommit;
            }
        } catch {
            // Marker doesn't exist yet, continue to git fallback
        }

        // Fallback to git hash if no marker exists (first run)
        const hash = execSync("git rev-parse --short HEAD").toString().trim();
        console.log(`✓ Got local commit from git: ${hash}`);
        return hash;
    } catch {
        console.warn("Could not get local commit hash");
        return "unknown";
    }
}

async function getLatestRelease(): Promise<Release | null> {
    try {
        const response = await fetch(`${API_BASE}/releases/latest`, {
            headers: {
                Accept: "application/vnd.github+json",
                "User-Agent": VENCORD_USER_AGENT,
            },
        });

        if (!response.ok) {
            console.error(`GitHub API error: ${response.status}`);
            return null;
        }

        return response.json();
    } catch (e) {
        console.error("Failed to fetch latest release:", e);
        return null;
    }
}

async function downloadFile(url: string, destPath: string): Promise<void> {
    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": VENCORD_USER_AGENT,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to download: ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        await writeFile(destPath, Buffer.from(buffer));
    } catch (e) {
        console.error(`Failed to download file: ${url}`, e);
        throw e;
    }
}

async function checkUpdates(): Promise<any[]> {
    try {
        const release = await getLatestRelease();

        if (!release) {
            console.error("Could not fetch latest release");
            return [];
        }

        const latestShort = parseShortCommitFromReleaseName(release.name);
        const localShort = getLocalGitHash();

        isOutdated = latestShort
            ? latestShort.toLowerCase() !== localShort.toLowerCase()
            : false;

        if (isOutdated && latestShort) {
            const author = release.author?.login || "release";
            pendingUpdates = [
                {
                    hash: latestShort,
                    author,
                    message: `Update to ${release.name}`,
                },
            ];
            console.log(`✓ Update available: ${release.name}`);
        } else {
            pendingUpdates = [];
            console.log("✓ Already up to date");
        }

        return pendingUpdates;
    } catch (e) {
        console.error("Failed to check updates:", e);
        return [];
    }
}

async function performUpdate(): Promise<boolean> {
    if (!isOutdated) {
        console.log("No update needed");
        return true;
    }

    try {
        const release = await getLatestRelease();

        if (!release) {
            throw new Error("Could not fetch latest release");
        }

        const shortCommit =
            parseShortCommitFromReleaseName(release.name) ?? "unknown";
        const vencordPath = join(app.getPath("appData"), "Vencord");
        const distPath = join(vencordPath, "dist");

        console.log(`📥 Downloading release assets to: ${distPath}`);

        // Ensure dist directory exists
        await mkdir(distPath, { recursive: true });

        // Clear existing dist files (except release.json)
        try {
            const files = await readdir(distPath);
            for (const file of files) {
                if (file !== "release.json") {
                    try {
                        await rm(join(distPath, file), {
                            recursive: true,
                            force: true,
                        });
                    } catch (e) {
                        console.warn(`Could not delete ${file}:`, e);
                    }
                }
            }
        } catch (e) {
            console.warn("Could not clear dist directory:", e);
        }

        // Download all assets
        let downloadedCount = 0;
        for (const asset of release.assets) {
            if (
                asset.name.endsWith(".js") ||
                asset.name.endsWith(".js.map") ||
                asset.name.endsWith(".css")
            ) {
                const destPath = join(distPath, asset.name);

                try {
                    console.log(`⬇️  Downloading: ${asset.name}`);
                    await downloadFile(asset.browser_download_url, destPath);
                    downloadedCount++;
                    console.log(`✓ Downloaded ${asset.name}`);
                } catch (e) {
                    console.error(`✗ Failed to download ${asset.name}:`, e);
                }
            }
        }

        if (downloadedCount === 0) {
            throw new Error("No dist files were downloaded from the release");
        }

        // Write release marker
        const markerPath = join(distPath, "release.json");
        const marker = {
            name: release.name,
            shortCommit,
            publishedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await writeFile(markerPath, JSON.stringify(marker, null, 2));

        console.log(`✅ Successfully updated to ${release.name}`);
        isOutdated = false;
        pendingUpdates = [];
        return true;
    } catch (e) {
        console.error("Update failed:", e);
        return false;
    }
}

function getRepo(): string {
    return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
}

// Properly wrapped IPC handlers - return { ok, value, error }
ipcMain.handle(IpcEvents.GET_UPDATES, async () => {
    try {
        const updates = await checkUpdates();
        return { ok: true, value: updates };
    } catch (e: any) {
        console.error("GET_UPDATES error:", e);
        return { ok: false, error: e?.message || String(e) };
    }
});

ipcMain.handle(IpcEvents.UPDATE, async () => {
    try {
        const success = await performUpdate();
        return { ok: true, value: success };
    } catch (e: any) {
        console.error("UPDATE error:", e);
        return { ok: false, error: e?.message || String(e) };
    }
});

ipcMain.handle(IpcEvents.BUILD, async () => {
    return { ok: true, value: true };
});

ipcMain.handle(IpcEvents.GET_REPO, () => {
    try {
        const repo = getRepo();
        return { ok: true, value: repo };
    } catch (e: any) {
        console.error("GET_REPO error:", e);
        return { ok: false, error: e?.message || String(e) };
    }
});
