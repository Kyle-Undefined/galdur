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
3. Watch mode:
   ```bash
   npm run dev
   ```

## Runtime Packaging Notes

Galdur uses `node-pty` for interactive terminal behavior.

- `main.js`, `manifest.json`, and `styles.css` are still required plugin artifacts.
- `node-pty` is externalized from the bundle (native module), so the runtime dependency must also be available in the plugin directory.
- `npm install` applies a compatibility patch to `node-pty` for Windows Obsidian runtimes that cannot construct worker threads.
- On Windows, Galdur currently forces `node-pty` to `winpty` mode (`useConpty: false`) for better compatibility with Obsidian's runtime.
- Easiest option for local dev:
  - copy the whole repo `node_modules` folder into `YOUR_VAULT/.obsidian/plugins/galdur/`
  - or at minimum ensure `node_modules/node-pty` and its transitive dependencies are present there

If `node-pty` fails to install, install Windows C++ build tooling (Visual Studio Build Tools + Python), then rerun `npm install`.

## Current MVP Features

- Sidebar `ItemView` for terminal panel
- xterm.js terminal rendering
- PTY-backed CLI process via `node-pty` (interactive terminal mode)
- Tool-specific executable discovery via adapters (Claude included)
- Tool-adapter architecture (ready for additional CLI tools like Codex)
- Settings tab for active tool selection and tool launch options
- Stop and Restart controls in the panel toolbar
- Debug logging toggle (off by default)
- PTY input/output + resize wiring
- Ribbon icon to open panel
- Toggle command (bind any hotkey in `Settings -> Hotkeys`)
- Restart command and toolbar button
