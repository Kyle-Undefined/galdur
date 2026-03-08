# Development

## Local plugin development

1. Install dependencies:
    ```bash
    npm install
    ```
2. Type-check:
    ```bash
    npm run check
    ```
3. Build the plugin:
    ```bash
    npm run build
    ```
4. Run tests:
    ```bash
    npm test
    ```
5. Watch for plugin changes:
    ```bash
    npm run dev
    ```

## Runtime architecture

Galdur uses a managed local runtime process for PTY-backed terminal sessions.

In simple terms: the runtime is a small helper app that exists only to provide real terminal support. It is not an AI model, and it does not bundle Claude or Codex.

- The Obsidian plugin handles UI, settings, install and update flows, and runtime lifecycle.
- PTY execution is delegated to a separate Windows runtime binary installed under the vault plugin folder at `bin/`.
- The plugin starts the runtime with a named pipe path and protocol version arguments, then sends an auth token through an environment variable.
- The plugin and runtime communicate over a newline-delimited JSON IPC protocol for commands such as `ping`, `spawn`, `write`, `resize`, and `kill`.
- The runtime owns `node-pty` and emits async session events back to the plugin over the same pipe.

This split exists because Obsidian plugins run inside an Electron renderer process, while `node-pty` requires a real Node.js environment with native addon support.

## Runtime build and packaging

The runtime build has two stages:

1. Bundle `runtime/src/` into `runtime/galdur-runtime.js` with esbuild.
2. Package that bundle into Windows executables with `@yao-pkg/pkg`.

What ends up inside the runtime bundle:

- A packaged Node.js executable
- Galdur's runtime server code
- The staged `node-pty` dependency and its native support files

What does not end up inside the runtime bundle:

- Claude Code CLI
- Codex CLI
- Any model weights or remote AI service

Build commands:

```bash
npm run runtime:build:js
npm run runtime:build:exe
```

Architecture-specific builds:

```bash
npm run runtime:build:exe:x64
npm run runtime:build:exe:arm64
```

Release artifacts expected by the plugin:

- `galdur-runtime-windows-x64.zip`
- `galdur-runtime-windows-arm64.zip`
- `galdur-runtime-checksums.txt`

Plugin release artifacts:

- `main.js`
- `manifest.json`
- `versions.json`
- `styles.css` when present
- `galdur-<version>.zip`

## Local runtime dev install flow

If you want to test a locally built runtime inside a vault:

1. Build the runtime zip artifacts in this repo:
    ```bash
    npm run runtime:build:exe
    ```
2. Copy the full `runtime/dist/` folder into:
   `YOUR_VAULT/.obsidian/plugins/galdur/runtime/dist/`
3. Open `Settings -> Galdur`.
4. Use `Install local runtime (dev)`.

That copies the local runtime bundle into the managed install location and sets the runtime path override to the local build.

## Notes

- The plugin bundle and the runtime are separate artifacts.
- The runtime still uses `node-pty`, but it runs outside the main plugin process.
- Runtime installation and updates are handled from inside the plugin settings UI.
- On Windows, Galdur currently forces `node-pty` to `winpty` mode with `useConpty: false` for compatibility with Obsidian's runtime environment.
