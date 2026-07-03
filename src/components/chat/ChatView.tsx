import { ItemView, WorkspaceLeaf, Platform, Notice } from "obsidian";
import * as React from "react";
const { useState, useRef, useEffect, useMemo, useCallback } = React;
import { createRoot, Root } from "react-dom/client";

import type AgentClientPlugin from "../../plugin";

// Component imports
import { ErrorBoundary } from "../ErrorBoundary";
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { AgentUpdateBanner } from "./AgentUpdateBanner";
import { CompatWarningBanner } from "./CompatWarningBanner";
import { SessionHistoryModal } from "./SessionHistoryModal";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

// Service imports
import { NoteMentionService } from "../../adapters/obsidian/mention-service";

// Utility imports
import { Logger } from "../../shared/logger";
import { ChatExporter } from "../../shared/chat-exporter";

// Adapter imports
import type { IAcpClient } from "../../adapters/acp/acp.adapter";
import { ObsidianVaultAdapter } from "../../adapters/obsidian/vault.adapter";

// Hooks imports
import { useSettings } from "../../hooks/useSettings";
import { useMentions } from "../../hooks/useMentions";
import { useSlashCommands } from "../../hooks/useSlashCommands";
import { useAutoMention } from "../../hooks/useAutoMention";
import { useAgentSession } from "../../hooks/useAgentSession";
import { useChat } from "../../hooks/useChat";
import { usePermission } from "../../hooks/usePermission";
import { useAutoExport } from "../../hooks/useAutoExport";
import { useSessionHistory } from "../../hooks/useSessionHistory";

// Domain model imports
import type {
	SessionModeState,
	SessionModelState,
} from "../../domain/models/chat-session";
import type { ImagePromptContent } from "../../domain/models/prompt-content";

// Type definitions for Obsidian internal APIs
interface VaultAdapterWithBasePath {
	basePath?: string;
}

interface AppWithSettings {
	setting: {
		open: () => void;
		openTabById: (id: string) => void;
	};
}

export const VIEW_TYPE_CHAT = "obsidianaitools-chat-view";

