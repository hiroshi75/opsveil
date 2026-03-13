// ============================================================
// AgentController — tmux session management
// ============================================================

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { TmuxSession } from "@opsveil/shared";

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Retry configuration (configurable via env vars)
// ---------------------------------------------------------------------------

const DEFAULT_INJECTION_RETRIES = 3;
const DEFAULT_INJECTION_TIMEOUT_MS = 10_000;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 8_000;

/** Errors that indicate the session is permanently gone (no point retrying) */
const NON_RETRYABLE_PATTERNS = ["not found", "no such session", "can't find session"];

export function getInjectionRetryConfig() {
  const maxRetries = parseInt(process.env.OPSVEIL_INJECTION_RETRIES ?? "", 10);
  const timeoutMs = parseInt(process.env.OPSVEIL_INJECTION_TIMEOUT_MS ?? "", 10);
  return {
    maxRetries: Number.isFinite(maxRetries) ? maxRetries : DEFAULT_INJECTION_RETRIES,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_INJECTION_TIMEOUT_MS,
  };
}

function isRetryableInjectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return !NON_RETRYABLE_PATTERNS.some((p) => msg.toLowerCase().includes(p));
}

function injectionBackoffDelay(attempt: number): number {
  const jitter = Math.random() * 0.3 + 0.85; // 0.85–1.15
  return Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt) * jitter, MAX_RETRY_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
   * Send keystrokes to a tmux session (single attempt, no retry).
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
   * Send keystrokes with retry + exponential backoff.
   * Used for decision injection where transient failures should be recovered.
   */
  async sendKeysWithRetry(sessionName: string, text: string): Promise<{ attempts: number }> {
    const { maxRetries } = getInjectionRetryConfig();
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = injectionBackoffDelay(attempt - 1);
          console.info(
            `[AgentController] sendKeys retry ${attempt}/${maxRetries} for session="${sessionName}" after ${Math.round(delay)}ms`,
          );
          await sleep(delay);
        }

        await this.sendKeys(sessionName, text);

        if (attempt > 0) {
          console.info(
            `[AgentController] sendKeys succeeded on retry ${attempt} for session="${sessionName}"`,
          );
        }
        return { attempts: attempt + 1 };
      } catch (err) {
        lastError = err;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[AgentController] sendKeys attempt ${attempt + 1}/${maxRetries + 1} failed for session="${sessionName}": ${errMsg}`,
        );

        if (!isRetryableInjectionError(err)) {
          console.warn(
            `[AgentController] Non-retryable error for session="${sessionName}", skipping remaining retries`,
          );
          break;
        }
      }
    }

    const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      `Decision injection failed after ${maxRetries + 1} attempts for session="${sessionName}": ${errMsg}`,
    );
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
