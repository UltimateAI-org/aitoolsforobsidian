import { useState, useCallback } from "react";
import type { QuickPromptSetting } from "../plugin";

export interface UseQuickPromptsReturn {
	/** Filtered quick prompt suggestions */
	suggestions: QuickPromptSetting[];
	/** Currently selected index in the dropdown */
	selectedIndex: number;
	/** Whether the dropdown is open */
	isOpen: boolean;

	/**
	 * Update quick prompt suggestions based on current input.
	 * Quick prompts only trigger when input starts with '!'.
	 */
	updateSuggestions: (input: string, cursorPosition: number) => void;

	/** Navigate the dropdown selection */
	navigate: (direction: "up" | "down") => void;

	/** Close the dropdown */
	close: () => void;
}

/**
 * Hook for managing the quick prompt (`!`) dropdown state and logic.
 * Mirrors useSlashCommands: `!` only triggers at the very beginning of
 * input, so typing "great!" mid-sentence never opens the dropdown.
 *
 * @param quickPrompts - Quick prompts configured in settings
 */
export function useQuickPrompts(
	quickPrompts: QuickPromptSetting[],
): UseQuickPromptsReturn {
	const [suggestions, setSuggestions] = useState<QuickPromptSetting[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);

	const isOpen = suggestions.length > 0;

	const updateSuggestions = useCallback(
		(input: string, cursorPosition: number) => {
			if (!input.startsWith("!") || quickPrompts.length === 0) {
				setSuggestions([]);
				setSelectedIndex(0);
				return;
			}

			const query = input
				.slice(1, Math.max(cursorPosition, 1))
				.toLowerCase();

			const filtered = quickPrompts.filter(
				(qp) =>
					qp.prompt.trim().length > 0 &&
					qp.name.toLowerCase().includes(query),
			);

			setSuggestions(filtered);
			setSelectedIndex(0);
		},
		[quickPrompts],
	);

	const navigate = useCallback(
		(direction: "up" | "down") => {
			if (suggestions.length === 0) {
				return;
			}

			const maxIndex = suggestions.length - 1;

			setSelectedIndex((current) => {
				if (direction === "down") {
					return Math.min(current + 1, maxIndex);
				} else {
					return Math.max(current - 1, 0);
				}
			});
		},
		[suggestions.length],
	);

	const close = useCallback(() => {
		setSuggestions([]);
		setSelectedIndex(0);
	}, []);

	return {
		suggestions,
		selectedIndex,
		isOpen,
		updateSuggestions,
		navigate,
		close,
	};
}
