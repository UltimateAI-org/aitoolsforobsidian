import { Modal, App, ButtonComponent, Setting } from "obsidian";
import type AgentClientPlugin from "../plugin";
import { getAgentInstallCommand } from "../shared/agent-installer";
import { detectWsl, detectNodePath, detectAgentPath } from "../shared/path-detector";
import { spawn } from "child_process";
import { Platform } from "obsidian";
import { getEnhancedWindowsEnv } from "../shared/windows-env";

interface AgentOption {
	id: string;
	name: string;
	provider: string;
	package: string;
	description: string;
}

/**
 * First-run onboarding modal that guides users through initial setup.
 *
 * Simplified flow:
 * 1. Choose an agent
 * 2. Enter API key
 * 3. Base URL (with default)
 * 4. Auto-install and finish
 */
export class OnboardingModal extends Modal {
	private plugin: AgentClientPlugin;
	private currentStep = 0;
	private stepContainer: HTMLElement;

	// Form state
	private selectedAgent: AgentOption | null = null;
	private apiKey = "";
	private baseUrl = "https://chat.obsidianaitools.com";
	private installErrorMessage = "";
	private detectedNodePath = ""; // Store detected Node.js path for settings
	private terminalOutputEl: HTMLElement | null = null; // Terminal output element for live updates

	private readonly agents: AgentOption[] = [
		{
			id: "claude-code-acp",
			name: "Claude Agent",
			provider: "Anthropic",
			package: "@zed-industries/claude-agent-acp",
			description: "Recommended — full tool support",
		},
		{
			id: "gemini-cli",
			name: "Gemini CLI",
			provider: "Google",
			package: "@google/gemini-cli",
			description: "Experimental — limited tool support",
		},
		// Note: Codex/OpenCode is currently in development
		// {
		// 	id: "codex-acp",
		// 	name: "Codex",
		// 	provider: "OpenAI",
		// 	package: "@zed-industries/codex-acp",
		// 	description: "Code generation focused",
		// },
	];

	constructor(app: App, plugin: AgentClientPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("obsidianaitools-onboarding-modal");

		// Header
		contentEl.createEl("h2", {
			text: "Welcome to AI Tools for Obsidian",
		});

		contentEl.createEl("p", {
			text: "Chat with AI coding agents directly from your vault",
			cls: "obsidianaitools-onboarding-subtitle",
		});

		// Step container
		this.stepContainer = contentEl.createDiv({
			cls: "obsidianaitools-onboarding-steps",
		});

		// Close button
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Close")
					.onClick(() => {
						this.close();
					}),
			);

		this.renderCurrentStep();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private nextStep() {
		// Validate current step before proceeding
		if (this.currentStep === 0 && !this.selectedAgent) {
			return;
		}
		if (this.currentStep === 1 && !this.apiKey.trim()) {
			return;
		}

		this.currentStep++;

		if (this.currentStep > 3) {
			// Save settings and finish
			void this.saveSettings().then(() => {
				this.close();
				void this.plugin.activateView();
			});
			return;
		}
		this.renderCurrentStep();
	}

	private async saveSettings(): Promise<void> {
		const settings = this.plugin.settings;

		// Save API key and base URL
		settings.apiKey = this.apiKey.trim();
		// Normalize URL: trim and remove trailing slash
		const normalizedUrl = this.baseUrl.trim().replace(/\/$/, "");
		settings.baseUrl = normalizedUrl || "https://chat.obsidianaitools.com";
		// Save detected Node.js path so user doesn't have to configure it manually
		if (this.detectedNodePath) {
			settings.nodePath = this.detectedNodePath;
		}

		// Configure selected agent - auto-detect the full path after installation
		if (this.selectedAgent) {
			settings.activeAgentId = this.selectedAgent.id;

			// Only trust agent path detection if Node.js is available.
			// Stale .cmd stubs persist in %APPDATA%\npm after Node.js is uninstalled.
			const nodeAvailable = detectNodePath();
			let agentPath = this.getAgentBinaryName(this.selectedAgent.id);

			if (nodeAvailable.path) {
				// Auto-detect the installed agent's full path with retry logic
				// On Windows, there can be a delay after npm install before the .cmd file is accessible
				let detectedPath = detectAgentPath(this.selectedAgent.id);
				let retries = 0;
				const maxRetries = 3;

				while (!detectedPath.path && retries < maxRetries) {
					console.warn(`[Onboarding] Path detection attempt ${retries + 1} failed, retrying in 1s...`);
					await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
					detectedPath = detectAgentPath(this.selectedAgent.id);
					retries++;
				}

				agentPath = detectedPath.path || agentPath;
				console.warn(`[Onboarding] Detected agent path: ${agentPath} (wasAutoDetected: ${detectedPath.wasAutoDetected})`);
			} else {
				console.warn(`[Onboarding] Node.js not available — saving bare binary name: ${agentPath}`);
			}

			if (this.selectedAgent.id === "claude-code-acp") {
				settings.claude.command = agentPath;
			} else if (this.selectedAgent.id === "codex-acp") {
				settings.codex.command = agentPath;
			} else if (this.selectedAgent.id === "gemini-cli") {
				settings.gemini.command = agentPath;
			}
		}

		// Mark onboarding as complete
		settings.hasCompletedOnboarding = true;

		// Use saveSettingsAndNotify so the settings store notifies all subscribers
		// (ChatView, useAgentSession, etc.) about the new configuration
		await this.plugin.saveSettingsAndNotify(settings);
	}

