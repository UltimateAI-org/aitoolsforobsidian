import { App, Modal, Setting } from "obsidian";
import type { QuickPromptSetting } from "../../plugin";

/**
 * Modal for creating or editing a single quick prompt.
 * Works on a draft copy; nothing is persisted until Save.
 */
export class QuickPromptEditModal extends Modal {
	private draft: QuickPromptSetting;
	private isNew: boolean;
	private onSave: (result: QuickPromptSetting) => Promise<void> | void;

	constructor(
		app: App,
		initial: QuickPromptSetting,
		onSave: (result: QuickPromptSetting) => Promise<void> | void,
	) {
		super(app);
		this.draft = { ...initial };
		this.isNew = initial.name.trim().length === 0;
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		this.titleEl.setText(
			this.isNew ? "Add quick prompt" : "Edit quick prompt",
		);

		new Setting(contentEl)
			.setName("Name")
			.setDesc("Label shown on the chip and in the ! menu.")
			.addText((text) => {
				text.setPlaceholder("Summarize note")
					.setValue(this.draft.name)
					.onChange((value) => {
						this.draft.name = value.trim();
					});
			});

		new Setting(contentEl)
			.setName("Prompt")
			.setDesc(
				"Message sent to the agent. Wikilink mentions resolve to notes.",
			)
			.addTextArea((text) => {
				text.setPlaceholder(
					"Summarize the key points of this note as a bullet list.",
				)
					.setValue(this.draft.prompt)
					.onChange((value) => {
						this.draft.prompt = value;
					});
				text.inputEl.rows = 6;
				text.inputEl.addClass("obsidianaitools-qp-modal-textarea");
			});

		new Setting(contentEl)
			.setName("Send immediately")
			.setDesc(
				"On: firing the prompt sends it right away. Off: it is inserted into the message box for editing first.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.draft.sendImmediately)
					.onChange((value) => {
						this.draft.sendImmediately = value;
					}),
			);

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText("Save")
					.setCta()
					.onClick(async () => {
						await this.onSave({ ...this.draft });
						this.close();
					}),
			)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.close()),
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}
