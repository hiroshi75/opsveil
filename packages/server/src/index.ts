// ============================================================
// OpsVeil Server — Entry Point
// ============================================================

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import type {
  HookStopPayload,
  HookNotificationPayload,
  HookPostToolUsePayload,
} from "@opsveil/shared";

import { SessionMonitor } from "./session-monitor.js";
import { StateInterpreter } from "./state-interpreter.js";
import { AgentController } from "./agent-controller.js";
import { HookManager } from "./hook-manager.js";
import { WebSocketHandler } from "./websocket-handler.js";

// ---- Load .env from repo root ----
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// ---- Config ----
const PORT = parseInt(process.env.PORT ?? "7432", 10);

// ---- Initialize components ----
const sessionMonitor = new SessionMonitor();
const stateInterpreter = new StateInterpreter();
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
  stateInterpreter,
  PORT
);

// ---- Hook HTTP Endpoints ----

app.post("/hooks/stop", async (req, res) => {
  try {
    const payload = req.body as HookStopPayload;
    console.log(
      `[Hook:Stop] session=${payload.session_id} project=${payload.project} reason=${payload.stop_reason}`
    );

    const projectInfo = sessionMonitor.resolveProject(payload.project);
    const projectId = projectInfo?.projectId ?? payload.project;
    const projectName = projectInfo?.projectName ?? payload.project;

    // Update project phase
    sessionMonitor.updateProjectPhase(projectId, "blocked");

    // Log activity
    sessionMonitor.addActivity({
      id: nanoid(),
      timestamp: Date.now(),
      projectId,
      projectName,
      sessionId: payload.session_id,
      action: `Agent stopped: ${payload.stop_reason}`,
      type: "blocked",
      detail: payload.last_message?.slice(0, 500),
    });

    // Use LLM to interpret and create a decision item
    const decision = await stateInterpreter.interpretStop({
      projectId,
      projectName,
      sessionId: payload.session_id,
      lastMessage: payload.last_message ?? "",
      stopReason: payload.stop_reason ?? "unknown",
    });

    wsHandler.addDecision(decision);

    res.json({ status: "ok" });
  } catch (err) {
    console.error("[Hook:Stop] Error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

app.post("/hooks/notification", (req, res) => {
  try {
    const payload = req.body as HookNotificationPayload;
    console.log(
      `[Hook:Notification] session=${payload.session_id} title=${payload.title}`
    );

    const projectInfo = sessionMonitor.resolveProject(payload.project);
    const projectId = projectInfo?.projectId ?? payload.project;
    const projectName = projectInfo?.projectName ?? payload.project;

    sessionMonitor.addActivity({
      id: nanoid(),
      timestamp: Date.now(),
      projectId,
      projectName,
      sessionId: payload.session_id,
      action: payload.title,
      type: "running",
      detail: payload.message,
    });

    res.json({ status: "ok" });
  } catch (err) {
    console.error("[Hook:Notification] Error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

app.post("/hooks/post-tool-use", (req, res) => {
  try {
    const payload = req.body as HookPostToolUsePayload;
    console.log(
      `[Hook:PostToolUse] session=${payload.session_id} tool=${payload.tool_name}`
    );

    const projectInfo = sessionMonitor.resolveProject(payload.project);
    const projectId = projectInfo?.projectId ?? payload.project;
    const projectName = projectInfo?.projectName ?? payload.project;

    sessionMonitor.addActivity({
      id: nanoid(),
      timestamp: Date.now(),
      projectId,
      projectName,
      sessionId: payload.session_id,
      action: `Tool: ${payload.tool_name}`,
      type: "tool_use",
      detail: payload.tool_output?.slice(0, 500),
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

// ---- Start ----
async function main(): Promise<void> {
  await sessionMonitor.start();

  server.listen(PORT, () => {
    console.log(`[OpsVeil] Server listening on http://localhost:${PORT}`);
    console.log(`[OpsVeil] WebSocket available at ws://localhost:${PORT}`);
    console.log(`[OpsVeil] Hook endpoints:`);
    console.log(`  POST http://localhost:${PORT}/hooks/stop`);
    console.log(`  POST http://localhost:${PORT}/hooks/notification`);
    console.log(`  POST http://localhost:${PORT}/hooks/post-tool-use`);
  });
}

main().catch((err) => {
  console.error("[OpsVeil] Fatal error:", err);
  process.exit(1);
});
