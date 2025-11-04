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

import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { ipcMain } from "electron";

import { DATA_DIR } from "@main/utils/constants";
import { fetchBuffer, fetchJson } from "@main/utils/http";
import { IpcEvents } from "@shared/IpcEvents";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";

import { serializeErrors } from "./common";
import gitHash from "~git-hash";

const gitRemote = "vermingov/Vermcord";
const API_BASE = `https://api.github.com/repos/${gitRemote}`;

const DIST_DIR = join(DATA_DIR, "dist");
let PendingUpdates: Array<[string, string]> = [];
let LatestReleaseHash: string | null = null;

async function githubGet<T = any>(endpoint: string) {
    return fetchJson<T>(API_BASE + endpoint, {
        headers: {
            Accept: "application/vnd.github+json",
            // "All API requests MUST include a valid User-Agent header.
            // Requests with no User-Agent header will be rejected."
            "User-Agent": VENCORD_USER_AGENT
        }
    });
}

// Returns a list of commits between the local hash and the latest release hash.
// If up-to-date, returns an empty list.
async function calculateGitChanges() {
    const isOutdated = await fetchUpdates();
    if (!isOutdated) return [];

    const compareTo = LatestReleaseHash ?? "HEAD";
    const data = await githubGet(`/compare/${gitHash}...${compareTo}`);

    return (data as any).commits.map((c: any) => ({
        hash: c.sha.slice(0, 7),
        author: c.author?.login ?? c.commit?.author?.name ?? "unknown",
        message: c.commit.message.split("\n")[0]
    }));
}

// Checks the latest GitHub release and prepares PendingUpdates by collecting
// all assets from the release. Comparison is based on the short commit hash
// suffix in the release name, e.g. "Vermcord v1.0.5 25330dd".
async function fetchUpdates() {
    const data = await githubGet("/releases/latest");

    // Take the last token in the release name as the short commit hash
    const name = (data as any).name as string;
    const hash = name.slice(name.lastIndexOf(" ") + 1).trim();
    LatestReleaseHash = hash;

    if (hash === gitHash) return false;

    PendingUpdates = [];
    (data as any).assets.forEach(({ name, browser_download_url }: any) => {
        PendingUpdates.push([name, browser_download_url]);
    });

    return true;
}

// Applies the prepared updates by replacing %APPDATA%/Vencord/dist
// with the assets from the latest release.
async function applyUpdates() {
    await rm(DIST_DIR, { recursive: true, force: true });
    await mkdir(DIST_DIR, { recursive: true });

    const fileContents = await Promise.all(
        PendingUpdates.map(async ([name, url]) => {
            const contents = await fetchBuffer(url);
            return [join(DIST_DIR, name), contents] as const;
        })
    );

    await Promise.all(
        fileContents.map(async ([filename, contents]) => writeFile(filename, contents))
    );

    PendingUpdates = [];
    return true;
}

ipcMain.handle(
    IpcEvents.GET_REPO,
    serializeErrors(() => `https://github.com/${gitRemote}`)
);
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(calculateGitChanges));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(fetchUpdates));
ipcMain.handle(IpcEvents.BUILD,
 serializeErrors(applyUpdates));