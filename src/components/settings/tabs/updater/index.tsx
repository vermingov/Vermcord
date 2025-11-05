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

import { useSettings } from "@api/Settings";
import { Divider } from "@components/Divider";
import { FormSwitch } from "@components/FormSwitch";
import { Link } from "@components/Link";
import {
    handleSettingsTabError,
    SettingsTab,
    wrapTab,
} from "@components/settings/tabs/BaseTab";
import { Margins } from "@utils/margins";
import {
    ModalCloseButton,
    ModalContent,
    ModalProps,
    ModalRoot,
    ModalSize,
    openModal,
} from "@utils/modal";
import { useAwaiter } from "@utils/react";
import { getRepo, isNewer, UpdateLogger } from "@utils/updater";
import { Forms, React } from "@webpack/common";

import gitHash from "~git-hash";

import { CommonProps, Newer, Updatable } from "./Components";

function Updater() {
    const settings = useSettings(["autoUpdate", "autoUpdateNotification"]);

    const [releaseData, err, releasePending] = useAwaiter(
        async () => {
            try {
                const repo = await getRepo();

                // Parse the repo URL to get owner/repo format
                const repoMatch = repo.match(/github\.com\/([^/]+\/[^/]+)/);
                const repoPath = repoMatch ? repoMatch[1] : repo;

                UpdateLogger.info(`Using repo path: ${repoPath}`);

                const response = await fetch(
                    `https://api.github.com/repos/${repoPath}/releases`,
                );
                const releases = await response.json();

                // Check if releases is an array and not an error response
                if (!Array.isArray(releases)) {
                    UpdateLogger.error("Invalid releases response", releases);
                    return {
                        version: "Unknown",
                        fullTag: gitHash,
                    };
                }

                // Get the first 7 characters of the current git hash
                const shortHash = gitHash.substring(0, 7);
                UpdateLogger.info(`Looking for hash: ${shortHash}`);

                // Find the release matching current git hash by checking release name
                let currentRelease = null;

                for (const release of releases) {
                    const releaseName = release.name || "";
                    UpdateLogger.info(`Checking release: ${releaseName}`);

                    // Check if hash is in the release name (e.g., "Vermcord vx.y.z githash")
                    if (releaseName.includes(shortHash)) {
                        currentRelease = release;
                        UpdateLogger.info(
                            `Found matching release: ${releaseName}`,
                        );
                        break;
                    }
                }

                if (currentRelease) {
                    const releaseName = currentRelease.name || "";

                    // Extract version from release name like "Vermcord vx.y.z githash"
                    const versionMatch = releaseName.match(/v([\d.]+)/);
                    const version = versionMatch ? versionMatch[1] : "Unknown";

                    UpdateLogger.info(
                        `Matched release: ${releaseName} - Version: ${version}`,
                    );

                    return {
                        version: version,
                        fullTag: releaseName,
                    };
                }

                UpdateLogger.warn(
                    `No release found matching hash: ${shortHash}`,
                );
                return {
                    version: "Unknown",
                    fullTag: gitHash,
                };
            } catch (e) {
                UpdateLogger.error("Failed to retrieve version info", e);
                return {
                    version: "Unknown",
                    fullTag: gitHash,
                };
            }
        },
        {
            fallbackValue: { version: "Loading...", fullTag: gitHash },
            onError: (e) =>
                UpdateLogger.error("Failed to retrieve release info", e),
        },
    );

    const commonProps: CommonProps = {
        releaseData,
        releasePending,
    };

    return (
        <SettingsTab title="Vermcord Updater">
            <Forms.FormTitle tag="h5">Updater Settings</Forms.FormTitle>

            <FormSwitch
                title="Automatically update"
                description="Automatically update Vermcord without confirmation prompt"
                value={settings.autoUpdate}
                onChange={(v: boolean) => (settings.autoUpdate = v)}
            />
            <FormSwitch
                title="Get notified when an automatic update completes"
                description="Show a notification when Vencord automatically updates"
                value={settings.autoUpdateNotification}
                onChange={(v: boolean) => (settings.autoUpdateNotification = v)}
                disabled={!settings.autoUpdate}
            />

            <Forms.FormTitle tag="h5">Version</Forms.FormTitle>

            <Forms.FormText>
                Installed Version:{" "}
                {releasePending
                    ? releaseData.version
                    : err
                      ? "Failed to retrieve - check console"
                      : `Vermcord v${releaseData.version}`}
            </Forms.FormText>

            <Divider className={Margins.top8 + " " + Margins.bottom8} />

            <Forms.FormTitle tag="h5">Updates</Forms.FormTitle>

            {isNewer ? (
                <Newer {...commonProps} />
            ) : (
                <Updatable {...commonProps} />
            )}
        </SettingsTab>
    );
}

export default IS_UPDATER_DISABLED ? null : wrapTab(Updater, "Updater");

export const openUpdaterModal = IS_UPDATER_DISABLED
    ? null
    : function () {
          const UpdaterTab = wrapTab(Updater, "Updater");

          try {
              openModal(
                  wrapTab(
                      (modalProps: ModalProps) => (
                          <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
                              <ModalContent className="vc-updater-modal">
                                  <ModalCloseButton
                                      onClick={modalProps.onClose}
                                      className="vc-updater-modal-close-button"
                                  />
                                  <UpdaterTab />
                              </ModalContent>
                          </ModalRoot>
                      ),
                      "UpdaterModal",
                  ),
              );
          } catch {
              handleSettingsTabError();
          }
      };
