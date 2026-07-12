import * as React from "react";
const { useRef, useState, useEffect, useCallback, useMemo } = React;
import { setIcon, DropdownComponent, Notice } from "obsidian";

import type AgentClientPlugin from "../../plugin";
import type { ChatView } from "./ChatView";
import type { NoteMetadata } from "../../domain/ports/vault-access.port";
import type {
	SlashCommand,
	SessionModeState,
	SessionModelState,
} from "../../domain/models/chat-session";
import type { ImagePromptContent } from "../../domain/models/prompt-content";
import type { QueuedMessage } from "../../hooks/useChat";
import type { QuickPromptSetting } from "../../plugin";
import { useQuickPrompts } from "../../hooks/useQuickPrompts";
import type { UseMentionsReturn } from "../../hooks/useMentions";
import type { UseSlashCommandsReturn } from "../../hooks/useSlashCommands";
import type { UseAutoMentionReturn } from "../../hooks/useAutoMention";
import { SuggestionDropdown } from "./SuggestionDropdown";
import { ImagePreviewStrip, type AttachedImage } from "./ImagePreviewStrip";
import { Logger } from "../../shared/logger";
import { useSettings } from "../../hooks/useSettings";

// ============================================================================
// Image Constants
// ============================================================================

/** Maximum image size in MB */
const MAX_IMAGE_SIZE_MB = 5;

/** Maximum image size in bytes */
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

/** Maximum number of images per message */
const MAX_IMAGE_COUNT = 10;

/** Supported image MIME types (whitelist) */
const SUPPORTED_IMAGE_TYPES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
] as const;

type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

/**
 * Props for ChatInput component
 */
export interface ChatInputProps {
	/** Whether a message is currently being sent */
	isSending: boolean;
	/** Whether the session is ready for user input */
	isSessionReady: boolean;
	/** Whether a session is being restored (load/resume/fork) */
	isRestoringSession: boolean;
	/** Display name of the active agent */
	agentLabel: string;
	/** Available slash commands */
	availableCommands: SlashCommand[];
	/** Whether auto-mention setting is enabled */
	autoMentionEnabled: boolean;
	/** Message to restore (e.g., after cancellation) */
	restoredMessage: string | null;
	/** Mentions hook state and methods */
	mentions: UseMentionsReturn;
	/** Slash commands hook state and methods */
	slashCommands: UseSlashCommandsReturn;
	/** Auto-mention hook state and methods */
	autoMention: UseAutoMentionReturn;
	/** Plugin instance */
	plugin: AgentClientPlugin;
	/** View instance for event registration */
	view: ChatView;
	/** Callback to send a message with optional images */
	onSendMessage: (
		content: string,
		images?: ImagePromptContent[],
	) => Promise<void>;
	/** Callback to queue a message while the agent is streaming */
	onQueueMessage: (content: string, images?: ImagePromptContent[]) => void;
	/** Messages queued to send when the current turn finishes */
	queuedMessages: QueuedMessage[];
	/** Callback to remove a queued message (chip dismissed) */
	onRemoveQueuedMessage: (id: string) => void;
	/** Callback to stop the current generation */
	onStopGeneration: () => Promise<void>;
	/** Callback when restored message has been consumed */
	onRestoredMessageConsumed: () => void;
	/** Session mode state (available modes and current mode) */
	modes?: SessionModeState;
	/** Callback when mode is changed */
	onModeChange?: (modeId: string) => void;
	/** Session model state (available models and current model) - experimental */
	models?: SessionModelState;
	/** Callback when model is changed */
	onModelChange?: (modelId: string) => void;
	/** Whether the agent supports image attachments */
	supportsImages?: boolean;
	/** Current agent ID (used to clear images on agent switch) */
	agentId: string;
}

/**
 * Input component for the chat view.
 *
 * Handles:
 * - Text input with auto-resize
 * - Mention dropdown (@-mentions)
 * - Slash command dropdown (/-commands)
 * - Auto-mention badge
 * - Hint overlay for slash commands
 * - Send/stop button
 * - Keyboard navigation
 */
