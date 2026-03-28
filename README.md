<h1 align="center">🤖 AI Tools for Obsidian</h1>

<p align="center">
  <img src="https://img.shields.io/github/downloads/UltimateAI-org/aitoolsforobsidian/total" alt="GitHub Downloads">
  <img src="https://img.shields.io/github/license/UltimateAI-org/aitoolsforobsidian" alt="License">
  <img src="https://img.shields.io/github/v/release/UltimateAI-org/aitoolsforobsidian" alt="GitHub release">
  <img src="https://img.shields.io/github/last-commit/UltimateAI-org/aitoolsforobsidian" alt="GitHub last commit">
</p>

<p align="center">
  <a href="https://www.buymeacoffee.com/rait09" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="180" height="50" ></a>
</p>

Bring your AI agents directly into Obsidian! This plugin lets you chat with Claude Agent, Gemini CLI, and other AI agents right from your vault. Your AI assistant is now just a side panel away.

Built on the [Agent Client Protocol (ACP)](https://github.com/agentclientprotocol/sdk).

https://github.com/user-attachments/assets/1c538349-b3fb-44dd-a163-7331cbca7824

## ✨ Features

- 🔗 **Direct Agent Integration**: Chat with AI coding agents in a dedicated side panel
- 🖼️ **Image Attachments**: Paste or drag-and-drop images into the chat
- 📝 **Note Mention Support**: Automatically include the active note, or use `@notename` to reference specific notes
- ⚡ **Slash Command Support**: Use `/` commands to browse and trigger agent actions
- 🔄 **Multi-Agent Support**: Switch between Claude Agent, Gemini CLI, and custom agents
- 🎛️ **Mode & Model Switching**: Change AI models (e.g., Sonnet, Haiku) and agent modes (e.g., Plan Mode) from the chat
- 💻 **Terminal Integration**: Let your agent execute terminal commands and see results in chat
- 🔐 **Permission Management**: Fine-grained control over agent actions

## 📦 Installation

### 🧪 Install via BRAT (Recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin from the Community Plugins browser.
2. In Obsidian settings, go to **Community Plugins → BRAT → Add Beta Plugin**.
3. Paste this repo URL:
   ```
   https://github.com/UltimateAI-org/aitoolsforobsidian
   ```
4. BRAT will download the latest release and keep it auto-updated.
5. Enable **AI Tools** from the plugin list.
6. The onboarding wizard will guide you through the rest of setup on first launch.

### 💻 Manual Installation

1. Download the latest release files from [GitHub Releases](https://github.com/UltimateAI-org/aitoolsforobsidian/releases):
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Place the files in: `VaultFolder/.obsidian/plugins/obsidianaitools/`
3. Enable the plugin in **Obsidian Settings → Community Plugins**

## ⚙️ Configuration

### Step 1: 📦 Install Node.js

Node.js and npm are required to install and run the agents.

**Windows:**
```cmd
winget install OpenJS.NodeJS.LTS
```

**macOS:**
```bash
brew install node
```

**Linux:**
```bash
# Arch
sudo pacman -S nodejs npm

# Debian / Ubuntu / Mint — use .deb from obsidian.md/download (not Snap/Flatpak)
sudo apt install nodejs npm

# Fedora
sudo dnf install nodejs npm
```

> **Linux note:** If you installed Obsidian via Snap or Flatpak, npm and Node.js are not accessible due to sandbox isolation. Reinstall Obsidian using the `.deb` (Debian/Ubuntu/Mint) or `.AppImage` (Fedora/other) from [obsidian.md/download](https://obsidian.md/download). The site may default to AppImage — scroll down to find the `.deb`.

### Step 2: 📦 Install Agent Dependencies

- **Claude Agent** (Recommended — full tool support):
  ```bash
  npm install -g @agentclientprotocol/claude-agent-acp
  ```

- **Gemini CLI** (Experimental — limited tool support):
  ```bash
  npm install -g @google/gemini-cli
  ```

### Step 3: 🔑 Get your API key

1. Go to [chat.obsidianaitools.com](https://chat.obsidianaitools.com)
2. Navigate to **Settings → Account**
3. Copy your API key

> Don't have an account? Visit [obsidianaitools.com](https://obsidianaitools.com) to get started.

### Step 4: 🛠️ Configure Plugin Settings

1. Open **Settings → AI Tools**
2. Enter your API key and Base URL (`https://chat.obsidianaitools.com`)
3. Configure agent paths — use the **Auto-detect** button to find installed agents automatically

**Manual path lookup if Auto-detect fails:**

macOS/Linux:
```bash
which node                  # e.g. /usr/local/bin/node
which claude-agent-acp      # e.g. /usr/local/bin/claude-agent-acp
which gemini                # e.g. /usr/local/bin/gemini
```

Windows:
```cmd
where.exe node              # e.g. C:\Program Files\nodejs\node.exe
where.exe claude-agent-acp  # e.g. C:\Users\Username\AppData\Roaming\npm\claude-agent-acp.cmd
where.exe gemini            # e.g. C:\Users\Username\AppData\Roaming\npm\gemini.cmd
```

### 📋 Example Configuration

**macOS/Linux:**
```
Settings:
├── Node.js path: /usr/local/bin/node

Agents:
├── Claude Agent
│   └── Path: /usr/local/bin/claude-agent-acp
└── Gemini CLI
    ├── Path: /usr/local/bin/gemini
    └── Args: --experimental-acp
```

**Windows (Native):**
```
Settings:
├── Node.js path: C:\Program Files\nodejs\node.exe

Agents:
├── Claude Agent
│   └── Path: C:\Users\Username\AppData\Roaming\npm\claude-agent-acp.cmd
└── Gemini CLI
    ├── Path: C:\Users\Username\AppData\Roaming\npm\gemini.cmd
    └── Args: --experimental-acp
```

### 🪟 WSL Mode (Recommended for Windows)

WSL Mode runs agents inside Windows Subsystem for Linux for better compatibility.

1. Install WSL: `wsl --install`
2. Enable **WSL Mode** in **Settings → AI Tools**
3. Use Linux-style paths (e.g., `/usr/local/bin/claude-agent-acp`)

## 🚀 Usage

- 🎯 Use the command palette: **"Open agent chat"**
- 🤖 Click the robot icon in the ribbon
- 💬 Chat with your configured agent in the side panel
- 📝 Reference notes using `@notename` syntax
- 🔄 Switch agents in plugin settings
- 🎛️ Change models and modes from the dropdowns below the input field

## 👨‍💻 Development

```bash
npm install
npm run dev
```

Production build:
```bash
npm run build
```

## 🗺️ Roadmap

- **Edit Tracking**: Automatically follow the agent's edits — open affected notes and move the cursor as they edit
- **Chat History Access**: Browse, search, and restore previous chat sessions
- **Multi-Instance Support**: Run multiple agents simultaneously in separate panels

Have ideas or feature requests? [Open an issue](https://github.com/UltimateAI-org/aitoolsforobsidian/issues) on GitHub!

## 📄 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## ⭐️ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=UltimateAI-org/aitoolsforobsidian&type=Date)](https://www.star-history.com/#UltimateAI-org/aitoolsforobsidian&Date)
