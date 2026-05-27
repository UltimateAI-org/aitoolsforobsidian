/**
 * Error Log - Persistent diagnostic log for agent/plugin failures.
 *
 * Appends one JSON object per line (NDJSON) to a file inside the plugin
 * config directory so users can share a meaningful diagnostic trail without
 * keeping DevTools open. Also captures optional ACP wire-frame traffic when
 * debug mode is enabled.
 *
 * Files live under `<vault>/<configDir>/plugins/obsidianaitools/`:
 *   - error.log      Always-on error sink (categorized failures)
 *   - acp-wire.log   Per-frame ACP traffic, only written when debugMode=true
 *
 * Each file is size-capped and rotated in place: when the cap is exceeded,
 * the oldest ~50% of lines is dropped so writes stay bounded without us
 * shipping a real log-rotation library.
 */

import type AgentClientPlugin from "../plugin";

const ERROR_LOG_FILENAME = "error.log";
const WIRE_LOG_FILENAME = "acp-wire.log";

/** Hard cap before rotation kicks in. */
const MAX_ERROR_LOG_BYTES = 512 * 1024; // 512 KB
const MAX_WIRE_LOG_BYTES = 2 * 1024 * 1024; // 2 MB

/** Truncate user-supplied strings before persisting. */
const MAX_FIELD_LENGTH = 4000;

export type ErrorLogSource =
	| "acp-stderr"
	| "acp-prompt-error"
	| "send-error"
	| "session-init"
	| "auth"
	| "other";

export interface ErrorLogEntry {
	timestamp: string;
	source: ErrorLogSource;
	agentId?: string;
	sessionId?: string;
	category?: string;
	title?: string;
	message?: string;
	code?: string | number;
	errorKind?: string;
	data?: unknown;
	stack?: string;
	context?: Record<string, unknown>;
}

export type WireDirection = "in" | "out";

interface WireFrameRecord {
	timestamp: string;
	direction: WireDirection;
	agentId?: string;
	frame: unknown;
}

/**
 * Persistent error sink writing NDJSON files into the plugin config dir.
 *
 * Construct once per plugin (`plugin.errorLog`) and call from any module
 * that catches a meaningful failure.
 */
export class ErrorLog {
	private plugin: AgentClientPlugin;

	// Serializes writes so concurrent callers don't interleave appends.
	private writeChain: Promise<void> = Promise.resolve();

	constructor(plugin: AgentClientPlugin) {
		this.plugin = plugin;
	}

	/** Directory inside the vault where logs are stored. */
	getLogDir(): string {
		return `${this.plugin.app.vault.configDir}/plugins/obsidianaitools`;
	}

	getErrorLogPath(): string {
		return `${this.getLogDir()}/${ERROR_LOG_FILENAME}`;
	}

	getWireLogPath(): string {
		return `${this.getLogDir()}/${WIRE_LOG_FILENAME}`;
	}

	/**
	 * Append a single error entry. Never throws — logging must not break
	 * the calling code path.
	 */
	async logError(entry: Omit<ErrorLogEntry, "timestamp">): Promise<void> {
		const record: ErrorLogEntry = {
			timestamp: new Date().toISOString(),
			...entry,
			message: truncate(entry.message),
			stack: truncate(entry.stack),
		};
		await this.appendLine(
			this.getErrorLogPath(),
			JSON.stringify(record),
			MAX_ERROR_LOG_BYTES,
		);
	}

	/**
	 * Append an ACP wire frame. No-op unless debug mode is enabled — frame
	 * volume is high and most users don't want it.
	 */
	async logWireFrame(
		direction: WireDirection,
		frame: unknown,
		agentId?: string,
	): Promise<void> {
		if (!this.plugin.settings.debugMode) return;
		const record: WireFrameRecord = {
			timestamp: new Date().toISOString(),
			direction,
			agentId,
			frame,
		};
		await this.appendLine(
			this.getWireLogPath(),
			safeStringify(record),
			MAX_WIRE_LOG_BYTES,
		);
	}

	/** Read the error log as text. Empty string if missing. */
	async readErrorLog(): Promise<string> {
		return this.readFile(this.getErrorLogPath());
	}

	/** Read the wire-frame log as text. Empty string if missing. */
	async readWireLog(): Promise<string> {
		return this.readFile(this.getWireLogPath());
	}

