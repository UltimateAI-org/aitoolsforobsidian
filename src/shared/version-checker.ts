import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { Platform, requestUrl } from "obsidian";
import { lt } from "semver";
import { getEnhancedWindowsEnv } from "./windows-env";
import { resolveCommandDirectory } from "./path-utils";

export interface VersionInfo {
	/** Installed version, when we can read it. Often null — npm metadata
	 *  goes missing in surprisingly common cases (partial installs, custom
	 *  prefixes). Treat null as "unknown", not "definitely not installed". */
	installed: string | null;
	/** Latest published version, from the npm registry. */
	latest: string | null;
	/** Whether the package binary appears to be on disk. The cheap, reliable
	 *  signal — uses path detection so it works even when version metadata
	 *  isn't readable. */
	isInstalled: boolean;
	/** True only when both versions are known and installed < latest.
	 *  Stays false when installed is unknown to avoid false "outdated"
	 *  reports. */
	isOutdated: boolean;
	/** True when the installed version is newer than the highest version
	 *  this plugin release was tested against. A newer agent may have
	 *  breaking protocol changes. Only set when installed version is known. */
	isAboveTestedVersion: boolean;
	/** The max tested version for this agent, or null if no range defined. */
	maxTestedVersion: string | null;
}

/**
 * Maps internal agent IDs to their npm package names.
 */
const NPM_PACKAGES: Record<string, string> = {
	"claude-code-acp": "@agentclientprotocol/claude-agent-acp",
	"codex-acp": "@zed-industries/codex-acp",
	"gemini-cli": "@google/gemini-cli",
};

/**
 * The highest agent package version explicitly tested with this plugin
 * release. Update this whenever a new agent version is verified working.
 * Leaving an agent out means no compatibility warning is shown for it.
 */
export const AGENT_MAX_TESTED_VERSIONS: Record<string, string> = {
	"claude-code-acp": "0.37.0",
	"gemini-cli": "0.43.0",
};

export function getNpmPackage(agentId: string): string | null {
	return NPM_PACKAGES[agentId] ?? null;
}

/**
 * Run a command and return trimmed stdout, or null on failure.
 * Used for capturing `node --version` / `npm --version` output. Mirrors the
 * spawn flow used elsewhere: login shell on macOS/Linux, cmd.exe on Windows,
 * with nodePath prepended to PATH if configured.
 */
function runForVersion(
	command: string,
	args: string[],
	nodePath: string,
): Promise<string | null> {
	return new Promise((resolve) => {
		let env: NodeJS.ProcessEnv = { ...process.env };
		const nodeDir = nodePath.trim()
			? (resolveCommandDirectory(nodePath.trim()) ?? "")
			: "";

		if (Platform.isWin) {
			env = getEnhancedWindowsEnv(env);
		}
		if (nodeDir) {
			const sep = Platform.isWin ? ";" : ":";
			env.PATH = `${nodeDir}${sep}${env.PATH ?? ""}`;
		}

		let spawnCommand: string;
		let spawnArgs: string[];
		if (Platform.isWin) {
			spawnCommand = process.env.ComSpec ?? "cmd.exe";
			spawnArgs = ["/c", `${command} ${args.join(" ")}`];
		} else {
			const shell = Platform.isMacOS ? "/bin/zsh" : "/bin/bash";
			const nvmSource = `[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"`;
			spawnCommand = shell;
			spawnArgs = ["-l", "-c", `${nvmSource}; ${command} ${args.join(" ")}`];
		}

		const child = spawn(spawnCommand, spawnArgs, {
			stdio: ["pipe", "pipe", "pipe"],
			env,
		});

		let stdout = "";
		child.stdout?.on("data", (data: unknown) => {
			stdout += typeof data === "string" ? data : String(data);
		});

		const timer = setTimeout(() => {
			child.kill();
			resolve(null);
		}, 3000);

		child.on("close", () => {
			clearTimeout(timer);
			const trimmed = stdout.trim();
			resolve(trimmed.length > 0 ? trimmed : null);
		});

		child.on("error", () => {
			clearTimeout(timer);
			resolve(null);
		});
	});
}

