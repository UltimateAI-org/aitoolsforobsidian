# Dev Log: Plugin Crash Loop Investigation

## Issue Description
Content: "Can you help me identify why my Obsidian Plugin Crashes when I close and open Obsidian? It only happens when I close and open Obsidian the second time, not the first time. The plugin that created this tab has gone away is the error. Obsidian keeps disabling AI Tools on the second reload."

## Investigation

### Initial Analysis
- **Symptoms:** Crash on second reload, "Plugin has gone away" error. This usually indicates a race condition or a failure to unmount/cleanup properly, leading to Obsidian disabling the plugin.
- **Hypothesis:** The `ChatView` is trying to access `plugin.settingsStore` before it is initialized.

### Code Review Findings
- **`src/plugin.ts`**:
    - `onload()` calls `registerView` *before* `await this.loadSettings()`.
    - `this.settingsStore` is initialized *after* `await this.loadSettings()`.
    - When Obsidian restarts, if the view was open, it immediately attempts to reconstruct the view using the registered factory.
    - The factory creates `ChatView`, which renders `ChatComponent`.
- **`src/components/chat/ChatView.tsx`**:
    - `ChatComponent` calls `useAgentSession(..., plugin.settingsStore, ...)` unconditionally during render.
    - IF `plugin.settingsStore` is undefined at this point, it will crash.

### Root Cause
Race condition in `onload`.
1. `onload` starts.
2. `registerView` is called.
3. Obsidian sees a saved workspace leaf with `VIEW_TYPE_CHAT`.
4. Obsidian immediately calls the view factory `(leaf) => new ChatView(leaf, this)`.
5. `ChatView` is instantiated and `onOpen` is called, potentially mounting the React component.
6. `ChatComponent` executes and tries to access `plugin.settingsStore`.
7. **CRASH**: `plugin.settingsStore` is not yet assigned because `await this.loadSettings()` in `onload` hasn't finished (or maybe hasn't even started waiting yet).

## Fix Strategy
Initialize `this.settings` and `this.settingsStore` synchronously with default values *before* registering the view. This ensures that even if the view is created immediately, it has a valid (albeit default) settings store to work with. Once `loadSettings` completes, we update the store, and React will re-render with the correct settings.

## Changes
- Modify `src/plugin.ts`:
    - Move `this.settings = { ...DEFAULT_SETTINGS }` to top of `onload`.
    - Initialize `this.settingsStore` immediately after.
    - Keep `registerView` where it is (after synchronous init).
    - `await this.loadSettings()` updates `this.settings` and then syncs to `this.settingsStore`.

## Resolution
- Modified `src/plugin.ts` to initialize `settings` and `settingsStore` with defaults immediately in `onload`.
- This ensures that if Obsidian restores the `ChatView` immediately (before `loadSettings` completes), the view has a valid store to subscribe to.
- Once settings are loaded from disk, `this.settingsStore.set(this.settings)` updates the store, triggering a React re-render with the correct user settings.
- Added comprehensive safety checks in `ChatView.open` and `ChatView.onClose`.
- Wrapped process killing in `TerminalManager` with `try-catch` to prevent crashes during rapid reload.
- Users can now safely reload the plugin without crashes.

## Verification
- User Scenario: "It only happens when I close and open Obsidian the second time, not the first time".
- Fix Strategy: Removed the initialization race condition and secured process cleanup to allow clean restarts.

## Resolution
- Modified `src/plugin.ts` to initialize `settings` and `settingsStore` with defaults immediately in `onload`.
- This ensures that if Obsidian restores the `ChatView` immediately (before `loadSettings` completes), the view has a valid store to subscribe to.
- Once settings are loaded from disk, `this.settingsStore.set(this.settings)` updates the store, triggering a React re-render with the correct user settings.
- This eliminates the race condition where `ChatView` would access an undefined `settingsStore`.
