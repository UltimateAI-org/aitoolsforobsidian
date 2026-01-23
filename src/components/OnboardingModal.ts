import { Modal, App, ButtonComponent, Setting } from "obsidian";
import type AgentClientPlugin from "../plugin";
import { getAgentInstallCommand } from "../shared/agent-installer";
import { spawn } from "child_process";
import { Platform } from "obsidian";

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
	private baseUrl = "https://chat.ultimateai.org";

	private readonly agents: AgentOption[] = [
		{
			id: "claude-code-acp",
			name: "Claude Code",
			provider: "Anthropic",
			package: "@zed-industries/claude-code-acp",
			description: "Popular for general coding tasks",
		},
		{
			id: "codex-acp",
			name: "Codex",
			provider: "OpenAI",
			package: "@zed-industries/codex-acp",
			description: "Code generation focused",
		},
		{
			id: "gemini-cli",
			name: "Gemini CLI",
			provider: "Google",
			package: "@google/gemini-cli",
			description: "Experimental ACP support",
		},
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

		// Navigation buttons
		const navContainer = contentEl.createDiv({
			cls: "obsidianaitools-onboarding-nav",
		});

		new ButtonComponent(navContainer)
			.setButtonText("Get Started")
			.setCta()
			.onClick(() => {
				this.nextStep();
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
			this.saveSettings();
			this.close();
			void this.plugin.activateView();
			return;
		}
		this.renderCurrentStep();
	}

	private saveSettings() {
		const settings = this.plugin.settings;

		// Save API key and base URL
		settings.apiKey = this.apiKey.trim();
		settings.baseUrl = this.baseUrl.trim() || "https://chat.ultimateai.org";
		settings.autoInstallAgents = true;

		// Configure selected agent command (after npm install, should be in PATH)
		if (this.selectedAgent) {
			settings.activeAgentId = this.selectedAgent.id;
			if (this.selectedAgent.id === "claude-code-acp") {
				settings.claude.command = "claude-code-acp";
			} else if (this.selectedAgent.id === "codex-acp") {
				settings.codex.command = "codex-acp";
			} else if (this.selectedAgent.id === "gemini-cli") {
				settings.gemini.command = "gemini";
			}
		}

		// Mark onboarding as complete
		settings.hasCompletedOnboarding = true;

		void this.plugin.saveSettings();
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
		this.stepContainer.createEl("h3", { text: "Choose an Agent" });

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

		this.addNavigation("Next: API Key →", undefined, false);
	}

	private createAgentCard(parent: HTMLElement, agent: AgentOption) {
		const card = parent.createDiv({
			cls: `obsidianaitools-onboarding-card ${
				this.selectedAgent?.id === agent.id ? "selected" : ""
			}`,
		});
		card.onclick = () => {
			this.selectedAgent = agent;
			this.renderStep1(); // Re-render to show selection
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
		this.stepContainer.createEl("h3", { text: "API Key" });

		this.stepContainer.createEl("p", {
			text: `Enter your API key for ${this.selectedAgent?.provider}:`,
		});

		// API key input
		new Setting(this.stepContainer)
			.setName(`${this.selectedAgent?.provider} API Key`)
			.setDesc("Your API key is stored securely in Obsidian settings")
			.addText((text) => {
				text.setPlaceholder("Enter your API key")
					.setValue(this.apiKey)
					.onChange((value) => {
						this.apiKey = value;
					});
				text.inputEl.type = "password";
			});

		this.stepContainer.createEl("p", {
			text: "Tip: The API key is used by all agents via ANTHROPIC_AUTH_TOKEN, GEMINI_API_KEY, or OPENAI_API_KEY",
			cls: "obsidianaitools-onboarding-tip",
		});

		this.addNavigation("Next: Base URL ←", "Back", false);
	}

	private renderStep3() {
		// Base URL
		this.stepContainer.createEl("h3", { text: "API Endpoint" });

		this.stepContainer.createEl("p", {
			text: "Enter the base URL for API requests:",
		});

		// Base URL input
		new Setting(this.stepContainer)
			.setName("Base URL")
			.setDesc("The API endpoint for all agents")
			.addText((text) => {
				text.setPlaceholder("https://chat.ultimateai.org")
					.setValue(this.baseUrl)
					.onChange((value) => {
						this.baseUrl = value;
					});
			});

		this.stepContainer.createEl("p", {
			text: `Default: ${this.baseUrl}`,
			cls: "obsidianaitools-onboarding-tip",
		});

		this.addNavigation("Install & Connect →", "Back", true, true);
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

		this.addNavigation("Start Chatting!", "Back", true);
	}

	private addNavigation(
		nextText: string,
		backText?: string,
		isPrimary = false,
		triggerInstall = false,
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
			.setButtonText(triggerInstall ? "Installing..." : nextText)
			.setDisabled(triggerInstall)
			.onClick(async () => {
				if (triggerInstall && this.selectedAgent) {
					// Run installation
					btn.setButtonText("Installing...");
					btn.setDisabled(true);

					const installed = await this.installAgent(
						this.selectedAgent,
					);

					if (installed) {
						// Save settings and proceed
						this.saveSettings();
						this.currentStep++;
						this.renderCurrentStep();
					} else {
						btn.setButtonText("Installation failed - Retry");
						btn.setDisabled(false);
					}
				} else {
					this.nextStep();
				}
			});
		if (isPrimary) {
			btn.setCta();
		}
	}

	private async installAgent(agent: AgentOption): Promise<boolean> {
		const installCommand = getAgentInstallCommand(agent.id);
		if (!installCommand) return false;

		const packageName = installCommand.replace("npm install -g ", "");
		const nodePath = this.plugin.settings.nodePath;
		const nodeDir = nodePath.trim()
			? nodePath.trim().replace(/\/node$/, "")
			: "";
		const npmExec = nodeDir ? `${nodeDir}/npm` : "npm";

		return new Promise((resolve) => {
			let command: string;
			let args: string[];
			const installArgs = `${npmExec} install -g ${packageName}`;

			if (Platform.isWin) {
				command = "cmd.exe";
				args = ["/c", installArgs];
			} else {
				command = "/bin/bash";
				args = ["-l", "-c", installArgs];
			}

			console.warn(`[Onboarding] Installing ${agent.name}...`);

			const child = spawn(command, args, {
				stdio: ["pipe", "pipe", "pipe"],
				env: {
					...process.env,
					...(nodeDir && !Platform.isWin
						? { PATH: `${nodeDir}:${process.env.PATH || ""}` }
						: {}),
				},
			});

			let output = "";
			child.stdout?.on("data", (data: unknown) => {
				const text = typeof data === "string" ? data : String(data);
				output += text;
			});
			child.stderr?.on("data", (data: unknown) => {
				const text = typeof data === "string" ? data : String(data);
				output += text;
			});

			child.on("close", (code: number) => {
				if (code === 0) {
					console.warn(`[Onboarding] Successfully installed ${agent.name}`);
					resolve(true);
				} else {
					console.error(
						`[Onboarding] Failed to install ${agent.name} (exit code: ${code}): ${output}`,
					);
					resolve(false);
				}
			});

			child.on("error", (error) => {
				console.error(`[Onboarding] Error installing ${agent.name}:`, error);
				resolve(false);
			});
		});
	}
}
