import {
	App,
	ButtonComponent,
	PluginSettingTab,
	Setting,
	DropdownComponent,
	Platform,
	Notice,
} from "obsidian";
import type AgentClientPlugin from "../../plugin";
import type { CustomAgentSettings, AgentEnvVar } from "../../plugin";
import { normalizeEnvVars } from "../../shared/settings-utils";
import { detectNodePath, detectAgentPath, validatePath } from "../../shared/path-detector";
import { checkAgentVersion, getNpmPackage } from "../../shared/version-checker";
import {
	installAgent,
	getAgentDisplayName,
	showAgentRestartNotice,
} from "../../shared/agent-installer";
import { ErrorLogModal } from "./ErrorLogModal";

export class AgentClientSettingTab extends PluginSettingTab {
	plugin: AgentClientPlugin;
	private agentSelector: DropdownComponent | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(app: App, plugin: AgentClientPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		this.agentSelector = null;

		// Cleanup previous subscription if exists
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}

		// Documentation link
		const docContainer = containerEl.createDiv({
			cls: "obsidianaitools-doc-link",
		});
		docContainer.createSpan({ text: "Need help? Check out the " });
		docContainer.createEl("a", {
			text: "documentation",
			href: "https://github.com/UltimateAI-org/aitoolsforobsidian",
		});
		docContainer.createSpan({ text: "." });

		// ─────────────────────────────────────────────────────────────────────
		// Top-level settings (no header)
		// ─────────────────────────────────────────────────────────────────────

		this.renderAgentSelector(containerEl);

		// Subscribe to settings changes to update agent dropdown
		this.unsubscribe = this.plugin.settingsStore.subscribe(() => {
			this.updateAgentDropdown();
		});

		// Also update immediately on display to sync with current settings
		this.updateAgentDropdown();

		new Setting(containerEl)
			.setName("Node.js path")
			.setDesc(
				"Absolute path to Node.js executable. Required for npm-based agents.",
			)
			.addText((text) => {
				text.setPlaceholder("Absolute path to node")
					.setValue(this.plugin.settings.nodePath)
					.onChange(async (value) => {
						const trimmed = value.trim();
						this.plugin.settings.nodePath = trimmed;
						if (trimmed) {
							const validation = validatePath(trimmed);
							if (!validation.valid) {
								new Notice(`Warning: ${validation.error}`, 3000);
							}
						}
						await this.plugin.saveSettings();
					});
			})
			.addButton((button) =>
				button
					.setButtonText("Auto-detect")
					.setTooltip("Try to automatically detect Node.js installation")
					.onClick(async () => {
						const result = detectNodePath();
						if (result.path) {
							const validation = validatePath(result.path);
							if (validation.valid) {
								this.plugin.settings.nodePath = result.path;
								await this.plugin.saveSettings();
								this.display(); // Refresh to show new value
								new Notice(`Node.js found: ${result.path}`, 3000);
							} else {
								new Notice(
									`Node.js detected but not working: ${validation.error}`,
									4000,
								);
							}
						} else {
							new Notice(
								"Node.js not found. Please install Node.js first.",
								4000,
							);
						}
					}),
			);

		this.renderSystemStatusSection(containerEl);

		// ─────────────────────────────────────────────────────────────────────
		// API Configuration (global for all agents)
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName("API Configuration").setHeading();

		new Setting(containerEl)
			.setName("API Key")
			.setDesc(
				"API key used by all agents. For Claude, this is used as ANTHROPIC_AUTH_TOKEN. For Gemini, this is used as GEMINI_API_KEY.",
			)
			.addText((text) => {
				text.setPlaceholder("Enter your API key")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
				// Make the input a password field
				text.inputEl.type = "password";
			});

		// API Key Instructions
		const instructionsDiv = containerEl.createDiv({
			cls: "obsidianaitools-onboarding-instructions",
		});

		new Setting(instructionsDiv).setName("How to get your API key:").setHeading();

		const stepsList = instructionsDiv.createEl("ol", {
			cls: "obsidianaitools-onboarding-instructions-list",
		});

		const step1 = stepsList.createEl("li");
		step1.appendText("Go to ");
		step1.createEl("a", {
			text: "https://chat.obsidianaitools.com",
			href: "https://chat.obsidianaitools.com",
		});

		stepsList.createEl("li", { text: "Click Settings (top right)" });
		stepsList.createEl("li", { text: "Left Click Account" });
		stepsList.createEl("li", { text: "Copy API Key" });
		stepsList.createEl("li", { text: "Paste into field above" });

		instructionsDiv.createEl("p", {
			text: "Note: This plugin only supports AI Tools inside Obsidian.",
		});

		const subscriptionText = instructionsDiv.createEl("p");
		subscriptionText.appendText(
			"For more details on getting a subscription please visit ",
		);
		subscriptionText.createEl("a", {
			text: "https://obsidianaitools.com",
			href: "https://obsidianaitools.com",
		});

		const supportText = instructionsDiv.createEl("p");
		supportText.appendText(
			"The API is hosted with UltimateAI - for API support please email ",
		);
		supportText.createEl("a", {
			text: "support@ultimateai.org",
			href: "mailto:support@ultimateai.org",
		});

		new Setting(containerEl)
			.setName("Send message shortcut")
			.setDesc(
				"Choose the keyboard shortcut to send messages. Note: If using Cmd/Ctrl+Enter, you may need to remove any hotkeys assigned to Cmd/Ctrl+Enter (Settings → Hotkeys).",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption(
						"enter",
						"Enter to send, Shift+Enter for newline",
					)
					.addOption(
						"cmd-enter",
						"Cmd/Ctrl+Enter to send, Enter for newline",
					)
					.setValue(this.plugin.settings.sendMessageShortcut)
					.onChange(async (value) => {
						this.plugin.settings.sendMessageShortcut = value as
							| "enter"
							| "cmd-enter";
						await this.plugin.saveSettings();
					}),
			);

