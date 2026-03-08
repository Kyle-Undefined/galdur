# Galdur

Galdur is an Obsidian plugin for running AI CLI tools in a sidebar terminal panel.

> Windows only. Desktop only. Beta distribution. After installing the plugin, you also need to install the managed runtime from Galdur settings.

## Why Galdur

Galdur is for people who want CLI flexibility inside Obsidian instead of a fully custom chat UI.

It embeds terminal-backed AI workflows in a sidebar panel, so you can stay in your vault while still using the CLI behavior, flags, and permission modes you already know.

## Requirements

- Obsidian Desktop
- Windows x64 or arm64
- Claude Code CLI and/or Codex CLI installed locally
- A one-time runtime install from `Settings -> Galdur`

## What the runtime is

The runtime is a small local helper app that Galdur downloads and runs on your machine.

In plain terms, it is the part that gives Galdur access to a real terminal. Obsidian plugins cannot host `node-pty` directly inside the main plugin process, so Galdur uses a separate packaged runtime for that job.

The runtime does not contain Claude, Codex, or any model. It contains Galdur's terminal bridge code plus the `node-pty` dependency needed to start and manage terminal sessions. Galdur talks to that helper app locally, and the helper app launches the CLI tool you selected.

## Install the beta with BRAT

[BRAT](https://github.com/TfTHacker/obsidian42-brat) is the primary installation path for the Galdur beta.

1. Install BRAT from Obsidian Community plugins.
2. Open `Settings -> Community plugins -> BRAT`.
3. Choose `Add Beta plugin`.
4. Enter the repository path `Kyle-Undefined/galdur`.
5. Let BRAT install the plugin, then enable `Galdur`.
6. Open `Settings -> Galdur`.
7. In the `Runtime` section, select `Install runtime`.

## Install from GitHub release

Use this if you do not want to install through BRAT.

1. Download the latest `galdur-<version>.zip` from [GitHub Releases](https://github.com/Kyle-Undefined/galdur/releases/latest).
2. Extract the archive into your vault's plugin folder so the final path is `YOUR_VAULT/.obsidian/plugins/galdur/`.
3. Enable `Galdur` in `Settings -> Community plugins`.
4. Open `Settings -> Galdur`.
5. In the `Runtime` section, select `Install runtime`.

## Quick start

1. Open `Settings -> Galdur`.
2. Install the runtime if it is not already installed.
3. Configure the tool profiles you want to use.
4. Make sure the CLI you want to launch is available on `PATH`, or set its command/path override through your environment.
5. Open the Galdur panel from the ribbon icon or the command palette.

## Supported tools

Galdur currently supports:

- Claude
- Codex

Each tool has its own launch profile. Configure permission mode, extra args, and debug logging behavior in plugin settings, then switch tools from the panel when you want to start a different CLI.

## What the plugin does

- Opens a sidebar terminal view inside Obsidian
- Starts CLI sessions with the vault as the working directory
- Lets you start or stop the active session from the panel toolbar
- Lets you switch between Claude and Codex from the panel while keeping per-tool settings in plugin settings
- Manages the local PTY runtime used for terminal sessions
- Writes tool debug logs for CLIs that support them
- Exposes commands for toggling the panel, starting a session, and stopping a session

## Runtime, privacy, and safety disclosures

- Galdur downloads runtime binaries from GitHub Releases for `Kyle-Undefined/galdur`.
- Galdur launches a local runtime executable for PTY support. That executable is a packaged helper app containing Galdur's runtime code and `node-pty`; it is not a bundled AI model or bundled Claude/Codex install.
- The selected CLI tool may read or write outside the vault depending on the CLI itself, the flags you pass, and the permission mode you choose.
- Galdur can access paths outside the vault when launching user-selected CLI tools.
- No client-side telemetry is included by default.

## Related plugins and inspiration

[Claudian](https://github.com/YishenTu/claudian) is a cleaner, more integrated Claude-in-Obsidian experience.

Galdur exists for a different use case: a terminal-first workflow that keeps the flexibility of external AI CLIs and supports more than one tool. Claudian helped clarify that direction, and it is worth a look if you want a more native chat-style plugin.

## Troubleshooting

### Runtime is not installed

If the panel says runtime setup is required, open `Settings -> Galdur` and select `Install runtime`, then start the session.

### CLI not found

If Galdur cannot find the AI tool, install the CLI normally and restart Obsidian. On Windows, Galdur checks common install locations and `PATH`. You can also use the relevant environment override:

- `GALDUR_CLAUDE_CMD`
- `GALDUR_CODEX_CMD`

### Windows-only support

The managed runtime currently supports Windows only. macOS and Linux are not supported in this release.

## Development

Development notes, runtime architecture, build commands, and local runtime workflow are documented in [docs/development.md](docs/development.md).

## License

Licensed under the [MIT License](LICENSE).