	private renderCurrentStep() {
		this.stepContainer.empty();

		switch (this.currentStep) {
			case 0:
				this.renderStep1();
				break;
			case 1:
				this.renderStep2();
				break;
			case 2:
				this.renderStep3();
				break;
			case 3:
				this.renderStep4();
				break;
		}
	}

	private renderStep1() {
		// Choose an agent
		this.stepContainer.createEl("h3", { text: "Choose an agent" });

		this.stepContainer.createEl("p", {
			text: "Select an AI agent to use:",
		});

		// Agent cards
		const cardsContainer = this.stepContainer.createDiv({
			cls: "obsidianaitools-onboarding-cards",
		});

		for (const agent of this.agents) {
			this.createAgentCard(cardsContainer, agent);
		}

		// Add development note
		this.stepContainer.createEl("p", {
			text: "Note: Codex/OpenCode is currently in development",
			cls: "obsidianaitools-onboarding-dev-note",
		});

		this.addNavigation("Get Started", undefined, true, false, !this.selectedAgent);
	}

	private createAgentCard(parent: HTMLElement, agent: AgentOption) {
		const isRecommended = agent.id === "claude-code-acp";
		const card = parent.createDiv({
			cls: `obsidianaitools-onboarding-card ${
				this.selectedAgent?.id === agent.id ? "selected" : ""
			} ${isRecommended ? "recommended" : ""}`,
		});
		card.onclick = () => {
			this.selectedAgent = agent;
			this.currentStep++;
			this.renderCurrentStep(); // Advance to next step automatically
		};

		card.createEl("h4", { text: agent.name });
		card.createEl("span", {
			text: agent.provider,
			cls: "obsidianaitools-provider-badge",
		});
		card.createEl("p", { text: agent.description });
	}

	private renderStep2() {
		// Enter API key
		this.stepContainer.createEl("h3", { text: "API key" });

		this.stepContainer.createEl("p", {
			text: "Enter your API key from chat.obsidianaitools.com:",
		});

		// API key input
		new Setting(this.stepContainer)
			.setName("API key")
			.setDesc("Your API key is stored securely in Obsidian settings")
			.addText((text) => {
				text.setPlaceholder("Enter your API key")
					.setValue(this.apiKey)
					.onChange((value) => {
						this.apiKey = value;
					});
				text.inputEl.type = "password";
			});

		// Instructions container
		const instructionsDiv = this.stepContainer.createDiv({
			cls: "obsidianaitools-onboarding-instructions",
		});

		instructionsDiv.createEl("p", {
			text: "To get your API key:",
			cls: "obsidianaitools-onboarding-instructions-header",
		});

		const instructionsList = instructionsDiv.createEl("ol", {
			cls: "obsidianaitools-onboarding-instructions-list",
		});

		instructionsList.createEl("li", { text: "Go to chat.obsidianaitools.com" });
		instructionsList.createEl("li", { text: "Navigate to Settings > Account" });
		instructionsList.createEl("li", { text: "Copy your API key" });

		this.stepContainer.createEl("p", {
			text: "Tip: The API key is used by all agents via ANTHROPIC_AUTH_TOKEN, GEMINI_API_KEY, or OPENAI_API_KEY",
			cls: "obsidianaitools-onboarding-tip",
		});

		this.addNavigation("Next: Base URL ←", "Back", false);
	}

