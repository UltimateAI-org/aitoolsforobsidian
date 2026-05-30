import * as React from "react";
import { useState } from "react";
import { Notice } from "obsidian";
import {
	installAgent,
	getAgentDisplayName,
	showAgentRestartNotice,
} from "../../shared/agent-installer";
import type AgentClientPlugin from "../../plugin";

export interface CompatWarningBannerProps {
	plugin: AgentClientPlugin;
	agentId: string;
	/** The installed version, which is newer than what the plugin was tested
	 *  against. */
	installedVersion: string;
	/** The highest version this plugin release was tested with — also the
	 *  rollback target. */
	maxTestedVersion: string;
	nodePath: string;
	/** Persist a dismissal for this installed version (won't show again). */
	onDismiss: () => void;
	/** Clear the banner after a rollback has been kicked off. */
	onResolved: () => void;
}

/**
 * Banner shown when the active agent's installed version is newer than the
 * version this plugin release was tested against. Offers a one-click rollback
 * to the tested version (a version-pinned npm install) so users who hit
 * breakage have a recovery path without needing the terminal. Reuses the same
 * install + "Restart Now" flow as the update banner.
 */
export function CompatWarningBanner({
	plugin,
	agentId,
	installedVersion,
	maxTestedVersion,
	nodePath,
	onDismiss,
	onResolved,
}: CompatWarningBannerProps) {
	const [rollingBack, setRollingBack] = useState(false);
	const displayName = getAgentDisplayName(agentId);

	const handleRollback = async () => {
		setRollingBack(true);
		// Release file locks held by the running agent so npm can replace its
		// files on Windows (EPERM otherwise).
		await plugin.disconnectAgentForFileOperation();
		const buf: string[] = [];
		const childProcess = installAgent(
			agentId,
			nodePath,
			(output) => buf.push(output),
			maxTestedVersion,
		);
		if (!childProcess) {
			new Notice(`Could not start rollback for ${displayName}.`, 4000);
			setRollingBack(false);
			return;
		}
		childProcess.on("close", (code) => {
			if (code === 0) {
				onResolved(); // clear the banner immediately
				showAgentRestartNotice(
					plugin,
					`${displayName} rolled back to v${maxTestedVersion}.`,
				);
			} else {
				console.error(
					`[CompatWarningBanner] rollback failed (exit ${code}). Full output:\n${buf.join("")}`,
				);
				new Notice(
					`${displayName} rollback failed (exit ${code}). See dev console for full log.`,
					10000,
				);
				setRollingBack(false);
			}
		});
		childProcess.on("error", (err) => {
			new Notice(`Rollback error: ${err.message}`, 6000);
			setRollingBack(false);
		});
	};

	return (
		<div className="obsidianaitools-compat-warning">
			<span className="obsidianaitools-compat-warning-text">
				⚠️ {displayName} v{installedVersion} is newer than the tested
				version (v{maxTestedVersion}) — if you hit issues, roll back or
				check for a plugin update.
			</span>
			<div className="obsidianaitools-compat-warning-actions">
				<button
					className="mod-cta obsidianaitools-compat-warning-rollback"
					onClick={() => void handleRollback()}
					disabled={rollingBack}
				>
					{rollingBack
						? "Rolling back…"
						: `Roll back to v${maxTestedVersion}`}
				</button>
				<button
					className="obsidianaitools-compat-warning-dismiss"
					onClick={onDismiss}
					disabled={rollingBack}
				>
					Dismiss
				</button>
			</div>
		</div>
	);
}
