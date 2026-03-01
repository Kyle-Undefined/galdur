import { join } from "path";
import { CliToolAdapter, CommandResolution, GaldurSettings } from "../types";
import { resolveExecutable } from "../services/executableResolver";

export class ClaudeToolAdapter implements CliToolAdapter {
  public readonly id = "claude";
  public readonly displayName = "Claude";

  public resolveCommand(): CommandResolution {
    return resolveExecutable({
      overrideEnvVar: "GALDUR_CLAUDE_CMD",
      pathCandidates: ["claude.cmd", "claude.exe", "claude"],
      commonPathCandidates: this.getCommonWindowsClaudePaths(),
      fallbackCommand: "claude"
    });
  }

  public getDebugLogPath(vaultPath: string): string {
    return join(vaultPath, ".obsidian", "plugins", "galdur", "claude-debug.log");
  }

  public buildArgs(settings: GaldurSettings, debugFilePath?: string): string[] {
    const profile = settings.toolProfiles[this.id] ?? {
      permissionMode: "default",
      extraArgs: "",
      debugLoggingEnabled: false
    };
    const args: string[] = [];
    if (profile.debugLoggingEnabled && debugFilePath) {
      args.push("--debug-file", debugFilePath);
    }
    const permissionMode = profile.permissionMode;
    if (permissionMode !== "default") {
      args.push("--permission-mode", permissionMode);
    }
    args.push(...parseExtraArgs(profile.extraArgs));
    return args;
  }

  public getMissingCliHelp(): string {
    return "Set GALDUR_CLAUDE_CMD or add Claude Code CLI to PATH, then restart Obsidian.";
  }

  private getCommonWindowsClaudePaths(): string[] {
    const appData = process.env.APPDATA;
    const userProfile = process.env.USERPROFILE;
    const localAppData = process.env.LOCALAPPDATA;
    const candidates: string[] = [];

    if (appData) {
      candidates.push(join(appData, "npm", "claude.cmd"));
      candidates.push(join(appData, "npm", "claude.exe"));
    }
    if (userProfile) {
      candidates.push(join(userProfile, "scoop", "shims", "claude.cmd"));
      candidates.push(join(userProfile, "scoop", "shims", "claude.exe"));
      candidates.push(join(userProfile, ".local", "bin", "claude.exe"));
      candidates.push(join(userProfile, ".local", "bin", "claude.cmd"));
    }
    if (localAppData) {
      candidates.push(join(localAppData, "Volta", "bin", "claude.cmd"));
      candidates.push(join(localAppData, "Volta", "bin", "claude.exe"));
    }

    return candidates;
  }
}

function parseExtraArgs(raw: string): string[] {
  const tokens: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    tokens.push(...tokenizeArgLine(line));
  }
  return tokens;
}

function tokenizeArgLine(line: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let escaping = false;

  for (const ch of line) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (escaping) {
    current += "\\";
  }
  if (current.length > 0) {
    args.push(current);
  }

  return args;
}
