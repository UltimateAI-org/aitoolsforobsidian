import * as React from "react";
const { useMemo, useState } = React;
import type AgentClientPlugin from "../../plugin";
import { Logger } from "../../shared/logger";
import * as acp from "@agentclientprotocol/sdk";

interface PermissionRequestSectionProps {
	permissionRequest: {
		requestId: string;
		options: acp.PermissionOption[];
		selectedOptionId?: string;
		isCancelled?: boolean;
		isActive?: boolean;
	};
	toolCallId: string;
	plugin: AgentClientPlugin;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
	onOptionSelected?: (optionId: string) => void;
	/** Callback to send a message (used for "Other" option) */
	onSendMessage?: (content: string) => Promise<void>;
}

export function PermissionRequestSection({
	permissionRequest,
	toolCallId,
	plugin,
	onApprovePermission,
	onOptionSelected,
	onSendMessage,
}: PermissionRequestSectionProps) {
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	// State for "Other" option
	const [showOtherInput, setShowOtherInput] = useState(false);
	const [customText, setCustomText] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	const isSelected = permissionRequest.selectedOptionId !== undefined;
	const isCancelled = permissionRequest.isCancelled === true;
	const isActive = permissionRequest.isActive !== false;
	const selectedOption = permissionRequest.options.find(
		(opt) => opt.optionId === permissionRequest.selectedOptionId,
	);

	// Handler for "Other" button click
	const handleOtherClick = () => {
		setShowOtherInput(true);
	};

	// Handler for cancel
	const handleCancelOther = () => {
		setShowOtherInput(false);
		setCustomText("");
	};

	// Handler for submit custom text
	const handleSubmitCustomText = async () => {
		if (!customText.trim() || !onApprovePermission || !onSendMessage) {
			return;
		}

		setIsSubmitting(true);

		try {
			// Find reject option
			const rejectOption = permissionRequest.options.find(
				(opt) =>
					opt.kind === "reject_once" || opt.kind === "reject_always",
			) || permissionRequest.options[0];

			// Reject permission
			await onApprovePermission(
				permissionRequest.requestId,
				rejectOption.optionId,
			);

			// Send custom message
			await onSendMessage(customText);

			// Reset state
			setShowOtherInput(false);
			setCustomText("");
		} catch (error) {
			logger.error("Failed to handle Other option:", error);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="obsidianaitools-message-permission-request">
			{isActive && !isSelected && !isCancelled && (
				<>
					{!showOtherInput ? (
						<div className="obsidianaitools-message-permission-request-options">
							{permissionRequest.options.map((option) => (
								<button
									key={option.optionId}
									className={`obsidianaitools-permission-option ${option.kind ? `obsidianaitools-permission-kind-${option.kind}` : ""}`}
									onClick={() => {
										// Update local UI state immediately for feedback
										if (onOptionSelected) {
											onOptionSelected(option.optionId);
										}

										if (onApprovePermission) {
											// Send response to agent via callback
											void onApprovePermission(
												permissionRequest.requestId,
												option.optionId,
											);
										} else {
											logger.warn(
												"Cannot handle permission response: missing onApprovePermission callback",
											);
										}
									}}
								>
									{option.name}
								</button>
							))}
							<button
								className="obsidianaitools-permission-option obsidianaitools-permission-kind-other"
								onClick={handleOtherClick}
							>
								Other...
							</button>
						</div>
					) : (
						<div className="obsidianaitools-permission-other-form">
							<textarea
								className="obsidianaitools-permission-other-textarea"
								placeholder="Describe what you want the agent to do instead..."
								value={customText}
								onChange={(e) => setCustomText(e.target.value)}
								disabled={isSubmitting}
								autoFocus
							/>
							<div className="obsidianaitools-permission-other-actions">
								<button
									className="obsidianaitools-permission-other-cancel"
									onClick={handleCancelOther}
									disabled={isSubmitting}
								>
									Cancel
								</button>
								<button
									className="obsidianaitools-permission-other-submit"
									onClick={handleSubmitCustomText}
									disabled={!customText.trim() || isSubmitting}
								>
									{isSubmitting ? "Sending..." : "Send & Reject"}
								</button>
							</div>
						</div>
					)}
				</>
			)}
			{isSelected && selectedOption && (
				<div className="obsidianaitools-message-permission-request-result obsidianaitools-selected">
					✓ Selected: {selectedOption.name}
				</div>
			)}
			{isCancelled && (
				<div className="obsidianaitools-message-permission-request-result obsidianaitools-cancelled">
					⚠ Cancelled: Permission request was cancelled
				</div>
			)}
		</div>
	);
}