/** Return the active node binary's version (strips a leading "v"), or null. */
export async function getNodeVersion(nodePath: string): Promise<string | null> {
	const raw = await runForVersion("node", ["--version"], nodePath);
	return raw ? raw.replace(/^v/, "") : null;
}

/** Ask npm for its global modules root (e.g. `%APPDATA%/npm/node_modules`). */
export async function getNpmGlobalRoot(nodePath: string): Promise<string | null> {
	return runForVersion("npm", ["root", "-g"], nodePath);
}

/** Return the active npm binary's version, or null. */
export async function getNpmVersion(nodePath: string): Promise<string | null> {
	return runForVersion("npm", ["--version"], nodePath);
}

/**
 * Run `npm list -g --depth=0 --json` asynchronously and return raw stdout.
 * Uses a login shell so nvm/volta-managed node binaries are found.
 */
function runNpmListGlobal(nodePath: string): Promise<string> {
	return new Promise((resolve) => {
		let env: NodeJS.ProcessEnv = { ...process.env };
		const nodeDir = nodePath.trim()
			? (resolveCommandDirectory(nodePath.trim()) ?? "")
			: "";

		if (Platform.isWin) {
			env = getEnhancedWindowsEnv(env);
		}
		if (nodeDir) {
			const sep = Platform.isWin ? ";" : ":";
			env.PATH = `${nodeDir}${sep}${env.PATH ?? ""}`;
		}

		let command: string;
		let args: string[];

		if (Platform.isWin) {
			command = process.env.ComSpec ?? "cmd.exe";
			args = ["/c", "npm list -g --depth=0 --json"];
		} else {
			const shell = Platform.isMacOS ? "/bin/zsh" : "/bin/bash";
			const nvmSource = `[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"`;
			command = shell;
			args = ["-l", "-c", `${nvmSource}; npm list -g --depth=0 --json`];
		}

		const child = spawn(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env,
		});

		let stdout = "";
		child.stdout?.on("data", (data: unknown) => {
			stdout += typeof data === "string" ? data : String(data);
		});

		const timer = setTimeout(() => {
			child.kill();
			resolve("");
		}, 5000);

		child.on("close", () => {
			clearTimeout(timer);
			resolve(stdout);
		});

		child.on("error", () => {
			clearTimeout(timer);
			resolve("");
		});
	});
}

/**
 * Try to read an installed package version directly from its package.json,
 * derived from the user's configured command path. Works for the common
 * npm-prefix layouts:
 *   - Windows: <prefix>/<bin>.cmd → <prefix>/node_modules/<pkg>/package.json
 *   - Unix:    <prefix>/bin/<bin> → <prefix>/lib/node_modules/<pkg>/package.json
 *   - Direct:  <prefix>/node_modules/<pkg>/<bin>.js → <pkg>/package.json
 * Returns null if the package.json can't be located.
 */
function tryReadVersion(pkgJsonPath: string): string | null {
	try {
		if (!existsSync(pkgJsonPath)) return null;
		const parsed = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
			version?: string;
		};
		return typeof parsed.version === "string" ? parsed.version : null;
	} catch {
		return null;
	}
}

/**
 * Walk up from a starting directory looking for the nearest package.json
 * whose `name` matches the expected package. Bounded to 6 levels to avoid
 * scanning the whole disk on malformed paths.
 */
