import * as React from "react";
import { useState } from "react";
import { Notice } from "obsidian";
import {
	installAgent,
	getAgentDisplayName,
	showAgentRestartNotice,
} from "../../shared/agent-installer";
import type AgentClientPlugin from "../../plugin";

/**
 * Pull the most-useful line out of an npm error stream — the first `npm ERR!`
 * with a real message — so we can surface it in the Notice without dumping
 * the whole log on the user.
 */
function summarizeNpmError(output: string): string {
	const errLines = output
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => /^npm (ERR!|error)/i.test(l))
		.filter((l) => !/^npm (ERR!|error)\s*$/i.test(l))
		.filter((l) => !/A complete log of this run/i.test(l));
	const firstReal = errLines.find(
		(l) => !/^npm (ERR!|error)\s+code\s+/i.test(l),
	);
	const summary = (firstReal ?? errLines[0] ?? output).slice(0, 220);
	return summary || "See dev console for npm output.";
}

export interface AgentUpdateBannerProps {
	plugin: AgentClientPlugin;
	agentId: string;
	/** May be null when npm metadata isn't readable — the banner just omits
	 *  the "from" version in that case. */
	installedVersion: string | null;
	latestVersion: string;
	nodePath: string;
	/** True when latestVersion is newer than the highest version this plugin
	 *  release was tested with — the banner switches to cautious wording and
	 *  an "Update anyway" button instead of quietly nudging users onto it. */
	untested?: boolean;
	/** The highest tested version, shown in the untested wording. */
	maxTestedVersion?: string | null;
	onDismiss: () => void;
	onUpdated: () => void;
}

/**
 * Banner shown above the chat when the active agent's npm package has an
 * update available. The same `installAgent` flow used by the settings page
 * runs the update — on success we notify and clear the banner so the chat
 * view re-checks.
 */
export function AgentUpdateBanner({
	plugin,
	agentId,
	installedVersion,
	latestVersion,
	nodePath,
	untested = false,
	maxTestedVersion,
	onDismiss,
	onUpdated,
}: AgentUpdateBannerProps) {
	const [installing, setInstalling] = useState(false);
	const displayName = getAgentDisplayName(agentId);

	const handleUpdate = async () => {
		setInstalling(true);
		// Release file locks held by the running agent so npm can replace
		// its files on Windows (EPERM otherwise).
		await plugin.disconnectAgentForFileOperation();
		const buf: string[] = [];
		const childProcess = installAgent(agentId, nodePath, (output) => {
			buf.push(output);
		});
		if (!childProcess) {
			new Notice(`Could not start update for ${displayName}.`, 4000);
			setInstalling(false);
			return;
		}
		childProcess.on("close", (code) => {
			if (code === 0) {
				onUpdated(); // clear the banner immediately
				// Auto-save the detected command path so subsequent version
				// checks use the fast existsSync path (fixes "Not installed"
				// shown in settings on Linux/Mac after a fresh install).
				void (async () => {
					try {
						// Save if empty OR bare name — bare names fail existsSync
						const isBare = (cmd: string) =>
							!!cmd && !cmd.includes("/") && !cmd.includes("\\");
						const needsSave = (cmd: string) => !cmd || isBare(cmd);

						const { detectAgentPath } = await import("../../shared/path-detector");
						let fullPath = detectAgentPath(agentId).path;

						// Fallback: derive from npm root -g when which fails
						if (!fullPath) {
							try {
								const { getNpmGlobalRoot } = await import("../../shared/version-checker");
								const root = await getNpmGlobalRoot(plugin.settings.nodePath);
								if (root) {
									const path = await import("path");
									const { existsSync } = await import("fs");
									const { Platform } = await import("obsidian");
									const NAMES: Record<string, { win: string; unix: string }> = {
										"claude-code-acp": { win: "claude-agent-acp.cmd", unix: "claude-agent-acp" },
										"codex-acp":       { win: "codex-acp.cmd",        unix: "codex-acp" },
										"gemini-cli":      { win: "gemini.cmd",            unix: "gemini" },
									};
									const names = NAMES[agentId];
									if (names) {
										const binDir = Platform.isWin
											? path.dirname(root)
											: path.join(path.dirname(path.dirname(root)), "bin");
										const candidate = path.join(binDir, Platform.isWin ? names.win : names.unix);
										if (existsSync(candidate)) fullPath = candidate;
									}
								}
							} catch { /* non-critical */ }
						}

						if (fullPath) {
							const s = plugin.settings;
							if (agentId === s.claude.id && needsSave(s.claude.command)) {
								s.claude.command = fullPath;
								await plugin.saveSettings();
							} else if (agentId === s.codex.id && needsSave(s.codex.command)) {
								s.codex.command = fullPath;
								await plugin.saveSettings();
							} else if (agentId === s.gemini.id && needsSave(s.gemini.command)) {
								s.gemini.command = fullPath;
								await plugin.saveSettings();
							}
						}
					} catch {
						// Non-critical
					}
				})();
				// Persistent notice with Restart Now so the user knows the new
				// binary won't be used until Obsidian re-spawns the agent.
				showAgentRestartNotice(
					plugin,
					`${displayName} updated to v${latestVersion}.`,
				);
			} else {
				const full = buf.join("");
				console.error(
					`[AgentUpdateBanner] npm install failed (exit ${code}). Full output:\n${full}`,
				);
				new Notice(
					`${displayName} update failed (exit ${code}). ${summarizeNpmError(full)} See dev console for full log.`,
					10000,
				);
				setInstalling(false);
			}
		});
		childProcess.on("error", (err) => {
			new Notice(`Update error: ${err.message}`, 6000);
			setInstalling(false);
		});
	};

	return (
		<div className="obsidianaitools-agent-update-banner">
			<span className="obsidianaitools-agent-update-banner-text">
				{untested
					? `${displayName} v${latestVersion} is available but not yet tested with this plugin${
							maxTestedVersion
								? ` (tested up to v${maxTestedVersion})`
								: ""
						}`
					: installedVersion
						? `${displayName} update available: ${installedVersion} → ${latestVersion}`
						: `${displayName}: update available — v${latestVersion}`}
			</span>
			<div className="obsidianaitools-agent-update-banner-actions">
				<button
					className="obsidianaitools-agent-update-banner-update"
					onClick={() => void handleUpdate()}
					disabled={installing}
				>
					{installing
						? "Updating…"
						: untested
							? "Update anyway"
							: "Update"}
				</button>
				<button
					className="obsidianaitools-agent-update-banner-dismiss"
					onClick={onDismiss}
					disabled={installing}
				>
					Dismiss
				</button>
			</div>
		</div>
	);
}
