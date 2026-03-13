// ============================================================
// AgentController — tmux session management
// ============================================================

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { TmuxSession } from "@opsveil/shared";

const execFile = promisify(execFileCb);

export class AgentController {
  /**
   * List all tmux sessions with parsed metadata.
   */
  async listSessions(): Promise<TmuxSession[]> {
    try {
      const { stdout } = await execFile("tmux", [
        "list-sessions",
        "-F",
        "#{session_name}:#{session_activity}:#{session_attached}:#{session_windows}",
      ]);

      const lines = stdout.trim().split("\n").filter(Boolean);
      return lines.map((line) => {
        const parts = line.split(":");
        const name = parts[0] ?? "";
        const activity = parseInt(parts[1] ?? "0", 10);
        const attached = parts[2] === "1";
        const windows = parseInt(parts[3] ?? "1", 10);

        return {
          name,
          projectId: name, // convention: session name maps to project ID
          isAttached: attached,
          lastActivity: activity * 1000, // tmux returns unix seconds
          windowCount: windows,
        };
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // "no server running" is expected when no tmux sessions exist
      if (message.includes("no server running") || message.includes("no sessions")) {
        return [];
      }
      throw new Error(`Failed to list tmux sessions: ${message}`);
    }
  }

  /**
   * Launch a new Claude Code agent in a tmux session.
   */
  async launchAgent(
    projectPath: string,
    sessionName: string,
    prompt?: string
  ): Promise<{ sessionName: string; pid: number }> {
    // Validate session name (tmux doesn't allow dots or colons)
    const safeName = sessionName.replace(/[.:]/g, "-");

    let command = `cd ${this.shellEscape(projectPath)} && claude --dangerously-skip-permissions`;
    if (prompt) {
      command += ` --prompt ${this.shellEscape(prompt)}`;
    }

    try {
      await execFile("tmux", [
        "new-session",
        "-d",
        "-s",
        safeName,
        command,
      ]);

      // Get the PID of the tmux session's initial process
      let pid = 0;
      try {
        const { stdout } = await execFile("tmux", [
          "list-panes",
          "-t",
          safeName,
          "-F",
          "#{pane_pid}",
        ]);
        pid = parseInt(stdout.trim(), 10) || 0;
      } catch {
        // PID retrieval is best-effort
      }

      return { sessionName: safeName, pid };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("duplicate session")) {
        throw new Error(`tmux session "${safeName}" already exists`);
      }
      throw new Error(`Failed to launch agent: ${message}`);
    }
  }

  /**
   * Send keystrokes to a tmux session.
   */
  async sendKeys(sessionName: string, text: string): Promise<void> {
    try {
      // Escape special characters for tmux send-keys
      const escaped = text.replace(/"/g, '\\"');
      await execFile("tmux", ["send-keys", "-t", sessionName, escaped, "Enter"]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("can't find session") || message.includes("no such session")) {
        throw new Error(`tmux session "${sessionName}" not found`);
      }
      throw new Error(`Failed to send keys: ${message}`);
    }
  }

  /**
   * Capture the visible content of a tmux pane.
   */
  async capturePane(sessionName: string): Promise<string> {
    try {
      const { stdout } = await execFile("tmux", [
        "capture-pane",
        "-t",
        sessionName,
        "-p",
      ]);
      return stdout;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("can't find session") || message.includes("no such session")) {
        throw new Error(`tmux session "${sessionName}" not found`);
      }
      throw new Error(`Failed to capture pane: ${message}`);
    }
  }

  /**
   * Kill a tmux session.
   */
  async killSession(sessionName: string): Promise<void> {
    try {
      await execFile("tmux", ["kill-session", "-t", sessionName]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("can't find session") || message.includes("no such session")) {
        throw new Error(`tmux session "${sessionName}" not found`);
      }
      throw new Error(`Failed to kill session: ${message}`);
    }
  }

  /**
   * Stop all OpsVeil-managed tmux sessions with a timeout.
   * Sends SIGTERM first, then SIGKILL if sessions don't exit within the timeout.
   */
  async stopAll(timeoutMs = 5000): Promise<void> {
    let sessions: { name: string }[];
    try {
      sessions = await this.listSessions();
    } catch {
      return; // No tmux server running
    }

    if (sessions.length === 0) return;

    console.log(`[AgentController] Stopping ${sessions.length} tmux session(s)...`);

    // Kill all sessions in parallel
    const killPromises = sessions.map((s) =>
      this.killSession(s.name).catch(() => {})
    );
    await Promise.all(killPromises);

    // Wait for sessions to actually terminate
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const remaining = await this.listSessions();
        if (remaining.length === 0) break;
      } catch {
        break; // No tmux server = all sessions gone
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    console.log("[AgentController] All sessions stopped");
  }

  /**
   * Shell-escape a string for safe embedding in a shell command.
   */
  private shellEscape(str: string): string {
    return `'${str.replace(/'/g, "'\\''")}'`;
  }
}
