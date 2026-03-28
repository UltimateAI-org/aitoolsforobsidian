import { spawnSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Platform } from "obsidian";

/**
 * Result of a path detection attempt
 */
export interface PathDetectionResult {
	path: string | null;
	wasAutoDetected: boolean;
}

/**
 * WSL detection result
 */
export interface WslDetectionResult {
	isWsl: boolean;
	distribution: string | null;
}

/**
 * Result of sandbox environment detection
 */
export interface SandboxEnvironment {
	isSandboxed: boolean;
	type: "flatpak" | "snap" | null;
}

/**
 * Detect if Obsidian is running inside a Flatpak or Snap sandbox on Linux.
 * In these environments, npm and node from the host system are not accessible.
 */
export function detectSandboxEnvironment(): SandboxEnvironment {
	if (Platform.isMacOS || Platform.isWin) {
		return { isSandboxed: false, type: null };
	}

	if (process.env.FLATPAK_ID) {
		return { isSandboxed: true, type: "flatpak" };
	}

	if (process.env.SNAP || process.env.SNAP_NAME) {
		return { isSandboxed: true, type: "snap" };
	}

	return { isSandboxed: false, type: null };
}

/**
 * Detect if running in WSL and get the distribution name
 */
export function detectWsl(): WslDetectionResult {
	// Check if running on Windows
	if (!Platform.isWin) {
		return { isWsl: false, distribution: null };
	}

	// Check for WSL indicator in the kernel version
	try {
		const result = spawnSync("wsl.exe", ["--list", "--quiet"], {
			encoding: "utf-8",
			timeout: 5000,
		});

		if (result.status === 0 && result.stdout) {
			// Get the default distribution - clean null bytes from output
			const cleaned = result.stdout.replace(/\0/g, "");
			const lines = cleaned.trim().split(/\r?\n/);
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed && trimmed.length > 0) {
					return { isWsl: true, distribution: trimmed };
				}
			}
		}
	} catch {
		// WSL not available
	}

	// Alternative check: look for /mnt/c path which exists in WSL
	try {
		const result = spawnSync("test", ["-d", "/mnt/c"], {
			encoding: "utf-8",
			timeout: 1000,
		});
		if (result.status === 0) {
			return { isWsl: true, distribution: "Ubuntu" }; // Default
		}
	} catch {
		// Not WSL
	}

	return { isWsl: false, distribution: null };
}

/**
 * Common installation paths for Node.js and agents across platforms
 */
const COMMON_NODE_PATHS: Record<string, string[]> = {
	// macOS
	darwin: [
		"/usr/local/bin/node",
		"/usr/bin/node",
		"/opt/homebrew/bin/node",
	],
	// Linux
	linux: [
		"/usr/bin/node",
		"/usr/bin/nodejs",
		"/usr/local/bin/node",
		"/usr/local/bin/nodejs",
		"/snap/bin/node",
	],
	// Windows
	win32: [
		"C:\\Program Files\\nodejs\\node.exe",
		"C:\\Program Files (x86)\\nodejs\\node.exe",
	],
};

const COMMON_AGENT_PATHS: Record<string, string[]> = {
	// macOS/Linux
	darwin: [
		"/usr/local/bin/claude-agent-acp",
		"/usr/local/bin/claude-code-acp",
		"/usr/local/bin/codex-acp",
		"/usr/local/bin/gemini",
		"/opt/homebrew/bin/claude-agent-acp",
		"/opt/homebrew/bin/claude-code-acp",
	],
	linux: [
		"/usr/bin/claude-agent-acp",
		"/usr/bin/claude-code-acp",
		"/usr/bin/codex-acp",
		"/usr/bin/gemini",
		"/usr/local/bin/claude-agent-acp",
		"/usr/local/bin/claude-code-acp",
		"/usr/local/bin/codex-acp",
		"/usr/local/bin/gemini",
		`${homedir()}/.npm-global/bin/claude-agent-acp`,
		`${homedir()}/.npm-global/bin/claude-code-acp`,
		`${homedir()}/.npm-global/bin/codex-acp`,
		`${homedir()}/.npm-global/bin/gemini`,
	],
	// Windows — use process.env.APPDATA for the actual user path
	win32: [
		...(process.env.APPDATA ? [
			join(process.env.APPDATA, "npm", "claude-agent-acp.cmd"),
			join(process.env.APPDATA, "npm", "claude-code-acp.cmd"),
			join(process.env.APPDATA, "npm", "codex-acp.cmd"),
			join(process.env.APPDATA, "npm", "gemini.cmd"),
		] : []),
	],
};

/**
 * Auto-detect Node.js installation path
 */
