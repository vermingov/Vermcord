/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

const API_URL = "https://api.krno.net:8443/ws/stats";

export interface VermcordStatsOk {
    status: number;
    ok: true;
    text: string;
    json: unknown;
}

export interface VermcordStatsErr {
    status: number;
    ok: false;
    text: string;
    json?: undefined;
}

/**
 * Fetch Vermcord usage stats from the main process.
 * This is invoked via IPC from the renderer to avoid CORS.
 */
export async function getVermcordStats(_: IpcMainInvokeEvent): Promise<VermcordStatsOk | VermcordStatsErr> {
    try {
        const res = await fetch(API_URL, {
            method: "GET",
            headers: {
                // Keep headers minimal; server should not require special headers
                "Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
            },
        });

        const text = await res.text();

        if (!res.ok) {
            return {
                status: res.status,
                ok: false,
                text,
            };
        }

        let json: unknown;
        try {
            json = JSON.parse(text);
        } catch {
            // If server returns plain text or invalid JSON, still return the raw body
            json = undefined;
        }

        return {
            status: res.status,
            ok: true,
            text,
            json,
        };
    } catch (e) {
        return {
            status: -1,
            ok: false,
            text: String(e),
        };
    }
}
