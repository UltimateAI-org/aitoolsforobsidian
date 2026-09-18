import * as React from "react";
import { Menu, setIcon } from "obsidian";

/**
 * One selectable value shown in a SessionOptionChip menu.
 */
export interface SessionOptionChipItem {
	/** Value identifier passed to onSelect */
	value: string;
	/** Display name */
	name: string;
	/** Optional description (shown as the chip tooltip when selected) */
	description?: string;
}

export interface SessionOptionChipProps {
	/**
	 * Optional label prefix, e.g. "Effort" renders as "Effort: High".
	 * Omit for options whose value is self-describing (mode, model).
	 */
	label?: string;
	/** Selectable values */
	items: SessionOptionChipItem[];
	/** Value identifier of the current selection */
	currentValue: string;
	/** Tooltip; falls back to the current item's description */
	title?: string;
	/** Called with the value identifier when the user picks a different item */
	onSelect: (value: string) => void;
}

/**
 * Compact text chip that opens an Obsidian Menu listing the option's values.
 *
 * Used in the composer action row for session mode, model and config
 * options (effort, fast mode, ...). Renders as status text rather than a
 * form control so several can sit side by side without crowding.
 */
export function SessionOptionChip({
	label,
	items,
	currentValue,
	title,
	onSelect,
}: SessionOptionChipProps) {
	const current = items.find((item) => item.value === currentValue);

	const openMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
		const menu = new Menu();
		for (const item of items) {
			menu.addItem((menuItem) => {
				menuItem.setTitle(item.name);
				menuItem.setChecked(item.value === currentValue);
				menuItem.onClick(() => {
					if (item.value !== currentValue) {
						onSelect(item.value);
					}
				});
			});
		}
		// Anchor the menu below the chip rather than at the pointer so it
		// opens in the same place regardless of where the chip was clicked.
		const rect = event.currentTarget.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	};

	return (
		<button
			type="button"
			className="obsidianaitools-option-chip"
			title={title ?? current?.description}
			onClick={openMenu}
		>
			{label && (
				<span className="obsidianaitools-option-chip-label">
					{label}:
				</span>
			)}
			<span className="obsidianaitools-option-chip-value">
				{current?.name ?? currentValue}
			</span>
			<span
				className="obsidianaitools-option-chip-icon"
				ref={(el) => {
					if (el) setIcon(el, "chevron-down");
				}}
			/>
		</button>
	);
}
