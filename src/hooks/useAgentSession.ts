import { useState, useCallback, useEffect } from "react";
import type {
	ChatSession,
	SessionState,
	SessionModeState,
	SessionModelState,
	SlashCommand,
	AuthenticationMethod,
} from "../domain/models/chat-session";
import type { IAgentClient } from "../domain/ports/agent-client.port";
import type { ISettingsAccess } from "../domain/ports/settings-access.port";
import type { AgentClientPluginSettings } from "../plugin";
import type {
	BaseAgentSettings,
} from "../domain/models/agent-config";
import type { AgentError } from "../domain/models/agent-error";
import { toAgentConfig } from "../shared/settings-utils";
import {
	getAgentInstallCommand,
} from "../shared/agent-installer";
import { detectNodePath, detectWsl } from "../shared/path-detector";
import { mapToApiUrl } from "../shared/url-mapper";
import { spawn } from "child_process";

// ============================================================================
// Auto-Install Helpers
// ============================================================================

interface InstallResult {
	success: boolean;
	command: string;
}

/**
 * Get the command name for a known agent
 */
function getCommandNameForAgent(agentId: string): string | null {
	switch (agentId) {
		case "claude-code-acp":
			return "claude-code-acp";
		case "codex-acp":
			return "codex-acp";
		case "gemini-cli":
			return "gemini";
		default:
			return null;
	}
}

/**
 * Auto-install an agent if command is not configured
 * Returns object with success status and the command to use
 */
async function autoInstallAgent(
	agentId: string,
	nodePath: string,
	wslMode: boolean,
	wslDistribution: string | undefined,
): Promise<InstallResult> {
	const installCommand = getAgentInstallCommand(agentId);
	if (!installCommand) {
		return { success: false, command: "" };
	}

	const packageName = installCommand.replace("npm install -g ", "");
	const commandName = getCommandNameForAgent(agentId);
	if (!commandName) {
		return { success: false, command: "" };
	}

	// Auto-detect Node.js path if not configured
	let resolvedNodePath = nodePath;
	if (!resolvedNodePath.trim()) {
		const detected = detectNodePath();
		if (detected?.path) {
			resolvedNodePath = detected.path;
		}
	}

	// Auto-detect WSL if on Windows
	let shouldUseWsl = wslMode;
	let wslDist: string | undefined = wslDistribution;

	if (!shouldUseWsl && process.platform === "win32") {
		const wslInfo = detectWsl();
		if (wslInfo.isWsl && wslInfo.distribution) {
			shouldUseWsl = true;
			wslDist = wslInfo.distribution;
			console.warn(`[AutoInstall] Auto-detected WSL distribution: ${wslDist}`);
		}
	}

	// Derive npm path from node path (only for non-WSL)
	const nodeDir = !shouldUseWsl && resolvedNodePath.trim()
		? resolvedNodePath.trim().replace(/\/node$/, "")
		: "";
	const npmExec = nodeDir ? `${nodeDir}/npm` : "npm";

	// Build installation command
	const installArgs = `${npmExec} install -g ${packageName}`;

	// Determine spawn command based on platform
	let command: string;
	let args: string[];

	if (shouldUseWsl && wslDist) {
		// Use WSL
		command = "wsl";
		args = ["--distribution", wslDist, "-e", "bash", "-l", "-c", installArgs];
		console.warn(`[AutoInstall] Using WSL for installation`);
	} else if (process.platform === "win32") {
		// Windows without WSL
		command = "cmd.exe";
		args = ["/c", installArgs];
	} else {
		// Linux/macOS
		command = "/bin/bash";
		args = ["-l", "-c", installArgs];
	}

	console.warn(`[AutoInstall] Installing ${agentId} with: ${installArgs}`);

	return new Promise((resolve) => {
		const child = spawn(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				...(nodeDir && !shouldUseWsl
					? { PATH: `${nodeDir}:${process.env.PATH || ""}` }
					: {}),
			},
		});

		let output = "";
		let hasTimeout = false;

		// Timeout after 2 minutes
		const timeout = setTimeout(() => {
			hasTimeout = true;
			console.error(`[AutoInstall] Installation timed out after 2 minutes`);
			child.kill("SIGTERM");
			resolve({ success: false, command: "" });
		}, 120000);

		child.stdout?.on("data", (data: unknown) => {
			const text = typeof data === "string" ? data : String(data);
			output += text;
			console.warn(`[AutoInstall] npm stdout: ${text.substring(0, 200)}`);
		});

		child.stderr?.on("data", (data: unknown) => {
			const text = typeof data === "string" ? data : String(data);
			output += text;
			console.warn(`[AutoInstall] npm stderr: ${text.substring(0, 200)}`);
		});

		child.on("close", (code: number) => {
			clearTimeout(timeout);
			if (hasTimeout) return;

			if (code === 0) {
				console.warn(`[AutoInstall] Successfully installed ${agentId}`);
				resolve({ success: true, command: commandName });
			} else {
				console.error(`[AutoInstall] Failed to install ${agentId} (exit code: ${code}): ${output}`);
				resolve({ success: false, command: "" });
			}
		});

		child.on("error", (error) => {
			clearTimeout(timeout);
			if (hasTimeout) return;
			console.error(`[AutoInstall] Error installing ${agentId}:`, error);
			resolve({ success: false, command: "" });
		});
	});
}

