/**
 * Confirmation Modal for Session Deletion
 *
 * Obsidian Modal that prompts user to confirm before deleting one or more
 * sessions. Prevents accidental deletion due to misclicks.
 */

import { Modal, App } from "obsidian";

/**
 * Text shown by the confirmation modal.
 */
export interface ConfirmDeleteOptions {
	/** Modal heading, e.g. "Delete session?" */
	title: string;
	/** Main question, e.g. `Are you sure you want to delete "Esteem"?` */
	message: string;
	/** Secondary note explaining the scope of the deletion */
	warning?: string;
	/** Label of the destructive button (defaults to "Delete") */
	confirmLabel?: string;
}

/** Note shown when the agent cannot delete its own copy. */
const PLUGIN_ONLY_NOTE =
	"This only removes the session from this plugin. The session data will remain on the agent side, so it may reappear in the list.";

/** Note shown when the agent deletes its own copy too. */
const AGENT_SIDE_NOTE =
	"This removes the session from the agent as well, including its transcript on disk.";

/**
 * Confirmation modal for session deletion.
 *
 * Calls onConfirm callback only when user clicks the confirm button.
 */
export class ConfirmDeleteModal extends Modal {
	private options: ConfirmDeleteOptions;
	private onConfirm: () => void | Promise<void>;

	constructor(
		app: App,
		options: ConfirmDeleteOptions,
		onConfirm: () => void | Promise<void>,
	) {
		super(app);
		this.options = options;
		this.onConfirm = onConfirm;
	}

	/**
	 * Build the options for deleting a single session.
	 *
	 * @param sessionTitle - Title shown in the question
	 * @param agentSide - Whether the agent deletes its own copy too
	 */
	static forSession(
		sessionTitle: string,
		agentSide: boolean,
	): ConfirmDeleteOptions {
		return {
			title: "Delete session?",
			message: `Are you sure you want to delete "${sessionTitle}"?`,
			warning: agentSide ? AGENT_SIDE_NOTE : PLUGIN_ONLY_NOTE,
		};
	}

	/**
	 * Build the options for deleting every listed session.
	 *
	 * @param count - How many sessions will be deleted
	 * @param openCount - How many listed sessions are open in a tab and kept
	 * @param agentSide - Whether the agent deletes its own copies too
	 */
	static forAllSessions(
		count: number,
		openCount: number,
		agentSide: boolean,
	): ConfirmDeleteOptions {
		const plural = count === 1 ? "session" : "sessions";
		const kept =
			openCount > 0
				? ` The ${openCount === 1 ? "session" : `${openCount} sessions`} open in a chat tab ${openCount === 1 ? "is" : "are"} kept.`
				: "";

		return {
			title: "Delete all sessions?",
			message: `Are you sure you want to delete ${count} ${plural}? This cannot be undone.${kept}`,
			warning: agentSide ? AGENT_SIDE_NOTE : PLUGIN_ONLY_NOTE,
			confirmLabel: "Delete all",
		};
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Title
		contentEl.createEl("h2", { text: this.options.title });

		// Message
		contentEl.createEl("p", {
			text: this.options.message,
			cls: "obsidianaitools-confirm-delete-message",
		});

		if (this.options.warning) {
			contentEl.createEl("p", {
				text: this.options.warning,
				cls: "obsidianaitools-confirm-delete-warning",
			});
		}

		// Buttons container
		const buttonContainer = contentEl.createDiv({
			cls: "obsidianaitools-confirm-delete-buttons",
		});

		// Cancel button
		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
			cls: "obsidianaitools-confirm-delete-cancel",
		});
		cancelButton.addEventListener("click", () => {
			this.close();
		});

		// Delete button
		const deleteButton = buttonContainer.createEl("button", {
			text: this.options.confirmLabel ?? "Delete",
			cls: "obsidianaitools-confirm-delete-confirm mod-warning",
		});
		deleteButton.addEventListener("click", () => {
			this.close();
			void this.onConfirm();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