export function ChatInput({
	isSending,
	isSessionReady,
	isRestoringSession,
	agentLabel,
	availableCommands,
	autoMentionEnabled,
	restoredMessage,
	mentions,
	slashCommands,
	autoMention,
	plugin,
	view,
	onSendMessage,
	onQueueMessage,
	queuedMessages,
	onRemoveQueuedMessage,
	onStopGeneration,
	onRestoredMessageConsumed,
	modes,
	onModeChange,
	models,
	onModelChange,
	supportsImages = false,
	agentId,
}: ChatInputProps) {
	const logger = useMemo(() => new Logger(plugin), [plugin]);
	const settings = useSettings(plugin);

	// Quick prompt `!` menu (prompts are configured in settings)
	const quickPromptMenu = useQuickPrompts(settings.quickPrompts);

	// Local state
	const [inputValue, setInputValue] = useState("");
	const [hintText, setHintText] = useState<string | null>(null);
	const [commandText, setCommandText] = useState<string>("");
	const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
	const [isDraggingOver, setIsDraggingOver] = useState(false);

	// Refs
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const dragCounterRef = useRef(0);
	const sendButtonRef = useRef<HTMLButtonElement>(null);
	const modeDropdownRef = useRef<HTMLDivElement>(null);
	const modeDropdownInstance = useRef<DropdownComponent | null>(null);
	const modelDropdownRef = useRef<HTMLDivElement>(null);
	const modelDropdownInstance = useRef<DropdownComponent | null>(null);

	// Clear attached images when agent changes
	useEffect(() => {
		setAttachedImages([]);
	}, [agentId]);

	/**
	 * Add an image to the attached images list.
	 * Simple addition - validation is done in handlePaste.
	 */
	const addImage = useCallback((image: AttachedImage) => {
		setAttachedImages((prev) => {
			// Safety check for race conditions
			if (prev.length >= MAX_IMAGE_COUNT) {
				return prev;
			}
			return [...prev, image];
		});
	}, []);

	/**
	 * Remove an image from the attached images list.
	 */
	const removeImage = useCallback((id: string) => {
		setAttachedImages((prev) => prev.filter((img) => img.id !== id));
	}, []);

	/**
	 * Convert a File to Base64 string.
	 */
	const fileToBase64 = useCallback(async (file: File): Promise<string> => {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				// Extract base64 part from "data:image/png;base64,..."
				const base64 = result.split(",")[1];
				resolve(base64);
			};
			reader.onerror = reject;
			reader.readAsDataURL(file);
		});
	}, []);

	/**
	 * Process and attach image files.
	 * Common logic for paste and drop handlers.
	 */
	const processImageFiles = useCallback(
		async (files: File[]) => {
			let addedCount = 0;

			for (const file of files) {
				// Check image count
				if (attachedImages.length + addedCount >= MAX_IMAGE_COUNT) {
					new Notice(
						`[AI Tools] Maximum ${MAX_IMAGE_COUNT} images allowed`,
					);
					break;
				}

				// Check file size (before conversion - memory efficiency)
				if (file.size > MAX_IMAGE_SIZE_BYTES) {
					new Notice(
						`[AI Tools] Image too large (max ${MAX_IMAGE_SIZE_MB}MB)`,
					);
					continue;
				}

				// Convert to Base64 and add
				try {
					const base64 = await fileToBase64(file);
					addImage({
						id: crypto.randomUUID(),
						data: base64,
						mimeType: file.type,
					});
					addedCount++;
				} catch (error) {
					console.error("Failed to convert image:", error);
					new Notice("[AI Tools] Failed to attach image");
				}
			}
		},
		[attachedImages.length, addImage, fileToBase64],
	);

	/**
	 * Handle paste event for image attachment.
	 */
	const handlePaste = useCallback(
		async (e: React.ClipboardEvent) => {
			const items = e.clipboardData?.items;
			if (!items) return;

			// Extract image files from clipboard
			const imageFiles: File[] = [];
			for (const item of Array.from(items)) {
				if (
					SUPPORTED_IMAGE_TYPES.includes(
						item.type as SupportedImageType,
					)
				) {
					const file = item.getAsFile();
					if (file) imageFiles.push(file);
				}
			}

			if (imageFiles.length === 0) return;

			e.preventDefault();

			if (!supportsImages) {
				new Notice(
					"[AI Tools] This agent does not support image attachments",
				);
				return;
			}

			await processImageFiles(imageFiles);
		},
		[supportsImages, processImageFiles],
	);

	/**
	 * Handle drag over event to allow drop.
	 */
	const handleDragOver = useCallback((e: React.DragEvent) => {
		if (e.dataTransfer?.types.includes("Files")) {
			e.preventDefault();
			e.dataTransfer.dropEffect = "copy";
		}
	}, []);

	/**
	 * Handle drag enter event for visual feedback.
	 * Uses counter to handle child element enter/leave correctly.
	 */
	const handleDragEnter = useCallback((e: React.DragEvent) => {
		if (e.dataTransfer?.types.includes("Files")) {
			e.preventDefault();
			dragCounterRef.current++;
			if (dragCounterRef.current === 1) {
				setIsDraggingOver(true);
			}
		}
	}, []);

	/**
	 * Handle drag leave event to reset visual feedback.
	 */
	const handleDragLeave = useCallback((e: React.DragEvent) => {
		dragCounterRef.current--;
		if (dragCounterRef.current === 0) {
			setIsDraggingOver(false);
		}
	}, []);

	/**
	 * Handle drop event for image files.
	 */
	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
			dragCounterRef.current = 0;
			setIsDraggingOver(false);

			const files = e.dataTransfer?.files;
			if (!files || files.length === 0) return;

			// Filter to supported image types
			const imageFiles = Array.from(files).filter((file) =>
				SUPPORTED_IMAGE_TYPES.includes(file.type as SupportedImageType),
			);

			if (imageFiles.length === 0) return;

			e.preventDefault();

			if (!supportsImages) {
				new Notice(
					"[AI Tools] This agent does not support image attachments",
				);
				return;
			}

			await processImageFiles(imageFiles);
		},
		[supportsImages, processImageFiles],
	);

	/**
	 * Common logic for setting cursor position after text replacement.
	 */
	const setTextAndFocus = useCallback((newText: string) => {
		setInputValue(newText);

		// Set cursor position to end of text
		window.setTimeout(() => {
			const textarea = textareaRef.current;
			if (textarea) {
				const cursorPos = newText.length;
				textarea.selectionStart = cursorPos;
				textarea.selectionEnd = cursorPos;
				textarea.focus();
			}
		}, 0);
	}, []);

	/**
	 * Handle mention selection from dropdown.
	 */
	const selectMention = useCallback(
		(suggestion: NoteMetadata) => {
			const newText = mentions.selectSuggestion(inputValue, suggestion);
			setTextAndFocus(newText);
		},
		[mentions, inputValue, setTextAndFocus],
	);

	/**
	 * Handle slash command selection from dropdown.
	 */
	const handleSelectSlashCommand = useCallback(
		(command: SlashCommand) => {
			const newText = slashCommands.selectSuggestion(inputValue, command);
			setInputValue(newText);

			// Setup hint overlay if command has hint
			if (command.hint) {
				const cmdText = `/${command.name} `;
				setCommandText(cmdText);
				setHintText(command.hint);
			} else {
				// No hint - clear hint state
				setHintText(null);
				setCommandText("");
			}

			// Place cursor right after command name (before hint text)
			window.setTimeout(() => {
				const textarea = textareaRef.current;
				if (textarea) {
					const cursorPos = command.hint
						? `/${command.name} `.length
						: newText.length;
					textarea.selectionStart = cursorPos;
					textarea.selectionEnd = cursorPos;
					textarea.focus();
				}
			}, 0);
		},
		[slashCommands, inputValue],
	);

	/**
	 * Fire a quick prompt (from a chip or the `!` menu).
	 * Send-immediately prompts go straight out — queued if the agent is
	 * streaming. Insert-mode prompts (and any prompt fired while the
	 * session isn't ready to send) land in the composer for editing.
	 */
	const fireQuickPrompt = useCallback(
		(quickPrompt: QuickPromptSetting) => {
			quickPromptMenu.close();
			setHintText(null);
			setCommandText("");

			const canSend = isSessionReady && !isRestoringSession;
			if (!quickPrompt.sendImmediately || !canSend) {
				setInputValue(quickPrompt.prompt);
				window.setTimeout(() => textareaRef.current?.focus(), 0);
				return;
			}

			setInputValue("");
			if (isSending) {
				onQueueMessage(quickPrompt.prompt);
			} else {
				void onSendMessage(quickPrompt.prompt);
			}
		},
		[
			quickPromptMenu,
			isSessionReady,
			isRestoringSession,
			isSending,
			onQueueMessage,
			onSendMessage,
		],
	);

	/**
	 * Adjust textarea height based on content.
	 */
	const adjustTextareaHeight = useCallback(() => {
		const textarea = textareaRef.current;
		if (textarea) {
			// Remove previous dynamic height classes
			textarea.classList.remove(
				"obsidianaitools-textarea-auto-height",
				"obsidianaitools-textarea-expanded",
			);

			// Temporarily use auto to measure
			textarea.classList.add("obsidianaitools-textarea-auto-height");
			const scrollHeight = textarea.scrollHeight;
			const minHeight = 80;
			const maxHeight = 300;

			// Calculate height
			const calculatedHeight = Math.max(
				minHeight,
				Math.min(scrollHeight, maxHeight),
			);

			// Apply expanded class if needed
			if (calculatedHeight > minHeight) {
				textarea.classList.add("obsidianaitools-textarea-expanded");
				// Set CSS variable for dynamic height
				textarea.style.setProperty(
					"--textarea-height",
					`${calculatedHeight}px`,
				);
			} else {
				textarea.style.removeProperty("--textarea-height");
			}

			textarea.classList.remove("obsidianaitools-textarea-auto-height");
		}
	}, []);

	/**
	 * Update send button icon color based on state.
	 */
	// Whether the composer holds sendable content (text or images)
	const hasContent = inputValue.trim() !== "" || attachedImages.length > 0;

	const updateIconColor = useCallback(
		(svg: SVGElement) => {
			// Remove all state classes
			svg.classList.remove(
				"obsidianaitools-icon-sending",
				"obsidianaitools-icon-active",
				"obsidianaitools-icon-inactive",
			);

			if (isSending && !hasContent) {
				// Stop button - streaming with an empty composer
				svg.classList.add("obsidianaitools-icon-sending");
			} else {
				// Send button - active when has input (text or images);
				// during streaming a filled composer means "steer"
				svg.classList.add(
					hasContent
						? "obsidianaitools-icon-active"
						: "obsidianaitools-icon-inactive",
				);
			}
		},
		[isSending, hasContent],
	);

	/**
	 * Handle sending or stopping based on current state.
	 */
	const handleSendOrStop = useCallback(async () => {
		// Streaming with an empty composer: the button is a stop button
		if (isSending && !hasContent) {
			await onStopGeneration();
			return;
		}

		// Allow sending if there's text OR images
		if (!hasContent) return;

		// Save input value and images before clearing
		const messageToSend = inputValue.trim();
		const imagesToSend: ImagePromptContent[] = attachedImages.map(
			(img) => ({
				type: "image",
				data: img.data,
				mimeType: img.mimeType,
			}),
		);

		// Clear input, images, and hint state immediately
		setInputValue("");
		setAttachedImages([]);
		setHintText(null);
		setCommandText("");

		// While streaming, queue instead of sending — the message auto-sends
		// when the current turn finishes (Claude Code semantics)
		if (isSending) {
			onQueueMessage(
				messageToSend,
				imagesToSend.length > 0 ? imagesToSend : undefined,
			);
			return;
		}

		await onSendMessage(
			messageToSend,
			imagesToSend.length > 0 ? imagesToSend : undefined,
		);
	}, [
		isSending,
		hasContent,
		inputValue,
		attachedImages,
		onSendMessage,
		onQueueMessage,
		onStopGeneration,
	]);

	/**
	 * Handle dropdown keyboard navigation.
	 */
	const handleDropdownKeyPress = useCallback(
		(e: React.KeyboardEvent): boolean => {
			const isSlashCommandActive = slashCommands.isOpen;
			const isMentionActive = mentions.isOpen;
			const isQuickPromptActive = quickPromptMenu.isOpen;

			if (
				!isSlashCommandActive &&
				!isMentionActive &&
				!isQuickPromptActive
			) {
				return false;
			}

			// Arrow navigation
			if (e.key === "ArrowDown") {
				e.preventDefault();
				if (isSlashCommandActive) {
					slashCommands.navigate("down");
				} else if (isQuickPromptActive) {
					quickPromptMenu.navigate("down");
				} else {
					mentions.navigate("down");
				}
				return true;
			}

			if (e.key === "ArrowUp") {
				e.preventDefault();
				if (isSlashCommandActive) {
					slashCommands.navigate("up");
				} else if (isQuickPromptActive) {
					quickPromptMenu.navigate("up");
				} else {
					mentions.navigate("up");
				}
				return true;
			}

			// Select item (Enter or Tab)
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				if (isSlashCommandActive) {
					const selectedCommand =
						slashCommands.suggestions[slashCommands.selectedIndex];
					if (selectedCommand) {
						handleSelectSlashCommand(selectedCommand);
					}
				} else if (isQuickPromptActive) {
					const selectedPrompt =
						quickPromptMenu.suggestions[
							quickPromptMenu.selectedIndex
						];
					if (selectedPrompt) {
						fireQuickPrompt(selectedPrompt);
					}
				} else {
					const selectedSuggestion =
						mentions.suggestions[mentions.selectedIndex];
					if (selectedSuggestion) {
						selectMention(selectedSuggestion);
					}
				}
				return true;
			}

			// Close dropdown (Escape)
			if (e.key === "Escape") {
				e.preventDefault();
				if (isSlashCommandActive) {
					slashCommands.close();
				} else if (isQuickPromptActive) {
					quickPromptMenu.close();
				} else {
					mentions.close();
				}
				return true;
			}

			return false;
		},
		[
			slashCommands,
			mentions,
			quickPromptMenu,
			handleSelectSlashCommand,
			fireQuickPrompt,
			selectMention,
		],
	);

	// Button disabled state - also allow sending if images are attached
	const isButtonDisabled =
		!isSending && (!hasContent || !isSessionReady || isRestoringSession);

	/**
	 * Handle keyboard events in the textarea.
	 */
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			// Handle dropdown navigation first
			if (handleDropdownKeyPress(e)) {
				return;
			}

			// Normal input handling - check if should send based on shortcut setting
			if (e.key === "Enter" && !e.nativeEvent.isComposing) {
				const shouldSend =
					settings.sendMessageShortcut === "enter"
						? !e.shiftKey // Enter mode: send unless Shift is pressed
						: e.metaKey || e.ctrlKey; // Cmd+Enter mode: send only with Cmd/Ctrl

				if (shouldSend) {
					e.preventDefault();
					// While streaming, Enter steers only when there is
					// content — an empty Enter must never trigger stop
					if (isSending ? hasContent : !isButtonDisabled) {
						void handleSendOrStop();
					}
				}
				// If not shouldSend, allow default behavior (newline)
			}
		},
		[
			handleDropdownKeyPress,
			isSending,
			hasContent,
			isButtonDisabled,
			handleSendOrStop,
			settings.sendMessageShortcut,
		],
	);

	/**
	 * Handle input changes in the textarea.
	 */
	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const newValue = e.target.value;
			const cursorPosition = e.target.selectionStart || 0;

			logger.log(
				"[DEBUG] Input changed:",
				newValue,
				"cursor:",
				cursorPosition,
			);

			setInputValue(newValue);

			// Hide hint overlay when user modifies the input
			if (hintText) {
				const expectedText = commandText + hintText;
				if (newValue !== expectedText) {
					setHintText(null);
					setCommandText("");
				}
			}

			// Update mention suggestions
			void mentions.updateSuggestions(newValue, cursorPosition);

			// Update slash command suggestions
			slashCommands.updateSuggestions(newValue, cursorPosition);

			// Update quick prompt suggestions
			quickPromptMenu.updateSuggestions(newValue, cursorPosition);
		},
		[logger, hintText, commandText, mentions, slashCommands, quickPromptMenu],
	);

	// Adjust textarea height when input changes
	useEffect(() => {
		adjustTextareaHeight();
	}, [inputValue, adjustTextareaHeight]);

	// Update send button icon based on sending/composer state.
	// While streaming, a filled composer flips the stop square back to a
	// send arrow: firing it queues the message for the end of the turn.
	useEffect(() => {
		if (sendButtonRef.current) {
			const iconName =
				isSending && !hasContent ? "square" : "send-horizontal";
			setIcon(sendButtonRef.current, iconName);
			const svg = sendButtonRef.current.querySelector("svg");
			if (svg) {
				updateIconColor(svg);
			}
		}
	}, [isSending, hasContent, updateIconColor]);

	// Auto-focus textarea on mount
	useEffect(() => {
		window.setTimeout(() => {
			if (textareaRef.current) {
				textareaRef.current.focus();
			}
		}, 0);
	}, []);

	// Restore message when provided (e.g., after cancellation)
	// Only restore if input is empty to avoid overwriting user's new input
	useEffect(() => {
		if (restoredMessage) {
			if (!inputValue.trim()) {
				setInputValue(restoredMessage);
				// Focus and place cursor at end
				window.setTimeout(() => {
					if (textareaRef.current) {
						textareaRef.current.focus();
						textareaRef.current.selectionStart =
							restoredMessage.length;
						textareaRef.current.selectionEnd =
							restoredMessage.length;
					}
				}, 0);
			}
			onRestoredMessageConsumed();
		}
	}, [restoredMessage, onRestoredMessageConsumed, inputValue]);

	// Stable references for callbacks
	const onModeChangeRef = useRef(onModeChange);
	onModeChangeRef.current = onModeChange;

	// Initialize Mode dropdown (only when availableModes change)
	const availableModes = modes?.availableModes;
	const currentModeId = modes?.currentModeId;

	useEffect(() => {
		const containerEl = modeDropdownRef.current;
		if (!containerEl) return;

		// Only show dropdown if there are multiple modes
		if (!availableModes || availableModes.length <= 1) {
			// Clean up existing dropdown if modes become unavailable
			if (modeDropdownInstance.current) {
				containerEl.empty();
				modeDropdownInstance.current = null;
			}
			return;
		}

		// Create dropdown if not exists
		if (!modeDropdownInstance.current) {
			const dropdown = new DropdownComponent(containerEl);
			modeDropdownInstance.current = dropdown;

			// Add options
			for (const mode of availableModes) {
				dropdown.addOption(mode.id, mode.name);
			}

			// Set initial value
			if (currentModeId) {
				dropdown.setValue(currentModeId);
			}

			// Handle change - use ref to avoid recreating dropdown on callback change
			dropdown.onChange((value) => {
				if (onModeChangeRef.current) {
					onModeChangeRef.current(value);
				}
			});
		}

		// Cleanup on unmount or when availableModes change
		return () => {
			if (modeDropdownInstance.current) {
				containerEl.empty();
				modeDropdownInstance.current = null;
			}
		};
	}, [availableModes]);

	// Update dropdown value when currentModeId changes (separate effect)
	useEffect(() => {
		if (modeDropdownInstance.current && currentModeId) {
			modeDropdownInstance.current.setValue(currentModeId);
		}
	}, [currentModeId]);

	// Stable references for model callbacks
	const onModelChangeRef = useRef(onModelChange);
	onModelChangeRef.current = onModelChange;

	// Initialize Model dropdown (only when availableModels change)
	const availableModels = models?.availableModels;
	const currentModelId = models?.currentModelId;

	useEffect(() => {
		const containerEl = modelDropdownRef.current;
		if (!containerEl) return;

		// Only show dropdown if there are multiple models
		if (!availableModels || availableModels.length <= 1) {
			// Clean up existing dropdown if models become unavailable
			if (modelDropdownInstance.current) {
				containerEl.empty();
				modelDropdownInstance.current = null;
			}
			return;
		}

		// Create dropdown if not exists
		if (!modelDropdownInstance.current) {
			const dropdown = new DropdownComponent(containerEl);
			modelDropdownInstance.current = dropdown;

			// Add options
			for (const model of availableModels) {
				dropdown.addOption(model.modelId, model.name);
			}

			// Set initial value
			if (currentModelId) {
				dropdown.setValue(currentModelId);
			}

			// Handle change - use ref to avoid recreating dropdown on callback change
			dropdown.onChange((value) => {
				if (onModelChangeRef.current) {
					onModelChangeRef.current(value);
				}
			});
		}

		// Cleanup on unmount or when availableModels change
		return () => {
			if (modelDropdownInstance.current) {
				containerEl.empty();
				modelDropdownInstance.current = null;
			}
		};
	}, [availableModels]);

	// Update dropdown value when currentModelId changes (separate effect)
	useEffect(() => {
		if (modelDropdownInstance.current && currentModelId) {
			modelDropdownInstance.current.setValue(currentModelId);
		}
	}, [currentModelId]);

	// Quick prompts that are complete enough to show (name + prompt text)
	const firableQuickPrompts = settings.quickPrompts.filter(
		(qp) => qp.name.trim().length > 0 && qp.prompt.trim().length > 0,
	);

	// Cap the chip row; the rest stay reachable via the `!` menu
	const MAX_VISIBLE_QUICK_PROMPTS = 6;
	const visibleQuickPrompts = firableQuickPrompts.slice(
		0,
		MAX_VISIBLE_QUICK_PROMPTS,
	);
	const overflowPromptCount =
		firableQuickPrompts.length - visibleQuickPrompts.length;

	/** Open the `!` menu pre-seeded so overflow prompts are one click away */
	const openQuickPromptMenu = useCallback(() => {
		setInputValue("!");
		quickPromptMenu.updateSuggestions("!", 1);
		window.setTimeout(() => textareaRef.current?.focus(), 0);
	}, [quickPromptMenu]);

	// Placeholder text
	const placeholder = `Message ${agentLabel} - @ to mention notes${availableCommands.length > 0 ? ", / for commands" : ""}${firableQuickPrompts.length > 0 ? ", ! for prompts" : ""}`;

	return (
		<div className="obsidianaitools-chat-input-container">
			{/* Quick Prompt Chips */}
			{firableQuickPrompts.length > 0 && (
				<div className="obsidianaitools-quick-prompt-strip">
					{visibleQuickPrompts.map((qp) => (
						<button
							key={qp.id}
							className="obsidianaitools-quick-prompt-chip"
							title={qp.prompt}
							onClick={() => fireQuickPrompt(qp)}
						>
							{qp.name}
						</button>
					))}
					{overflowPromptCount > 0 && (
						<button
							className="obsidianaitools-quick-prompt-chip"
							title="Show all quick prompts"
							onClick={openQuickPromptMenu}
						>
							+{overflowPromptCount} more
						</button>
					)}
				</div>
			)}

			{/* Quick Prompt Dropdown (`!` menu) */}
			{quickPromptMenu.isOpen && (
				<SuggestionDropdown
					type="quick-prompt"
					items={quickPromptMenu.suggestions}
					selectedIndex={quickPromptMenu.selectedIndex}
					onSelect={(item) =>
						fireQuickPrompt(item as QuickPromptSetting)
					}
					onClose={quickPromptMenu.close}
					plugin={plugin}
					view={view}
				/>
			)}

			{/* Mention Dropdown */}
			{mentions.isOpen && (
				<SuggestionDropdown
					type="mention"
					items={mentions.suggestions}
					selectedIndex={mentions.selectedIndex}
					onSelect={selectMention}
					onClose={mentions.close}
					plugin={plugin}
					view={view}
				/>
			)}

			{/* Slash Command Dropdown */}
			{slashCommands.isOpen && (
				<SuggestionDropdown
					type="slash-command"
					items={slashCommands.suggestions}
					selectedIndex={slashCommands.selectedIndex}
					onSelect={handleSelectSlashCommand}
					onClose={slashCommands.close}
					plugin={plugin}
					view={view}
				/>
			)}

			{/* Input Box - flexbox container with border */}
			<div
				className={`obsidianaitools-chat-input-box ${isDraggingOver ? "obsidianaitools-dragging-over" : ""}`}
				onDragOver={handleDragOver}
				onDragEnter={handleDragEnter}
				onDragLeave={handleDragLeave}
				onDrop={(e) => void handleDrop(e)}
			>
				{/* Auto-mention Badge */}
				{autoMentionEnabled && autoMention.activeNote && (
					<div className="obsidianaitools-auto-mention-inline">
						<span
							className={`obsidianaitools-mention-badge ${autoMention.isDisabled ? "obsidianaitools-disabled" : ""}`}
						>
							@{autoMention.activeNote.name}
							{autoMention.activeNote.selection && (
								<span className="obsidianaitools-selection-indicator">
									{":"}
									{autoMention.activeNote.selection.from
										.line + 1}
									-
									{autoMention.activeNote.selection.to.line +
										1}
								</span>
							)}
						</span>
						<button
							className="obsidianaitools-auto-mention-toggle-btn"
							onClick={(e) => {
								const newDisabledState =
									!autoMention.isDisabled;
								autoMention.toggle(newDisabledState);
								const iconName = newDisabledState
									? "x"
									: "plus";
								setIcon(e.currentTarget, iconName);
							}}
							title={
								autoMention.isDisabled
									? "Enable auto-mention"
									: "Temporarily disable auto-mention"
							}
							ref={(el) => {
								if (el) {
									const iconName = autoMention.isDisabled
										? "plus"
										: "x";
									setIcon(el, iconName);
								}
							}}
						/>
					</div>
				)}

				{/* Textarea with Hint Overlay */}
				<div className="obsidianaitools-textarea-wrapper">
					<textarea
						ref={textareaRef}
						value={inputValue}
						onChange={handleInputChange}
						onKeyDown={handleKeyDown}
						onPaste={(e) => void handlePaste(e)}
						placeholder={placeholder}
						className={`obsidianaitools-chat-input-textarea ${autoMentionEnabled && autoMention.activeNote ? "has-auto-mention" : ""}`}
						rows={1}
					/>
					{hintText && (
						<div
							className="obsidianaitools-hint-overlay"
							aria-hidden="true"
						>
							<span className="obsidianaitools-invisible">
								{commandText}
							</span>
							<span className="obsidianaitools-hint-text">
								{hintText}
							</span>
						</div>
					)}
				</div>

				{/* Image Preview Strip (only shown when agent supports images) */}
				{supportsImages && (
					<ImagePreviewStrip
						images={attachedImages}
						onRemove={removeImage}
					/>
				)}

				{/* Queued messages — auto-send when the turn finishes */}
				{queuedMessages.length > 0 && (
					<div className="obsidianaitools-queued-strip">
						{queuedMessages.map((queued) => (
							<div
								key={queued.id}
								className="obsidianaitools-queued-chip"
								title={queued.content}
							>
								<span className="obsidianaitools-queued-chip-label">
									Queued: {queued.content}
								</span>
								<button
									className="obsidianaitools-queued-chip-remove"
									aria-label="Remove queued message"
									title="Remove queued message"
									onClick={() =>
										onRemoveQueuedMessage(queued.id)
									}
								>
									×
								</button>
							</div>
						))}
					</div>
				)}

				{/* Input Actions (Mode Selector + Model Selector + Send Button) */}
				<div className="obsidianaitools-chat-input-actions">
					{/* Mode Selector */}
					{modes && modes.availableModes.length > 1 && (
						<div
							className="obsidianaitools-mode-selector"
							title={
								modes.availableModes.find(
									(m) => m.id === modes.currentModeId,
								)?.description ?? "Select mode"
							}
						>
							<div ref={modeDropdownRef} />
							<span
								className="obsidianaitools-mode-selector-icon"
								ref={(el) => {
									if (el) setIcon(el, "chevron-down");
								}}
							/>
						</div>
					)}

					{/* Model Selector (experimental) */}
					{models && models.availableModels.length > 1 && (
						<div
							className="obsidianaitools-model-selector"
							title={
								models.availableModels.find(
									(m) => m.modelId === models.currentModelId,
								)?.description ?? "Select model"
							}
						>
							<div ref={modelDropdownRef} />
							<span
								className="obsidianaitools-model-selector-icon"
								ref={(el) => {
									if (el) setIcon(el, "chevron-down");
								}}
							/>
						</div>
					)}

					{/* Send/Stop Button */}
					<button
						ref={sendButtonRef}
						onClick={() => void handleSendOrStop()}
						disabled={isButtonDisabled}
						className={`obsidianaitools-chat-send-button ${isSending && !hasContent ? "sending" : ""} ${isButtonDisabled ? "obsidianaitools-disabled" : ""}`}
						title={
							!isSessionReady
								? "Connecting..."
								: isSending
									? hasContent
										? "Queue message (sends when the current response finishes)"
										: "Stop generation"
									: "Send message"
						}
					></button>
				</div>
			</div>
		</div>
	);
}
