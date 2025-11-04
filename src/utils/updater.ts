/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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

import { Logger } from "./Logger";
import { relaunch } from "./native";

export const UpdateLogger = /* #__PURE__*/ new Logger("Updater", "white");
export let isOutdated = false;
export let isNewer = false;
export let updateError: any;
export let changes: Record<"hash" | "author" | "message", string>[] = [];

type GithubRelease = {
    name: string;
    tag_name: string;
    assets: Array<{
        name: string;
        browser_download_url: string;
        size: number;
        content_type: string;
    }>;
    draft: boolean;
    prerelease: boolean;
    created_at: string;
    published_at: string;
    author?: { login?: string };
};

const GITHUB_OWNER = "vermingov";
const GITHUB_REPO = "Vermcord";

function parseShortCommitFromReleaseName(name: string): string | undefined {
    const parts = name.trim().split(/\s+/);
    const last = parts[parts.length - 1] || "";
    if (/^[0-9a-f]{7,}$/i.test(last)) return last;
    return undefined;
}

async function getLocalShortCommit(): Promise<string | undefined> {
    try {
        const settingsDir = VencordNative.settings.settingsDir;
        const markerPath = `${settingsDir}/dist/release.json`;

        const result = await VencordNative.native.readFile(markerPath);
        if (!result.ok) return undefined;

        const parsed = JSON.parse(result.value);

        if (parsed?.shortCommit && typeof parsed.shortCommit === "string") {
            return parsed.shortCommit;
        }
    } catch (err) {
        UpdateLogger.info("No local release marker found");
    }
    return undefined;
}

async function getLatestRelease(): Promise<GithubRelease> {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

    // Use VencordNative to bypass CORS
    const result = await VencordNative.native.request(url, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "Vermcord-Updater",
        },
    });

    if (!result.ok) {
        throw new Error(
            `GitHub API returned error: ${result.error || "Unknown error"}`,
        );
    }

    return JSON.parse(result.value) as GithubRelease;
}

function selectDistAssets(r: GithubRelease) {
    const assets = r.assets || [];

    // For now, only support individual files (no zip)
    return { mode: "files" as const, assets };
}

async function replaceDistWithAssets(release: GithubRelease) {
    const settingsDir = VencordNative.settings.settingsDir;
    const distDir = `${settingsDir}/dist`;

    UpdateLogger.info(`Updating dist at: ${distDir}`);

    const pick = selectDistAssets(release);

    UpdateLogger.info(`Downloading ${pick.assets.length} dist files`);

    for (const asset of pick.assets) {
        const destPath = `${distDir}/${asset.name}`;

        UpdateLogger.info(`Downloading ${asset.name}...`);

        // Use VencordNative.native.request to bypass CORS
        const result = await VencordNative.native.request(
            asset.browser_download_url,
            {
                headers: {
                    "User-Agent": "Vermcord-Updater",
                },
            },
        );

        if (!result.ok) {
            throw new Error(
                `Failed to download ${asset.name}: ${result.error}`,
            );
        }

        // Write the file
        const writeResult = await VencordNative.native.writeFile(
            destPath,
            result.value,
        );

        if (!writeResult.ok) {
            throw new Error(
                `Failed to write ${asset.name}: ${writeResult.error}`,
            );
        }

        UpdateLogger.info(`Successfully wrote ${asset.name}`);
    }

    // Write release marker
    const shortCommit =
        parseShortCommitFromReleaseName(release.name) ?? "unknown";
    const marker = {
        name: release.name,
        shortCommit,
        publishedAt: release.published_at || release.created_at,
        updatedAt: new Date().toISOString(),
    };

    const markerPath = `${distDir}/release.json`;
    const markerResult = await VencordNative.native.writeFile(
        markerPath,
        JSON.stringify(marker, null, 2),
    );

    if (!markerResult.ok) {
        UpdateLogger.warn(
            "Failed to write release marker:",
            markerResult.error,
        );
    }

    UpdateLogger.info(`Successfully updated to ${release.name}`);
}

export async function checkForUpdates(): Promise<boolean> {
    changes = [];
    updateError = undefined;

    try {
        const latest = await getLatestRelease();
        const latestShort = parseShortCommitFromReleaseName(latest.name);

        if (!latestShort) {
            throw new Error(
                `Release name "${latest.name}" does not contain a trailing short commit hash`,
            );
        }

        const localShort = await getLocalShortCommit();

        isOutdated =
            !localShort ||
            localShort.toLowerCase() !== latestShort.toLowerCase();
        isNewer = false;

        if (isOutdated) {
            const author = latest.author?.login || "release";
            const msg = `Update to ${latest.name}`;
            changes = [{ hash: latestShort, author, message: msg }];

            UpdateLogger.info(`Update available: ${latest.name}`);
        } else {
            UpdateLogger.info("Already up to date");
        }

        return isOutdated;
    } catch (e) {
        updateError = e;
        UpdateLogger.error("Failed to check for updates:", e);
        isOutdated = false;
        changes = [];
        return false;
    }
}

export async function update(): Promise<boolean> {
    if (!isOutdated) {
        UpdateLogger.info("No update needed");
        return true;
    }

    try {
        const latest = await getLatestRelease();
        const latestShort = parseShortCommitFromReleaseName(latest.name);

        if (!latestShort) {
            throw new Error(
                `Release name "${latest.name}" does not contain a trailing short commit hash`,
            );
        }

        await replaceDistWithAssets(latest);

        isOutdated = false;
        changes = [];

        return true;
    } catch (e) {
        updateError = e;
        UpdateLogger.error("Update failed:", e);
        throw e;
    }
}

export async function getRepo(): Promise<string> {
    return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
}

export async function maybePromptToUpdate(
    confirmMessage: string,
    checkForDev = false,
) {
    if (IS_WEB || IS_UPDATER_DISABLED) return;
    if (checkForDev && IS_DEV) return;

    try {
        const outdated = await checkForUpdates();
        if (outdated) {
            const wantsUpdate = confirm(confirmMessage);
            if (wantsUpdate && isNewer) {
                return alert(
                    "Your local copy has more recent commits. Please stash or reset them.",
                );
            }
            if (wantsUpdate) {
                await update();
                relaunch();
            }
        }
    } catch (err) {
        UpdateLogger.error(err);
        alert("Update failed. Try reinstalling or updating via the installer!");
    }
}
