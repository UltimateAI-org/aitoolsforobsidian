# Plugin Hang Issue - Debug Notes

## Problem Summary
The plugin hangs indefinitely when trying to send a chat message after onboarding is complete. No errors appear in console.

## What We Know

### Working State (Before)
- Node.js v25.4.0
- npm 11.9.0
- Plugin worked perfectly
- All agents installed and functional

### Current State (After Node.js Reinstall)
- Node.js v25.4.0 (same version!)
- npm 11.9.0 (same version!)
- Plugin hangs when sending first message
- NO console errors
- Agent executables are installed and found:
  - `claude-code-acp` at `C:\Users\pauld\AppData\Roaming\npm\`
  - `gemini` at `C:\Users\pauld\AppData\Roaming\npm\`
  - `codex-acp` at `C:\Users\pauld\AppData\Roaming\npm\`

### What Changed During Reinstall
Something environmental changed, but NOT the Node/npm versions. Possible culprits:
- npm global package configuration
- PATH setup (though executables are found)
- npm cache/state
- Environment variables
- User permissions on npm directories

## Where It Hangs

**File**: `src/adapters/acp/acp.adapter.ts`
**Line**: 466 (inside `initialize()` method)
**Call**: `await this.connection.initialize(...)`

The agent process spawns successfully, but never responds to the ACP initialize request.

## Manual Tests Performed

### Test 1: Agent Responds to JSON-RPC
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | claude-code-acp
```
**Result**: ✅ Agent responds with proper JSON-RPC error (method not found)
**Conclusion**: Agent executable works, receives stdin, sends stdout

### Test 2: Check Installed Versions
```bash
node --version  # v25.4.0
npm --version   # 11.9.0
npm config list # Shows normal configuration
```
**Result**: ✅ All correct

### Test 3: Agent Locations
```bash
where.exe claude-code-acp
where.exe gemini
where.exe codex-acp
```
**Result**: ✅ All found at expected locations

## Fix Applied Today

### Timeout Added to Prevent Infinite Hang
**File**: `src/adapters/acp/acp.adapter.ts` (line 466)
**Change**: Added 30-second timeout to `initialize()` call
**Purpose**: Instead of hanging forever, will now show error message with diagnostic details after 30 seconds

**Error message will include**:
- Process ID (proves agent spawned)
- Possible causes (API key, auth, network)
- Node/npm versions
- Helpful troubleshooting tips

## Tomorrow's Action Plan

### Step 1: Get the Timeout Error
1. Open Obsidian
2. Try to send a message
3. Wait 30 seconds for timeout error
4. **Copy the full error message** from console (Ctrl+Shift+I)
5. The error will tell us exactly why initialization is failing

### Step 2: Check API Key & Settings
Open Obsidian Settings → Agent Client and verify:
- API Key is filled in (should start with `sk-...`)
- Base URL: `https://chat.obisidianaitools.com`
- Node Path: `C:\Program Files\nodejs\node.exe` (or wherever it's installed)
- Selected Agent: Claude Code / Gemini / Codex

### Step 3: Enable Debug Logging
In Settings → Agent Client → Developer Settings:
- Turn ON "Debug Mode"
- This will show detailed logs in console

### Step 4: Compare with Working PC
If you have access to the working PC:
1. Check `npm config list` output
2. Check environment variables (especially PATH, NODE_OPTIONS, npm_*)
3. Compare global npm directory permissions
4. Check if there are any npm config files:
   - `%USERPROFILE%\.npmrc`
   - `C:\Program Files\nodejs\node_modules\npm\npmrc`

### Step 5: Nuclear Option (If Nothing Else Works)
If timeout error doesn't reveal the issue:
1. Completely uninstall Node.js
2. Delete:
   - `C:\Program Files\nodejs`
   - `%USERPROFILE%\AppData\Roaming\npm`
   - `%USERPROFILE%\AppData\Roaming\npm-cache`
3. Restart computer
4. Install Node.js v22 LTS (not v25)
5. Reinstall agents: `npm install -g @zed-industries/claude-code-acp`

## Files Modified Today

1. **src/adapters/acp/acp.adapter.ts**
   - Added 30-second timeout to prevent infinite hang
   - Added detailed error message with diagnostic info

2. **src/components/OnboardingModal.ts**
   - Changed Node.js download URLs from `/download/current` to `/download`
   - Now points users to LTS versions

3. **test-agent.js** (created)
   - Manual test script to verify agent responds to JSON-RPC

## Quick Commands Reference

```bash
# Check versions
node --version
npm --version

# Check npm configuration
npm config list

# Test agent manually
echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | claude-code-acp

# Find agent locations
where.exe claude-code-acp

# Rebuild plugin after code changes
npm run build

# View npm global packages
npm list -g --depth=0
```

## Next Steps Priority

1. **FIRST**: Run the plugin with timeout fix and get the error message
2. **THEN**: Based on error message, we'll know if it's:
   - API key/auth issue
   - Network/connectivity issue
   - Environment variable issue
   - Something else entirely

---

## SOLUTION FOUND ✅

**Date**: 2026-02-08

### Root Causes Identified:

1. **`spawn cmd.exe ENOENT` on VM**
   - **Problem**: Windows PATH broken on VM, couldn't find cmd.exe
   - **Fix**: Explicitly specify cmd.exe path in spawn options
   - **File**: `src/adapters/acp/acp.adapter.ts` line 340
   - **Change**: `shell: needsShell ? (process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe") : false`

2. **Authentication Failure with obisidianaitools.com**
   - **Problem**: API authentication only works with `ultimateai.org` domain
   - **Fix**: Keep base URL as `https://chat.ultimateai.org`
   - **File**: `src/plugin.ts` line 131
   - **Note**: Even though domains may point to same server, auth is domain-specific

### Verification:
- ✅ Agent spawns successfully
- ✅ No cmd.exe ENOENT errors
- ✅ Initialization completes
- ✅ Authentication succeeds
- ✅ Plugin works on both PC and VM

---

**Last Updated**: 2026-02-08
**Status**: RESOLVED - Plugin working on VM
