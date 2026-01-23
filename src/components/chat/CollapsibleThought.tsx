import * as React from "react";
const { useState } = React;
import type AgentClientPlugin from "../../plugin";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";

interface CollapsibleThoughtProps {
	text: string;
	plugin: AgentClientPlugin;
}

export function CollapsibleThought({ text, plugin }: CollapsibleThoughtProps) {
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<div
			className="obsidianaitools-collapsible-thought"
			onClick={() => setIsExpanded(!isExpanded)}
		>
			<div className="obsidianaitools-collapsible-thought-header">
				💡Thinking
				<span className="obsidianaitools-collapsible-thought-icon">
					{isExpanded ? "▼" : "▶"}
				</span>
			</div>
			{isExpanded && (
				<div className="obsidianaitools-collapsible-thought-content">
					<MarkdownTextRenderer text={text} plugin={plugin} />
				</div>
			)}
		</div>
	);
}
