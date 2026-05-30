import { spawn, ChildProcess } from "child_process";
import { Notice, Platform } from "obsidian";
import { getEnhancedWindowsEnv } from "./windows-env";
import { resolveCommandDirectory } from "./path-utils";
import type AgentClientPlugin from "../plugin";

/**
 * Agent installer for ACP-compatible agents.
 * Handles automatic installation of agents like Claude Code, Gemini CLI, etc.
 */

export interface InstallResult {
	success: boolean;
	output: string;
	error?: string;
}

/**
 * Get the npm install command for a specific agent
 */
export function getAgentInstallCommand(agentId: string): string {
	switch (agentId) {
		case "claude-code-acp":
			return "npm install -g @agentclientprotocol/claude-agent-acp";
		case "codex-acp":
			return "npm install -g @zed-industries/codex-acp";
		case "gemini-cli":
			return "npm install -g @google/gemini-cli";
		default:
			return "";
	}
}

/**
 * Get the display name for an agent
 */
export function getAgentDisplayName(agentId: string): string {
	switch (agentId) {
		case "claude-code-acp":
			return "Claude Agent";
		case "codex-acp":
			return "Codex";
		case "gemini-cli":
			return "Gemini CLI";
		default:
			return agentId;
	}
}

/**
 * Install an agent using npm
 */
export function installAgent(
	agentId: string,
	nodePath: string,
	onOutput?: (data: string) => void,
	version?: string | null,
): ChildProcess | null {
	const installCommand = getAgentInstallCommand(agentId);

	if (!installCommand) {
		return null;
	}

	// Use the node path from settings to derive node directory
	const nodeDir = nodePath.trim() ? resolveCommandDirectory(nodePath.trim()) || "" : "";
	// We add nodeDir to PATH later, so we can just use "npm" and let the shell resolve it.
	// This avoids issues with spaces in paths (e.g. "Program Files") and file extensions (.cmd).
	const npmExec = "npm";

	// Build command based on platform
	let command: string;
	let args: string[];

	// Use `--force` to handle several scenarios:
	//   - upgrades from older versions / package renames where the old
	//     install lingers
	//   - broken installs where npm has the package registered but with
	//     missing/corrupt metadata (a plain `install` may leave it broken)
	//   - rollbacks to a pinned older version (npm overwrites the newer tree)
	// --force tells npm to overwrite the existing tree. When `version` is
	// omitted we target `@latest`; otherwise we pin the exact version.
	const tag = version && version.trim() ? version.trim() : "latest";
	const pkg = `${getAgentNpmPackage(agentId)}@${tag}`;
	if (Platform.isWin) {
		// On Windows, use cmd.exe with /c (use ComSpec for reliability)
		command = process.env.ComSpec || "cmd.exe";
		args = ["/c", `${npmExec} install -g ${pkg} --force`];
	} else {
		// On macOS/Linux, use login shell to get proper PATH.
		// Also source nvm.sh so GUI apps can find node/npm installed via nvm.
		const shell = Platform.isMacOS ? "/bin/zsh" : "/bin/bash";
		command = shell;
		const nvmSource = `[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"`;
		args = [
			"-l",
			"-c",
			`${nvmSource}; ${npmExec} install -g ${pkg} --force`,
		];
	}

	// Enhance environment on Windows to include full system PATH
	let env = { ...process.env };
	if (Platform.isWin) {
		env = getEnhancedWindowsEnv(env);
	}

	// Add nodeDir to PATH if specified
	if (nodeDir) {
		const separator = Platform.isWin ? ";" : ":";
		env.PATH = `${nodeDir}${separator}${env.PATH || ""}`;
	}

	const childProcess = spawn(command, args, {
		stdio: ["pipe", "pipe", "pipe"],
		env,
	});

	childProcess.on("error", (error) => {
		onOutput?.(`Installation process error: ${error.message}\n`);
	});

	childProcess.stdout?.on("data", (data: unknown) => {
		const text = typeof data === "string" ? data : String(data);
		onOutput?.(text);
	});

	childProcess.stderr?.on("data", (data: unknown) => {
		const text = typeof data === "string" ? data : String(data);
		onOutput?.(text);
	});

	return childProcess;
}

/**
 * Get the npm package name for an agent
 */
function getAgentNpmPackage(agentId: string): string {
	switch (agentId) {
		case "claude-code-acp":
			return "@agentclientprotocol/claude-agent-acp";
		case "codex-acp":
			return "@zed-industries/codex-acp";
		case "gemini-cli":
			return "@google/gemini-cli";
		default:
			return agentId;
	}
}

/**
 * Check if an agent is a known npm-based agent
 */
export function isKnownAgent(agentId: string): boolean {
	return ["claude-code-acp", "codex-acp", "gemini-cli"].includes(agentId);
}

/**
 * Check if an agent is already installed globally
 */
export async function isAgentInstalled(agentId: string): Promise<boolean> {
	// Use dynamic import to avoid circular dependency
	const { detectAgentPath } = await import("./path-detector");
	const result = detectAgentPath(agentId);
	return result.path !== null;
}

/**
 * Show a persistent Notice telling the user a newly installed/rolled-back
 * agent binary won't be used until Obsidian re-spawns the agent, with a
 * one-click "Restart Now". Shared by the update and rollback flows so the
 * post-install UX stays identical.
 */
export function showAgentRestartNotice(
	plugin: AgentClientPlugin,
	titleText: string,
	bodyText = "Restart Obsidian to activate the new version.",
): void {
	const notice = new Notice("", 0);
	const el = notice.noticeEl;
	el.createEl("p", { text: titleText, cls: "obsidianaitools-upgrade-title" });
	el.createEl("p", { text: bodyText, cls: "obsidianaitools-upgrade-body" });
	const btnRow = el.createDiv({ cls: "obsidianaitools-upgrade-buttons" });
	const restartBtn = btnRow.createEl("button", {
		text: "Restart Now",
		cls: "mod-cta obsidianaitools-upgrade-btn-restart",
	});
	restartBtn.addEventListener("click", () => {
		notice.hide();
		try {
			(
				plugin.app as unknown as {
					commands: { executeCommandById: (id: string) => void };
				}
			).commands.executeCommandById("app:reload");
		} catch {
			window.location.reload();
		}
	});
	const laterBtn = btnRow.createEl("button", {
		text: "Later",
		cls: "obsidianaitools-upgrade-btn-later",
	});
	laterBtn.addEventListener("click", () => notice.hide());
}