export function detectNodePath(): PathDetectionResult {
	// Try using which/where command first
	const command = Platform.isWin ? "where.exe" : "which";
	// On Debian/Ubuntu/Mint the binary may be "nodejs" instead of "node"
	const namesToTry = Platform.isWin ? ["node.exe"] : ["node", "nodejs"];

	for (const name of namesToTry) {
		try {
			const result = spawnSync(command, [name], {
				encoding: "utf-8",
				timeout: 5000,
			});

			if (result.status === 0 && result.stdout) {
				const lines = result.stdout.trim().split(/\r?\n/);
				for (const line of lines) {
					const trimmed = line.trim();
					if (trimmed && trimmed.length > 0) {
						return { path: trimmed, wasAutoDetected: true };
					}
				}
			}
		} catch {
			// Try next name
		}
	}

	// Try common installation paths
	const platform = Platform.isWin ? "win32" : Platform.isMacOS ? "darwin" : "linux";
	const commonPaths = COMMON_NODE_PATHS[platform] || [];

	for (const path of commonPaths) {
		if (pathExists(path)) {
			return { path, wasAutoDetected: true };
		}
	}

	// Try nvm — GUI apps don't inherit shell PATH so nvm node is invisible to `which`
	if (!Platform.isWin) {
		const nvmDir = process.env.NVM_DIR || join(homedir(), ".nvm");
		const nvmVersionsDir = join(nvmDir, "versions", "node");
		try {
			if (existsSync(nvmVersionsDir)) {
				// Check nvm default alias first
				const defaultAliasPath = join(nvmDir, "alias", "default");
				let defaultVersion: string | null = null;
				try {
					const { readFileSync } = require("fs") as typeof import("fs");
					defaultVersion = readFileSync(defaultAliasPath, "utf-8").trim();
				} catch {
					// No default alias
				}

				const versions = readdirSync(nvmVersionsDir).filter(v => v.startsWith("v"));
				// Prefer default alias version, otherwise pick latest
				const sorted = versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
				const preferred = defaultVersion
					? sorted.find(v => v === defaultVersion || v.startsWith(defaultVersion!.replace(/^\^/, "")))
					: null;
				const candidates = preferred ? [preferred, ...sorted.filter(v => v !== preferred)] : sorted;

				for (const version of candidates) {
					const nodePath = join(nvmVersionsDir, version, "bin", "node");
					if (existsSync(nodePath)) {
						return { path: nodePath, wasAutoDetected: true };
					}
				}
			}
		} catch {
			// nvm not available
		}
	}

	return { path: null, wasAutoDetected: false };
}

/**
 * Auto-detect agent installation path
 */
export function detectAgentPath(agentId: string): PathDetectionResult {
	const command = Platform.isWin ? "where.exe" : "which";
	let executableName: string;

	switch (agentId) {
		case "claude-code-acp":
			executableName = Platform.isWin ? "claude-agent-acp.cmd" : "claude-agent-acp";
			break;
		case "codex-acp":
			executableName = Platform.isWin ? "codex-acp.cmd" : "codex-acp";
			break;
		case "gemini-cli":
			executableName = Platform.isWin ? "gemini.cmd" : "gemini";
			break;
		default:
			// Custom agent - can't auto-detect
			return { path: null, wasAutoDetected: false };
	}

	// Try primary executable name, then legacy fallback for claude-code-acp → claude-agent-acp rename
	const namesToTry = [executableName];
	if (agentId === "claude-code-acp") {
		const legacyName = Platform.isWin ? "claude-code-acp.cmd" : "claude-code-acp";
		namesToTry.push(legacyName);
	}

	for (const name of namesToTry) {
		try {
			const result = spawnSync(command, [name], {
				encoding: "utf-8",
				timeout: 5000,
			});

			if (result.status === 0 && result.stdout) {
				const lines = result.stdout.trim().split(/\r?\n/);
				for (const line of lines) {
					const trimmed = line.trim();
					if (trimmed && trimmed.length > 0) {
						return { path: trimmed, wasAutoDetected: true };
					}
				}
			}
		} catch {
			// Continue to next name or fallback paths
		}
	}

	// Try common installation paths
	const platform = Platform.isWin ? "win32" : Platform.isMacOS ? "darwin" : "linux";
	const commonPaths = COMMON_AGENT_PATHS[platform] || [];

	for (const path of commonPaths) {
		if (pathIncludesAgent(path, agentId) && pathExists(path)) {
			return { path, wasAutoDetected: true };
		}
	}

	return { path: null, wasAutoDetected: false };
}

/**
 * Check if a file exists at the given path
 */
function pathExists(filePath: string): boolean {
	try {
		return existsSync(filePath);
	} catch {
		return false;
	}
}

/**
 * Check if a path includes the agent identifier
 */
function pathIncludesAgent(path: string, agentId: string): boolean {
	const pathLower = path.toLowerCase();
	switch (agentId) {
		case "claude-code-acp":
			return pathLower.includes("claude");
		case "codex-acp":
			return pathLower.includes("codex");
		case "gemini-cli":
			return pathLower.includes("gemini");
		default:
			return false;
	}
}

/**
 * Validate if a path is executable/valid
 */
export function validatePath(path: string): { valid: boolean; error?: string } {
	if (!path || path.trim().length === 0) {
		return { valid: false, error: "Path is empty" };
	}

	const trimmedPath = path.trim();

	// Check if file exists
	if (!pathExists(trimmedPath)) {
		return { valid: false, error: `File not found: ${trimmedPath}` };
	}

	// On Windows, also check .cmd/.exe variations
	if (Platform.isWin) {
		const basePath = trimmedPath.replace(/\.(cmd|exe)$/i, "");
		const extensions = [".cmd", ".exe", ""];
		const found = extensions.some((ext) => pathExists(basePath + ext));
		if (!found) {
			return { valid: false, error: `Executable not found at: ${trimmedPath}` };
		}
	}

	return { valid: true };
}

/**
 * Get installation instructions for an agent
 */
export function getAgentInstallInstructions(agentId: string): string {
	switch (agentId) {
		case "claude-code-acp":
			return "npm install -g @agentclientprotocol/claude-agent-acp";
		case "codex-acp":
			return "npm install -g @zed-industries/codex-acp";
		case "gemini-cli":
			return "npm install -g @google/gemini-cli";
		default:
			return "Install your custom ACP-compatible agent";
	}
}
