import { spawn, ChildProcess } from "child_process";
import { Platform } from "obsidian";
import { getEnhancedWindowsEnv } from "./windows-env";
import { resolveCommandDirectory } from "./path-utils";

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
			return "npm install -g @zed-industries/claude-code-acp";
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
			return "Claude Code";
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

	if (Platform.isWin) {
		// On Windows, use cmd.exe with /c (use ComSpec for reliability)
		command = process.env.ComSpec || "cmd.exe";
		args = ["/c", `${npmExec} install -g ${getAgentNpmPackage(agentId)}`];
	} else {
		// On macOS/Linux, use login shell to get proper PATH
		const shell = Platform.isMacOS ? "/bin/zsh" : "/bin/bash";
		command = shell;
		args = [
			"-l",
			"-c",
			`${npmExec} install -g ${getAgentNpmPackage(agentId)}`,
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
			return "@zed-industries/claude-code-acp";
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
export function isAgentInstalled(agentId: string): boolean {
	// Import detectAgentPath inline to avoid circular dependency
	const { detectAgentPath } = require("./path-detector");
	const result = detectAgentPath(agentId);
	return result.path !== null;
}