// ============================================================================
// Types
// ============================================================================

/**
 * Agent information for display.
 * (Inlined from SwitchAgentUseCase)
 */
export interface AgentInfo {
	/** Unique agent ID */
	id: string;
	/** Display name for UI */
	displayName: string;
}

/**
 * Error information specific to session operations.
 */
export interface SessionErrorInfo {
	title: string;
	message: string;
	suggestion?: string;
	canAutoInstall?: boolean;
	agentId?: string;
}

/**
 * Return type for useAgentSession hook.
 */
export interface UseAgentSessionReturn {
	/** Current session state */
	session: ChatSession;
	/** Whether the session is ready for user input */
	isReady: boolean;
	/** Error information if session operation failed */
	errorInfo: SessionErrorInfo | null;

	/**
	 * Create a new session with the current active agent.
	 * Resets session state and initializes connection.
	 */
	createSession: () => Promise<void>;

	/**
	 * Load a previous session by ID.
	 * Restores conversation context via session/load.
	 *
	 * Note: Conversation history is received via session/update notifications
	 * (user_message_chunk, agent_message_chunk, etc.), not returned from this function.
	 *
	 * @param sessionId - ID of the session to load
	 */
	loadSession: (sessionId: string) => Promise<void>;

	/**
	 * Restart the current session.
	 * Alias for createSession (closes current and creates new).
	 */
	restartSession: () => Promise<void>;

	/**
	 * Close the current session and disconnect from agent.
	 * Cancels any running operation and kills the agent process.
	 */
	closeSession: () => Promise<void>;

	/**
	 * Cancel the current agent operation.
	 * Stops ongoing message generation without disconnecting.
	 */
	cancelOperation: () => Promise<void>;

	/**
	 * Switch to a different agent.
	 * Updates the active agent ID in session state.
	 * @param agentId - ID of the agent to switch to
	 */
	switchAgent: (agentId: string) => Promise<void>;

	/**
	 * Get list of available agents.
	 * @returns Array of agent info with id and displayName
	 */
	getAvailableAgents: () => AgentInfo[];

	/**
	 * Update session state after loading/resuming/forking a session.
	 * Called by useSessionHistory after a successful session operation.
	 * @param sessionId - New session ID
	 * @param modes - Session modes (optional)
	 * @param models - Session models (optional)
	 */
	updateSessionFromLoad: (
		sessionId: string,
		modes?: SessionModeState,
		models?: SessionModelState,
	) => void;

	/**
	 * Callback to update available slash commands.
	 * Called by AcpAdapter when agent sends available_commands_update.
	 */
	updateAvailableCommands: (commands: SlashCommand[]) => void;

	/**
	 * Callback to update current mode.
	 * Called by AcpAdapter when agent sends current_mode_update.
	 */
	updateCurrentMode: (modeId: string) => void;

	/**
	 * Set the session mode.
	 * Sends a request to the agent to change the mode.
	 * @param modeId - ID of the mode to set
	 */
	setMode: (modeId: string) => Promise<void>;

	/**
	 * Set the session model (experimental).
	 * Sends a request to the agent to change the model.
	 * @param modelId - ID of the model to set
	 */
	setModel: (modelId: string) => Promise<void>;
}

