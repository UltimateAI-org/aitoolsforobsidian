# Model Selection

Switch between different AI models to optimize for speed, capability, or cost.

## What are Models?

Models are different versions of the AI with varying capabilities:

- **Larger models**: More capable, better reasoning, slower, higher cost
- **Smaller models**: Faster responses, lower cost, good for simpler tasks

## Changing Models

1. Open the chat panel
2. Look for the **model dropdown** below the input field
3. Select the desired model from the available options

<p align="center">
  <img src="/images/model-selection.webp" alt="Model selection dropdown" width="400" />
</p>

::: tip
Available models depend on the active agent and your subscription/API plan.
:::

## Default Model

The selected model applies to the current chat. Each new chat starts on the default model, set in **Settings → AI Tools → Claude Agent → Default model**:

| Setting | Use it for |
|---|---|
| **Sonnet** (default) | Most note work. Much faster than Opus and costs less |
| Haiku | Quick, simple requests |
| Opus | Harder tasks where quality matters more than speed |
| Sonnet / Opus, 1M context | Very long sessions only. Not faster |
| Use my Claude Code setting | Keep the `model` from your own Claude Code settings |

::: tip
If a chat feels slow, check the model chip first. Opus can take several times longer than Sonnet on the same skill.
:::

## Cost Considerations

When using API keys, different models have different pricing. Check your provider's pricing page for current rates.