	/** Parse the error log into entries (newest last). Malformed lines skipped. */
	async readErrorEntries(): Promise<ErrorLogEntry[]> {
		const raw = await this.readErrorLog();
		if (!raw) return [];
		const out: ErrorLogEntry[] = [];
		for (const line of raw.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				out.push(JSON.parse(trimmed) as ErrorLogEntry);
			} catch {
				// Skip corrupted lines silently — the log file is best-effort.
			}
		}
		return out;
	}

	/** Delete the error log file. */
	async clearErrorLog(): Promise<void> {
		await this.removeFile(this.getErrorLogPath());
	}

	/** Delete the wire-frame log file. */
	async clearWireLog(): Promise<void> {
		await this.removeFile(this.getWireLogPath());
	}

	// ────────────────────────────────────────────────────────────────────
	// Internals
	// ────────────────────────────────────────────────────────────────────

	private appendLine(
		path: string,
		line: string,
		maxBytes: number,
	): Promise<void> {
		const next = this.writeChain
			.then(() => this.appendLineInternal(path, line, maxBytes))
			.catch((err) => {
				console.warn("[ErrorLog] Append failed:", err);
			});
		this.writeChain = next;
		return next;
	}

	private async appendLineInternal(
		path: string,
		line: string,
		maxBytes: number,
	): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		const dir = this.getLogDir();

		try {
			if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}

			let existing = "";
			if (await adapter.exists(path)) {
				existing = await adapter.read(path);
			}

			const candidate = existing + line + "\n";
			const finalText =
				candidate.length > maxBytes
					? rotate(candidate, maxBytes)
					: candidate;

			await adapter.write(path, finalText);
		} catch (err) {
			// Swallow — logging must never break the caller.
			console.warn("[ErrorLog] Write failed for", path, err);
		}
	}

	private async readFile(path: string): Promise<string> {
		const adapter = this.plugin.app.vault.adapter;
		try {
			if (!(await adapter.exists(path))) return "";
			return await adapter.read(path);
		} catch (err) {
			console.warn("[ErrorLog] Read failed for", path, err);
			return "";
		}
	}

	private async removeFile(path: string): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		try {
			if (await adapter.exists(path)) {
				await adapter.remove(path);
			}
		} catch (err) {
			console.warn("[ErrorLog] Remove failed for", path, err);
		}
	}
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function truncate(value: string | undefined): string | undefined {
	if (!value) return value;
	if (value.length <= MAX_FIELD_LENGTH) return value;
	return value.slice(0, MAX_FIELD_LENGTH) + "…[truncated]";
}

/**
 * Drop the oldest ~half of the file so the next write stays under the cap.
 * Splits on line boundaries to keep NDJSON valid.
 */
function rotate(text: string, maxBytes: number): string {
	const target = Math.floor(maxBytes / 2);
	const cutFrom = text.length - target;
	if (cutFrom <= 0) return text;
	const newlineIdx = text.indexOf("\n", cutFrom);
	const kept = newlineIdx >= 0 ? text.slice(newlineIdx + 1) : text;
	const header =
		`{"timestamp":"${new Date().toISOString()}","source":"other","message":"[log rotated — older entries dropped]"}\n`;
	return header + kept;
}

/**
 * JSON.stringify that survives circular refs and over-long payloads.
 */
function safeStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	try {
		return JSON.stringify(value, (_key, val: unknown) => {
			if (typeof val === "object" && val !== null) {
				if (seen.has(val)) return "[circular]";
				seen.add(val);
			}
			if (typeof val === "string" && val.length > MAX_FIELD_LENGTH) {
				return val.slice(0, MAX_FIELD_LENGTH) + "…[truncated]";
			}
			return val;
		});
	} catch {
		return JSON.stringify({ error: "[unserializable frame]" });
	}
}

/**
 * Log a single NDJSON wire line. Tries to parse the line as JSON so the
 * record contains a structured frame; falls back to recording the raw
 * line if parsing fails.
 */
export async function logWireLine(
	errorLog: ErrorLog,
	direction: WireDirection,
	line: string,
	agentId?: string,
): Promise<void> {
	let frame: unknown;
	try {
		frame = JSON.parse(line);
	} catch {
		frame = { raw: line };
	}
	await errorLog.logWireFrame(direction, frame, agentId);
}

/**
 * Convert an arbitrary thrown value into the shape the error log expects.
 * Centralises the "is this an Error / is this a JSON-RPC error object / is
 * this a string" decoding that otherwise gets sprinkled at every callsite.
 */
export function describeError(error: unknown): {
	message: string;
	code?: string | number;
	errorKind?: string;
	data?: unknown;
	stack?: string;
} {
	if (!error) {
		return { message: "Unknown error (falsy)" };
	}
	if (typeof error === "string") {
		return { message: error };
	}
	if (error instanceof Error) {
		const obj = error as Error & {
			code?: string | number;
			data?: unknown;
		};
		const result: ReturnType<typeof describeError> = {
			message: error.message,
			stack: error.stack,
		};
		if (obj.code !== undefined) result.code = obj.code;
		if (obj.data !== undefined) {
			result.data = obj.data;
			const data = obj.data as { errorKind?: unknown };
			if (typeof data?.errorKind === "string") {
				result.errorKind = data.errorKind;
			}
		}
		return result;
	}
	if (typeof error === "object") {
		const obj = error as Record<string, unknown>;
		const result: ReturnType<typeof describeError> = {
			message:
				typeof obj.message === "string"
					? obj.message
					: JSON.stringify(error),
		};
		if (typeof obj.code === "string" || typeof obj.code === "number") {
			result.code = obj.code;
		}
		if ("data" in obj) {
			result.data = obj.data;
			const data = obj.data as { errorKind?: unknown } | null;
			if (data && typeof data.errorKind === "string") {
				result.errorKind = data.errorKind;
			}
		}
		if (typeof obj.stack === "string") {
			result.stack = obj.stack;
		}
		return result;
	}
	// Remaining primitives only (number, boolean, bigint, symbol, function).
	if (typeof error === "symbol") return { message: error.toString() };
	if (typeof error === "function") return { message: "[function]" };
	return { message: `${error as number | boolean | bigint}` };
}
