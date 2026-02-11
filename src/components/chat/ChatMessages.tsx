import * as React from "react";
const { useRef, useState, useEffect, useCallback } = React;

import type { ChatMessage } from "../../domain/models/chat-message";
import type { IAcpClient } from "../../adapters/acp/acp.adapter";
import type AgentClientPlugin from "../../plugin";
import type { ChatView } from "./ChatView";
import { MessageRenderer } from "./MessageRenderer";

/**
 * Error information to display
 */
export interface ErrorInfo {
	title: string;
	message: string;
	suggestion?: string;
	canAutoInstall?: boolean;
	agentId?: string;
}

/**
 * Props for ChatMessages component
 */
export interface ChatMessagesProps {
	/** All messages in the current chat session */
	messages: ChatMessage[];
	/** Whether a message is currently being sent */
	isSending: boolean;
	/** Whether the session is ready for user input */
	isSessionReady: boolean;
	/** Whether a session is being restored (load/resume/fork) */
	isRestoringSession: boolean;
	/** Display name of the active agent */
	agentLabel: string;
	/** Error information (if any) */
	errorInfo: ErrorInfo | null;
	/** Plugin instance */
	plugin: AgentClientPlugin;
	/** View instance for event registration */
	view: ChatView;
	/** ACP client for terminal operations */
	acpClient?: IAcpClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
	/** Callback to send a message (used for "Other" option) */
	onSendMessage?: (content: string) => Promise<void>;
	/** Callback to clear the error */
	onClearError: () => void;
	/** Whether the agent is properly configured */
	isAgentConfigured: boolean;
	/** Callback to open settings */
	onOpenSettings?: () => void;
	/** Callback to install agent (when auto-install is available) */
	onInstallAgent?: (agentId: string) => Promise<void>;
}

/**
 * Messages container component for the chat view.
 *
 * Handles:
 * - Message list rendering
 * - Auto-scroll behavior
 * - Error display
 * - Empty state display
 * - Loading indicator
 */
export function ChatMessages({
	messages,
	isSending,
	isSessionReady,
	isRestoringSession,
	agentLabel,
	errorInfo,
	plugin,
	view,
	acpClient,
	onApprovePermission,
	onSendMessage,
	onClearError,
	isAgentConfigured,
	onOpenSettings,
	onInstallAgent,
}: ChatMessagesProps) {
	const [isInstalling, setIsInstalling] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);

	/**
	 * Handle install agent click with proper async handling.
	 */
	const handleInstallClick = useCallback(() => {
		if (!errorInfo?.agentId || !onInstallAgent) return;
		setIsInstalling(true);
		void onInstallAgent(errorInfo.agentId).finally(() => {
			setIsInstalling(false);
		});
	}, [errorInfo?.agentId, onInstallAgent]);

	/**
	 * Check if the scroll position is near the bottom.
	 */
	const checkIfAtBottom = useCallback(() => {
		const container = containerRef.current;
		if (!container) return true;

		const threshold = 50;
		const isNearBottom =
			container.scrollTop + container.clientHeight >=
			container.scrollHeight - threshold;
		setIsAtBottom(isNearBottom);
		return isNearBottom;
	}, []);

	/**
	 * Scroll to the bottom of the container.
	 */
	const scrollToBottom = useCallback(() => {
		const container = containerRef.current;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
	}, []);

	// Auto-scroll when messages change
	useEffect(() => {
		if (isAtBottom && messages.length > 0) {
			// Use setTimeout to ensure DOM has updated
			window.setTimeout(() => {
				scrollToBottom();
			}, 0);
		}
	}, [messages, isAtBottom, scrollToBottom]);

	// Set up scroll event listener
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const handleScroll = () => {
			checkIfAtBottom();
		};

		view.registerDomEvent(container, "scroll", handleScroll);

		// Initial check
		checkIfAtBottom();
	}, [view, checkIfAtBottom]);

	return (
		<div ref={containerRef} className="obsidianaitools-chat-view-messages">
			{errorInfo ? (
				<div className="obsidianaitools-chat-error-container">
					<h4 className="obsidianaitools-chat-error-title">
						{errorInfo.title}
					</h4>
					<p className="obsidianaitools-chat-error-message">
						{errorInfo.message}
					</p>
					{errorInfo.suggestion && (
						<p className="obsidianaitools-chat-error-suggestion">
							💡 {errorInfo.suggestion}
						</p>
					)}
					<div className="obsidianaitools-chat-error-buttons">
						{errorInfo.canAutoInstall &&
							errorInfo.agentId &&
							onInstallAgent && (
								<button
									onClick={handleInstallClick}
									disabled={isInstalling}
									className="obsidianaitools-chat-error-button obsidianaitools-chat-error-install"
								>
									{isInstalling ? "Installing..." : "Install"}
								</button>
							)}
						<button
							onClick={onClearError}
							className="obsidianaitools-chat-error-button"
						>
							OK
						</button>
					</div>
				</div>
			) : messages.length === 0 ? (
				<div className="obsidianaitools-chat-empty-state">
					{isRestoringSession ? (
						"Restoring session..."
					) : !isSessionReady ? (
						!isAgentConfigured ? (
							<div className="obsidianaitools-empty-state-setup">
								<div className="obsidianaitools-empty-state-icon">
									⚙️
								</div>
								<h3>Setup Required</h3>
								<p>
									To start chatting, configure an AI agent in
									settings.
								</p>
								<div className="obsidianaitools-empty-state-actions">
									<button
										className="obsidianaitools-empty-state-button"
										onClick={onOpenSettings}
									>
										Open Settings
									</button>
									<a
										href="https://ultimateai-org.github.io/aitoolsforobsidian/getting-started/"
										target="_blank"
										className="obsidianaitools-empty-state-link"
									>
										View Setup Guide →
									</a>
								</div>
							</div>
						) : (
							`Connecting to ${agentLabel}...`
						)
					) : (
						<div className="obsidianaitools-empty-state-ready">
							<div className="obsidianaitools-empty-state-icon">💬</div>
							<p>Start a conversation with {agentLabel}...</p>
							<div className="obsidianaitools-empty-state-hints">
								<span className="obsidianaitools-hint">
									Tip: Type @ to mention notes
								</span>
								<span className="obsidianaitools-hint">
									Type / for commands
								</span>
							</div>
						</div>
					)}
				</div>
			) : (
				<>
					{messages.map((message) => (
						<MessageRenderer
							key={message.id}
							message={message}
							plugin={plugin}
							acpClient={acpClient}
							onApprovePermission={onApprovePermission}
							onSendMessage={onSendMessage}
						/>
					))}
					{isSending && (
						<div className="obsidianaitools-loading-indicator">
							<div className="obsidianaitools-loading-dots">
								<div className="obsidianaitools-loading-dot"></div>
								<div className="obsidianaitools-loading-dot"></div>
								<div className="obsidianaitools-loading-dot"></div>
								<div className="obsidianaitools-loading-dot"></div>
								<div className="obsidianaitools-loading-dot"></div>
								<div className="obsidianaitools-loading-dot"></div>
								<div className="obsidianaitools-loading-dot"></div>
								<div className="obsidianaitools-loading-dot"></div>
								<div className="obsidianaitools-loading-dot"></div>
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}
