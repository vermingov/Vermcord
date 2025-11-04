import { Logger } from "./Logger";
import { relaunch } from "./native";
import { IpcRes } from "./types";

export const UpdateLogger = /* #__PURE__*/ new Logger("Updater", "white");
export let isOutdated = false;
export let isNewer = false;
export let updateError: any;
export let changes: Record<"hash" | "author" | "message", string>[] = [];

async function Unwrap<T>(p: Promise<IpcRes<T>>) {
    const res = await p;
    if (res.ok) return res.value;
    updateError = res.error;
    throw res.error;
}

export async function checkForUpdates(): Promise<boolean> {
    changes = await Unwrap(VencordNative.updater.getUpdates());
    isOutdated = changes.length > 0;
    return isOutdated;
}

export async function update(): Promise<boolean> {
    if (!isOutdated) return true;
    const res = await Unwrap(VencordNative.updater.update());
    if (res) {
        isOutdated = false;
        if (!(await Unwrap(VencordNative.updater.rebuild())))
            throw new Error(
                "The Build failed. Please try manually building the new update",
            );
    }
    return res;
}

export const getRepo = () => Unwrap(VencordNative.updater.getRepo());

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