	private renderStep3() {
		// Auto-detect and save Node.js path early
		if (!this.detectedNodePath) {
			const detected = detectNodePath();
			if (detected?.path) {
				this.detectedNodePath = detected.path;
				console.warn(`[Onboarding] Auto-detected Node.js at: ${this.detectedNodePath}`);
				// Save to settings immediately so it persists even if user skips installation
				this.plugin.settings.nodePath = this.detectedNodePath;
				void this.plugin.saveSettings();
			}
		}

		// Prerequisites note
		const prereqDiv = this.stepContainer.createDiv({
			cls: "obsidianaitools-onboarding-prerequisites",
		});

		prereqDiv.createEl("p", {
			text: "Before installing, ensure you have:",
			cls: "obsidianaitools-onboarding-prerequisites-header",
		});

		const prereqList = prereqDiv.createEl("ul", {
			cls: "obsidianaitools-onboarding-prerequisites-list",
		});

		const nodePrereq = prereqList.createEl("li");
		nodePrereq.setText("Node.js and npm installed (");
		const nodeLink = nodePrereq.createEl("a", {
			text: "https://nodejs.org/en/download",
			href: "https://nodejs.org/en/download",
		});
		nodeLink.setAttribute("target", "_blank");
		nodePrereq.appendText(")");

		if (Platform.isWin) {
			prereqList.createEl("li", { text: "WSL installed (run: wsl --install)" });
			const pathNote = prereqList.createEl("li");
			pathNote.setText("After installing Node.js, ");
			pathNote.createEl("strong").setText("restart your computer");
			pathNote.appendText(" to ensure npm is in your system PATH");
		}

		// WSL note for Windows users
		if (Platform.isWin) {
			const wslDiv = this.stepContainer.createDiv({
				cls: "obsidianaitools-onboarding-wsl-note",
			});

			wslDiv.createEl("p", {
				text: "Windows users: WSL (Windows Subsystem for Linux) is recommended",
			});

			wslDiv.createEl("p", {
				text: "To install WSL, open Command Prompt and run: wsl --install",
				cls: "obsidianaitools-onboarding-wsl-command",
			});

			// Add PATH troubleshooting note
			const pathDiv = this.stepContainer.createDiv({
				cls: "obsidianaitools-onboarding-wsl-note",
			});

			const pathHeader = pathDiv.createEl("p");
			pathHeader.createEl("strong").setText("Troubleshooting: ");
			pathHeader.appendText("If installation fails after restarting");

			const pathInstructions = pathDiv.createEl("p", {
				cls: "obsidianaitools-onboarding-wsl-command",
			});
			pathInstructions.setText("Verify this path is in your system PATH (Environment Variables):");

			const pathList = pathDiv.createEl("ul", {
				cls: "obsidianaitools-onboarding-prerequisites-list",
			});
			pathList.createEl("li").createEl("code").setText("C:\\Users\\%username%\\AppData\\Roaming\\npm");
		}

		// Display installation error if present
		if (this.installErrorMessage) {
			const errorDiv = this.stepContainer.createDiv({
				cls: "obsidianaitools-onboarding-error",
			});

			const errorHeader = errorDiv.createDiv({
				cls: "obsidianaitools-onboarding-error-header-row",
			});
			errorHeader.createEl("p", {
				text: "Installation Failed",
				cls: "obsidianaitools-onboarding-error-header",
			});
			const dismissBtn = errorHeader.createEl("button", {
				text: "×",
				cls: "obsidianaitools-onboarding-error-dismiss",
			});
			dismissBtn.onclick = () => {
				this.installErrorMessage = "";
				errorDiv.remove();
			};

			// Check error type
			const isNpmMissing = this.installErrorMessage.toLowerCase().includes("node.js and npm");
			const isPermissionError = this.installErrorMessage.includes("NPM_PERMISSION_ERROR");

			if (isPermissionError) {
				// Show npm global permissions fix for Linux users
				const actionDiv = errorDiv.createDiv({
					cls: "obsidianaitools-onboarding-error-action",
				});

				actionDiv.createEl("p", {
					text: "npm does not have permission to install global packages. This is common on Linux when Node.js is installed via a system package manager.",
					cls: "obsidianaitools-onboarding-error-action-text",
				});

				actionDiv.createEl("p", {
					text: "To fix this, run these commands in your terminal:",
					cls: "obsidianaitools-onboarding-error-action-header",
				});

				const commands = [
					"mkdir -p ~/.npm-global",
					"npm config set prefix '~/.npm-global'",
					"echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc",
					"source ~/.bashrc",
				];

				const codeBlock = actionDiv.createEl("pre", {
					cls: "obsidianaitools-onboarding-error-codeblock",
				});
				codeBlock.createEl("code", {
					text: commands.join("\n"),
				});

				actionDiv.createEl("p", {
					text: "If you use zsh or fish, update your shell config file instead of ~/.bashrc.",
					cls: "obsidianaitools-onboarding-error-action-text",
				});

				actionDiv.createEl("p", {
					text: "Then click 'Retry Installation' below.",
					cls: "obsidianaitools-onboarding-error-alternative",
				});
			} else if (isNpmMissing) {
				// Show prominent installation instructions for missing npm
				const actionDiv = errorDiv.createDiv({
					cls: "obsidianaitools-onboarding-error-action",
				});

				actionDiv.createEl("p", {
					text: "Node.js is required but not installed on your system.",
					cls: "obsidianaitools-onboarding-error-action-text",
				});

				actionDiv.createEl("p", {
					text: "What to do next:",
					cls: "obsidianaitools-onboarding-error-action-header",
				});

				const stepsList = actionDiv.createEl("ol", {
					cls: "obsidianaitools-onboarding-error-steps",
				});

				const step1 = stepsList.createEl("li");
				step1.createEl("strong").setText("Install Node.js ");
				if (Platform.isWin) {
					step1.appendText("via terminal: ");
					step1.createEl("code", { text: "winget install OpenJS.NodeJS.LTS" });
				} else if (Platform.isMacOS) {
					step1.appendText("via terminal: ");
					step1.createEl("code", { text: "brew install node" });
				} else {
					step1.appendText("via terminal: ");
					step1.createEl("code", { text: "sudo apt install nodejs npm" });
					step1.appendText(" (Debian/Ubuntu) or ");
					step1.createEl("code", { text: "sudo pacman -S nodejs npm" });
					step1.appendText(" (Arch)");
				}

				const step1alt = stepsList.createEl("li");
				step1alt.appendText("Or download from ");
				const link = step1alt.createEl("a", {
					text: "nodejs.org",
					href: "https://nodejs.org/en/download",
				});
				link.setAttribute("target", "_blank");

				const restartLi = stepsList.createEl("li");
				restartLi.createEl("strong").setText("Restart your computer");
				restartLi.appendText(" (required for npm to be added to PATH)");

				stepsList.createEl("li", { text: "Restart Obsidian and come back here to click 'Retry Installation'" });

				actionDiv.createEl("p", {
					text: "OR click 'Skip & Setup Manually' below to configure later in settings.",
					cls: "obsidianaitools-onboarding-error-alternative",
				});
			} else {
				// Show generic error with help
				// Check if it's a Node.js missing error with URL
				const isNodeMissing = this.installErrorMessage.includes("https://nodejs.org/en/download");

				if (isNodeMissing) {
					// Split message to make URL clickable
					const parts = this.installErrorMessage.split("https://nodejs.org/en/download");
					const messagePara = errorDiv.createEl("p", {
						cls: "obsidianaitools-onboarding-error-message",
					});
					messagePara.appendText(parts[0]);
					const link = messagePara.createEl("a", {
						text: "https://nodejs.org/en/download",
						href: "https://nodejs.org/en/download",
					});
					link.setAttribute("target", "_blank");
					if (parts[1]) {
						messagePara.appendText(parts[1]);
					}
				} else {
					// Show plain text for other errors
					errorDiv.createEl("p", {
						text: this.installErrorMessage,
						cls: "obsidianaitools-onboarding-error-message",
					});
				}

				// Add help section
				const helpDiv = errorDiv.createDiv({
					cls: "obsidianaitools-onboarding-error-help",
				});

				helpDiv.createEl("p", {
					text: "What you can do:",
				});

				const helpList = helpDiv.createEl("ul");
				helpList.createEl("li", { text: "Click 'Skip & Setup Manually' to configure paths in settings later" });
				helpList.createEl("li", { text: "Check the error message above and resolve the issue, then retry" });

				// Only show manual install command if we have a selected agent
				if (this.selectedAgent) {
					const packageName = this.selectedAgent.package;
					const manualInstallLi = helpList.createEl("li");
					manualInstallLi.setText("Or install manually from command line: ");
					manualInstallLi.createEl("code", {
						text: `npm install -g ${packageName}`,
						cls: "obsidianaitools-onboarding-error-command",
					});
				}
			}
		}

		// Terminal output container (initially hidden)
		const terminalContainer = this.stepContainer.createDiv({
			cls: "obsidianaitools-onboarding-terminal obsidianaitools-hidden",
		});

		const terminalHeader = terminalContainer.createDiv({
			cls: "obsidianaitools-terminal-renderer-header",
		});
		terminalHeader.setText("Installation Progress");

		this.terminalOutputEl = terminalContainer.createDiv({
			cls: "obsidianaitools-terminal-renderer-output",
		});

		// Add navigation with skip option
		const navContainer = this.stepContainer.createDiv({
			cls: "obsidianaitools-onboarding-nav",
		});

		// Back button
		const backBtn = new ButtonComponent(navContainer)
			.setButtonText("Back")
			.onClick(() => {
				this.currentStep--;
				this.renderCurrentStep();
			});

		// Skip button
		const skipBtn = new ButtonComponent(navContainer)
			.setButtonText("Skip & Setup Manually")
			.setTooltip("Skip automatic installation and configure manually in settings")
			.onClick(() => {
				// Save settings without installation
				void this.saveSettings().then(() => {
					this.close();
				});
			});
		skipBtn.buttonEl.addClass("obsidianaitools-onboarding-skip-button");

		// Install button
		const installBtn = new ButtonComponent(navContainer)
			.setButtonText("Install & Connect →")
			.setCta()
			.onClick(async () => {
				// Clear any previous error messages
				this.stepContainer.querySelectorAll(".obsidianaitools-onboarding-error").forEach((el) => el.remove());
				this.installErrorMessage = "";

				// Show terminal and disable navigation
				terminalContainer.removeClass("obsidianaitools-hidden");
				this.terminalOutputEl!.setText("");

				// Show time estimate for agents with many dependencies
				const timeEstimate = this.selectedAgent!.id === "gemini-cli"
					? "Installing... (this may take 2-5 minutes)"
					: "Installing...";
				installBtn.setButtonText(timeEstimate);
				installBtn.setDisabled(true);
				backBtn.setDisabled(true);
				skipBtn.setDisabled(true);

				// Show initial command being run
				const packageName = this.selectedAgent!.package;
				const estimateMessage = this.selectedAgent!.id === "gemini-cli"
					? "\nℹ️  Gemini CLI has 600+ dependencies and may take 2-5 minutes to install.\nPlease be patient, the installation is in progress...\n\n"
					: "";
				const initialText = `$ npm install -g ${packageName}\n${estimateMessage}`;
				this.terminalOutputEl!.appendText(initialText);

				const result = await this.installAgent(
					this.selectedAgent!,
					(output: string) => {
						// Append output to terminal
						if (this.terminalOutputEl) {
							this.terminalOutputEl.appendText(output);
							// Auto-scroll to bottom
							this.terminalOutputEl.scrollTop = this.terminalOutputEl.scrollHeight;
						}
					},
				);

				if (result.success) {
					// Show success message
					this.terminalOutputEl!.appendText("\n\n✓ Installation completed successfully!\n");

					// Save settings (await so path is persisted before session creation)
					this.installErrorMessage = "";
					await this.saveSettings();

					// Change install button to "Continue" and enable it
					installBtn.setButtonText("Continue →");
					installBtn.setDisabled(false);
					installBtn.setCta();

					// Set up auto-advance after 5 seconds
					const autoAdvanceTimer = setTimeout(() => {
						this.currentStep++;
						this.renderCurrentStep();
					}, 5000);

					// Allow user to continue immediately by clicking button
					installBtn.onClick(() => {
						clearTimeout(autoAdvanceTimer);
						this.currentStep++;
						this.renderCurrentStep();
					});
				} else {
					// Show error message above terminal without re-rendering (preserves terminal output)
					this.installErrorMessage = result.error || "Installation failed. Please try again.";

					// Create error message container above terminal
					const errorDiv = this.stepContainer.createDiv({
						cls: "obsidianaitools-onboarding-error",
					});
					errorDiv.style.order = String(Number(terminalContainer.style.order || "0") - 1);

					errorDiv.createEl("p", {
						text: "⚠️ Installation Failed",
						cls: "obsidianaitools-onboarding-error-header",
					});

				// Check error type
				const isNodeMissing = this.installErrorMessage.includes("https://nodejs.org/en/download");
				const isPermError = this.installErrorMessage.includes("NPM_PERMISSION_ERROR");

				if (isPermError) {
					// Show npm global permissions fix
					errorDiv.createEl("p", {
						text: "npm does not have permission to install global packages. This is common on Linux when Node.js is installed via a system package manager.",
						cls: "obsidianaitools-onboarding-error-message",
					});

					const fixDiv = errorDiv.createDiv({
						cls: "obsidianaitools-onboarding-error-help",
					});
					fixDiv.createEl("p", { text: "Run these commands in your terminal to fix this:" });

					const commands = [
						"mkdir -p ~/.npm-global",
						"npm config set prefix '~/.npm-global'",
						"echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc",
						"source ~/.bashrc",
					];

					const codeBlock = fixDiv.createEl("pre", {
						cls: "obsidianaitools-onboarding-error-codeblock",
					});
					codeBlock.createEl("code", {
						text: commands.join("\n"),
					});

					fixDiv.createEl("p", { text: "If you use zsh or fish, update your shell config file instead of ~/.bashrc." });
					fixDiv.createEl("p", { text: "Then click 'Retry Installation' below." });
				} else if (isNodeMissing) {
					// Show platform-specific install command
					errorDiv.createEl("p", {
						text: "Node.js is required but not installed on your system.",
						cls: "obsidianaitools-onboarding-error-message",
					});

					const installHint = errorDiv.createEl("p", {
						cls: "obsidianaitools-onboarding-error-message",
					});
					installHint.createEl("strong").setText("Quick install: ");
					if (Platform.isWin) {
						installHint.createEl("code", { text: "winget install OpenJS.NodeJS.LTS" });
					} else if (Platform.isMacOS) {
						installHint.createEl("code", { text: "brew install node" });
					} else {
						installHint.createEl("code", { text: "sudo apt install nodejs npm" });
						installHint.appendText(" or ");
						installHint.createEl("code", { text: "sudo pacman -S nodejs npm" });
					}

					const dlPara = errorDiv.createEl("p", {
						cls: "obsidianaitools-onboarding-error-message",
					});
					dlPara.appendText("Or download from ");
					const dlLink = dlPara.createEl("a", {
						text: "nodejs.org",
						href: "https://nodejs.org/en/download",
					});
					dlLink.setAttribute("target", "_blank");

					errorDiv.createEl("p", {
						text: "After installing, restart Obsidian and click 'Retry Installation'.",
						cls: "obsidianaitools-onboarding-error-message",
					});
				} else {
					// Show plain text for other errors
					errorDiv.createEl("p", {
						text: this.installErrorMessage,
						cls: "obsidianaitools-onboarding-error-message",
					});
				}

				if (!isPermError) {
					const helpDiv = errorDiv.createDiv({
						cls: "obsidianaitools-onboarding-error-help",
					});
					helpDiv.createEl("p", { text: "What you can do:" });
					const helpList = helpDiv.createEl("ul");
					helpList.createEl("li", { text: "Click 'Retry Installation' to try again" });
					helpList.createEl("li", { text: "Check the terminal output below for details" });
					helpList.createEl("li", { text: "Click 'Skip & Setup Manually' to configure paths in settings later" });

					if (this.selectedAgent) {
						const manualLi = helpList.createEl("li");
						manualLi.setText("Or install manually: ");
						manualLi.createEl("code", {
							text: `npm install -g ${this.selectedAgent.package}`,
							cls: "obsidianaitools-onboarding-error-command",
						});
					}
				}

					// Insert error div before terminal
					terminalContainer.parentElement?.insertBefore(errorDiv, terminalContainer);

					// Update button states
					installBtn.setButtonText("Retry Installation");
					installBtn.setDisabled(false);
					backBtn.setDisabled(false);
					skipBtn.setDisabled(false);
				}
			});
	}

