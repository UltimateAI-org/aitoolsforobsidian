# Mode Selection

Some agents support different operational modes that change how the agent behaves.

## What are Modes?

Modes are predefined configurations that alter the agent's behavior for specific tasks. For example:

- **Default Mode**: General-purpose assistance
- **Plan Mode**: Focus on planning and architecture before implementation

## Changing Modes

1. Open the chat panel
2. Look for the **mode dropdown** below the input field
3. Select the desired mode from the available options

<p align="center">
  <img src="/images/mode-selection.webp" alt="Mode selection dropdown" width="400" />
</p>

::: tip
Available modes depend on the active agent. Not all agents support multiple modes.
:::

## Default Mode

The selected mode applies to the current chat. Each new chat starts in the default mode, set in **Settings → AI Tools → Claude Agent → Default permission mode**:

| Mode | What it does |
|---|---|
| **Accept edits** (default) | Note edits go through without asking; running commands still asks |
| Manual | Asks before every change |
| Auto | Claude's own safety check approves or blocks each action |
| Plan | Plans only, makes no changes |
| Bypass permissions | No checks at all |
| Use my Claude Code setting | Keep the `defaultMode` from your own Claude Code settings |

::: warning
Bypass permissions gives the agent full access to your system without confirmation prompts.
:::
