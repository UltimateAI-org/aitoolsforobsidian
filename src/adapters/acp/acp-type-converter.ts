import * as acp from "@agentclientprotocol/sdk";
import type { ToolCallContent } from "../../domain/models/chat-message";
import type { PromptContent } from "../../domain/models/prompt-content";
import type {
	SessionConfigOption,
	SessionConfigSelectOption,
} from "../../domain/models/chat-session";

/**
 * Type converter between ACP Protocol types and Domain types.
 *
 * This adapter ensures the domain layer remains independent of the ACP library.
 * When the ACP protocol changes, only this converter needs to be updated.
 */
export class AcpTypeConverter {
	/**
	 * Convert ACP ToolCallContent to domain ToolCallContent.
	 *
	 * Filters out content types that are not supported by the domain model:
	 * - Supports: "diff", "terminal"
	 * - Ignores: "content" (not implemented in UI)
	 *
	 * @param acpContent - Tool call content from ACP protocol
	 * @returns Domain model tool call content, or undefined if input is null/empty
	 */
	static toToolCallContent(
		acpContent: acp.ToolCallContent[] | undefined | null,
	): ToolCallContent[] | undefined {
		if (!acpContent) return undefined;

		const converted: ToolCallContent[] = [];

		for (const item of acpContent) {
			if (item.type === "diff") {
				converted.push({
					type: "diff",
					path: item.path,
					newText: item.newText,
					oldText: item.oldText,
				});
			} else if (item.type === "terminal") {
				converted.push({
					type: "terminal",
					terminalId: item.terminalId,
				});
			}
			// "content" type is intentionally ignored (not implemented in UI)
		}

		return converted.length > 0 ? converted : undefined;
	}

	/**
	 * Convert ACP session config options to domain SessionConfigOption[].
	 *
	 * Only select-type options are kept (boolean options are not advertised
	 * as supported, so agents send two-value selects instead). Grouped option
	 * lists are flattened; the group label is not preserved.
	 *
	 * @param acpOptions - configOptions from a session response or update
	 * @returns Domain options, or undefined if none were sent
	 */
	static toSessionConfigOptions(
		acpOptions: acp.SessionConfigOption[] | undefined | null,
	): SessionConfigOption[] | undefined {
		if (!acpOptions) return undefined;

		const converted: SessionConfigOption[] = [];

		for (const option of acpOptions) {
			if (option.type !== "select") continue;

			const values: SessionConfigSelectOption[] = [];
			for (const entry of option.options) {
				if ("group" in entry) {
					for (const grouped of entry.options) {
						values.push({
							value: grouped.value,
							name: grouped.name,
							description: grouped.description ?? undefined,
						});
					}
				} else {
					values.push({
						value: entry.value,
						name: entry.name,
						description: entry.description ?? undefined,
					});
				}
			}

			converted.push({
				id: option.id,
				name: option.name,
				description: option.description ?? undefined,
				category: option.category ?? undefined,
				currentValue: option.currentValue,
				options: values,
			});
		}

		return converted.length > 0 ? converted : undefined;
	}

	/**
	 * Convert domain PromptContent to ACP ContentBlock.
	 *
	 * This converts our domain-layer prompt content to the ACP protocol format
	 * for sending to the agent.
	 *
	 * @param content - Domain prompt content (text, image, or resource)
	 * @returns ACP ContentBlock for use with the prompt API
	 */
	static toAcpContentBlock(content: PromptContent): acp.ContentBlock {
		switch (content.type) {
			case "text":
				return { type: "text", text: content.text };
			case "image":
				return {
					type: "image",
					data: content.data,
					mimeType: content.mimeType,
				};
			case "resource":
				return {
					type: "resource",
					resource: {
						uri: content.resource.uri,
						mimeType: content.resource.mimeType,
						text: content.resource.text,
					},
					annotations: content.annotations,
				};
		}
	}
}
