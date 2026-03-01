import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { CommandResolution } from "../types";

export type ExecutableResolverOptions = {
  overrideEnvVar: string;
  pathCandidates: string[];
  commonPathCandidates: string[];
  fallbackCommand: string;
};

export function resolveExecutable(
  options: ExecutableResolverOptions
): CommandResolution {
  const attempts: string[] = [];

  const override = process.env[options.overrideEnvVar]?.trim();
  if (override) {
    const normalized = stripOuterQuotes(override);
    attempts.push(`${options.overrideEnvVar}=${normalized}`);
    if (!looksLikePath(normalized) || existsSync(normalized)) {
      return {
        command: normalized,
        source: `env:${options.overrideEnvVar}`,
        attempts,
        found: true
      };
    }
  }

  for (const candidate of options.pathCandidates) {
    attempts.push(`where.exe ${candidate}`);
    const result = findInPathWithWhere(candidate);
    if (result.length > 0) {
      return {
        command: result[0],
        source: "PATH",
        attempts,
        found: true
      };
    }
  }

  for (const candidate of options.commonPathCandidates) {
    attempts.push(candidate);
    if (existsSync(candidate)) {
      return {
        command: candidate,
        source: "common-path",
        attempts,
        found: true
      };
    }
  }

  return {
    command: options.fallbackCommand,
    source: "fallback",
    attempts,
    found: false
  };
}

function findInPathWithWhere(executable: string): string[] {
  try {
    const output = execFileSync("where.exe", [executable], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function stripOuterQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1);
  }
  return value;
}

function looksLikePath(value: string): boolean {
  return /[\\/]/.test(value) || /^[A-Za-z]:/.test(value);
}