	private renderStep4() {
		// Ready
		this.stepContainer.createEl("h3", { text: "You're All Set!" });

		this.stepContainer.createEl("p", {
			text: `${this.selectedAgent?.name} has been installed and configured.`,
		});

		const statusDiv = this.stepContainer.createDiv({
			cls: "obsidianaitools-onboarding-status",
		});

		statusDiv.createEl("p", { text: `✓ ${this.selectedAgent?.name} installed` });
		statusDiv.createEl("p", { text: "✓ API key configured" });
		statusDiv.createEl("p", { text: "✓ Base URL configured" });

		this.stepContainer.createEl("p", {
			text: "Click 'Start Chatting' to begin:",
			cls: "obsidianaitools-onboarding-tip",
		});

		this.addNavigation("Start chatting!", "Back", true);
	}

	private addNavigation(
		nextText: string,
		backText?: string,
		isPrimary = false,
		triggerInstall = false,
		forceDisabled = false,
	) {
		const navContainer = this.stepContainer.createDiv({
			cls: "obsidianaitools-onboarding-nav",
		});

		if (backText) {
			new ButtonComponent(navContainer)
				.setButtonText(backText)
				.onClick(() => {
					this.currentStep--;
					this.renderCurrentStep();
				});
		}

		const btn = new ButtonComponent(navContainer)
			.setButtonText(nextText)
			.setDisabled(forceDisabled)
			.onClick(async () => {
				if (triggerInstall && this.selectedAgent) {
					// Run installation
					btn.setButtonText("Installing...");
					btn.setDisabled(true);

					const result = await this.installAgent(
						this.selectedAgent,
					);

					if (result.success) {
						// Save settings and proceed
						this.installErrorMessage = "";
						void this.saveSettings();
						this.currentStep++;
						this.renderCurrentStep();
					} else {
						// Store error message and re-render to show it
						this.installErrorMessage = result.error || "Installation failed. Please try again.";
						btn.setButtonText("Installation failed - retry");
						btn.setDisabled(false);
						this.renderCurrentStep();
					}
				} else {
					this.nextStep();
				}
			});
		if (isPrimary) {
			btn.setCta();
		}
	}

