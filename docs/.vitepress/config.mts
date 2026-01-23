import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Agent Client",
  description:
    "Obsidian plugin for AI agent integration - Chat with Claude Code, Codex, Gemini CLI and more",

  // GitHub Pages base path
  base: "/aitoolsforobsidian/",

  head: [
    ["link", { rel: "icon", type: "image/x-icon", href: "/aitoolsforobsidian/favicon.ico" }],
    ["link", { rel: "icon", type: "image/png", sizes: "32x32", href: "/aitoolsforobsidian/favicon-32x32.png" }],
    ["link", { rel: "icon", type: "image/png", sizes: "16x16", href: "/aitoolsforobsidian/favicon-16x16.png" }],
    ["link", { rel: "apple-touch-icon", sizes: "180x180", href: "/aitoolsforobsidian/apple-touch-icon.png" }],
    ["meta", { name: "og:type", content: "website" }],
    ["meta", { name: "og:title", content: "AI Tools for Obsidian" }],
    [
      "meta",
      {
        name: "og:description",
        content: "Chat with AI agents directly in Obsidian",
      },
    ],
    [
      "meta",
      {
        name: "og:url",
        content: "https://ultimateai-org.github.io/aitoolsforobsidian/",
      },
    ],
  ],

  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Getting Started", link: "/getting-started/" },
      { text: "Agent Setup", link: "/agent-setup/" },
      { text: "Usage", link: "/usage/" },
      { text: "GitHub", link: "https://github.com/UltimateAI-org/aitoolsforobsidian" },
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [{ text: "What is Agent Client?", link: "/" }],
      },
      {
        text: "Getting Started",
        items: [
          { text: "Installation", link: "/getting-started/" },
          { text: "Quick Start", link: "/getting-started/quick-start" },
        ],
      },
      {
        text: "Agent Setup",
        items: [
          { text: "Overview", link: "/agent-setup/" },
          { text: "Claude Code", link: "/agent-setup/claude-code" },
          { text: "Codex", link: "/agent-setup/codex" },
          { text: "Gemini CLI", link: "/agent-setup/gemini-cli" },
          { text: "Custom Agents", link: "/agent-setup/custom-agents" },
        ],
      },
      {
        text: "Usage",
        items: [
          { text: "Basic Usage", link: "/usage/" },
          { text: "Note Mentions", link: "/usage/mentions" },
          { text: "Sending Images", link: "/usage/sending-images" },
          { text: "Slash Commands", link: "/usage/slash-commands" },
          { text: "Mode Selection", link: "/usage/mode-selection" },
          { text: "Model Selection", link: "/usage/model-selection" },
          { text: "Session History", link: "/usage/session-history" },
          { text: "Editing", link: "/usage/editing" },
          { text: "Chat Export", link: "/usage/chat-export" },
          { text: "Context Files", link: "/usage/context-files" },
          { text: "MCP Tools", link: "/usage/mcp-tools" },
        ],
      },
      {
        text: "Help",
        items: [
          { text: "FAQ", link: "/help/faq" },
          { text: "Troubleshooting", link: "/help/troubleshooting" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "ACP Protocol Support", link: "/reference/acp-support" },
        ],
      },
    ],

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/UltimateAI-org/aitoolsforobsidian",
      },
    ],

    footer: {
      message: "Released under the Apache 2.0 License.",
      copyright: "Copyright © 2025-present UltimateAI-org",
    },

    search: {
      provider: "local",
    },
  },
});