// ============================================================================
// Helper Functions (Inlined from SwitchAgentUseCase)
// ============================================================================

/**
 * Get the currently active agent ID from settings.
 */
function getActiveAgentId(settings: AgentClientPluginSettings): string {
	return settings.activeAgentId || settings.claude.id;
}

/**
 * Get list of all available agents from settings.
 */
function getAvailableAgentsFromSettings(
	settings: AgentClientPluginSettings,
): AgentInfo[] {
	return [
		{
			id: settings.claude.id,
			displayName: settings.claude.displayName || settings.claude.id,
		},
		{
			id: settings.codex.id,
			displayName: settings.codex.displayName || settings.codex.id,
		},
		{
			id: settings.gemini.id,
			displayName: settings.gemini.displayName || settings.gemini.id,
		},
		...settings.customAgents.map((agent) => ({
			id: agent.id,
			displayName: agent.displayName || agent.id,
		})),
	];
}

/**
 * Get the currently active agent information from settings.
 */
function getCurrentAgent(settings: AgentClientPluginSettings): AgentInfo {
	const activeId = getActiveAgentId(settings);
	const agents = getAvailableAgentsFromSettings(settings);
	return (
		agents.find((agent) => agent.id === activeId) || {
			id: activeId,
			displayName: activeId,
		}
	);
}

// ============================================================================
// Helper Functions (Inlined from ManageSessionUseCase)
// ============================================================================

/**
 * Find agent settings by ID from plugin settings.
 */
function findAgentSettings(
	settings: AgentClientPluginSettings,
	agentId: string,
): BaseAgentSettings | null {
	if (agentId === settings.claude.id) {
		return settings.claude;
	}
	if (agentId === settings.codex.id) {
		return settings.codex;
	}
	if (agentId === settings.gemini.id) {
		return settings.gemini;
	}
	// Search in custom agents
	const customAgent = settings.customAgents.find(
		(agent) => agent.id === agentId,
	);
	return customAgent || null;
}

/**
 * Build AgentConfig with API key injection for known agents.
 * Uses global API key, base URL, and model for all agents.
 */
function buildAgentConfigWithApiKey(
	settings: AgentClientPluginSettings,
	agentSettings: BaseAgentSettings,
	agentId: string,
	workingDirectory: string,
) {
	const baseConfig = toAgentConfig(agentSettings, workingDirectory);
	const env: Record<string, string> = {
		...baseConfig.env,
	};

	// Use global API key for all agents
	if (settings.apiKey) {
		// Claude: use ANTHROPIC_AUTH_TOKEN (not ANTHROPIC_API_KEY)
		if (agentId === settings.claude.id) {
			env.ANTHROPIC_AUTH_TOKEN = settings.apiKey;
			if (settings.baseUrl) {
				// Map display URL (obsidianaitools.com) to actual API URL (ultimateai.org)
				env.ANTHROPIC_BASE_URL = mapToApiUrl(settings.baseUrl);
			}
		}
		// Gemini: use GEMINI_API_KEY
		if (agentId === settings.gemini.id) {
			env.GEMINI_API_KEY = settings.apiKey;
			if (settings.baseUrl) {
				// Map display URL (obsidianaitools.com) to actual API URL (ultimateai.org)
				env.GOOGLE_GEMINI_BASE_URL = mapToApiUrl(settings.baseUrl);
			}
			if (settings.model) {
				env.GEMINI_MODEL = settings.model;
			}
		}
		// Codex: use OPENAI_API_KEY
		if (agentId === settings.codex.id) {
			env.OPENAI_API_KEY = settings.apiKey;
			if (settings.baseUrl) {
				// Map display URL (obsidianaitools.com) to actual API URL (ultimateai.org)
				env.OPENAI_BASE_URL = mapToApiUrl(settings.baseUrl);
			}
			if (settings.model) {
				env.OPENAI_MODEL = settings.model;
			}
		}
	}

	return {
		...baseConfig,
		env,
	};
}

// ============================================================================
// Initial State
// ============================================================================

/**
 * Create initial session state.
 */
