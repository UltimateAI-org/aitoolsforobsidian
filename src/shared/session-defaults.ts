/**
 * Session Defaults - apply the user's default model and permission mode to a
 * freshly created session.
 *
 * Without this, a new chat starts on whatever the agent picks, which for
 * claude-agent-acp is the user's Claude Code settings (often Opus, often
 * Manual) — slow for note work. Pure functions (non-React): they return
 * session state for the caller to store.
 *
 * The agent answers these requests only once Claude Code has started
 * behind it, which can take close to a minute through a slow gateway, so
 * callers show selectSessionDefaults() immediately and let
 * applySessionDefaults() finish in the background.
 */

import type { IAgentClient } from "../domain/ports/agent-client.port";
import type {
	SessionConfigOption,
	SessionModeState,
	SessionModelState,
} from "../domain/models/chat-session";

export interface SessionOptionState {
	modes?: SessionModeState;
	models?: SessionModelState;
	configOptions?: SessionConfigOption[];
}

export interface SessionDefaults {
	/** Model id to select (e.g. "sonnet"); empty = leave the agent's choice */
	model: string;
	/** Mode id to select (e.g. "acceptEdits"); empty = leave the agent's choice */
	mode: string;
}

/**
 * Select the default model, then the default mode, on a new session.
 *
 * Each default is applied only when the agent actually offers that value,
 * via the config option of that category if there is one (current
 * claude-agent-acp), otherwise via the legacy modes/models state. A value
 * the agent doesn't offer, or a failed request, is skipped: the session
 * still starts, just on the agent's own choice.
 *
 * @returns The session's option state after the defaults were applied
 */
export async function applySessionDefaults(
	agentClient: IAgentClient,
	sessionId: string,
	state: SessionOptionState,
	defaults: SessionDefaults,
	onError: (message: string, error: unknown) => void,
): Promise<SessionOptionState> {
	let { modes, models, configOptions } = state;

	// Model first: switching model can rebuild other options (effort)
	const modelId = defaults.model.trim();
	if (modelId) {
		try {
			const option = findOption(configOptions, "model", modelId);
			if (option) {
				if (option.currentValue !== modelId) {
					configOptions = await setOption(
						agentClient,
						sessionId,
						configOptions,
						option.id,
						modelId,
					);
				}
			} else if (
				models &&
				models.currentModelId !== modelId &&
				models.availableModels.some((m) => m.modelId === modelId)
			) {
				await agentClient.setSessionModel(sessionId, modelId);
				models = { ...models, currentModelId: modelId };
			}
		} catch (error) {
			onError(`Failed to apply default model "${modelId}"`, error);
		}
	}

	const modeId = defaults.mode.trim();
	if (modeId) {
		try {
			const option = findOption(configOptions, "mode", modeId);
			if (option) {
				if (option.currentValue !== modeId) {
					configOptions = await setOption(
						agentClient,
						sessionId,
						configOptions,
						option.id,
						modeId,
					);
				}
				// Keep the legacy mode state in step with the config option
				if (modes && modes.currentModeId !== modeId) {
					modes = { ...modes, currentModeId: modeId };
				}
			} else if (
				modes &&
				modes.currentModeId !== modeId &&
				modes.availableModes.some((m) => m.id === modeId)
			) {
				await agentClient.setSessionMode(sessionId, modeId);
				modes = { ...modes, currentModeId: modeId };
			}
		} catch (error) {
			onError(`Failed to apply default mode "${modeId}"`, error);
		}
	}

	return { modes, models, configOptions };
}

/**
 * The option state with the defaults already selected, for showing in the
 * UI while applySessionDefaults() is still waiting on the agent. Selects
 * exactly what applySessionDefaults() would request; sends nothing.
 */
export function selectSessionDefaults(
	state: SessionOptionState,
	defaults: SessionDefaults,
): SessionOptionState {
	let { modes, models, configOptions } = state;

	const modelId = defaults.model.trim();
	if (modelId) {
		const option = findOption(configOptions, "model", modelId);
		if (option) {
			configOptions = selectValue(configOptions, option.id, modelId);
		} else if (models?.availableModels.some((m) => m.modelId === modelId)) {
			models = { ...models, currentModelId: modelId };
		}
	}

	const modeId = defaults.mode.trim();
	if (modeId) {
		const option = findOption(configOptions, "mode", modeId);
		if (option) {
			configOptions = selectValue(configOptions, option.id, modeId);
		}
		if (
			modes &&
			(option || modes.availableModes.some((m) => m.id === modeId))
		) {
			modes = { ...modes, currentModeId: modeId };
		}
	}

	return { modes, models, configOptions };
}

/** The option list with one option's current value replaced */
function selectValue(
	configOptions: SessionConfigOption[] | undefined,
	configId: string,
	value: string,
): SessionConfigOption[] | undefined {
	return configOptions?.map((option) =>
		option.id === configId ? { ...option, currentValue: value } : option,
	);
}

/** Config option of the given category that offers the given value */
function findOption(
	configOptions: SessionConfigOption[] | undefined,
	category: string,
	value: string,
): SessionConfigOption | undefined {
	return configOptions?.find(
		(option) =>
			option.category === category &&
			option.options.some((o) => o.value === value),
	);
}

/**
 * Set a config option and return the resulting option list: the agent's
 * reconciled list when it sends one, otherwise the old list with the value
 * swapped in.
 */
async function setOption(
	agentClient: IAgentClient,
	sessionId: string,
	configOptions: SessionConfigOption[] | undefined,
	configId: string,
	value: string,
): Promise<SessionConfigOption[] | undefined> {
	const updated = await agentClient.setSessionConfigOption(
		sessionId,
		configId,
		value,
	);
	return updated ?? selectValue(configOptions, configId, value);
}