function findPackageJsonUpwards(
	startDir: string,
	expectedName: string,
): string | null {
	let dir = startDir;
	for (let i = 0; i < 6; i++) {
		const candidate = join(dir, "package.json");
		if (existsSync(candidate)) {
			try {
				const parsed = JSON.parse(
					readFileSync(candidate, "utf-8"),
				) as { name?: string; version?: string };
				if (parsed.name === expectedName && parsed.version) {
					return parsed.version;
				}
			} catch {
				// keep walking
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/**
 * Parse a Windows npm bin shim (.cmd) to extract the actual JS entry point
 * it executes. The shim format always references the package via
 * `<...>\node_modules\<package>\<entry-point>`. Returns the absolute path
 * to that entry point, or null if it can't be parsed.
 */
function resolveEntryFromWindowsShim(cmdPath: string): string | null {
	try {
		const content = readFileSync(cmdPath, "utf-8");
		// Look for a quoted path containing `node_modules`. The dp0 variable
		// is set to the .cmd's own directory inside the shim, so we
		// substitute it with the actual parent dir.
		const match = content.match(/"([^"]*node_modules[^"]+)"/);
		if (!match) return null;
		const raw = match[1];
		const dp0 = dirname(cmdPath);
		// Substitute %~dp0 / %dp0% with the actual directory. The shim
		// usually has `%dp0%\node_modules\...`, sometimes `%~dp0\..\...`.
		return raw
			.replace(/%~?dp0%?\\?/gi, dp0 + "\\")
			.replace(/\\\\/g, "\\");
	} catch {
		return null;
	}
}

function getInstalledVersionFromCommandPath(
	commandPath: string,
	packageName: string,
): string | null {
	if (!commandPath || !commandPath.trim()) return null;
	const cmd = commandPath.trim();

	// 1. Standard layouts (Windows npm prefix, Unix /usr or /lib).
	const parent = dirname(cmd);
	const grandparent = dirname(parent);
	for (const p of [
		join(parent, "node_modules", packageName, "package.json"),
		join(grandparent, "lib", "node_modules", packageName, "package.json"),
		join(grandparent, "node_modules", packageName, "package.json"),
	]) {
		const v = tryReadVersion(p);
		if (v) return v;
	}

	// 2. Windows .cmd shim: parse it to find the actual entry path, then
	// walk up from there to find package.json with the matching name. This
	// works even when npm installed the package at a non-standard prefix.
	if (Platform.isWin && /\.cmd$/i.test(cmd)) {
		const entry = resolveEntryFromWindowsShim(cmd);
		if (entry) {
			const fromShim = findPackageJsonUpwards(dirname(entry), packageName);
			if (fromShim) return fromShim;
		}
	}

	return null;
}

/**
 * Build platform-specific candidate paths to `<npm-prefix>/.../<pkg>/package.json`.
 * Covers default npm install locations on Windows (APPDATA\npm), macOS
 * (Homebrew prefixes), Linux (system and user npm-global).
 */
function knownPackageJsonCandidates(packageName: string): string[] {
	if (Platform.isWin) {
		return [
			process.env.APPDATA &&
				join(
					process.env.APPDATA,
					"npm",
					"node_modules",
					packageName,
					"package.json",
				),
			process.env.ProgramFiles &&
				join(
					process.env.ProgramFiles,
					"nodejs",
					"node_modules",
					packageName,
					"package.json",
				),
		].filter((p): p is string => typeof p === "string");
	}
	const home = homedir();
	return [
		`/usr/local/lib/node_modules/${packageName}/package.json`,
		`/opt/homebrew/lib/node_modules/${packageName}/package.json`,
		`/usr/lib/node_modules/${packageName}/package.json`,
		`${home}/.npm-global/lib/node_modules/${packageName}/package.json`,
		`${home}/.nvm/versions/node/*/lib/node_modules/${packageName}/package.json`,
	];
}

/**
 * Return the globally installed version of a built-in agent, or null if not
 * found. Tries (in order):
 *   1. package.json next to the user's configured command path
 *   2. package.json next to an auto-detected binary path
 *   3. package.json at well-known npm-prefix locations
 *   4. `npm list -g --json`
 */
export async function getInstalledVersion(
	agentId: string,
	nodePath: string,
	commandPath?: string,
): Promise<string | null> {
	const packageName = NPM_PACKAGES[agentId];
	if (!packageName) return null;

	// 1. Configured command path → adjacent / shim-resolved package.json
	if (commandPath) {
		const v = getInstalledVersionFromCommandPath(commandPath, packageName);
		if (v) return v;
	}

	// 2. Auto-detect the binary, then same lookup.
	try {
		const { detectAgentPath } = await import("./path-detector");
		const detected = detectAgentPath(agentId);
		if (detected.path) {
			const v = getInstalledVersionFromCommandPath(
				detected.path,
				packageName,
			);
			if (v) return v;
		}
	} catch {
		// fall through
	}

	// 3. Hardcoded npm-prefix candidates.
	for (const candidate of knownPackageJsonCandidates(packageName)) {
		if (candidate.includes("*")) continue;
		const v = tryReadVersion(candidate);
		if (v) return v;
	}

	// 4. Ask npm directly for its global root.
	try {
		const npmRoot = await getNpmGlobalRoot(nodePath);
		if (npmRoot) {
			const v = tryReadVersion(
				join(npmRoot, packageName, "package.json"),
			);
			if (v) return v;
		}
	} catch {
		// fall through
	}

	// Fallback: ask npm.
	try {
		const stdout = await runNpmListGlobal(nodePath);
		if (!stdout) return null;

		// Find the first balanced JSON object in the output — npm may print
		// deprecation warnings or even other `{ ... }` text before the
		// actual result, so we can't rely on the first `{`.
		for (let i = 0; i < stdout.length; i++) {
			if (stdout[i] !== "{") continue;
			const candidate = stdout.slice(i);
			try {
				const parsed = JSON.parse(candidate) as {
					dependencies?: Record<string, { version?: string }>;
				};
				return parsed.dependencies?.[packageName]?.version ?? null;
			} catch {
				// Not the real JSON; keep scanning.
			}
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Fetch the latest published version of a built-in agent from the npm registry.
 */
export async function getLatestVersion(agentId: string): Promise<string | null> {
	const packageName = NPM_PACKAGES[agentId];
	if (!packageName) return null;

	try {
		// The npm registry accepts the literal @scope/name path (no extra encoding needed)
		const url = `https://registry.npmjs.org/${packageName}/latest`;
		const response = await requestUrl({
			url,
			method: "GET",
			headers: { Accept: "application/json" },
			throw: false,
		});
		if (response.status < 200 || response.status >= 300) return null;
		const data = response.json as { version?: string };
		return data.version ?? null;
	} catch {
		return null;
	}
}

/**
 * Cheap, reliable "is the binary on disk?" check. Used to decide whether to
 * show Install vs Update affordances, independent of whether we can read the
 * version metadata. Returns true if either the user-configured command path
 * exists, or the auto-detector finds the binary in PATH / known locations.
 */
async function isAgentInstalled(
	agentId: string,
	commandPath?: string,
): Promise<boolean> {
	if (commandPath && existsSync(commandPath)) return true;
	try {
		const { detectAgentPath } = await import("./path-detector");
		const detected = detectAgentPath(agentId);
		return !!detected.path;
	} catch {
		return false;
	}
}

/**
 * Check the installed vs latest version for a built-in agent.
 * Runs all probes in parallel. `commandPath` (when supplied) makes the
 * installed-version probe more accurate — see `getInstalledVersion`.
 */
export async function checkAgentVersion(
	agentId: string,
	nodePath: string,
	commandPath?: string,
): Promise<VersionInfo> {
	const [installed, latest, isInstalled] = await Promise.all([
		getInstalledVersion(agentId, nodePath, commandPath),
		getLatestVersion(agentId),
		isAgentInstalled(agentId, commandPath),
	]);

	let isOutdated = false;
	if (installed && latest) {
		try {
			isOutdated = lt(installed, latest);
		} catch {
			isOutdated = installed !== latest;
		}
	}

	const maxTestedVersion = AGENT_MAX_TESTED_VERSIONS[agentId] ?? null;
	let isAboveTestedVersion = false;
	if (installed && maxTestedVersion) {
		try {
			// gt() throws on invalid semver — fall back to string compare
			const { gt } = await import("semver");
			isAboveTestedVersion = gt(installed, maxTestedVersion);
		} catch {
			isAboveTestedVersion = installed !== maxTestedVersion;
		}
	}

	return { installed, latest, isInstalled, isOutdated, isAboveTestedVersion, maxTestedVersion };
}