function createInitialSession(
	agentId: string,
	agentDisplayName: string,
	workingDirectory: string,
): ChatSession {
	return {
		sessionId: null,
		state: "disconnected" as SessionState,
		agentId,
		agentDisplayName,
		authMethods: [],
		availableCommands: undefined,
		modes: undefined,
		models: undefined,
		createdAt: new Date(),
		lastActivityAt: new Date(),
		workingDirectory,
	};
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing agent session lifecycle.
 *
 * Handles session creation, restart, cancellation, and agent switching.
 * This hook owns the session state independently.
 *
 * @param agentClient - Agent client for communication
 * @param settingsAccess - Settings access for agent configuration
 * @param workingDirectory - Working directory for the session
 */
export function useAgentSession(
	agentClient: IAgentClient,
	settingsAccess: ISettingsAccess,
	workingDirectory: string,
): UseAgentSessionReturn {
	// Get initial agent info from settings
	const initialSettings = settingsAccess.getSnapshot();
	const initialAgentId = getActiveAgentId(initialSettings);
	const initialAgent = getCurrentAgent(initialSettings);

	// Session state
	const [session, setSession] = useState<ChatSession>(() =>
		createInitialSession(
			initialAgentId,
			initialAgent.displayName,
			workingDirectory,
		),
	);

	// Error state
	const [errorInfo, setErrorInfo] = useState<SessionErrorInfo | null>(null);

	// Register error callback immediately (not in useEffect) to catch errors during initial createSession
	useEffect(() => {
		const handleError = (error: AgentError) => {
			setSession((prev) => ({ ...prev, state: "error" }));
			setErrorInfo({
				title: error.title || "Agent Error",
				message: error.message || "An error occurred",
				suggestion: error.suggestion,
				canAutoInstall: error.canAutoInstall,
				agentId: error.agentId,
			});
		};
		agentClient.onError(handleError);
		return () => {
			// Cleanup not needed as adapter manages single callback
		};
	}, [agentClient]);

	// Derived state
	const isReady = session.state === "ready";

	/**
	 * Create a new session with the active agent.
	 * (Inlined from ManageSessionUseCase.createSession)
	 */
	const createSession = useCallback(async () => {
		// Get current settings and agent info
		const settings = settingsAccess.getSnapshot();
		const activeAgentId = getActiveAgentId(settings);
		const currentAgent = getCurrentAgent(settings);

		// Reset to initializing state immediately
		setSession((prev) => ({
			...prev,
			sessionId: null,
			state: "initializing",
			agentId: activeAgentId,
			agentDisplayName: currentAgent.displayName,
			authMethods: [],
			availableCommands: undefined,
			modes: undefined,
			models: undefined,
			// Keep capabilities/info from previous session if same agent
			// They will be updated if re-initialization is needed
			promptCapabilities: prev.promptCapabilities,
			agentCapabilities: prev.agentCapabilities,
			agentInfo: prev.agentInfo,
			createdAt: new Date(),
			lastActivityAt: new Date(),
		}));
		setErrorInfo(null);

		try {
			// Find agent settings
			const agentSettings = findAgentSettings(settings, activeAgentId);

			if (!agentSettings) {
				setSession((prev) => ({ ...prev, state: "error" }));
				setErrorInfo({
					title: "Agent Not Found",
					message: `Agent with ID "${activeAgentId}" not found in settings`,
					suggestion:
						"Please check your agent configuration in settings.",
				});
				return;
			}

			// Auto-install known agents if command is not configured (do this FIRST)
			if (
				settings.autoInstallAgents &&
				(!agentSettings.command || agentSettings.command.trim().length === 0)
			) {
				// Auto-detect Node.js path if not configured
				if (!settings.nodePath.trim()) {
					const detected = detectNodePath();
					if (detected?.path) {
						settings.nodePath = detected.path;
					}
				}

				const result = await autoInstallAgent(
					activeAgentId,
					settings.nodePath,
					settings.windowsWslMode,
					settings.windowsWslDistribution,
				);
				if (result.success) {
					// Update settings with command path
					if (activeAgentId === settings.claude.id) {
						settings.claude.command = result.command;
					} else if (activeAgentId === settings.codex.id) {
						settings.codex.command = result.command;
					} else if (activeAgentId === settings.gemini.id) {
						settings.gemini.command = result.command;
					}
					// Update the local agentSettings reference
					agentSettings.command = result.command;
				}
			}

			// Build AgentConfig with API key injection (AFTER auto-install)
			const agentConfig = buildAgentConfigWithApiKey(
				settings,
				agentSettings,
				activeAgentId,
				workingDirectory,
			);

			// Check if initialization is needed
			// Only initialize if agent is not initialized OR agent ID has changed
			const needsInitialize =
				!agentClient.isInitialized() ||
				agentClient.getCurrentAgentId() !== activeAgentId;

			let authMethods: AuthenticationMethod[] = [];
			let promptCapabilities:
				| {
						image?: boolean;
						audio?: boolean;
						embeddedContext?: boolean;
				  }
				| undefined;
			let agentCapabilities:
				| {
						loadSession?: boolean;
						mcpCapabilities?: {
							http?: boolean;
							sse?: boolean;
						};
						promptCapabilities?: {
							image?: boolean;
							audio?: boolean;
							embeddedContext?: boolean;
						};
				  }
				| undefined;
			let agentInfo:
				| {
						name: string;
						title?: string;
						version?: string;
				  }
				| undefined;

			if (needsInitialize) {
				// Initialize connection to agent (spawn process + protocol handshake)
				const initResult = await agentClient.initialize(agentConfig);
				authMethods = initResult.authMethods;
				promptCapabilities = initResult.promptCapabilities;
				agentCapabilities = initResult.agentCapabilities;
				agentInfo = initResult.agentInfo;
			}

			// Create new session (lightweight operation)
			const sessionResult =
				await agentClient.newSession(workingDirectory);

			// Success - update to ready state
			setSession((prev) => ({
				...prev,
				sessionId: sessionResult.sessionId,
				state: "ready",
				authMethods: authMethods,
				modes: sessionResult.modes,
				models: sessionResult.models,
				// Only update capabilities/info if we re-initialized
				// Otherwise, keep the previous value (from the same agent)
				promptCapabilities: needsInitialize
					? promptCapabilities
					: prev.promptCapabilities,
				agentCapabilities: needsInitialize
					? agentCapabilities
					: prev.agentCapabilities,
				agentInfo: needsInitialize ? agentInfo : prev.agentInfo,
				lastActivityAt: new Date(),
			}));
		} catch (error) {
			// Error - update to error state
			setSession((prev) => ({ ...prev, state: "error" }));
			setErrorInfo({
				title: "Session Creation Failed",
				message: `Failed to create new session: ${error instanceof Error ? error.message : String(error)}`,
				suggestion:
					"Please check the agent configuration and try again.",
			});
		}
	}, [agentClient, settingsAccess, workingDirectory]);

	/**
	 * Load a previous session by ID.
	 * Restores conversation history and creates a new session for future prompts.
	 *
	 * Note: Conversation history is received via session/update notifications
	 * (user_message_chunk, agent_message_chunk, etc.), not returned from this function.
	 *
	 * @param sessionId - ID of the session to load
	 */
	const loadSession = useCallback(
		async (sessionId: string) => {
			// Get current settings and agent info
			const settings = settingsAccess.getSnapshot();
			const activeAgentId = getActiveAgentId(settings);
			const currentAgent = getCurrentAgent(settings);

			// Reset to initializing state immediately
			setSession((prev) => ({
				...prev,
				sessionId: null,
				state: "initializing",
				agentId: activeAgentId,
				agentDisplayName: currentAgent.displayName,
				authMethods: [],
				availableCommands: undefined,
				modes: undefined,
				models: undefined,
				promptCapabilities: prev.promptCapabilities,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			}));
			setErrorInfo(null);

			try {
				// Find agent settings
				const agentSettings = findAgentSettings(
					settings,
					activeAgentId,
				);

				if (!agentSettings) {
					setSession((prev) => ({ ...prev, state: "error" }));
					setErrorInfo({
						title: "Agent Not Found",
						message: `Agent with ID "${activeAgentId}" not found in settings`,
						suggestion:
							"Please check your agent configuration in settings.",
					});
					return;
				}

				// Build AgentConfig with API key injection
				const agentConfig = buildAgentConfigWithApiKey(
					settings,
					agentSettings,
					activeAgentId,
					workingDirectory,
				);

				// Check if initialization is needed
				const needsInitialize =
					!agentClient.isInitialized() ||
					agentClient.getCurrentAgentId() !== activeAgentId;

				let authMethods: AuthenticationMethod[] = [];
				let promptCapabilities:
					| {
							image?: boolean;
							audio?: boolean;
							embeddedContext?: boolean;
					  }
					| undefined;
				let agentCapabilities:
					| {
							loadSession?: boolean;
							sessionCapabilities?: {
								resume?: Record<string, unknown>;
								fork?: Record<string, unknown>;
								list?: Record<string, unknown>;
							};
							mcpCapabilities?: {
								http?: boolean;
								sse?: boolean;
							};
							promptCapabilities?: {
								image?: boolean;
								audio?: boolean;
								embeddedContext?: boolean;
							};
					  }
					| undefined;

				if (needsInitialize) {
					// Initialize connection to agent
					const initResult =
						await agentClient.initialize(agentConfig);
					authMethods = initResult.authMethods;
					promptCapabilities = initResult.promptCapabilities;
					agentCapabilities = initResult.agentCapabilities;
				}

				// Load the session
				// Conversation history is received via session/update notifications
				const loadResult = await agentClient.loadSession(
					sessionId,
					workingDirectory,
				);

				// Success - update to ready state with session ID
				setSession((prev) => ({
					...prev,
					sessionId: loadResult.sessionId,
					state: "ready",
					authMethods: authMethods,
					modes: loadResult.modes,
					models: loadResult.models,
					promptCapabilities: needsInitialize
						? promptCapabilities
						: prev.promptCapabilities,
					agentCapabilities: needsInitialize
						? agentCapabilities
						: prev.agentCapabilities,
					lastActivityAt: new Date(),
				}));
			} catch (error) {
				// Error - update to error state
				setSession((prev) => ({ ...prev, state: "error" }));
				// Check if this is an Error with attached AgentError
				const err = error as Error & { agentError?: AgentError };
				if (err.agentError) {
					const agentError = err.agentError;
					setErrorInfo({
						title: agentError.title || "Agent Error",
						message: agentError.message,
						suggestion: agentError.suggestion,
						canAutoInstall: agentError.canAutoInstall,
						agentId: agentError.agentId,
					});
				} else {
					setErrorInfo({
						title: "Session Loading Failed",
						message: `Failed to load session: ${error instanceof Error ? error.message : String(error)}`,
						suggestion: "Please try again or create a new session.",
					});
				}
			}
		},
		[agentClient, settingsAccess, workingDirectory],
	);

	/**
	 * Restart the current session.
	 */
	const restartSession = useCallback(async () => {
		await createSession();
	}, [createSession]);

	/**
	 * Close the current session and disconnect from agent.
	 * Cancels any running operation and kills the agent process.
	 */
	const closeSession = useCallback(async () => {
		// Cancel current session if active
		if (session.sessionId) {
			try {
				await agentClient.cancel(session.sessionId);
			} catch (error) {
				// Ignore errors - session might already be closed
				console.warn("Failed to cancel session:", error);
			}
		}

		// Disconnect from agent (kill process)
		try {
			await agentClient.disconnect();
		} catch (error) {
			console.warn("Failed to disconnect:", error);
		}

		// Update to disconnected state
		setSession((prev) => ({
			...prev,
			sessionId: null,
			state: "disconnected",
		}));
	}, [agentClient, session.sessionId]);

	/**
	 * Cancel the current operation.
	 */
	const cancelOperation = useCallback(async () => {
		if (!session.sessionId) {
			return;
		}

		try {
			// Cancel via agent client
			await agentClient.cancel(session.sessionId);

			// Update to ready state
			setSession((prev) => ({
				...prev,
				state: "ready",
			}));
		} catch (error) {
			// If cancel fails, log but still update UI
			console.warn("Failed to cancel operation:", error);

			// Still update to ready state
			setSession((prev) => ({
				...prev,
				state: "ready",
			}));
		}
	}, [agentClient, session.sessionId]);

	/**
	 * Switch to a different agent.
	 * Updates settings and local session state.
	 */
	const switchAgent = useCallback(
		async (agentId: string) => {
			// Update settings (persists the change)
			await settingsAccess.updateSettings({ activeAgentId: agentId });

			// Update session with new agent ID
			// Clear agent-specific data (new agent will send its own)
			setSession((prev) => ({
				...prev,
				agentId,
				availableCommands: undefined,
				modes: undefined,
				models: undefined,
				promptCapabilities: undefined,
				agentCapabilities: undefined,
				agentInfo: undefined,
			}));
		},
		[settingsAccess],
	);

	/**
	 * Get list of available agents.
	 */
	const getAvailableAgents = useCallback(() => {
		const settings = settingsAccess.getSnapshot();
		return getAvailableAgentsFromSettings(settings);
	}, [settingsAccess]);

	/**
	 * Update available slash commands.
	 * Called by AcpAdapter when receiving available_commands_update.
	 */
	const updateAvailableCommands = useCallback((commands: SlashCommand[]) => {
		setSession((prev) => ({
			...prev,
			availableCommands: commands,
		}));
	}, []);

	/**
	 * Update current mode.
	 * Called by AcpAdapter when receiving current_mode_update.
	 */
	const updateCurrentMode = useCallback((modeId: string) => {
		setSession((prev) => {
			// Only update if modes exist
			if (!prev.modes) {
				return prev;
			}
			return {
				...prev,
				modes: {
					...prev.modes,
					currentModeId: modeId,
				},
			};
		});
	}, []);

	/**
	 * Set the session mode.
	 * Sends a request to the agent to change the mode.
	 */
	const setMode = useCallback(
		async (modeId: string) => {
			if (!session.sessionId) {
				console.warn("Cannot set mode: no active session");
				return;
			}

			// Store previous mode for rollback on error
			const previousModeId = session.modes?.currentModeId;

			// Optimistic update - update UI immediately
			setSession((prev) => {
				if (!prev.modes) return prev;
				return {
					...prev,
					modes: {
						...prev.modes,
						currentModeId: modeId,
					},
				};
			});

			try {
				await agentClient.setSessionMode(session.sessionId, modeId);
				// Per ACP protocol, current_mode_update is only sent when the agent
				// changes its own mode, not in response to client's setSessionMode.
				// UI is already updated optimistically above.
			} catch (error) {
				console.error("Failed to set mode:", error);
				// Rollback to previous mode on error
				if (previousModeId) {
					setSession((prev) => {
						if (!prev.modes) return prev;
						return {
							...prev,
							modes: {
								...prev.modes,
								currentModeId: previousModeId,
							},
						};
					});
				}
			}
		},
		[agentClient, session.sessionId, session.modes?.currentModeId],
	);

	/**
	 * Set the session model (experimental).
	 * Sends a request to the agent to change the model.
	 */
	const setModel = useCallback(
		async (modelId: string) => {
			if (!session.sessionId) {
				console.warn("Cannot set model: no active session");
				return;
			}

			// Store previous model for rollback on error
			const previousModelId = session.models?.currentModelId;

			// Optimistic update - update UI immediately
			setSession((prev) => {
				if (!prev.models) return prev;
				return {
					...prev,
					models: {
						...prev.models,
						currentModelId: modelId,
					},
				};
			});

			try {
				await agentClient.setSessionModel(session.sessionId, modelId);
				// Note: Unlike modes, there is no dedicated notification for model changes.
				// UI is already updated optimistically above.
			} catch (error) {
				console.error("Failed to set model:", error);
				// Rollback to previous model on error
				if (previousModelId) {
					setSession((prev) => {
						if (!prev.models) return prev;
						return {
							...prev,
							models: {
								...prev.models,
								currentModelId: previousModelId,
							},
						};
					});
				}
			}
		},
		[agentClient, session.sessionId, session.models?.currentModelId],
	);

	/**
	 * Update session state after loading/resuming/forking a session.
	 * Called by useSessionHistory after a successful session operation.
	 */
	const updateSessionFromLoad = useCallback(
		(
			sessionId: string,
			modes?: SessionModeState,
			models?: SessionModelState,
		) => {
			setSession((prev) => ({
				...prev,
				sessionId,
				state: "ready",
				modes: modes ?? prev.modes,
				models: models ?? prev.models,
				lastActivityAt: new Date(),
			}));
		},
		[],
	);

	return {
		session,
		isReady,
		errorInfo,
		createSession,
		loadSession,
		restartSession,
		closeSession,
		cancelOperation,
		switchAgent,
		getAvailableAgents,
		updateSessionFromLoad,
		updateAvailableCommands,
		updateCurrentMode,
		setMode,
		setModel,
	};
}
