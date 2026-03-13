// ============================================================
// OpsVeil Server — Entry Point
// ============================================================

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";

import { SessionMonitor } from "./session-monitor.js";
import { AgentController } from "./agent-controller.js";
import { HookManager } from "./hook-manager.js";
import { WebSocketHandler } from "./websocket-handler.js";

// ---- Load .env from repo root ----
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// ---- Config ----
const PORT = parseInt(process.env.OPSVEIL_PORT ?? process.env.PORT ?? "7432", 10);
const SHUTDOWN_TIMEOUT_MS = 10_000;
const RUN_DIR = path.join(os.tmpdir(), "opsveil");

// ---- Initialize components ----
const sessionMonitor = new SessionMonitor();
const agentController = new AgentController();
const hookManager = new HookManager();

// ---- Express + HTTP ----
const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);

// ---- WebSocket Handler ----
const wsHandler = new WebSocketHandler(
  server,
  sessionMonitor,
  agentController,
  hookManager,
  PORT
);

// ---- Hook HTTP Endpoints ----

// Claude Code hook stdin format (actual):
// { session_id, transcript_path, cwd, hook_event_name, tool_name?, tool_input?, tool_response?, ... }
// "cwd" is the project path. There is no "project" field.
// "stop_reason" and "last_message" come from Stop hooks.

