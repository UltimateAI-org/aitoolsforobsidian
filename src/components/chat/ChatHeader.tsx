import * as React from "react";
import { HeaderButton } from "./HeaderButton";

/**
 * One chip in the session tab strip.
 */
export interface TabStripTab {
	id: string;
	/** 1-based display number */
	number: number;
	/** Whether this tab's agent is currently working */
	busy: boolean;
}

/**
 * State + callbacks for the session tab strip, provided by TabbedChat.
 */
export interface TabStripState {
	tabs: TabStripTab[];
	activeTabId: string;
	canAddTab: boolean;
	onSelectTab: (id: string) => void;
	onNewTab: () => void;
	onCloseTab: (id: string) => void;
}

/**
 * Session tab strip — numbered chips + add button. Rendered by
 * ChatComponent in its own row directly above the chat area.
 */
export function TabStrip({ strip }: { strip: TabStripState }) {
	return (
		<div className="obsidianaitools-tab-strip">
			{strip.tabs.map((tab) => (
				<button
					key={tab.id}
					className={`obsidianaitools-tab-chip${tab.id === strip.activeTabId ? " is-active" : ""}`}
					title={`Session ${tab.number} — right-click to close`}
					onClick={() => strip.onSelectTab(tab.id)}
					onContextMenu={(e) => {
						e.preventDefault();
						strip.onCloseTab(tab.id);
					}}
				>
					{tab.number}
					{tab.busy && (
						<span className="obsidianaitools-tab-chip-busy" />
					)}
				</button>
			))}
			{strip.canAddTab && (
				<button
					className="obsidianaitools-tab-chip obsidianaitools-tab-chip-add"
					title="New session tab"
					onClick={strip.onNewTab}
				>
					+
				</button>
			)}
		</div>
	);
}

/**
 * Props for ChatHeader component
 */
export interface ChatHeaderProps {
	/** Display name of the active agent */
	agentLabel: string;
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
	/** Whether session history is supported (show History button) */
	hasHistoryCapability?: boolean;
	/** Callback to create a new chat session */
	onNewChat: () => void;
	/** Callback to export the chat */
	onExportChat: () => void;
	/** Callback to open settings */
	onOpenSettings: () => void;
	/** Callback to open session history */
	onOpenHistory?: () => void;
}

/**
 * Header component for the chat view.
 *
 * Displays:
 * - Agent name
 * - Update notification (if available)
 * - Action buttons (new chat, history, export, settings)
 */
export function ChatHeader({
	agentLabel,
	isUpdateAvailable,
	hasHistoryCapability = false,
	onNewChat,
	onExportChat,
	onOpenSettings,
	onOpenHistory,
}: ChatHeaderProps) {
	return (
		<div className="obsidianaitools-chat-view-header">
			<div className="obsidianaitools-chat-view-header-main">
				<h3 className="obsidianaitools-chat-view-header-title">
					{agentLabel}
				</h3>
			</div>
			{isUpdateAvailable && (
				<p className="obsidianaitools-chat-view-header-update">
					Update available!
				</p>
			)}
			<div className="obsidianaitools-chat-view-header-actions">
				<HeaderButton
					iconName="plus"
					tooltip="New chat"
					onClick={onNewChat}
				/>
				{onOpenHistory && (
					<HeaderButton
						iconName="history"
						tooltip="Session history"
						onClick={onOpenHistory}
					/>
				)}
				<HeaderButton
					iconName="save"
					tooltip="Export chat to Markdown"
					onClick={onExportChat}
				/>
				<HeaderButton
					iconName="settings"
					tooltip="Settings"
					onClick={onOpenSettings}
				/>
			</div>
		</div>
	);
}