		// ─────────────────────────────────────────────────────────────────────
		// Mentions
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName("Mentions").setHeading();

		new Setting(containerEl)
			.setName("Auto-mention active note")
			.setDesc(
				"Include the current note in your messages automatically. The agent will have access to its content without typing @notename.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoMentionActiveNote)
					.onChange(async (value) => {
						this.plugin.settings.autoMentionActiveNote = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Max note length")
			.setDesc(
				"Maximum characters per mentioned note. Notes longer than this will be truncated.",
			)
			.addText((text) =>
				text
					.setPlaceholder("10000")
					.setValue(
						String(
							this.plugin.settings.displaySettings.maxNoteLength,
						),
					)
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 1) {
							this.plugin.settings.displaySettings.maxNoteLength =
								num;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Max selection length")
			.setDesc(
				"Maximum characters for text selection in auto-mention. Selections longer than this will be truncated.",
			)
			.addText((text) =>
				text
					.setPlaceholder("10000")
					.setValue(
						String(
							this.plugin.settings.displaySettings
								.maxSelectionLength,
						),
					)
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 1) {
							this.plugin.settings.displaySettings.maxSelectionLength =
								num;
							await this.plugin.saveSettings();
						}
					}),
			);

		// ─────────────────────────────────────────────────────────────────────
		// Display
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName("Display").setHeading();

		new Setting(containerEl)
			.setName("Auto-collapse long diffs")
			.setDesc(
				"Automatically collapse diffs that exceed the line threshold.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.displaySettings.autoCollapseDiffs,
					)
					.onChange(async (value) => {
						this.plugin.settings.displaySettings.autoCollapseDiffs =
							value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.displaySettings.autoCollapseDiffs) {
			new Setting(containerEl)
				.setName("Collapse threshold")
				.setDesc(
					"Diffs with more lines than this will be collapsed by default.",
				)
				.addText((text) =>
					text
						.setPlaceholder("10")
						.setValue(
							String(
								this.plugin.settings.displaySettings
									.diffCollapseThreshold,
							),
						)
						.onChange(async (value) => {
							const num = parseInt(value, 10);
							if (!isNaN(num) && num > 0) {
								this.plugin.settings.displaySettings.diffCollapseThreshold =
									num;
								await this.plugin.saveSettings();
							}
						}),
				);
		}

		// ─────────────────────────────────────────────────────────────────────
		// Permissions
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName("Permissions").setHeading();

		new Setting(containerEl)
			.setName("Auto-allow permissions")
			.setDesc(
				"Automatically allow all permission requests from agents. ⚠️ Use with caution - this gives agents full access to your system.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoAllowPermissions)
					.onChange(async (value) => {
						this.plugin.settings.autoAllowPermissions = value;
						await this.plugin.saveSettings();
					}),
			);

		// ─────────────────────────────────────────────────────────────────────
		// Windows WSL Settings (Windows only)
		// ─────────────────────────────────────────────────────────────────────

		if (Platform.isWin) {
			new Setting(containerEl)
				.setName("Windows Subsystem for Linux")
				.setHeading();

			new Setting(containerEl)
				.setName("Enable WSL mode")
				.setDesc(
					"Run agents inside Windows Subsystem for Linux. Recommended for agents like Codex that don't work well in native Windows environments.",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.windowsWslMode)
						.onChange(async (value) => {
							this.plugin.settings.windowsWslMode = value;
							await this.plugin.saveSettings();
							this.display(); // Refresh to show/hide distribution setting
						}),
				);

			if (this.plugin.settings.windowsWslMode) {
				new Setting(containerEl)
					.setName("WSL distribution")
					.setDesc(
						"Specify WSL distribution name (leave empty for default). Example: Ubuntu, Debian",
					)
					.addText((text) =>
						text
							.setPlaceholder("Leave empty for default")
							.setValue(
								this.plugin.settings.windowsWslDistribution ||
									"",
							)
							.onChange(async (value) => {
								this.plugin.settings.windowsWslDistribution =
									value.trim() || undefined;
								await this.plugin.saveSettings();
							}),
					);
			}
		}

		// ─────────────────────────────────────────────────────────────────────
		// Agents
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName("Built-in agents").setHeading();

		this.renderClaudeSettings(containerEl);
		this.renderCodexSettings(containerEl);
		this.renderGeminiSettings(containerEl);

		new Setting(containerEl).setName("Custom agents").setHeading();

		this.renderCustomAgents(containerEl);

		// ─────────────────────────────────────────────────────────────────────
		// Export
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName("Export").setHeading();

		new Setting(containerEl)
			.setName("Export folder")
			.setDesc("Folder where chat exports will be saved")
			.addText((text) =>
				text
					.setPlaceholder("AI tools")
					.setValue(this.plugin.settings.exportSettings.defaultFolder)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.defaultFolder =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Filename")
			.setDesc(
				"Template for exported filenames. Use {date} for date and {time} for time",
			)
			.addText((text) =>
				text
					.setPlaceholder("agent_client_{date}_{time}")
					.setValue(
						this.plugin.settings.exportSettings.filenameTemplate,
					)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.filenameTemplate =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Include images")
			.setDesc("Include images in exported markdown files")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.exportSettings.includeImages)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.includeImages =
							value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.exportSettings.includeImages) {
			new Setting(containerEl)
				.setName("Image location")
				.setDesc("Where to save exported images")
				.addDropdown((dropdown) =>
					dropdown
						.addOption(
							"obsidian",
							"Use Obsidian's attachment setting",
						)
						.addOption("custom", "Save to custom folder")
						.addOption(
							"base64",
							"Embed as Base64 (not recommended)",
						)
						.setValue(
							this.plugin.settings.exportSettings.imageLocation,
						)
						.onChange(async (value) => {
							this.plugin.settings.exportSettings.imageLocation =
								value as "obsidian" | "custom" | "base64";
							await this.plugin.saveSettings();
							this.display();
						}),
				);

			if (
				this.plugin.settings.exportSettings.imageLocation === "custom"
			) {
				new Setting(containerEl)
					.setName("Custom image folder")
					.setDesc(
						"Folder path for exported images (relative to vault root)",
					)
					.addText((text) =>
						text
							.setPlaceholder("AI tools")
							.setValue(
								this.plugin.settings.exportSettings
									.imageCustomFolder,
							)
							.onChange(async (value) => {
								this.plugin.settings.exportSettings.imageCustomFolder =
									value;
								await this.plugin.saveSettings();
							}),
					);
			}
		}

		new Setting(containerEl)
			.setName("Auto-export on new chat")
			.setDesc(
				"Automatically export the current chat when starting a new chat",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.exportSettings.autoExportOnNewChat,
					)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.autoExportOnNewChat =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-export on close chat")
			.setDesc(
				"Automatically export the current chat when closing the chat view",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.exportSettings
							.autoExportOnCloseChat,
					)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.autoExportOnCloseChat =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Open note after export")
			.setDesc("Automatically open the exported note after exporting")
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.exportSettings.openFileAfterExport,
					)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.openFileAfterExport =
							value;
						await this.plugin.saveSettings();
					}),
			);

		// ─────────────────────────────────────────────────────────────────────
		// Developer
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName("Developer").setHeading();

		new Setting(containerEl)
			.setName("Debug mode")
			.setDesc(
				"Enable debug logging to console and capture the full ACP wire traffic to acp-wire.log. Useful for development and troubleshooting.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debugMode)
					.onChange(async (value) => {
						this.plugin.settings.debugMode = value;
						await this.plugin.saveSettings();
					}),
			);

		this.renderDiagnosticsSection(containerEl);
	}

	/**
	 * Render diagnostics controls for the persistent error log.
	 *
	 * Errors caught by the AcpAdapter and message-service are appended as
	 * NDJSON to <vault>/<configDir>/plugins/obsidianaitools/error.log. This
	 * section lets users view, copy and clear that file without opening
	 * DevTools.
	 */
	private renderDiagnosticsSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Diagnostics").setHeading();

		new Setting(containerEl)
			.setName("Error log")
			.setDesc(
				"Persistent log of agent failures (socket errors, prompt errors, agent stderr). Recorded automatically.",
			)
			.addButton((button) =>
				button
					.setButtonText("View")
					.setCta()
					.onClick(() => {
						new ErrorLogModal(this.app, this.plugin).open();
					}),
			)
			.addButton((button) =>
				button.setButtonText("Copy").onClick(async () => {
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
				}),
			)
			.addButton((button) =>
				button
					.setButtonText("Clear")
					.setWarning()
					.onClick(async () => {
						await this.plugin.errorLog.clearErrorLog();
						new Notice("Error log cleared.", 2000);
					}),
			);

		const pathInfo = containerEl.createDiv({
			cls: "obsidianaitools-diagnostics-path",
		});
		pathInfo.appendText("Log file: ");
		pathInfo.createEl("code", {
			text: this.plugin.errorLog.getErrorLogPath(),
		});

		if (this.plugin.settings.debugMode) {
			new Setting(containerEl)
				.setName("ACP wire log")
				.setDesc(
					"Full JSON-RPC traffic captured while debug mode is on. Use this to share precise traces with maintainers.",
				)
				.addButton((button) =>
					button.setButtonText("Copy").onClick(async () => {
						const raw = await this.plugin.errorLog.readWireLog();
						if (!raw) {
							new Notice("Wire log is empty.", 2000);
							return;
						}
						try {
							await navigator.clipboard.writeText(raw);
							new Notice("Wire log copied to clipboard.", 2000);
						} catch {
							new Notice("Failed to copy to clipboard.", 3000);
						}
					}),
				)
				.addButton((button) =>
					button
						.setButtonText("Clear")
						.setWarning()
						.onClick(async () => {
							await this.plugin.errorLog.clearWireLog();
							new Notice("Wire log cleared.", 2000);
						}),
				);

			const wirePathInfo = containerEl.createDiv({
				cls: "obsidianaitools-diagnostics-path",
			});
			wirePathInfo.appendText("Wire log file: ");
			wirePathInfo.createEl("code", {
				text: this.plugin.errorLog.getWireLogPath(),
			});
		}
	}

	/**
	 * Update the agent dropdown when settings change.
	 * Only updates if the value is different to avoid infinite loops.
	 */
	private updateAgentDropdown(): void {
		if (!this.agentSelector) {
			return;
		}

		// Get latest settings from store snapshot
		const settings = this.plugin.settingsStore.getSnapshot();
		const currentValue = this.agentSelector.getValue();

		// Only update if different to avoid triggering onChange
		if (settings.activeAgentId !== currentValue) {
			this.agentSelector.setValue(settings.activeAgentId);
		}
	}

	/**
	 * Called when the settings tab is hidden.
	 * Clean up subscriptions to prevent memory leaks.
	 */
	hide(): void {
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
	}

	private renderAgentSelector(containerEl: HTMLElement) {
		this.plugin.ensureActiveAgentId();

		new Setting(containerEl)
			.setName("Active agent")
			.setDesc("Choose which agent handles new chat sessions.")
			.addDropdown((dropdown) => {
				this.agentSelector = dropdown;
				this.populateAgentDropdown(dropdown);
				dropdown.setValue(this.plugin.settings.activeAgentId);
				dropdown.onChange(async (value) => {
					const nextSettings = {
						...this.plugin.settings,
						activeAgentId: value,
					};
					this.plugin.ensureActiveAgentId();
					await this.plugin.saveSettingsAndNotify(nextSettings);
				});
			});
	}

	private populateAgentDropdown(dropdown: DropdownComponent) {
		dropdown.selectEl.empty();
		for (const option of this.getAgentOptions()) {
			dropdown.addOption(option.id, option.label);
		}
	}

	private refreshAgentDropdown() {
		if (!this.agentSelector) {
			return;
		}
		this.populateAgentDropdown(this.agentSelector);
		this.agentSelector.setValue(this.plugin.settings.activeAgentId);
	}

	private getAgentOptions(): { id: string; label: string }[] {
		const toOption = (id: string, displayName: string) => ({
			id,
			label: `${displayName} (${id})`,
		});
		const claudeName =
			this.plugin.settings.claude.displayName ||
			this.plugin.settings.claude.id;
		const options: { id: string; label: string }[] = [
			{
				id: this.plugin.settings.claude.id,
				label: `${claudeName} - Recommended`,
			},
			{
				id: this.plugin.settings.gemini.id,
				label: `${this.plugin.settings.gemini.displayName || this.plugin.settings.gemini.id} - Experimental`,
			},
		];
		for (const agent of this.plugin.settings.customAgents) {
			if (agent.id && agent.id.length > 0) {
				const labelSource =
					agent.displayName && agent.displayName.length > 0
						? agent.displayName
						: agent.id;
				options.push(toOption(agent.id, labelSource));
			}
		}
		const seen = new Set<string>();
		return options.filter(({ id }) => {
			if (seen.has(id)) {
				return false;
			}
			seen.add(id);
			return true;
		});
	}

	/**
	 * Look up the configured command path for a known agent, used to give
	 * the version checker a fast/reliable installed-version source.
	 */
	private commandPathForAgent(agentId: string): string | undefined {
		const s = this.plugin.settings;
		if (agentId === s.claude.id) return s.claude.command || undefined;
		if (agentId === s.codex.id) return s.codex.command || undefined;
		if (agentId === s.gemini.id) return s.gemini.command || undefined;
		return undefined;
	}

	/**
	 * True when a command string is a bare executable name with no directory
	 * component (e.g. "claude-agent-acp"). existsSync always returns false for
	 * bare names, so they must be replaced with full paths for reliable checks.
	 */
	private static isBareCommand(cmd: string): boolean {
		return !!cmd && !cmd.includes("/") && !cmd.includes("\\");
	}

	/**
	 * After a successful npm install, auto-detect the binary path and persist
	 * it so subsequent version checks use the fast existsSync path instead of
	 * falling through to slow npm spawns.
	 *
	 * Saves when the command is empty OR is a bare name (no path separator) —
	 * bare names fail existsSync so the settings always show "Not installed".
	 * Never overwrites a path that already contains a directory separator.
	 */
	private async autoSaveCommandPath(agentId: string): Promise<void> {
		try {
			// 1. Standard detection: which/where + common filesystem paths.
			const { detectAgentPath } = await import("../../shared/path-detector");
			let fullPath = detectAgentPath(agentId).path;

			// 2. Fallback: derive the bin directory from `npm root -g`.
			//    Reliable right after install even when the login shell hasn't
			//    picked up the new PATH (common on Linux GUI apps).
			if (!fullPath) {
				fullPath = await this.detectPathFromNpmRoot(agentId);
			}

			if (!fullPath) return;

			const s = this.plugin.settings;
			const needsSave = (cmd: string) =>
				!cmd || AgentClientSettingTab.isBareCommand(cmd);

			if (agentId === s.claude.id && needsSave(s.claude.command)) {
				s.claude.command = fullPath;
			} else if (agentId === s.codex.id && needsSave(s.codex.command)) {
				s.codex.command = fullPath;
			} else if (agentId === s.gemini.id && needsSave(s.gemini.command)) {
				s.gemini.command = fullPath;
			} else {
				return;
			}
			await this.plugin.saveSettings();
		} catch {
			// Non-critical — version check will fall back to detection
		}
	}

	/**
	 * Derive the agent binary path from `npm root -g`.
	 * npm root -g  →  e.g. /usr/local/lib/node_modules  (Unix)
	 *                      C:\Users\…\npm\node_modules   (Windows)
	 * Bin dir      →       /usr/local/bin                (Unix, up two + /bin)
	 *                      C:\Users\…\npm                (Windows, up one)
	 */
	private async detectPathFromNpmRoot(agentId: string): Promise<string | null> {
		try {
			const { getNpmGlobalRoot } = await import("../../shared/version-checker");
			const root = await getNpmGlobalRoot(this.plugin.settings.nodePath);
			if (!root) return null;

			const path = await import("path");
			const { existsSync } = await import("fs");
			const { Platform } = await import("obsidian");

			const BINARY_NAMES: Record<string, { win: string; unix: string }> = {
				"claude-code-acp": { win: "claude-agent-acp.cmd", unix: "claude-agent-acp" },
				"codex-acp":       { win: "codex-acp.cmd",        unix: "codex-acp" },
				"gemini-cli":      { win: "gemini.cmd",            unix: "gemini" },
			};
			const names = BINARY_NAMES[agentId];
			if (!names) return null;

			let binDir: string;
			if (Platform.isWin) {
				// root = …\npm\node_modules  →  bin = …\npm
				binDir = path.dirname(root);
			} else {
				// root = …/lib/node_modules  →  prefix = …  →  bin = …/bin
				binDir = path.join(path.dirname(path.dirname(root)), "bin");
			}

			const binaryName = Platform.isWin ? names.win : names.unix;
			const fullPath = path.join(binDir, binaryName);
			return existsSync(fullPath) ? fullPath : null;
		} catch {
			return null;
		}
	}

	/**
	 * Render a prominent "System status" section at the top of settings that
	 * surfaces node, npm, and each known agent's npm-package version in one
	 * glance. Node and npm are display-only (deliberately no update button —
	 * updating those mid-session can break things). Agent rows include an
	 * Update button when outdated.
	 */
	private renderSystemStatusSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("System status").setHeading();

		this.renderEnvVersionRow(containerEl, "Node.js", "node");
		this.renderEnvVersionRow(containerEl, "npm", "npm");

		// Agent rows — Codex omitted intentionally until it's general-use ready.
		const knownAgents: Array<[string, string]> = [
			[this.plugin.settings.claude.id, this.plugin.settings.claude.displayName || "Claude Agent"],
			[this.plugin.settings.gemini.id, this.plugin.settings.gemini.displayName || "Gemini CLI"],
		];
		for (const [agentId, displayName] of knownAgents) {
			if (getNpmPackage(agentId)) {
				this.renderAgentVersionRow(containerEl, agentId, displayName);
			}
		}
	}

	/**
	 * Render a read-only version row for node or npm. No update button —
	 * those are managed outside the plugin and auto-bumping them risks
	 * breaking the user's wider toolchain.
	 */
	private renderEnvVersionRow(
		containerEl: HTMLElement,
		label: string,
		which: "node" | "npm",
	): void {
		const setting = new Setting(containerEl)
			.setName(label)
			.setDesc("Checking…");

		const check = async () => {
			const { getNodeVersion, getNpmVersion } = await import(
				"../../shared/version-checker"
			);
			const version =
				which === "node"
					? await getNodeVersion(this.plugin.settings.nodePath)
					: await getNpmVersion(this.plugin.settings.nodePath);
			if (version) {
				setting.setDesc(`Installed: ${version}`);
			} else {
				setting.setDesc(
					`Not found. Check the Node.js path setting above.`,
				);
			}
		};
		void check();
	}

	/**
	 * Render a "Version" row showing the agent's installed npm version vs.
	 * the latest published version, with an "Update" button when outdated.
	 * Async — kicks off the check on render and updates the row in place.
	 */
	private renderAgentVersionRow(
		sectionEl: HTMLElement,
		agentId: string,
		label?: string,
	): void {
		const pkg = getNpmPackage(agentId);
		if (!pkg) return; // Custom agents — nothing to check

		const setting = new Setting(sectionEl)
			.setName(label ?? "Version")
			.setDesc("Checking npm registry…");

		type Mode = "check" | "update";
		let mode: Mode = "check";
		let btnComp: ButtonComponent | null = null;
		let rollbackBtnComp: ButtonComponent | null = null;
		// Captured from the most recent runCheck so the rollback handler knows
		// which version to pin without re-fetching.
		let currentMaxTested: string | null = null;

		const setButtonState = (label: string, disabled: boolean): void => {
			if (!btnComp) return;
			btnComp.setButtonText(label);
			btnComp.setDisabled(disabled);
		};

		const setRollbackState = (
			visible: boolean,
			targetVersion: string | null,
			disabled: boolean,
		): void => {
			if (!rollbackBtnComp) return;
			rollbackBtnComp.buttonEl.classList.toggle(
				"obsidianaitools-hidden",
				!visible,
			);
			if (visible && targetVersion) {
				rollbackBtnComp.setButtonText(`Roll back to v${targetVersion}`);
			}
			rollbackBtnComp.setDisabled(disabled);
		};

		const runCheck = async (): Promise<void> => {
			setting.setDesc("Checking npm registry…");
			setButtonState("Checking…", true);
			setRollbackState(false, null, false);
			try {
				const commandPath = this.commandPathForAgent(agentId);
				const info = await checkAgentVersion(
					agentId,
					this.plugin.settings.nodePath,
					commandPath,
				);
				currentMaxTested = info.maxTestedVersion;
				const aboveTested =
					info.isAboveTestedVersion && info.maxTestedVersion;
				const aboveTestedSuffix = aboveTested
					? ` Newer than tested (v${info.maxTestedVersion}).`
					: "";

				// Not installed → offer Install. (Rollback is meaningless here.)
				if (!info.isInstalled) {
					mode = "update";
					setting.setDesc(
						info.latest
							? `Not installed. Latest: ${info.latest}.`
							: "Not installed. Could not reach npm registry.",
					);
					setButtonState(
						info.latest ? `Install ${info.latest}` : "Install",
						false,
					);
					return;
				}

				// Installed but registry unreachable → no actionable state.
				if (!info.latest) {
					mode = "check";
					setting.setDesc(
						(info.installed
							? `Installed: ${info.installed}. Could not reach npm registry.`
							: "Installed. Could not reach npm registry.") +
							aboveTestedSuffix,
					);
					setButtonState("Check again", false);
					setRollbackState(
						!!aboveTested,
						info.maxTestedVersion,
						false,
					);
					return;
				}

				// Installed + on latest → up to date.
				if (info.installed && !info.isOutdated) {
					mode = "check";
					setting.setDesc(
						`Installed: ${info.installed} (up to date).${aboveTestedSuffix}`,
					);
					setButtonState("Check again", false);
					setRollbackState(
						!!aboveTested,
						info.maxTestedVersion,
						false,
					);
					return;
				}

				// Installed + outdated (known): show both versions.
				// Installed + unknown version: just offer the latest.
				mode = "update";
				setting.setDesc(
					(info.installed
						? `Installed: ${info.installed} → Latest: ${info.latest} — update available.`
						: `Installed. Latest: ${info.latest} — update available.`) +
						aboveTestedSuffix,
				);
				setButtonState(`Update to ${info.latest}`, false);
				setRollbackState(!!aboveTested, info.maxTestedVersion, false);
			} catch {
				mode = "check";
				setting.setDesc("Version check failed.");
				setButtonState("Check again", false);
				setRollbackState(false, null, false);
			}
		};

		const runUpdate = async (): Promise<void> => {
			setButtonState("Disconnecting agent…", true);
			setting.setDesc("Stopping the running agent so npm can replace its files…");
			// Release file locks the running agent holds on its own binaries.
			// Without this, Windows fails the npm install with EPERM.
			await this.plugin.disconnectAgentForFileOperation();
			setButtonState("Installing…", true);
			setting.setDesc(`Running: npm install -g ${pkg}@latest --force`);
			const buf: string[] = [];
			const childProcess = installAgent(
				agentId,
				this.plugin.settings.nodePath,
				(output) => {
					buf.push(output);
				},
			);
			if (!childProcess) {
				new Notice(`Failed to start install for ${pkg}`, 4000);
				void runCheck();
				return;
			}
			childProcess.on("close", (code) => {
				if (code === 0) {
					// Auto-detect the installed binary and save the path to
					// settings so the version check re-run uses the fast path
					// (avoids showing "Not installed" on Linux/Mac after install).
					void this.autoSaveCommandPath(agentId).then(() => void runCheck());
					// Persistent notice with Restart Now so the user knows the
					// new binary won't be used until Obsidian re-spawns the agent.
					showAgentRestartNotice(
						this.plugin,
						`${getAgentDisplayName(agentId)} updated successfully.`,
					);
				} else {
					const full = buf.join("");
					console.error(
						`[AgentVersionRow] npm install failed (exit ${code}). Full output:\n${full}`,
					);
					const errLines = full
						.split(/\r?\n/)
						.map((l) => l.trim())
						.filter((l) => /^npm (ERR!|error)/i.test(l));
					const summary = (errLines[0] ?? full).slice(0, 220);
					new Notice(
						`Update failed (exit ${code}). ${summary} See dev console for full log.`,
						10000,
					);
					void runCheck(); // re-check on failure too
				}
			});
			childProcess.on("error", (err) => {
				new Notice(`Update error: ${err.message}`, 6000);
				void runCheck();
			});
		};

		const runRollback = async (): Promise<void> => {
			const target = currentMaxTested;
			if (!target) return;
			setRollbackState(true, target, true);
			setButtonState("Rolling back…", true);
			setting.setDesc(
				`Stopping the running agent so npm can replace its files…`,
			);
			await this.plugin.disconnectAgentForFileOperation();
			setting.setDesc(
				`Running: npm install -g ${pkg}@${target} --force`,
			);
			const buf: string[] = [];
			const childProcess = installAgent(
				agentId,
				this.plugin.settings.nodePath,
				(output) => {
					buf.push(output);
				},
				target,
			);
			if (!childProcess) {
				new Notice(`Failed to start rollback for ${pkg}`, 4000);
				void runCheck();
				return;
			}
			childProcess.on("close", (code) => {
				if (code === 0) {
					// Same post-install dance as update: re-detect the path and
					// re-run the check so the row reflects the new state.
					void this.autoSaveCommandPath(agentId).then(
						() => void runCheck(),
					);
					showAgentRestartNotice(
						this.plugin,
						`${getAgentDisplayName(agentId)} rolled back to v${target}.`,
					);
				} else {
					const full = buf.join("");
					console.error(
						`[AgentVersionRow] rollback failed (exit ${code}). Full output:\n${full}`,
					);
					const errLines = full
						.split(/\r?\n/)
						.map((l) => l.trim())
						.filter((l) => /^npm (ERR!|error)/i.test(l));
					const summary = (errLines[0] ?? full).slice(0, 220);
					new Notice(
						`Rollback failed (exit ${code}). ${summary} See dev console for full log.`,
						10000,
					);
					void runCheck();
				}
			});
			childProcess.on("error", (err) => {
				new Notice(`Rollback error: ${err.message}`, 6000);
				void runCheck();
			});
		};

		setting.addButton((btn) => {
			btnComp = btn;
			btn.setButtonText("Checking…")
				.setDisabled(true)
				.onClick(() => {
					if (mode === "update") void runUpdate();
					else void runCheck();
				});
		});

		// Secondary action — only visible when installed version is above
		// the version this plugin release was tested against. Lets users
		// recover from a known-untested agent version without leaving
		// settings (the chat banner's dismiss state can hide its own
		// rollback button, so this is the discoverable home).
		setting.addButton((btn) => {
			rollbackBtnComp = btn;
			btn.setButtonText("Roll back").onClick(() => void runRollback());
			btn.buttonEl.classList.add("obsidianaitools-hidden");
		});

		// Initial check on render
		void runCheck();
	}

	private renderGeminiSettings(sectionEl: HTMLElement) {
		const gemini = this.plugin.settings.gemini;

		new Setting(sectionEl)
			.setName(gemini.displayName || "Gemini CLI")
			.setDesc("Experimental — limited tool support through ACP mode.")
			.setHeading();

		new Setting(sectionEl)
			.setName("Path")
			.setDesc("Absolute path to the Gemini CLI executable. Install via: npm install -g @google/gemini-cli")
			.addText((text) => {
				text.setPlaceholder("Absolute path to gemini")
					.setValue(gemini.command)
					.onChange(async (value) => {
						const trimmed = value.trim();
						this.plugin.settings.gemini.command = trimmed;
						if (trimmed) {
							const validation = validatePath(trimmed);
							if (!validation.valid) {
								new Notice(`Warning: ${validation.error}`, 3000);
							}
						}
						await this.plugin.saveSettings();
					});
			})
			.addButton((button) =>
				button
					.setButtonText("Auto-detect")
					.setTooltip("Try to automatically detect Gemini CLI")
					.onClick(async () => {
						const result = detectAgentPath("gemini-cli");
						if (result.path) {
							const validation = validatePath(result.path);
							if (validation.valid) {
								this.plugin.settings.gemini.command = result.path;
								await this.plugin.saveSettings();
								this.display();
								new Notice(`Gemini CLI found: ${result.path}`, 3000);
							} else {
								new Notice(
									`Detected but not working: ${validation.error}`,
									4000,
								);
							}
						} else {
							new Notice(
								"Gemini CLI not found. Install with: npm install -g @google/gemini-cli",
								5000,
							);
						}
					}),
			);

		new Setting(sectionEl)
			.setName("Arguments")
			.setDesc(
				'Enter one argument per line. Leave empty to run without arguments.(Currently, the Gemini CLI requires the "--experimental-acp" option.)',
			)
			.addTextArea((text) => {
				text.setPlaceholder("")
					.setValue(this.formatArgs(gemini.args))
					.onChange(async (value) => {
						this.plugin.settings.gemini.args =
							this.parseArgs(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});

		new Setting(sectionEl)
			.setName("Environment variables")
			.setDesc(
				"Enter KEY=VALUE pairs, one per line. Required to authenticate with Vertex AI. GEMINI_API_KEY is derived from the field above.(Stored as plain text)",
			)
			.addTextArea((text) => {
				text.setPlaceholder("GOOGLE_CLOUD_PROJECT=...")
					.setValue(this.formatEnv(gemini.env))
					.onChange(async (value) => {
						this.plugin.settings.gemini.env = this.parseEnv(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});
	}

	private renderClaudeSettings(sectionEl: HTMLElement) {
		const claude = this.plugin.settings.claude;

		new Setting(sectionEl)
			.setName(claude.displayName || "Claude Agent (ACP)")
			.setHeading();

		new Setting(sectionEl)
			.setName("Path")
			.setDesc(
				"Absolute path to the claude-agent-acp executable. Install via: npm install -g @agentclientprotocol/claude-agent-acp",
			)
			.addText((text) => {
				text.setPlaceholder("Absolute path to claude-agent-acp")
					.setValue(claude.command)
					.onChange(async (value) => {
						const trimmed = value.trim();
						this.plugin.settings.claude.command = trimmed;
						if (trimmed) {
							const validation = validatePath(trimmed);
							if (!validation.valid) {
								new Notice(`Warning: ${validation.error}`, 3000);
							}
						}
						await this.plugin.saveSettings();
					});
			})
			.addButton((button) =>
				button
					.setButtonText("Auto-detect")
					.setTooltip("Try to automatically detect claude-agent-acp")
					.onClick(async () => {
						const result = detectAgentPath("claude-code-acp");
						if (result.path) {
							const validation = validatePath(result.path);
							if (validation.valid) {
								this.plugin.settings.claude.command = result.path;
								await this.plugin.saveSettings();
								this.display();
								new Notice(`claude-agent-acp found: ${result.path}`, 3000);
							} else {
								new Notice(
									`Detected but not working: ${validation.error}`,
									4000,
								);
							}
						} else {
							new Notice(
								"claude-agent-acp not found. Install with: npm install -g @agentclientprotocol/claude-agent-acp",
								5000,
							);
						}
					}),
			);

		new Setting(sectionEl)
			.setName("Arguments")
			.setDesc(
				"Enter one argument per line. Leave empty to run without arguments.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("")
					.setValue(this.formatArgs(claude.args))
					.onChange(async (value) => {
						this.plugin.settings.claude.args =
							this.parseArgs(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});

		new Setting(sectionEl)
			.setName("Environment variables")
			.setDesc(
				"Enter KEY=VALUE pairs, one per line. ANTHROPIC_API_KEY is derived from the field above.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("")
					.setValue(this.formatEnv(claude.env))
					.onChange(async (value) => {
						this.plugin.settings.claude.env = this.parseEnv(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});
	}

	private renderCodexSettings(sectionEl: HTMLElement) {
		const codex = this.plugin.settings.codex;

		new Setting(sectionEl)
			.setName(codex.displayName || "Codex")
			.setDesc("In development — not yet available for general use.")
			.setHeading();

		new Setting(sectionEl)
			.setName("Path")
			.setDesc("Absolute path to the codex-acp executable. Install via: npm install -g @zed-industries/codex-acp")
			.addText((text) => {
				text.setPlaceholder("Absolute path to codex-acp")
					.setValue(codex.command)
					.onChange(async (value) => {
						const trimmed = value.trim();
						this.plugin.settings.codex.command = trimmed;
						if (trimmed) {
							const validation = validatePath(trimmed);
							if (!validation.valid) {
								new Notice(`Warning: ${validation.error}`, 3000);
							}
						}
						await this.plugin.saveSettings();
					});
			})
			.addButton((button) =>
				button
					.setButtonText("Auto-detect")
					.setTooltip("Try to automatically detect codex-acp")
					.onClick(async () => {
						const result = detectAgentPath("codex-acp");
						if (result.path) {
							const validation = validatePath(result.path);
							if (validation.valid) {
								this.plugin.settings.codex.command = result.path;
								await this.plugin.saveSettings();
								this.display();
								new Notice(`codex-acp found: ${result.path}`, 3000);
							} else {
								new Notice(
									`Detected but not working: ${validation.error}`,
									4000,
								);
							}
						} else {
							new Notice(
								"codex-acp not found. Install with: npm install -g @zed-industries/codex-acp",
								5000,
							);
						}
					}),
			);

		new Setting(sectionEl)
			.setName("Arguments")
			.setDesc(
				"Enter one argument per line. Leave empty to run without arguments.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("")
					.setValue(this.formatArgs(codex.args))
					.onChange(async (value) => {
						this.plugin.settings.codex.args = this.parseArgs(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});

		new Setting(sectionEl)
			.setName("Environment variables")
			.setDesc(
				"Enter KEY=VALUE pairs, one per line. OPENAI_API_KEY is derived from the field above.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("")
					.setValue(this.formatEnv(codex.env))
					.onChange(async (value) => {
						this.plugin.settings.codex.env = this.parseEnv(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});
	}

	private renderCustomAgents(containerEl: HTMLElement) {
		if (this.plugin.settings.customAgents.length === 0) {
			containerEl.createEl("p", {
				text: "No custom agents configured yet.",
			});
		} else {
			this.plugin.settings.customAgents.forEach((agent, index) => {
				this.renderCustomAgent(containerEl, agent, index);
			});
		}

		new Setting(containerEl).addButton((button) => {
			button
				.setButtonText("Add custom agent")
				.setCta()
				.onClick(async () => {
					const newId = this.generateCustomAgentId();
					const newDisplayName =
						this.generateCustomAgentDisplayName();
					this.plugin.settings.customAgents.push({
						id: newId,
						displayName: newDisplayName,
						command: "",
						args: [],
						env: [],
					});
					this.plugin.ensureActiveAgentId();
					await this.plugin.saveSettings();
					this.display();
				});
		});
	}

	private renderCustomAgent(
		containerEl: HTMLElement,
		agent: CustomAgentSettings,
		index: number,
	) {
		const blockEl = containerEl.createDiv({
			cls: "obsidianaitools-custom-agent",
		});

		const idSetting = new Setting(blockEl)
			.setName("Agent ID")
			.setDesc("Unique identifier used to reference this agent.")
			.addText((text) => {
				text.setPlaceholder("custom-agent")
					.setValue(agent.id)
					.onChange(async (value) => {
						const previousId =
							this.plugin.settings.customAgents[index].id;
						const trimmed = value.trim();
						let nextId = trimmed;
						if (nextId.length === 0) {
							nextId = this.generateCustomAgentId();
							text.setValue(nextId);
						}
						this.plugin.settings.customAgents[index].id = nextId;
						if (this.plugin.settings.activeAgentId === previousId) {
							this.plugin.settings.activeAgentId = nextId;
						}
						this.plugin.ensureActiveAgentId();
						await this.plugin.saveSettings();
						this.refreshAgentDropdown();
					});
			});

		idSetting.addExtraButton((button) => {
			button
				.setIcon("trash")
				.setTooltip("Delete this agent")
				.onClick(async () => {
					this.plugin.settings.customAgents.splice(index, 1);
					this.plugin.ensureActiveAgentId();
					await this.plugin.saveSettings();
					this.display();
				});
		});

		new Setting(blockEl)
			.setName("Display name")
			.setDesc("Shown in menus and headers.")
			.addText((text) => {
				text.setPlaceholder("Custom agent")
					.setValue(agent.displayName || agent.id)
					.onChange(async (value) => {
						const trimmed = value.trim();
						this.plugin.settings.customAgents[index].displayName =
							trimmed.length > 0
								? trimmed
								: this.plugin.settings.customAgents[index].id;
						await this.plugin.saveSettings();
						this.refreshAgentDropdown();
					});
			});

		new Setting(blockEl)
			.setName("Path")
			.setDesc("Absolute path to the custom agent.")
			.addText((text) => {
				text.setPlaceholder("Absolute path to custom agent")
					.setValue(agent.command)
					.onChange(async (value) => {
						this.plugin.settings.customAgents[index].command =
							value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(blockEl)
			.setName("Arguments")
			.setDesc(
				"Enter one argument per line. Leave empty to run without arguments.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("--flag\n--another=value")
					.setValue(this.formatArgs(agent.args))
					.onChange(async (value) => {
						this.plugin.settings.customAgents[index].args =
							this.parseArgs(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});

		new Setting(blockEl)
			.setName("Environment variables")
			.setDesc(
				"Enter KEY=VALUE pairs, one per line. (Stored as plain text)",
			)
			.addTextArea((text) => {
				text.setPlaceholder("TOKEN=...")
					.setValue(this.formatEnv(agent.env))
					.onChange(async (value) => {
						this.plugin.settings.customAgents[index].env =
							this.parseEnv(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});
	}

	private generateCustomAgentDisplayName(): string {
		const base = "Custom agent";
		const existing = new Set<string>();
		existing.add(
			this.plugin.settings.claude.displayName ||
				this.plugin.settings.claude.id,
		);
		existing.add(
			this.plugin.settings.codex.displayName ||
				this.plugin.settings.codex.id,
		);
		existing.add(
			this.plugin.settings.gemini.displayName ||
				this.plugin.settings.gemini.id,
		);
		for (const item of this.plugin.settings.customAgents) {
			existing.add(item.displayName || item.id);
		}
		if (!existing.has(base)) {
			return base;
		}
		let counter = 2;
		let candidate = `${base} ${counter}`;
		while (existing.has(candidate)) {
			counter += 1;
			candidate = `${base} ${counter}`;
		}
		return candidate;
	}

	// Create a readable ID for new custom agents and avoid collisions
	private generateCustomAgentId(): string {
		const base = "custom-agent";
		const existing = new Set(
			this.plugin.settings.customAgents.map((item) => item.id),
		);
		if (!existing.has(base)) {
			return base;
		}
		let counter = 2;
		let candidate = `${base}-${counter}`;
		while (existing.has(candidate)) {
			counter += 1;
			candidate = `${base}-${counter}`;
		}
		return candidate;
	}

	private formatArgs(args: string[]): string {
		return args.join("\n");
	}

	private parseArgs(value: string): string[] {
		return value
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	private formatEnv(env: AgentEnvVar[]): string {
		return env
			.map((entry) => `${entry.key}=${entry.value ?? ""}`)
			.join("\n");
	}

	private parseEnv(value: string): AgentEnvVar[] {
		const envVars: AgentEnvVar[] = [];

		for (const line of value.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const delimiter = trimmed.indexOf("=");
			if (delimiter === -1) {
				continue;
			}
			const key = trimmed.slice(0, delimiter).trim();
			const envValue = trimmed.slice(delimiter + 1).trim();
			if (!key) {
				continue;
			}
			envVars.push({ key, value: envValue });
		}

		return normalizeEnvVars(envVars);
	}
}
