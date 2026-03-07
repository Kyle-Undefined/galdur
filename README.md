# Galdur

Galdur is an Obsidian plugin that opens AI CLI tool sessions inside a sidebar terminal view.

## Development

1. Install dependencies:
    ```bash
    npm install
    ```
2. Build once:
   ```bash
   npm run build
   ```
3. Run tests:
   ```bash
   npm test
   ```
4. Watch mode:
   ```bash
   npm run dev
   ```

## Runtime Architecture

Galdur now runs terminal work through a separate runtime executable instead of hosting `node-pty` directly in the main plugin process.

- The Obsidian plugin remains responsible for UI, settings, install/update flows, and runtime lifecycle.
- The managed runtime is a Windows executable placed under `.obsidian/plugins/galdur/bin/`.
- The plugin starts the runtime with a per-launch named pipe path plus protocol version args, and sends an auth token via environment variable.
- Plugin and runtime communicate over a local newline-delimited JSON IPC protocol for commands like `ping`, `spawn`, `write`, `resize`, and `kill`.
- The runtime owns the PTY/session work and emits async events back to the plugin over the same pipe.

## Runtime Packaging Notes

Galdur still uses `node-pty` for interactive terminal behavior, but it now lives inside the separate runtime process.

- `main.js`, `manifest.json`, and `styles.css` are still required plugin artifacts.
- The plugin bundle and the runtime are separate artifacts. The plugin talks to the runtime over IPC instead of calling `node-pty` directly.
- `npm install` applies a compatibility patch to `node-pty` for Windows Obsidian runtimes that cannot construct worker threads.
- On Windows, Galdur currently forces `node-pty` to `winpty` mode (`useConpty: false`) for better compatibility with Obsidian's runtime.
- Easiest option for local dev:
    - copy `runtime/dist` from this repo into `YOUR_VAULT/.obsidian/plugins/galdur/runtime/dist/`

If `node-pty` fails to install, install Windows C++ build tooling (Visual Studio Build Tools + Python), then rerun `npm install`.

## Current MVP Features

- Sidebar `ItemView` for terminal panel
- xterm.js terminal rendering
- PTY-backed CLI process via `node-pty` (interactive terminal mode)
- Tool-specific executable discovery via adapters (Claude and Codex included)
- Tool-adapter architecture for additional CLI tools
- Settings tab for active tool selection and tool launch options
- Stop and Restart controls in the panel toolbar
- Debug logging toggle (off by default)
- PTY input/output + resize wiring
- Ribbon icon to open panel
- Toggle command (bind any hotkey in `Settings -> Hotkeys`)
- Restart command and toolbar button
