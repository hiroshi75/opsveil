// ============================================================
// HookManager — install/uninstall Claude Code hooks
// ============================================================

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

interface ClaudeHookEntry {
  matcher: string;
  hooks: Array<{ type: string; command: string }>;
}

interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookEntry[]>;
  [key: string]: unknown;
}

export class HookManager {
  private claudeDir: string;

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir ?? path.join(os.homedir(), ".claude");
  }

  /**
   * Build the curl command for a given hook event.
   *
   * Claude Code passes hook data as JSON on stdin.
   * We pipe it directly to our server endpoint.
   */
  private buildHookCommand(event: string, port: number): string {
    const base = `http://localhost:${port}/hooks`;

    const endpoints: Record<string, string> = {
      Stop: "stop",
      Notification: "notification",
      PostToolUse: "post-tool-use",
    };

    const ep = endpoints[event];
    if (!ep) throw new Error(`Unknown hook event: ${event}`);

    // Pipe stdin JSON directly to server via curl
    return `curl -sf -X POST ${base}/${ep} -H 'Content-Type: application/json' -d @-`;
  }

  /**
   * Install OpsVeil hooks into ~/.claude/settings.json.
   * Merges with existing hooks — does not overwrite other hooks.
   */
  async installHooks(port: number): Promise<void> {
    const settingsPath = path.join(this.claudeDir, "settings.json");
    let settings: ClaudeSettings = {};

    try {
      const raw = await fs.promises.readFile(settingsPath, "utf-8");
      settings = JSON.parse(raw);
    } catch {
      // File doesn't exist or is invalid — start fresh
    }

    if (!settings.hooks) {
      settings.hooks = {};
    }

    const hookEvents = ["Stop", "Notification", "PostToolUse"] as const;

    for (const event of hookEvents) {
      const command = this.buildHookCommand(event, port);

      const opsveilEntry: ClaudeHookEntry = {
        matcher: "",
        hooks: [
          {
            type: "command",
            command,
          },
        ],
      };

      if (!settings.hooks[event]) {
        settings.hooks[event] = [];
      }

      // Remove any existing OpsVeil hooks (identified by our URL pattern)
      settings.hooks[event] = settings.hooks[event].filter(
        (entry) =>
          !entry.hooks?.some((h) => h.command?.includes(`localhost:${port}/hooks/`))
      );

      // Add our hook
      settings.hooks[event].push(opsveilEntry);
    }

    // Write back
    await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.promises.writeFile(
      settingsPath,
      JSON.stringify(settings, null, 2) + "\n",
      "utf-8"
    );

    console.log(`[HookManager] Installed hooks → ${settingsPath} (port=${port})`);
  }

  /**
   * Remove OpsVeil hooks from ~/.claude/settings.json.
   */
  async uninstallHooks(port?: number): Promise<void> {
    const settingsPath = path.join(this.claudeDir, "settings.json");

    let settings: ClaudeSettings;
    try {
      const raw = await fs.promises.readFile(settingsPath, "utf-8");
      settings = JSON.parse(raw);
    } catch {
      // Nothing to uninstall
      return;
    }

    if (!settings.hooks) return;

    const hookEvents = ["Stop", "Notification", "PostToolUse"];
    const urlPattern = port ? `localhost:${port}/hooks/` : "/hooks/";

    for (const event of hookEvents) {
      if (!settings.hooks[event]) continue;
      settings.hooks[event] = settings.hooks[event].filter(
        (entry) =>
          !entry.hooks?.some((h) => h.command?.includes(urlPattern))
      );
      // Clean up empty arrays
      if (settings.hooks[event].length === 0) {
        delete settings.hooks[event];
      }
    }

    // Clean up empty hooks object
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    await fs.promises.writeFile(
      settingsPath,
      JSON.stringify(settings, null, 2) + "\n",
      "utf-8"
    );

    console.log(`[HookManager] Uninstalled hooks from ${settingsPath}`);
  }
}
