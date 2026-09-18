import type { TurnStats } from "../domain/models/chat-message";

/**
 * Describe how a turn ended and how long it took, e.g. "Completed in 42s".
 */
export function describeTurn(turn: TurnStats): string {
	const duration = formatDuration(turn.durationMs);
	switch (turn.stopReason) {
		case "cancelled":
			return `Stopped after ${duration}`;
		case "refusal":
			return `Declined after ${duration}`;
		case "max_tokens":
		case "max_turn_requests":
			return `Hit limit after ${duration}`;
		default:
			return `Completed in ${duration}`;
	}
}

/**
 * Format a duration in milliseconds for display.
 *
 * - under 1 second: "<1s"
 * - under a minute: "42s"
 * - under an hour:  "1m 05s"
 * - otherwise:      "1h 02m"
 */
export function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	if (totalSeconds < 1) return "<1s";
	if (totalSeconds < 60) return `${totalSeconds}s`;

	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}h ${String(minutes).padStart(2, "0")}m`;
	}
	return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
