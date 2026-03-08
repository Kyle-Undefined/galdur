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

## Release versioning

Use `bumpp` plus a small TypeScript post-step to keep plugin release metadata in sync:

```bash
npm run version:bump -- patch
npm run version:bump -- minor
npm run version:bump -- 0.6.0
```

This updates:

- `package.json`
- `manifest.json`
- `versions.json`
- `package-lock.json`

`bumpp` handles `package.json`, `manifest.json`, and `package-lock.json`. A small TypeScript post-step then syncs the matching `versions.json` entry from the bumped plugin version and `manifest.json`'s `minAppVersion`.

## Runtime architecture

Galdur uses a managed local runtime process for PTY-backed terminal sessions.

In simple terms: the runtime is a small helper app that exists only to provide real terminal support. It is not an AI model, and it does not bundle Claude, Codex, or OpenCode.

- The Obsidian plugin handles UI, settings, install and update flows, and runtime lifecycle.
- PTY execution is delegated to a separate Windows runtime binary installed under the vault plugin folder at `bin/`.
- The plugin starts the runtime with a named pipe path and protocol version arguments, then sends an auth token through an environment variable.
- The plugin and runtime communicate over a newline-delimited JSON IPC protocol for commands such as `ping`, `spawn`, `write`, `resize`, and `kill`.
- The runtime owns `node-pty` and emits async session events back to the plugin over the same pipe.

This split exists because Obsidian plugins run inside an Electron renderer process, while `node-pty` requires a real Node.js environment with native addon support.

## Context guard architecture

Galdur includes a global tag-based context guard for Markdown notes.

In simple terms: the plugin reads Obsidian metadata for configured note tags, computes the set of matching vault-relative note paths at launch time, writes plugin-owned guard artifacts under `vault/.obsidian/plugins/galdur/context-guard/`, and appends any tool-specific guard arguments after the normal tool args.

Current behavior:

- The setting lives in `GaldurSettings.excludedNoteTags`
- Tags are normalized by trimming whitespace, stripping leading `#`, and lowercasing
- Only Markdown notes are evaluated
- Tag extraction uses Obsidian `metadataCache`
- If a note has no metadata cache entry yet, it is treated as included for that launch

Generated artifacts:

- `excluded-notes.json`: Debugging and inspection artifact with normalized tags plus matched note paths
- `claude-settings.json`: Temporary Claude settings payload with `permissions.deny` rules for `Read(...)` and `Edit(...)`
- `gemini-policy.toml`: Temporary Gemini policy rules for file-tool denies

Per-tool support:

- Claude: tool-enforced. Galdur appends `--settings <path>` and writes deny rules for each matched note path. This does not fully block shell-based access.
- Gemini: partial. Galdur appends `--policy <path>` and writes deny rules for supported file tools. This does not fully block shell-based access.
- Codex: advisory. No documented native path-deny surface is wired today, so Galdur surfaces the match count and warning in the startup banner only.
- OpenCode: advisory for the same reason.

Mitigation guidance:

- If a user depends on the context guard for sensitive content, they should verify which tool they are launching before starting a session.
- Claude is the only currently supported tool with enforced deny rules for tagged notes.
- Gemini should be treated as a partial guard only, because shell-capable workflows can still reach tagged files outside the blocked file-tool surface.
- Codex and OpenCode should be treated as visibility warnings, not privacy boundaries.

Launch plumbing:

- `TerminalView` resolves the guard state before orchestration
- `toolSessionOrchestrator` appends `contextGuard.toolArgs` after `tool.buildArgs(...)`
- Guard args intentionally win over per-tool extra args
- `terminalMessages.writeStartupBanner()` prints support level, excluded tag count, excluded note count, and a one-line support message
- `ContextGuardStalenessMonitor` watches vault and metadata events during a live session, recomputes the excluded note set with a short debounce, and marks the session stale if that set changes
- `terminalMessages.writeContextGuardStaleWarning()` prints a restart-required warning, and `TerminalView` decorates the live status text with `restart required`

This feature does not mutate vault-root project files such as `.geminiignore`, `.claude/`, or similar. All generated files stay inside the plugin folder. It also does not attempt filtered mirror workspaces in this iteration, because that approach complicates writes, new-file propagation, and shell behavior.

**Important:** The context guard is launch-time policy generation, not a replacement for a true sandbox.

Known limitation:

- The guard is metadata-driven. Newly created notes, retagged notes, or stale metadata may not be reflected until Obsidian updates `metadataCache`.
- Galdur can detect that the excluded note set changed after session start, but it cannot hot-reload Claude or Gemini policy into an already running CLI process.
- The reliable enforcement boundary is still session start. If guard-relevant tags change, restart the Galdur session.

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
- Gemini CLI
- OpenCode CLI
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
- `styles.css`
- `galdur-<version>.zip`

Release tag contract:

- Git tags must match `manifest.json` exactly, such as `1.0.1`
- The managed runtime installer downloads from the matching GitHub release tag
- BRAT-compatible release assets are `main.js`, `manifest.json`, `styles.css`, and `versions.json`

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
- The context guard is launch-time policy generation, not a replacement for a true sandbox.