app.post("/hooks/stop", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const sessionId = (body.session_id as string) || "unknown";
    const cwd = (body.cwd as string) || "";
    const stopReason = (body.stop_reason as string) || (body.hook_event_name as string) || "stop";
    const lastMessage = (body.last_message as string) || "";

    const projectInfo = sessionMonitor.resolveProject(cwd);
    const projectId = projectInfo?.projectId ?? cwd;
    const projectName = projectInfo?.projectName ?? cwd;

    console.log(`[Hook:Stop] session=${sessionId} project=${projectName} reason=${stopReason}`);

    sessionMonitor.updateProjectPhase(projectId, "blocked");

    sessionMonitor.addActivity({
      id: nanoid(),
      timestamp: Date.now(),
      projectId,
      projectName,
      sessionId,
      action: `Agent stopped: ${stopReason}`,
      type: "blocked",
      detail: lastMessage.slice(0, 500) || undefined,
    });

    wsHandler.broadcast({
      jsonrpc: "2.0",
      method: "hook.stop",
      params: { sessionId, projectId, projectName, lastMessage, stopReason },
    });

    res.json({ status: "ok" });
  } catch (err) {
    console.error("[Hook:Stop] Error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

app.post("/hooks/notification", (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const sessionId = (body.session_id as string) || "unknown";
    const cwd = (body.cwd as string) || "";
    const title = (body.title as string) || (body.hook_event_name as string) || "Notification";
    const message = (body.message as string) || "";

    const projectInfo = sessionMonitor.resolveProject(cwd);
    const projectId = projectInfo?.projectId ?? cwd;
    const projectName = projectInfo?.projectName ?? cwd;

    console.log(`[Hook:Notification] session=${sessionId} project=${projectName} title=${title}`);

    sessionMonitor.addActivity({
      id: nanoid(),
      timestamp: Date.now(),
      projectId,
      projectName,
      sessionId,
      action: title,
      type: "running",
      detail: message || undefined,
    });

    res.json({ status: "ok" });
  } catch (err) {
    console.error("[Hook:Notification] Error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

app.post("/hooks/post-tool-use", (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const sessionId = (body.session_id as string) || "unknown";
    const cwd = (body.cwd as string) || "";
    const toolName = (body.tool_name as string) || "unknown";
    const toolResponse = body.tool_response as Record<string, unknown> | undefined;
    const toolOutput = toolResponse
      ? (toolResponse.stdout as string) || (toolResponse.stderr as string) || ""
      : "";

    const projectInfo = sessionMonitor.resolveProject(cwd);
    const projectId = projectInfo?.projectId ?? cwd;
    const projectName = projectInfo?.projectName ?? cwd;

    console.log(`[Hook:PostToolUse] session=${sessionId} project=${projectName} tool=${toolName}`);

    sessionMonitor.addActivity({
      id: nanoid(),
      timestamp: Date.now(),
      projectId,
      projectName,
      sessionId,
      action: `Tool: ${toolName}`,
      type: "tool_use",
      detail: toolOutput.slice(0, 500) || undefined,
    });

    res.json({ status: "ok" });
  } catch (err) {
    console.error("[Hook:PostToolUse] Error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ---- Health check ----
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ---- PID file management ----

function getPidFilePath(): string {
  return path.join(RUN_DIR, `opsveil-${PORT}.pid`);
}

function writePidFile(): void {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(getPidFilePath(), String(process.pid), "utf-8");
}

function removePidFile(): void {
  try {
    fs.unlinkSync(getPidFilePath());
  } catch {
    // Already removed or never created
  }
  // Remove run dir if empty
  try {
    const entries = fs.readdirSync(RUN_DIR);
    if (entries.length === 0) fs.rmdirSync(RUN_DIR);
  } catch {
    // Not empty or already gone
  }
}

/**
 * Check for stale PID files from a previous crashed process and clean up.
 */
function cleanupStalePidFile(): void {
  const pidFile = getPidFilePath();
  let oldPid: number;
  try {
    oldPid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
  } catch {
    return; // No PID file
  }

  // Check if the old process is still running
  let isRunning = false;
  try {
    process.kill(oldPid, 0); // Signal 0 = check existence without killing
    isRunning = true;
  } catch {
    isRunning = false;
  }

  if (isRunning) {
    console.warn(`[OpsVeil] Another instance (PID ${oldPid}) is still running on port ${PORT}`);
    console.warn(`[OpsVeil] If this is stale, remove ${pidFile} manually`);
    process.exit(1);
  }

  // Stale PID file — previous process crashed
  console.log(`[OpsVeil] Cleaning up stale PID file from previous process (PID ${oldPid})`);
  removePidFile();

  // Clean up leftover hooks from the crashed process
  hookManager.uninstallHooks(PORT).catch(() => {});
}

// ---- Graceful shutdown ----

let shutdownInProgress = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  console.log(`\n[OpsVeil] Received ${signal}, shutting down gracefully...`);

  // Force exit if shutdown takes too long
  const forceExitTimer = setTimeout(() => {
    console.error("[OpsVeil] Shutdown timed out, forcing exit");
    removePidFile();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  try {
    // 1. Stop accepting new connections
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    console.log("[OpsVeil] HTTP server closed");

    // 2. Close WebSocket connections
    await wsHandler.close();
    console.log("[OpsVeil] WebSocket connections closed");

    // 3. Stop session monitor (watchers + poll timer)
    await sessionMonitor.stop();
    console.log("[OpsVeil] Session monitor stopped");

    // 4. Stop managed tmux sessions
    await agentController.stopAll(5000);

    // 5. Uninstall hooks from Claude Code settings
    await hookManager.uninstallHooks(PORT);
    console.log("[OpsVeil] Hooks uninstalled");
  } catch (err) {
    console.error("[OpsVeil] Error during shutdown:", err);
  } finally {
    // 6. Remove PID file
    removePidFile();
    console.log("[OpsVeil] Shutdown complete");
    clearTimeout(forceExitTimer);
    process.exit(0);
  }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ---- Start ----
async function main(): Promise<void> {
  // Clean up artifacts from previous crashed process
  cleanupStalePidFile();

  await sessionMonitor.start();

  // Auto-install Claude Code hooks on startup
  try {
    await hookManager.installHooks(PORT);
  } catch (err) {
    console.warn("[OpsVeil] Failed to install hooks:", err);
  }

  server.listen(PORT, () => {
    // Write PID file after successful bind
    writePidFile();

    console.log(`[OpsVeil] Server listening on http://localhost:${PORT} (PID ${process.pid})`);
    console.log(`[OpsVeil] WebSocket available at ws://localhost:${PORT}`);
    console.log(`[OpsVeil] Hook endpoints:`);
    console.log(`  POST http://localhost:${PORT}/hooks/stop`);
    console.log(`  POST http://localhost:${PORT}/hooks/notification`);
    console.log(`  POST http://localhost:${PORT}/hooks/post-tool-use`);
  });
}

main().catch((err) => {
  console.error("[OpsVeil] Fatal error:", err);
  removePidFile();
  process.exit(1);
});
