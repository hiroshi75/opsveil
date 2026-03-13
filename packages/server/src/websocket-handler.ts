// ============================================================
// WebSocketHandler — JSON-RPC over WebSocket
// ============================================================

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import { nanoid } from "nanoid";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  ServerNotification,
  DecisionItem,
  ActivityEntry,
} from "@opsveil/shared";
import type { SessionMonitor } from "./session-monitor.js";
import type { AgentController } from "./agent-controller.js";
import type { HookManager } from "./hook-manager.js";

const SERVER_VERSION = "0.1.0";

export class WebSocketHandler {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private decisions: DecisionItem[] = [];
  private startedAt = Date.now();

  private sessionMonitor: SessionMonitor;
  private agentController: AgentController;
  private hookManager: HookManager;
  private port: number;

  constructor(
    server: HttpServer,
    sessionMonitor: SessionMonitor,
    agentController: AgentController,
    hookManager: HookManager,
    port: number
  ) {
    this.sessionMonitor = sessionMonitor;
    this.agentController = agentController;
    this.hookManager = hookManager;
    this.port = port;

    this.wss = new WebSocketServer({ server });

    this.wss.on("connection", (ws: WebSocket) => {
      this.clients.add(ws);
      console.log(
        `[WebSocket] Client connected (total: ${this.clients.size})`
      );

      ws.on("message", (data: Buffer | string) => {
        this.handleMessage(ws, data.toString()).catch((err) =>
          console.error("[WebSocket] Message handling error:", err)
        );
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log(
          `[WebSocket] Client disconnected (total: ${this.clients.size})`
        );
      });

      ws.on("error", (err) => {
        console.error("[WebSocket] Client error:", err);
        this.clients.delete(ws);
      });
    });

    // Wire SessionMonitor events
    this.sessionMonitor.on("project:updated", (project) => {
      this.broadcast({
        jsonrpc: "2.0",
        method: "project.updated",
        params: { project },
      });
    });

    this.sessionMonitor.on("activity:new", (entry: ActivityEntry) => {
      this.broadcast({
        jsonrpc: "2.0",
        method: "activity.new",
        params: { entry },
      });
    });

    // When agent transitions to waiting for input, broadcast as hook.stop
    this.sessionMonitor.on("waiting-for-input", (data: {
      sessionId: string;
      projectId: string;
      projectName: string;
      lastMessage: string;
      stopReason: string;
    }) => {
      console.log(`[WaitingForInput] project=${data.projectName} session=${data.sessionId}`);
      this.broadcast({
        jsonrpc: "2.0",
        method: "hook.stop",
        params: data,
      });
    });
  }

  /** Add a decision and broadcast to clients */
  addDecision(decision: DecisionItem): void {
    this.decisions.push(decision);
    this.broadcast({
      jsonrpc: "2.0",
      method: "decision.new",
      params: { decision },
    });
  }

  /** Get all pending decisions */
  getDecisions(): DecisionItem[] {
    return this.decisions.filter((d) => !d.resolved);
  }

  /** Broadcast a JSON-RPC notification to all connected clients */
  broadcast(notification: ServerNotification): void {
    const message = JSON.stringify(notification);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /** Gracefully close all WebSocket connections and shut down the server */
  async close(): Promise<void> {
    // Notify clients of shutdown
    const shutdownMsg = JSON.stringify({
      jsonrpc: "2.0",
      method: "server.shutdown",
      params: { reason: "Server shutting down" },
    });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(shutdownMsg);
        client.close(1001, "Server shutting down");
      }
    }
    this.clients.clear();

