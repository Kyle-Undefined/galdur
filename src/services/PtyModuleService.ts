import { join } from "path";
import { PLUGIN_ID } from "../constants";
import { PtyModule, PtyModuleResolution } from "../types";

export class PtyModuleService {
  private ptyModule: PtyModule | null = null;

  public resolve(vaultPath: string): PtyModuleResolution {
    if (this.ptyModule) {
      return { module: this.ptyModule, attempts: [], errors: [] };
    }

    const pluginDir = join(vaultPath, ".obsidian", "plugins", PLUGIN_ID);
    const attempts = [
      "node-pty",
      join(pluginDir, "node_modules", "node-pty"),
      join(pluginDir, "node_modules", "node-pty", "lib", "index.js")
    ];
    const errors: string[] = [];

    for (const attempt of attempts) {
      try {
        this.ptyModule = require(attempt) as PtyModule;
        return { module: this.ptyModule, attempts, errors };
      } catch (error) {
        errors.push(`${attempt}: ${String(error)}`);
      }
    }

    return { module: null, attempts, errors };
  }
}
