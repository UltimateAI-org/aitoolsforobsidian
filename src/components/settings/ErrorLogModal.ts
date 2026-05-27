/**
 * Error Log Modal
 *
 * Shows recent entries from the persistent error log so users can read what
 * went wrong without opening DevTools. Each entry is rendered as a formatted
 * block so structured fields (code, errorKind, data) stay readable.
 */

import { Modal, App, Notice } from "obsidian";
import type AgentClientPlugin from "../../plugin";
import type { ErrorLogEntry } from "../../shared/error-log";

const MAX_DISPLAYED_ENTRIES = 50;

export class ErrorLogModal extends Modal {
	private plugin: AgentClientPlugin;

	constructor(app: App, plugin: AgentClientPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass("obsidianaitools-error-log-modal");

		contentEl.createEl("h2", { text: "Recent errors" });

		const description = contentEl.createEl("p", {
			cls: "obsidianaitools-error-log-desc",
		});
		description.appendText("Persistent log of agent failures. File: ");
		description.createEl("code", { text: this.plugin.errorLog.getErrorLogPath() });

		const toolbar = contentEl.createDiv({
			cls: "obsidianaitools-error-log-toolbar",
		});

		const refreshButton = toolbar.createEl("button", { text: "Refresh" });
		refreshButton.addEventListener("click", () => {
			void this.renderEntries(entriesContainer);
		});

		const copyButton = toolbar.createEl("button", { text: "Copy all" });
		copyButton.addEventListener("click", () => {
			void (async () => {
				const raw = await this.plugin.errorLog.readErrorLog();
				if (!raw) {
					new Notice("Error log is empty.", 2000);
					return;
				}
				try {
					await navigator.clipboard.writeText(raw);
					new Notice("Error log copied to clipboard.", 2000);
				} catch {
					new Notice("Failed to copy to clipboard.", 3000);
				}
			})();
		});

		const clearButton = toolbar.createEl("button", {
			text: "Clear",
			cls: "mod-warning",
		});
		clearButton.addEventListener("click", () => {
			void (async () => {
				await this.plugin.errorLog.clearErrorLog();
				new Notice("Error log cleared.", 2000);
				void this.renderEntries(entriesContainer);
			})();
		});

		const entriesContainer = contentEl.createDiv({
			cls: "obsidianaitools-error-log-entries",
		});

		void this.renderEntries(entriesContainer);
	}

	onClose() {
		this.contentEl.empty();
	}

	private async renderEntries(container: HTMLElement): Promise<void> {
		container.empty();

		const entries = await this.plugin.errorLog.readErrorEntries();

		if (entries.length === 0) {
			container.createEl("p", {
				text: "No errors logged yet.",
				cls: "obsidianaitools-error-log-empty",
			});
			return;
		}

		// Show newest first, capped.
		const recent = entries.slice(-MAX_DISPLAYED_ENTRIES).reverse();

		const summary = container.createEl("p", {
			cls: "obsidianaitools-error-log-summary",
		});
		summary.setText(
			`Showing ${recent.length} of ${entries.length} entries (newest first).`,
		);

		for (const entry of recent) {
			this.renderEntry(container, entry);
		}
	}

	private renderEntry(container: HTMLElement, entry: ErrorLogEntry): void {
		const block = container.createDiv({
			cls: "obsidianaitools-error-log-entry",
		});

		const header = block.createDiv({
			cls: "obsidianaitools-error-log-entry-header",
		});
		header.createSpan({
			text: entry.timestamp,
			cls: "obsidianaitools-error-log-entry-time",
		});
		header.createSpan({
			text: entry.source,
			cls: "obsidianaitools-error-log-entry-source",
		});
		if (entry.agentId) {
			header.createSpan({
				text: entry.agentId,
				cls: "obsidianaitools-error-log-entry-agent",
			});
		}

		if (entry.message) {
			block.createEl("div", {
				text: entry.message,
				cls: "obsidianaitools-error-log-entry-message",
			});
		}

		const meta = block.createDiv({
			cls: "obsidianaitools-error-log-entry-meta",
		});
		if (entry.code !== undefined) {
			meta.createSpan({ text: `code: ${String(entry.code)}` });
		}
		if (entry.errorKind) {
			meta.createSpan({ text: `errorKind: ${entry.errorKind}` });
		}
		if (entry.sessionId) {
			meta.createSpan({
				text: `session: ${entry.sessionId.slice(0, 8)}…`,
			});
		}

		if (entry.data !== undefined) {
			const dataEl = block.createEl("pre", {
				cls: "obsidianaitools-error-log-entry-data",
			});
			dataEl.setText(safeJsonStringify(entry.data));
		}

		if (entry.stack) {
			const stackEl = block.createEl("pre", {
				cls: "obsidianaitools-error-log-entry-stack",
			});
			stackEl.setText(entry.stack);
		}
	}
}

function safeJsonStringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		if (typeof value === "string") return value;
		return "[unserializable]";
	}
}