	/**
	 * Get the actual binary/command name for an agent ID.
	 * The internal ID (e.g. "claude-code-acp") differs from the binary name (e.g. "claude-agent-acp").
	 */
	private getAgentBinaryName(agentId: string): string {
		switch (agentId) {
			case "claude-code-acp":
				return Platform.isWin ? "claude-agent-acp.cmd" : "claude-agent-acp";
			case "codex-acp":
				return Platform.isWin ? "codex-acp.cmd" : "codex-acp";
			case "gemini-cli":
				return Platform.isWin ? "gemini.cmd" : "gemini";
			default:
				return agentId;
		}
	}

	private async installAgent(agent: AgentOption, onOutput?: (text: string) => void): Promise<{ success: boolean; error?: string }> {
		const installCommand = getAgentInstallCommand(agent.id);
		if (!installCommand) {
			const error = `No install command found for agent: ${agent.name}`;
			console.error(`[Onboarding] ${error}`);
			return { success: false, error };
		}

		// Always run npm install -g even if the agent binary already exists.
		// On Windows, stale .cmd stubs and broken node_modules can persist after
		// Node.js reinstalls. npm install -g is fast for already-installed packages
		// and repairs broken installs.
		const packageName = installCommand.replace("npm install -g ", "");
		let nodePath = this.plugin.settings.nodePath;

		// Auto-detect WSL if on Windows
		let shouldUseWsl = false;
		let wslDistribution: string | undefined;

		if (Platform.isWin) {
			const wslInfo = detectWsl();
			if (wslInfo.isWsl && wslInfo.distribution) {
				shouldUseWsl = true;
				wslDistribution = wslInfo.distribution;
				console.warn(`[Onboarding] Auto-detected WSL: ${wslDistribution}`);
			}
		}

		// Auto-detect Node.js path if not configured (only for non-WSL)
		if (!shouldUseWsl && !nodePath.trim()) {
			console.warn(`[Onboarding] Node path not set, attempting auto-detect...`);
			const detected = detectNodePath();
			if (detected?.path) {
				nodePath = detected.path;
				console.warn(`[Onboarding] Auto-detected Node.js: ${nodePath}`);
			}
		}

		// Store the detected/configured Node.js path for saving to settings
		if (nodePath.trim()) {
			this.detectedNodePath = nodePath.trim();
		}

		const nodeDir = !shouldUseWsl && nodePath.trim()
			? nodePath.trim().replace(/\/node$/, "").replace(/\\node\.exe$/, "")
			: "";
		const npmExec = nodeDir ? `${nodeDir}/npm` : "npm";

		return new Promise((resolve) => {
			let command: string;
			let args: string[];

			if (shouldUseWsl && wslDistribution) {
				// Use WSL
				const installArgs = `${npmExec} install -g ${packageName}`;
				command = "wsl";
				args = ["--distribution", wslDistribution, "-e", "bash", "-l", "-c", installArgs];
				console.warn(`[Onboarding] Installing ${agent.name} (${packageName}) via WSL...`);
			} else if (Platform.isWin) {
				// Windows: spawn npm directly with shell: true (added below) to handle paths with spaces
				// Quote the path if it contains spaces
				const npmCmd = nodeDir ? `"${nodeDir}\\npm.cmd"` : "npm";
				command = npmCmd;
				args = ["install", "-g", packageName];
				console.warn(`[Onboarding] Installing ${agent.name} (${packageName}) via Windows...`);
			} else {
				// macOS/Linux
				const installArgs = `${npmExec} install -g ${packageName}`;
				command = "/bin/bash";
				args = ["-l", "-c", installArgs];
				console.warn(`[Onboarding] Installing ${agent.name} (${packageName}) via bash...`);
			}

			// Enhance environment on Windows to include full system PATH
			let env = { ...process.env };
			if (Platform.isWin && !shouldUseWsl) {
				env = getEnhancedWindowsEnv(env);
			}

			// Add nodeDir to PATH if specified
			if (nodeDir && !shouldUseWsl) {
				const separator = Platform.isWin ? ";" : ":";
				env.PATH = `${nodeDir}${separator}${env.PATH || ""}`;
			}

			const child = spawn(command, args, {
				stdio: ["pipe", "pipe", "pipe"],
				// Use shell on Windows to properly handle paths with spaces
				shell: Platform.isWin && !shouldUseWsl,
				env,
			});

			let output = "";
			let hasTimeout = false;

			// Show progress indicators during installation
			let progressInterval: NodeJS.Timeout | null = null;
			let elapsed = 0;
			const progressIntervalMs = agent.id === "gemini-cli" ? 15000 : 10000; // 15s for Gemini, 10s for others

			progressInterval = setInterval(() => {
				elapsed += progressIntervalMs / 1000;
				onOutput?.(`\n⏳ Still installing... (${elapsed}s elapsed)\n`);
			}, progressIntervalMs);

			// Timeout after 5 minutes (Gemini CLI) or 3 minutes (others)
			const timeoutDuration = agent.id === "gemini-cli" ? 300000 : 180000;
			const timeout = setTimeout(() => {
				hasTimeout = true;
				if (progressInterval) clearInterval(progressInterval);
				const error = `Installation timed out after ${timeoutDuration / 60000} minutes`;
				console.error(`[Onboarding] ${error}`);
				child.kill("SIGTERM");
				resolve({ success: false, error });
			}, timeoutDuration);

			child.stdout?.on("data", (data: unknown) => {
				const text = typeof data === "string" ? data : String(data);
				output += text;
				console.warn(`[Onboarding] npm stdout: ${text.substring(0, 200)}`);
				onOutput?.(text);
			});
			child.stderr?.on("data", (data: unknown) => {
				const text = typeof data === "string" ? data : String(data);
				output += text;
				console.warn(`[Onboarding] npm stderr: ${text.substring(0, 200)}`);
				onOutput?.(text);
			});

			child.on("close", (code: number) => {
				clearTimeout(timeout);
				if (progressInterval) clearInterval(progressInterval);
				if (hasTimeout) return;

				// Check if agent was actually installed, regardless of exit code
				// npm can return non-zero exit codes even on successful installs if there are warnings
				// Also verify Node.js exists — stale .cmd stubs from a previous install can fool existsSync
				const installed = detectAgentPath(agent.id);
				const nodeAvailable = detectNodePath();
				const wasInstalled = installed.path !== null && nodeAvailable.path !== null;

				if (code === 0 || wasInstalled) {
					if (wasInstalled) {
						console.warn(`[Onboarding] Successfully installed ${agent.name} at: ${installed.path}`);
					} else {
						console.warn(`[Onboarding] npm completed with exit code 0`);
					}
					resolve({ success: true });
				} else {
					// Check for common errors and provide helpful messages
					let errorMsg = "";
					const outputLower = output.toLowerCase();

					if (outputLower.includes("npm") && (outputLower.includes("not recognized") || outputLower.includes("command not found") || outputLower.includes("not found"))) {
						errorMsg = "Node.js and npm are not installed or not in your system PATH.\n\nPlease install Node.js from: https://nodejs.org/en/download\n\nAfter installing, restart Obsidian and try again.";
					} else if (outputLower.includes("eacces") || outputLower.includes("permission denied")) {
						errorMsg = "NPM_PERMISSION_ERROR: Permission denied when installing globally.";
					} else if (outputLower.includes("enotfound") || outputLower.includes("network")) {
						errorMsg = "Network error. Please check your internet connection and try again.";
					} else {
						errorMsg = `Installation failed with exit code ${code}.\n\n${output ? output.substring(0, 300) : "No error details available."}`;
					}

					console.error(
						`[Onboarding] Failed to install ${agent.name} (exit code: ${code}): ${output}`,
					);
					resolve({ success: false, error: errorMsg });
				}
			});

			child.on("error", (error) => {
				clearTimeout(timeout);
				if (progressInterval) clearInterval(progressInterval);
				if (hasTimeout) return;
				const errorMsg = `Installation error: ${error.message}`;
				console.error(`[Onboarding] Error installing ${agent.name}:`, error);
				resolve({ success: false, error: errorMsg });
			});
		});
	}
}