function ChatComponent({
	plugin,
	view,
}: {
	plugin: AgentClientPlugin;
	view: ChatView;
}) {
	// ============================================================
	// Platform Check
	// ============================================================
	if (!Platform.isDesktopApp) {
		throw new Error("AI Tools is only available on desktop");
	}

	// ============================================================
	// Memoized Services & Adapters
	// ============================================================
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	const vaultPath = useMemo(() => {
		return (
			(plugin.app.vault.adapter as VaultAdapterWithBasePath).basePath ||
			process.cwd()
		);
	}, [plugin]);

	const noteMentionService = useMemo(
		() => new NoteMentionService(plugin),
		[plugin],
	);

	// Cleanup NoteMentionService when component unmounts
	useEffect(() => {
		return () => {
			noteMentionService.destroy();
		};
	}, [noteMentionService]);

	const acpAdapter = useMemo(() => plugin.getOrCreateAdapter(), [plugin]);
	const acpClientRef = useRef<IAcpClient>(acpAdapter);

	const vaultAccessAdapter = useMemo(() => {
		return new ObsidianVaultAdapter(plugin, noteMentionService);
	}, [plugin, noteMentionService]);

	// ============================================================
	// Custom Hooks
	// ============================================================
	const settings = useSettings(plugin);

	const agentSession = useAgentSession(
		acpAdapter,
		plugin.settingsStore,
		vaultPath,
	);

	const {
		session,
		errorInfo: sessionErrorInfo,
		isReady: isSessionReady,
	} = agentSession;

	const chat = useChat(
		acpAdapter,
		vaultAccessAdapter,
		noteMentionService,
		{
			sessionId: session.sessionId,
			authMethods: session.authMethods,
			promptCapabilities: session.promptCapabilities,
		},
		{
			windowsWslMode: settings.windowsWslMode,
			maxNoteLength: settings.displaySettings.maxNoteLength,
			maxSelectionLength: settings.displaySettings.maxSelectionLength,
		},
	);

	const { messages, isSending, streamingPhase } = chat;

	const permission = usePermission(acpAdapter, messages);

	const mentions = useMentions(vaultAccessAdapter, plugin);
	const autoMention = useAutoMention(vaultAccessAdapter);
	const slashCommands = useSlashCommands(
		session.availableCommands || [],
		autoMention.toggle,
	);

	const autoExport = useAutoExport(plugin);

	// Session history hook with callback for session load
	// Session load callback - called when a session is loaded/resumed/forked from history
	// Note: Conversation history is received via session/update notifications for load
	const handleSessionLoad = useCallback(
		(
			sessionId: string,
			modes?: SessionModeState,
			models?: SessionModelState,
		) => {
			// Log that session was loaded
			logger.log(
				`[ChatView] Session loaded/resumed/forked: ${sessionId}`,
				{
					modes,
					models,
				},
			);

			// Update session state with new session ID and modes/models
			// This is critical for session/update notifications to be accepted
			agentSession.updateSessionFromLoad(sessionId, modes, models);

			// Conversation history for load is received via session/update notifications
			// but we ignore them and use local history instead (see handleLoadStart/handleLoadEnd)
		},
		[logger, agentSession],
	);

	/**
	 * Called when session/load starts.
	 * Sets flag to ignore history replay messages from agent.
	 */
	const handleLoadStart = useCallback(() => {
		logger.log("[ChatView] session/load started, ignoring history replay");
		setIsLoadingSessionHistory(true);
		// Clear existing messages before loading local history
		chat.clearMessages();
	}, [logger, chat]);

	/**
	 * Called when session/load ends.
	 * Clears flag to resume normal message processing.
	 */
	const handleLoadEnd = useCallback(() => {
		logger.log("[ChatView] session/load ended, resuming normal processing");
		setIsLoadingSessionHistory(false);
	}, [logger]);

	const sessionHistory = useSessionHistory({
		agentClient: acpAdapter,
		session,
		settingsAccess: plugin.settingsStore,
		cwd: vaultPath,
		onSessionLoad: handleSessionLoad,
		onMessagesRestore: chat.setMessagesFromLocal,
		onLoadStart: handleLoadStart,
		onLoadEnd: handleLoadEnd,
	});

	// Combined error info (session errors take precedence)
	const errorInfo =
		sessionErrorInfo || chat.errorInfo || permission.errorInfo;

	// ============================================================
	// Local State
	// ============================================================
	const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
	const [agentUpdate, setAgentUpdate] = useState<{
		agentId: string;
		installed: string | null;
		latest: string;
		untested: boolean;
		maxTested: string | null;
	} | null>(null);
	const [compatWarning, setCompatWarning] = useState<{
		agentId: string;
		installed: string;
		maxTested: string;
	} | null>(null);
	const [restoredMessage, setRestoredMessage] = useState<string | null>(null);
	/** Flag to ignore history replay messages during session/load */
	const [isLoadingSessionHistory, setIsLoadingSessionHistory] =
		useState(false);

	// ============================================================
	// Refs
	// ============================================================
	/** Ref for session history modal (persisted across renders) */
	const historyModalRef = useRef<SessionHistoryModal | null>(null);

	// ============================================================
	// Computed Values
	// ============================================================
	const activeAgentLabel = useMemo(() => {
		const activeId = session.agentId;
		if (activeId === plugin.settings.claude.id) {
			return (
				plugin.settings.claude.displayName || plugin.settings.claude.id
			);
		}
		if (activeId === plugin.settings.codex.id) {
			return (
				plugin.settings.codex.displayName || plugin.settings.codex.id
			);
		}
		if (activeId === plugin.settings.gemini.id) {
			return (
				plugin.settings.gemini.displayName || plugin.settings.gemini.id
			);
		}
		const custom = plugin.settings.customAgents.find(
			(agent) => agent.id === activeId,
		);
		return custom?.displayName || custom?.id || activeId;
	}, [session.agentId, plugin.settings]);

	// ============================================================
	// Callbacks
	// ============================================================
	/**
	 * Handle new chat request.
	 * @param requestedAgentId - If provided, switch to this agent (from "New chat with [Agent]" command)
	 */
	const handleNewChat = useCallback(
		async (requestedAgentId?: string) => {
			const isAgentSwitch =
				requestedAgentId && requestedAgentId !== session.agentId;

			// Skip if already an empty, healthy session and not switching
			// agents. When the session is in an error/disconnected state,
			// "New chat" doubles as a retry even with no messages.
			if (
				messages.length === 0 &&
				!isAgentSwitch &&
				session.state === "ready"
			) {
				new Notice("[AI Tools] Already a new session");
				return;
			}

			// Cancel ongoing generation before starting new chat
			if (chat.isSending) {
				await agentSession.cancelOperation();
			}

			logger.log(
				`[Debug] Creating new session${isAgentSwitch ? ` with agent: ${requestedAgentId}` : ""}...`,
			);

			// Auto-export current chat before starting new one (if has messages)
			if (messages.length > 0) {
				await autoExport.autoExportIfEnabled(
					"newChat",
					messages,
					session,
				);
			}

			// Switch agent if requested
			if (isAgentSwitch) {
				await agentSession.switchAgent(requestedAgentId);
			}

			autoMention.toggle(false);
			chat.clearMessages();
			await agentSession.restartSession();

			// Invalidate session history cache when creating new session
			sessionHistory.invalidateCache();
		},
		[
			messages,
			session,
			logger,
			autoExport,
			autoMention,
			chat,
			agentSession,
			sessionHistory,
		],
	);

	const handleExportChat = useCallback(async () => {
		if (messages.length === 0) {
			new Notice("[AI Tools] No messages to export");
			return;
		}

		try {
			const exporter = new ChatExporter(plugin);
			const openFile = plugin.settings.exportSettings.openFileAfterExport;
			const filePath = await exporter.exportToMarkdown(
				messages,
				session.agentDisplayName,
				session.agentId,
				session.sessionId || "unknown",
				session.createdAt,
				openFile,
			);
			new Notice(`[AI Tools] Chat exported to ${filePath}`);
		} catch (error) {
			new Notice("[AI Tools] Failed to export chat");
			logger.error("Export error:", error);
		}
	}, [messages, session, plugin, logger]);

	const handleOpenSettings = useCallback(() => {
		const appWithSettings = plugin.app as unknown as AppWithSettings;
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(plugin.manifest.id);
	}, [plugin]);

	// ============================================================
	// Session History Modal Callbacks
	// ============================================================
	const handleHistoryRestoreSession = useCallback(
		async (sessionId: string, cwd: string) => {
			try {
				logger.log(`[ChatView] Restoring session: ${sessionId}`);
				chat.clearMessages();
				await sessionHistory.restoreSession(sessionId, cwd);
				new Notice("[AI Tools] Session restored");
			} catch (error) {
				new Notice("[AI Tools] Failed to restore session");
				logger.error("Session restore error:", error);
			}
		},
		[logger, chat, sessionHistory],
	);

	const handleHistoryForkSession = useCallback(
		async (sessionId: string, cwd: string) => {
			try {
				logger.log(`[ChatView] Forking session: ${sessionId}`);
				chat.clearMessages();
				await sessionHistory.forkSession(sessionId, cwd);
				new Notice("[AI Tools] Session forked");
			} catch (error) {
				new Notice("[AI Tools] Failed to fork session");
				logger.error("Session fork error:", error);
			}
		},
		[logger, chat, sessionHistory],
	);

	const handleHistoryDeleteSession = useCallback(
		(sessionId: string) => {
			const targetSession = sessionHistory.sessions.find(
				(s) => s.sessionId === sessionId,
			);
			const sessionTitle = targetSession?.title ?? "Untitled Session";

			const confirmModal = new ConfirmDeleteModal(
				plugin.app,
				sessionTitle,
				async () => {
					try {
						logger.log(`[ChatView] Deleting session: ${sessionId}`);
						await sessionHistory.deleteSession(sessionId);
						new Notice("[AI Tools] Session deleted");
					} catch (error) {
						new Notice("[AI Tools] Failed to delete session");
						logger.error("Session delete error:", error);
					}
				},
			);
			confirmModal.open();
		},
		[plugin.app, sessionHistory, logger],
	);

	const handleHistoryLoadMore = useCallback(() => {
		void sessionHistory.loadMoreSessions();
	}, [sessionHistory]);

	const handleHistoryFetchSessions = useCallback(
		(cwd?: string) => {
			void sessionHistory.fetchSessions(cwd);
		},
		[sessionHistory],
	);

	const handleOpenHistory = useCallback(() => {
		// Create modal if it doesn't exist
		if (!historyModalRef.current) {
			historyModalRef.current = new SessionHistoryModal(plugin.app, {
				sessions: sessionHistory.sessions,
				loading: sessionHistory.loading,
				error: sessionHistory.error,
				hasMore: sessionHistory.hasMore,
				currentCwd: vaultPath,
				canList: sessionHistory.canList,
				canRestore: sessionHistory.canRestore,
				canFork: sessionHistory.canFork,
				isUsingLocalSessions: sessionHistory.isUsingLocalSessions,
				isAgentReady: isSessionReady,
				debugMode: settings.debugMode,
				onRestoreSession: handleHistoryRestoreSession,
				onForkSession: handleHistoryForkSession,
				onDeleteSession: handleHistoryDeleteSession,
				onLoadMore: handleHistoryLoadMore,
				onFetchSessions: handleHistoryFetchSessions,
			});
		}
		historyModalRef.current.open();
		void sessionHistory.fetchSessions(vaultPath);
	}, [
		plugin.app,
		sessionHistory,
		vaultPath,
		isSessionReady,
		settings.debugMode,
		handleHistoryRestoreSession,
		handleHistoryForkSession,
		handleHistoryDeleteSession,
		handleHistoryLoadMore,
		handleHistoryFetchSessions,
	]);

	// Update modal props when session history state changes
	useEffect(() => {
		if (historyModalRef.current) {
			historyModalRef.current.updateProps({
				sessions: sessionHistory.sessions,
				loading: sessionHistory.loading,
				error: sessionHistory.error,
				hasMore: sessionHistory.hasMore,
				currentCwd: vaultPath,
				canList: sessionHistory.canList,
				canRestore: sessionHistory.canRestore,
				canFork: sessionHistory.canFork,
				isUsingLocalSessions: sessionHistory.isUsingLocalSessions,
				isAgentReady: isSessionReady,
				debugMode: settings.debugMode,
				onRestoreSession: handleHistoryRestoreSession,
				onForkSession: handleHistoryForkSession,
				onDeleteSession: handleHistoryDeleteSession,
				onLoadMore: handleHistoryLoadMore,
				onFetchSessions: handleHistoryFetchSessions,
			});
		}
	}, [
		sessionHistory.sessions,
		sessionHistory.loading,
		sessionHistory.error,
		sessionHistory.hasMore,
		sessionHistory.canList,
		sessionHistory.canRestore,
		sessionHistory.canFork,
		sessionHistory.isUsingLocalSessions,
		vaultPath,
		isSessionReady,
		settings.debugMode,
		handleHistoryRestoreSession,
		handleHistoryForkSession,
		handleHistoryDeleteSession,
		handleHistoryLoadMore,
		handleHistoryFetchSessions,
	]);

	const handleSendMessage = useCallback(
		async (content: string, images?: ImagePromptContent[]) => {
			const isFirstMessage = messages.length === 0;

			await chat.sendMessage(content, {
				activeNote: autoMention.activeNote,
				vaultBasePath:
					(plugin.app.vault.adapter as VaultAdapterWithBasePath)
						.basePath || "",
				isAutoMentionDisabled: autoMention.isDisabled,
				images,
			});

			// Save session metadata locally on first message
			if (isFirstMessage && session.sessionId) {
				await sessionHistory.saveSessionLocally(
					session.sessionId,
					content,
				);
				logger.log(
					`[ChatView] Session saved locally: ${session.sessionId}`,
				);
			}
		},
		[
			chat,
			autoMention,
			plugin,
			messages.length,
			session.sessionId,
			sessionHistory,
			logger,
		],
	);

	const handleStopGeneration = useCallback(async () => {
		logger.log("Cancelling current operation...");
		// Save last user message before cancel (to restore it)
		const lastMessage = chat.lastUserMessage;
		await agentSession.cancelOperation();
		// Restore the last user message to input field
		if (lastMessage) {
			setRestoredMessage(lastMessage);
		}
	}, [logger, agentSession, chat.lastUserMessage]);

	const handleSendMessageFromPermission = useCallback(
		async (content: string) => {
			await chat.sendMessage(content, {
				activeNote: autoMention.activeNote,
				vaultBasePath:
					(plugin.app.vault.adapter as VaultAdapterWithBasePath)
						.basePath || "",
				isAutoMentionDisabled: autoMention.isDisabled,
			});
		},
		[chat, autoMention, plugin],
	);

	const handleClearError = useCallback(() => {
		chat.clearError();
	}, [chat]);

	const handleInstallAgent = useCallback(
		async (agentId: string) => {
			logger.log("Installing agent:", agentId);
			const adapter = acpClientRef.current;
			if (adapter && "installCurrentAgent" in adapter) {
				const result = await (
					adapter as {
						installCurrentAgent: (
							onProgress?: (output: string) => void,
						) => Promise<boolean>;
					}
				).installCurrentAgent((output) => {
					logger.log("Install output:", output);
				});

				if (result) {
					// Installation succeeded, clear error and retry session
					chat.clearError();
					await agentSession.createSession();
				} else {
					// Installation failed, keep error displayed
					logger.error("Installation failed");
				}
			}
		},
		[logger, acpClientRef, chat, agentSession],
	);

	const handleRestoredMessageConsumed = useCallback(() => {
		setRestoredMessage(null);
	}, []);

	// ============================================================
	// Effects - Session Lifecycle
	// ============================================================
	// Initialize session on mount or when agent changes
	// Skip during onboarding — the modal will trigger activateView() after saving settings
	useEffect(() => {
		if (!settings.hasCompletedOnboarding) {
			logger.log("[Debug] Skipping session creation — onboarding in progress");
			return;
		}
		logger.log("[Debug] Starting connection setup via useAgentSession...");
		void agentSession.createSession();
	}, [session.agentId, agentSession.createSession, settings.hasCompletedOnboarding]);

	// Refs for cleanup (to access latest values in cleanup function)
	const messagesRef = useRef(messages);
	const sessionRef = useRef(session);
	const autoExportRef = useRef(autoExport);
	const closeSessionRef = useRef(agentSession.closeSession);
	messagesRef.current = messages;
	sessionRef.current = session;
	autoExportRef.current = autoExport;
	closeSessionRef.current = agentSession.closeSession;

	// Refs for stable onSessionUpdate callback (avoid mid-stream re-registration)
	const sessionIdRef = useRef(session.sessionId);
	const isLoadingSessionHistoryRef = useRef(isLoadingSessionHistory);
	const handleSessionUpdateRef = useRef(chat.handleSessionUpdate);
	const updateAvailableCommandsRef = useRef(agentSession.updateAvailableCommands);
	const updateCurrentModeRef = useRef(agentSession.updateCurrentMode);
	sessionIdRef.current = session.sessionId;
	isLoadingSessionHistoryRef.current = isLoadingSessionHistory;
	handleSessionUpdateRef.current = chat.handleSessionUpdate;
	updateAvailableCommandsRef.current = agentSession.updateAvailableCommands;
	updateCurrentModeRef.current = agentSession.updateCurrentMode;

	// Reload session when API settings change (apiKey, baseUrl, model).
	// Debounced: the settings tab saves on every keystroke, and applying a new
	// API key respawns the agent process (env vars only apply at spawn) — do
	// that once after the user stops typing, not per keystroke. Skips the
	// mount run so vault startup doesn't trigger a redundant reload.
	const skipInitialSettingsReloadRef = useRef(true);
	useEffect(() => {
		if (skipInitialSettingsReloadRef.current) {
			skipInitialSettingsReloadRef.current = false;
			return;
		}
		const timer = window.setTimeout(() => {
			const state = sessionRef.current.state;
			if (state === "ready" || state === "error") {
				logger.log("[Debug] API settings changed, reloading session...");
				void agentSession.createSession();
			}
		}, 2000);
		return () => window.clearTimeout(timer);
	}, [
		settings.apiKey,
		settings.baseUrl,
		settings.model,
		agentSession.createSession,
		logger,
	]);

	// Cleanup on unmount only - auto-export and close session
	useEffect(() => {
		return () => {
			logger.log("[ChatView] Cleanup: auto-export and close session");
			// Use refs to get latest values (avoid stale closures)
			// IMPORTANT: catch all errors to prevent unhandled promise rejections
			// which cause Obsidian to disable the plugin on next restart
			(async () => {
				try {
					await autoExportRef.current.autoExportIfEnabled(
						"closeChat",
						messagesRef.current,
						sessionRef.current,
					);
				} catch (error) {
					console.warn("[AI Tools] Auto-export during cleanup failed:", error);
				}
				try {
					await closeSessionRef.current();
				} catch (error) {
					console.warn("[AI Tools] Session close during cleanup failed:", error);
				}
			})().catch((error) => {
				console.warn("[AI Tools] Cleanup error:", error);
			});
		};
		// Empty dependency array - only run on unmount
	}, []);

	// Monitor agent changes from settings when messages are empty
	useEffect(() => {
		const newActiveAgentId = settings.activeAgentId || settings.claude.id;
		if (messages.length === 0 && newActiveAgentId !== session.agentId) {
			void agentSession.switchAgent(newActiveAgentId);
		}
	}, [
		settings.activeAgentId,
		messages.length,
		session.agentId,
		agentSession.switchAgent,
	]);

	// ============================================================
	// Effects - ACP Adapter Callbacks
	// ============================================================
	// Register unified session update callback (stable - uses refs to avoid mid-stream re-registration)
	useEffect(() => {
		acpAdapter.onSessionUpdate((update) => {
			// Filter by sessionId - ignore updates from old sessions
			if (sessionIdRef.current && update.sessionId !== sessionIdRef.current) {
				logger.log(
					`[ChatView] Ignoring update for old session: ${update.sessionId} (current: ${sessionIdRef.current})`,
				);
				return;
			}

			// During session/load, ignore history replay messages but process session-level updates
			if (isLoadingSessionHistoryRef.current) {
				// Only process session-level updates during load
				if (update.type === "available_commands_update") {
					updateAvailableCommandsRef.current(update.commands);
				} else if (update.type === "current_mode_update") {
					updateCurrentModeRef.current(update.currentModeId);
				}
				// Ignore all message-related updates (history replay)
				return;
			}

			// Route message-related updates to useChat
			handleSessionUpdateRef.current(update);

			// Route session-level updates to useAgentSession
			if (update.type === "available_commands_update") {
				updateAvailableCommandsRef.current(update.commands);
			} else if (update.type === "current_mode_update") {
				updateCurrentModeRef.current(update.currentModeId);
			}
		});
	}, [acpAdapter, logger]);

	// Register updateMessage callback for permission UI updates
	useEffect(() => {
		acpAdapter.setUpdateMessageCallback(chat.updateMessage);
	}, [acpAdapter, chat.updateMessage]);

	// ============================================================
	// Effects - Update Check
	// ============================================================
	useEffect(() => {
		plugin
			.checkForUpdates()
			.then(setIsUpdateAvailable)
			.catch((error) => {
				console.error("Failed to check for updates:", error);
			});
	}, [plugin]);

	// Agent npm-package update check. Runs when the active agent changes;
	// shows a banner if the installed version is older than the registry's
	// latest. Dismissals are remembered for the React-mount lifetime per
	// version, so users don't get re-nagged after dismissing.
	useEffect(() => {
		const activeAgentId =
			settings.activeAgentId || settings.claude.id;
		if (!activeAgentId) return;
		let cancelled = false;

		// Delay the version check so it doesn't compete with session
		// initialisation during Obsidian startup. The check spawns child
		// processes (npm/where/which) that — even async — add load pressure.
		const delayId = window.setTimeout(() => {
			void (async () => {
				try {
					const { checkAgentVersion, getNpmPackage } = await import(
						"../../shared/version-checker"
					);
					if (!getNpmPackage(activeAgentId)) return;
					const cmd =
						activeAgentId === settings.claude.id
							? settings.claude.command
							: activeAgentId === settings.codex.id
								? settings.codex.command
								: activeAgentId === settings.gemini.id
									? settings.gemini.command
									: undefined;
					const info = await checkAgentVersion(
						activeAgentId,
						settings.nodePath,
						cmd || undefined,
					);
					if (cancelled) return;

					// Show the banner when the agent is installed and there's a
					// known newer version (or when we can't read the installed
					// version but a latest exists — the user can still choose to
					// update). Skip if not installed (settings handles install)
					// or if the user already dismissed this latest version.
					// Dismissals are persisted per version, so someone who
					// deliberately rolled back after a broken agent release
					// dismisses its banner exactly once — the next release
					// shows a fresh banner. Versions above the tested ceiling
					// still show, but flagged as untested ("Update anyway").
					const alreadyDismissed =
						!!info.latest &&
						settings.agentUpdateDismissed[activeAgentId] ===
							info.latest;
					const shouldShow =
						info.isInstalled &&
						!!info.latest &&
						!alreadyDismissed &&
						// Only show if outdated, OR if we can't tell (no installed
						// version detected — being honest that we're unsure).
						(info.isOutdated || !info.installed);

					if (shouldShow && info.latest) {
						setAgentUpdate({
							agentId: activeAgentId,
							installed: info.installed,
							latest: info.latest,
							untested: info.latestAboveTested,
							maxTested: info.maxTestedVersion,
						});
					} else {
						setAgentUpdate(null);
					}

					// Compatibility warning: installed version is newer than
					// what this plugin release was tested against.
					// Only show when we know the exact installed version, it's
					// above maxTested, and the user hasn't dismissed it yet for
					// this specific version (persisted across restarts).
					if (
						info.isAboveTestedVersion &&
						info.installed &&
						info.maxTestedVersion
					) {
						const dismissed =
							plugin.settings.compatWarningDismissed[activeAgentId];
						if (dismissed !== info.installed) {
							setCompatWarning({
								agentId: activeAgentId,
								installed: info.installed,
								maxTested: info.maxTestedVersion,
							});
						}
					} else {
						setCompatWarning(null);
					}
				} catch (err) {
					console.error("[ChatView] agent version check failed:", err);
				}
			})();
		}, 3000); // 3-second startup grace period

		return () => {
			cancelled = true;
			window.clearTimeout(delayId);
		};
	}, [
		settings.activeAgentId,
		settings.claude.id,
		settings.claude.command,
		settings.codex.id,
		settings.codex.command,
		settings.gemini.id,
		settings.gemini.command,
		settings.nodePath,
		settings.agentUpdateDismissed,
	]);

	// ============================================================
	// Effects - Save Session Messages on Turn End
	// ============================================================
	// Track previous isSending state to detect turn completion
	const prevIsSendingRef = useRef<boolean>(false);

	useEffect(() => {
		const wasSending = prevIsSendingRef.current;
		prevIsSendingRef.current = isSending;

		// Save when turn ends (isSending: true → false) and has messages
		if (
			wasSending &&
			!isSending &&
			session.sessionId &&
			messages.length > 0
		) {
			// Fire-and-forget save via sessionHistory hook
			sessionHistory.saveSessionMessages(session.sessionId, messages);
			logger.log(
				`[ChatView] Session messages saved: ${session.sessionId}`,
			);
		}
	}, [isSending, session.sessionId, messages, sessionHistory, logger]);

	// ============================================================
	// Effects - Auto-mention Active Note Tracking
	// ============================================================
	useEffect(() => {
		let isMounted = true;

		const refreshActiveNote = async () => {
			if (!isMounted) return;
			await autoMention.updateActiveNote();
		};

		const unsubscribe = vaultAccessAdapter.subscribeSelectionChanges(() => {
			void refreshActiveNote();
		});

		void refreshActiveNote();

		return () => {
			isMounted = false;
			unsubscribe();
		};
	}, [autoMention.updateActiveNote, vaultAccessAdapter]);

	// ============================================================
	// Effects - Workspace Events (Hotkeys)
	// ============================================================
	useEffect(() => {
		const workspace = plugin.app.workspace;

		const eventRef = workspace.on(
			"obsidianaitools:toggle-auto-mention" as "quit",
			() => {
				autoMention.toggle();
			},
		);

		return () => {
			workspace.offref(eventRef);
		};
	}, [plugin.app.workspace, autoMention.toggle]);

	// Handle new chat request from plugin commands (e.g., "New chat with [Agent]")
	useEffect(() => {
		const workspace = plugin.app.workspace;

		// Cast to any to bypass Obsidian's type constraints for custom events
		const eventRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: (agentId?: string) => void,
				) => ReturnType<typeof workspace.on>;
			}
		).on("obsidianaitools:new-chat-requested", (agentId?: string) => {
			void handleNewChat(agentId);
		});

		return () => {
			workspace.offref(eventRef);
		};
	}, [plugin.app.workspace, handleNewChat]);

	useEffect(() => {
		const workspace = plugin.app.workspace;

		const approveRef = workspace.on(
			"obsidianaitools:approve-active-permission" as "quit",
			() => {
				void (async () => {
					const success = await permission.approveActivePermission();
					if (!success) {
						new Notice(
							"[AI Tools] No active permission request",
						);
					}
				})();
			},
		);

		const rejectRef = workspace.on(
			"obsidianaitools:reject-active-permission" as "quit",
			() => {
				void (async () => {
					const success = await permission.rejectActivePermission();
					if (!success) {
						new Notice(
							"[AI Tools] No active permission request",
						);
					}
				})();
			},
		);

		const cancelRef = workspace.on(
			"obsidianaitools:cancel-message" as "quit",
			() => {
				void handleStopGeneration();
			},
		);

		return () => {
			workspace.offref(approveRef);
			workspace.offref(rejectRef);
			workspace.offref(cancelRef);
		};
	}, [
		plugin.app.workspace,
		permission.approveActivePermission,
		permission.rejectActivePermission,
		handleStopGeneration,
	]);

	// ============================================================
	// Render
	// ============================================================
	return (
		<div className="obsidianaitools-chat-view-container">
			<ChatHeader
				agentLabel={activeAgentLabel}
				isUpdateAvailable={isUpdateAvailable}
				hasHistoryCapability={sessionHistory.canShowSessionHistory}
				onNewChat={() => void handleNewChat()}
				onExportChat={() => void handleExportChat()}
				onOpenSettings={handleOpenSettings}
				onOpenHistory={handleOpenHistory}
			/>

			{agentUpdate && (
				<AgentUpdateBanner
					plugin={plugin}
					agentId={agentUpdate.agentId}
					installedVersion={agentUpdate.installed}
					latestVersion={agentUpdate.latest}
					nodePath={settings.nodePath}
					untested={agentUpdate.untested}
					maxTestedVersion={agentUpdate.maxTested}
					onDismiss={() => {
						// Persist per version so the banner never re-nags for
						// this release (survives view reopen and restarts)
						void plugin.saveSettingsAndNotify({
							...plugin.settings,
							agentUpdateDismissed: {
								...plugin.settings.agentUpdateDismissed,
								[agentUpdate.agentId]: agentUpdate.latest,
							},
						});
						setAgentUpdate(null);
					}}
					onUpdated={() => {
						setAgentUpdate(null);
					}}
				/>
			)}

			{compatWarning && !agentUpdate && (
				<CompatWarningBanner
					plugin={plugin}
					agentId={compatWarning.agentId}
					installedVersion={compatWarning.installed}
					maxTestedVersion={compatWarning.maxTested}
					nodePath={settings.nodePath}
					onDismiss={() => {
						// Persist dismiss so it won't show again for this version
						void plugin.saveSettingsAndNotify({
							...plugin.settings,
							compatWarningDismissed: {
								...plugin.settings.compatWarningDismissed,
								[compatWarning.agentId]:
									compatWarning.installed,
							},
						});
						setCompatWarning(null);
					}}
					onResolved={() => setCompatWarning(null)}
				/>
			)}

			<ChatMessages
				messages={messages}
				isSending={isSending}
				streamingPhase={streamingPhase}
				isSessionReady={isSessionReady}
				isRestoringSession={sessionHistory.loading}
				agentLabel={activeAgentLabel}
				errorInfo={errorInfo}
				plugin={plugin}
				view={view}
				acpClient={acpClientRef.current}
				onApprovePermission={permission.approvePermission}
				onSendMessage={handleSendMessageFromPermission}
				onClearError={handleClearError}
				isAgentConfigured={!!session.agentId}
				onOpenSettings={handleOpenSettings}
				onInstallAgent={handleInstallAgent}
			/>

			<ChatInput
				isSending={isSending}
				isSessionReady={isSessionReady}
				isRestoringSession={sessionHistory.loading}
				agentLabel={activeAgentLabel}
				availableCommands={session.availableCommands || []}
				autoMentionEnabled={settings.autoMentionActiveNote}
				restoredMessage={restoredMessage}
				mentions={mentions}
				slashCommands={slashCommands}
				autoMention={autoMention}
				plugin={plugin}
				view={view}
				onSendMessage={handleSendMessage}
				onStopGeneration={handleStopGeneration}
				onRestoredMessageConsumed={handleRestoredMessageConsumed}
				modes={session.modes}
				onModeChange={(modeId) => void agentSession.setMode(modeId)}
				models={session.models}
				onModelChange={(modelId) => void agentSession.setModel(modelId)}
				supportsImages={session.promptCapabilities?.image ?? false}
				agentId={session.agentId}
			/>
		</div>
	);
}

export class ChatView extends ItemView {
	private root: Root | null = null;
	private plugin: AgentClientPlugin;
	private logger: Logger;

	constructor(leaf: WorkspaceLeaf, plugin: AgentClientPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.logger = new Logger(plugin);
	}

	getViewType() {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText() {
		return "AI Tools";
	}

	getIcon() {
		return "bot-message-square";
	}

	onOpen() {
		try {
			const container = this.containerEl.children[1];
			container.empty();

			this.root = createRoot(container);
			this.root.render(
				<ErrorBoundary>
					<ChatComponent plugin={this.plugin} view={this} />
				</ErrorBoundary>,
			);
		} catch (error) {
			console.error("[AI Tools] Failed to open chat view:", error);
		}
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		try {
			this.logger.log("[ChatView] onClose() called");
			// Cleanup is handled by React useEffect cleanup in ChatComponent
			// which performs auto-export and closeSession
			if (this.root) {
				this.root.unmount();
				this.root = null;
			}
		} catch (error) {
			console.error("[AI Tools] Failed to close chat view:", error);
		}
		return Promise.resolve();
	}
}