    // Close the WebSocket server
    await new Promise<void>((resolve) => {
      this.wss.close(() => resolve());
    });
  }

  // ---- Internal message dispatch ----

  private async handleMessage(ws: WebSocket, raw: string): Promise<void> {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(raw);
    } catch {
      this.sendError(ws, null, -32700, "Parse error");
      return;
    }

    if (request.jsonrpc !== "2.0" || !request.method) {
      this.sendError(ws, request.id ?? null, -32600, "Invalid request");
      return;
    }

    try {
      const result = await this.dispatch(request);
      this.sendResult(ws, request.id, result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(ws, request.id, -32000, message);
    }
  }

  private async dispatch(request: JsonRpcRequest): Promise<unknown> {
    const params = (request.params ?? {}) as Record<string, unknown>;

    switch (request.method) {
      case "projects.list":
        return { projects: this.sessionMonitor.getProjects() };

      case "decisions.list":
        return { decisions: this.getDecisions() };

      case "decisions.resolve": {
        const decisionId = params.decisionId as string;
        const option = params.option as string;
        const message = params.message as string | undefined;
        return await this.resolveDecision(decisionId, option, message);
      }

      case "activity.list": {
        const projectId = params.projectId as string | undefined;
        const limit = params.limit as number | undefined;
        return {
          entries: this.sessionMonitor.getActivities(projectId, limit),
        };
      }

      case "session.lastMessage": {
        const sessionId = params.sessionId as string;
        if (!sessionId) throw new Error("sessionId is required");
        const session = this.sessionMonitor.getSession(sessionId);
        if (!session) throw new Error(`Session not found: ${sessionId}`);
        const lastMessage = await this.sessionMonitor.getLastAssistantMessage(session.filePath);
        return { lastMessage };
      }

      case "tmux.list": {
        const sessions = await this.agentController.listSessions();
        return { sessions };
      }

      case "agent.launch": {
        const projectPath = params.projectPath as string;
        const sessionName = params.sessionName as string;
        const prompt = params.prompt as string | undefined;
        if (!projectPath || !sessionName) {
          throw new Error("projectPath and sessionName are required");
        }
        return await this.agentController.launchAgent(
          projectPath,
          sessionName,
          prompt
        );
      }

      case "agent.stop": {
        const sessionName = params.sessionName as string;
        if (!sessionName) throw new Error("sessionName is required");
        await this.agentController.killSession(sessionName);
        return { success: true };
      }

      case "agent.sendKeys": {
        const sessionName = params.sessionName as string;
        const text = params.text as string;
        if (!sessionName || !text) {
          throw new Error("sessionName and text are required");
        }
        await this.agentController.sendKeys(sessionName, text);
        return { success: true };
      }

      case "tmux.capture": {
        const sessionName = params.sessionName as string;
        if (!sessionName) throw new Error("sessionName is required");
        const content = await this.agentController.capturePane(sessionName);
        return { content };
      }

      case "hooks.install":
        await this.hookManager.installHooks(this.port);
        return { success: true };

      case "server.info": {
        const tmuxSessions = await this.agentController
          .listSessions()
          .catch(() => []);
        return {
          version: SERVER_VERSION,
          uptime: Date.now() - this.startedAt,
          claudeDir: "~/.claude",
          projectCount: this.sessionMonitor.getProjects().length,
          activeAgents: tmuxSessions.length,
        };
      }

      default:
        throw Object.assign(
          new Error(`Method not found: ${request.method}`),
          { code: -32601 }
        );
    }
  }

  private async resolveDecision(
    decisionId: string,
    option: string,
    message?: string
  ): Promise<{ success: boolean; attempts?: number; warning?: string }> {
    const decision = this.decisions.find((d) => d.id === decisionId);
    if (!decision) {
      throw new Error(`Decision not found: ${decisionId}`);
    }
    if (decision.resolved) {
      throw new Error(`Decision already resolved: ${decisionId}`);
    }

    // Find the selected option label
    const selectedOption = decision.options.find((o) => o.key === option);
    const responseText =
      message ?? selectedOption?.label ?? `Selected option: ${option}`;

    // Find a tmux session for this project to send keys to
    const tmuxSessions = await this.agentController.listSessions();
    const tmuxSession = tmuxSessions.find(
      (s) => s.name === decision.projectId || s.projectId === decision.projectId
    );

    let attempts = 0;
    let warning: string | undefined;

    if (tmuxSession) {
      try {
        const result = await this.agentController.sendKeysWithRetry(
          tmuxSession.name,
          responseText,
        );
        attempts = result.attempts;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[WebSocket] Decision injection failed for decision=${decisionId} ` +
          `project=${decision.projectName} session=${tmuxSession.name}: ${errMsg}`,
        );
        // Mark resolved anyway so UI isn't stuck, but include warning
        warning = `Injection failed: ${errMsg}`;

        // Log the failure as an activity
        this.sessionMonitor.addActivity({
          id: nanoid(),
          timestamp: Date.now(),
          projectId: decision.projectId,
          projectName: decision.projectName,
          sessionId: decision.sessionId,
          action: `Decision injection failed: ${errMsg}`,
          type: "error",
        });
      }
    } else {
      console.warn(
        `[WebSocket] No tmux session found for project=${decision.projectId} ` +
        `when resolving decision=${decisionId}`,
      );
      warning = "No tmux session found for this project";
    }

    // Mark as resolved
    decision.resolved = true;
    decision.resolvedOption = option;
    decision.resolvedAt = Date.now();

    // Broadcast resolution
    this.broadcast({
      jsonrpc: "2.0",
      method: "decision.resolved",
      params: { decisionId, option },
    });

    // Log activity
    this.sessionMonitor.addActivity({
      id: nanoid(),
      timestamp: Date.now(),
      projectId: decision.projectId,
      projectName: decision.projectName,
      sessionId: decision.sessionId,
      action: `Decision resolved: ${selectedOption?.label ?? option}`,
      type: "decision_resolved",
    });

    return { success: !warning, attempts, warning };
  }

  private sendResult(
    ws: WebSocket,
    id: string | number,
    result: unknown
  ): void {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id,
      result,
    };
    ws.send(JSON.stringify(response));
  }

  private sendError(
    ws: WebSocket,
    id: string | number | null,
    code: number,
    message: string
  ): void {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: id ?? 0,
      error: { code, message },
    };
    ws.send(JSON.stringify(response));
  }
}
