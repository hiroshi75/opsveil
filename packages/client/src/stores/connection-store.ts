import { create } from "zustand";
import type {
  ServerConnection,
  ProjectState,
  DecisionItem,
  ActivityEntry,
} from "@opsveil/shared";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
} from "@opsveil/shared";
import { useProjectStore } from "./project-store";
import { useDecisionStore } from "./decision-store";
import { useActivityStore } from "./activity-store";
import { interpretStopEvent } from "../lib/state-interpreter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServerConnectionState extends ServerConnection {
  ws: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ConnectionStore {
  connections: Map<string, ServerConnectionState>;
  pendingRequests: Map<string, PendingRequest>;

  // Actions
  addServer: (name: string, url: string) => string;
  removeServer: (id: string) => void;
  connect: (id: string) => void;
  disconnect: (id: string) => void;
  sendRpc: (
    serverId: string,
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;

  // Internal
  _setConnectionStatus: (
    id: string,
    status: ServerConnection["status"],
  ) => void;
  _persistServers: () => void;
  _loadServers: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOCAL_STORAGE_KEY = "opsveil:servers";

let rpcIdCounter = 0;
function nextRpcId(): string {
  rpcIdCounter += 1;
  return `rpc-${rpcIdCounter}-${Date.now()}`;
}

function generateServerId(): string {
  return `srv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_RECONNECT_DELAY = 30_000;

function reconnectDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), MAX_RECONNECT_DELAY);
}

/** Track connections where auto-reconnect is suppressed (manual disconnect) */
const suppressReconnect = new Set<string>();

/** Track the "current" WebSocket for each connection to detect stale callbacks */
const liveWs = new Map<string, WebSocket>();

/** Guard against overlapping reconnect / connect attempts */
const connectInProgress = new Set<string>();

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  connections: new Map(),
  pendingRequests: new Map(),

  addServer(name: string, url: string): string {
    const id = generateServerId();
    const conn: ServerConnectionState = {
      id,
      name,
      url,
      status: "disconnected",
      ws: null,
      reconnectTimer: null,
      reconnectAttempt: 0,
    };
    set((state) => {
      const next = new Map(state.connections);
      next.set(id, conn);
      return { connections: next };
    });
    get()._persistServers();
    return id;
  },

  removeServer(id: string) {
    get().disconnect(id);
    liveWs.delete(id);
    suppressReconnect.delete(id);
    connectInProgress.delete(id);
    set((state) => {
      const next = new Map(state.connections);
      next.delete(id);
      return { connections: next };
    });
    get()._persistServers();
  },

  connect(id: string) {
    const state = get();
    const conn = state.connections.get(id);
    if (!conn) return;

    // Prevent duplicate connection attempts (race condition guard)
    if (connectInProgress.has(id)) return;
    if (conn.ws && conn.status === "connected") return;

    connectInProgress.add(id);

    // Clean up previous connection — close and wait for it to finish
    const prevWs = liveWs.get(id);
    if (prevWs) {
      prevWs.onopen = null;
      prevWs.onclose = null;
      prevWs.onerror = null;
      prevWs.onmessage = null;
      if (prevWs.readyState !== WebSocket.CLOSED && prevWs.readyState !== WebSocket.CLOSING) {
        prevWs.close();
      }
      liveWs.delete(id);
    }
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
    }

    suppressReconnect.delete(id);
    get()._setConnectionStatus(id, "connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(conn.url);
    } catch {
      connectInProgress.delete(id);
      get()._setConnectionStatus(id, "error");
      return;
    }

    liveWs.set(id, ws);

    ws.onopen = () => {
      // Ignore if this ws is no longer the current one
      if (liveWs.get(id) !== ws) return;

      connectInProgress.delete(id);

      set((s) => {
        const next = new Map(s.connections);
        const c = next.get(id);
        if (c) {
          next.set(id, {
            ...c,
            ws,
            status: "connected",
            reconnectAttempt: 0,
            lastConnected: Date.now(),
          });
        }
        return { connections: next };
      });

      // Fetch initial data from the server
      fetchInitialData(id, get().sendRpc);
    };

    ws.onmessage = (event) => {
      if (liveWs.get(id) !== ws) return;

      let data: JsonRpcResponse | JsonRpcNotification;
      try {
        data = JSON.parse(event.data as string);
      } catch {
        return;
      }

      // Response to a pending request
      if ("id" in data && data.id != null) {
        const resp = data as JsonRpcResponse;
        const pending = get().pendingRequests.get(String(resp.id));
        if (pending) {
          clearTimeout(pending.timer);
          set((s) => {
            const next = new Map(s.pendingRequests);
            next.delete(String(resp.id));
            return { pendingRequests: next };
          });
          if (resp.error) {
            pending.reject(resp.error);
          } else {
            pending.resolve(resp.result);
          }
        }
        return;
      }

      // Notification (no id field)
      const notif = data as JsonRpcNotification<string, Record<string, unknown>>;
      handleNotification(id, notif);
    };

    ws.onclose = () => {
      // Ignore if this ws is no longer the current one, or manually disconnected
      if (liveWs.get(id) !== ws || suppressReconnect.has(id)) return;

      connectInProgress.delete(id);
      liveWs.delete(id);
      get()._setConnectionStatus(id, "disconnected");

      // Schedule auto-reconnect
      const current = get().connections.get(id);
      if (!current) return;
      const attempt = current.reconnectAttempt;
      const delay = reconnectDelay(attempt);
      const timer = setTimeout(() => {
        set((s) => {
          const next = new Map(s.connections);
          const c = next.get(id);
          if (c) {
            next.set(id, { ...c, reconnectAttempt: attempt + 1 });
          }
          return { connections: next };
        });
        get().connect(id);
      }, delay);
      set((s) => {
        const next = new Map(s.connections);
        const c = next.get(id);
        if (c) {
          next.set(id, { ...c, reconnectTimer: timer, ws: null });
        }
        return { connections: next };
      });
    };

    ws.onerror = () => {
      if (liveWs.get(id) !== ws) return;
      connectInProgress.delete(id);
      get()._setConnectionStatus(id, "error");
    };

    // Store ws reference in Zustand state
    set((s) => {
      const next = new Map(s.connections);
      const c = next.get(id);
      if (c) {
        next.set(id, { ...c, ws });
      }
      return { connections: next };
    });
  },

  disconnect(id: string) {
    suppressReconnect.add(id);
    connectInProgress.delete(id);

    const conn = get().connections.get(id);
    if (!conn) return;
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
    }

    // Kill the live WebSocket and null ALL handlers
    const ws = liveWs.get(id);
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        ws.close();
      }
    }
    liveWs.delete(id);

    set((s) => {
      const next = new Map(s.connections);
      const c = next.get(id);
      if (c) {
        next.set(id, {
          ...c,
          ws: null,
          status: "disconnected",
          reconnectTimer: null,
          reconnectAttempt: 0,
        });
      }
      return { connections: next };
    });

    // Clear this server's data from other stores
    useProjectStore.getState().clearServer(id);
  },

  sendRpc(
    serverId: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const conn = get().connections.get(serverId);
      if (!conn || !conn.ws || conn.status !== "connected") {
        reject(new Error("Not connected"));
        return;
      }

      const id = nextRpcId();
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        ...(params ? { params } : {}),
      };

      const timer = setTimeout(() => {
        set((s) => {
          const next = new Map(s.pendingRequests);
          next.delete(id);
          return { pendingRequests: next };
        });
        reject(new Error(`RPC timeout: ${method}`));
      }, 15_000);

      set((s) => {
        const next = new Map(s.pendingRequests);
        next.set(id, { resolve, reject, timer });
        return { pendingRequests: next };
      });

      conn.ws.send(JSON.stringify(request));
    });
  },

  _setConnectionStatus(id: string, status: ServerConnection["status"]) {
    set((s) => {
      const next = new Map(s.connections);
      const c = next.get(id);
      if (c) {
        next.set(id, { ...c, status });
      }
      return { connections: next };
    });
  },

  _persistServers() {
    const entries: Array<{ id: string; name: string; url: string }> = [];
    for (const [, conn] of get().connections) {
      entries.push({ id: conn.id, name: conn.name, url: conn.url });
    }
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // localStorage may not be available
    }
  },

  _loadServers() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return;
      const entries = JSON.parse(raw) as Array<{
        id: string;
        name: string;
        url: string;
      }>;
      set((state) => {
        const next = new Map(state.connections);
        for (const entry of entries) {
          if (!next.has(entry.id)) {
            next.set(entry.id, {
              id: entry.id,
              name: entry.name,
              url: entry.url,
              status: "disconnected",
              ws: null,
              reconnectTimer: null,
              reconnectAttempt: 0,
            });
          }
        }
        return { connections: next };
      });
    } catch {
      // ignore
    }
  },
}));

// ---------------------------------------------------------------------------
// Notification dispatcher
// ---------------------------------------------------------------------------

async function fetchInitialData(
  serverId: string,
  sendRpc: ConnectionStore["sendRpc"],
) {
  try {
    const [projectsRes, decisionsRes, activityRes] = await Promise.all([
      sendRpc(serverId, "projects.list") as Promise<{
        projects: ProjectState[];
      }>,
      sendRpc(serverId, "decisions.list") as Promise<{
        decisions: DecisionItem[];
      }>,
      sendRpc(serverId, "activity.list", { limit: 100 }) as Promise<{
        entries: ActivityEntry[];
      }>,
    ]);

    useProjectStore.getState().setProjects(serverId, projectsRes.projects);
    for (const d of decisionsRes.decisions) {
      useDecisionStore.getState().addDecision(serverId, d);
    }
    for (const e of activityRes.entries) {
      useActivityStore.getState().addEntry(serverId, e);
    }

    // Generate decisions for sessions that are already blocked on connect.
    // The server's waiting-for-input events may have fired before we connected.
    for (const project of projectsRes.projects) {
      for (const session of project.sessions) {
        if (session.phase === "blocked" && session.isActive && !session.terminated) {
          const existing = useDecisionStore.getState().decisions.some(
            (d) => d.sessionId === session.id,
          );
          if (!existing) {
            // Fetch the actual last message from the server for LLM context
            sendRpc(serverId, "session.lastMessage", { sessionId: session.id })
              .then((res) => {
                const { lastMessage } = res as { lastMessage: string };
                handleHookStop(serverId, {
                  sessionId: session.id,
                  projectId: project.id,
                  projectName: project.name,
                  lastMessage: lastMessage || "",
                  stopReason: "waiting_for_input",
                });
              })
              .catch(() => {
                // Fallback without message context
                handleHookStop(serverId, {
                  sessionId: session.id,
                  projectId: project.id,
                  projectName: project.name,
                  lastMessage: "",
                  stopReason: "waiting_for_input",
                });
              });
          }
        }
      }
    }
  } catch (err) {
    console.warn("[fetchInitialData] Failed:", err);
  }
}

function handleNotification(
  serverId: string,
  notif: JsonRpcNotification<string, Record<string, unknown>>,
) {
  switch (notif.method) {
    case "projects.updated": {
      const payload = notif.params as { projects: ProjectState[] };
      useProjectStore.getState().setProjects(serverId, payload.projects);
      break;
    }
    case "project.updated": {
      const payload = notif.params as { project: ProjectState };
      useProjectStore.getState().updateProject(serverId, payload.project);
      // Auto-dismiss decisions per session when session goes back to autonomous
      for (const session of payload.project.sessions) {
        if (session.phase === "autonomous") {
          useDecisionStore.getState().dismissBySession(session.id);
        }
      }
      break;
    }
    case "decision.new": {
      const payload = notif.params as { decision: DecisionItem };
      useDecisionStore.getState().addDecision(serverId, payload.decision);
      break;
    }
    case "decision.resolved": {
      const payload = notif.params as {
        decisionId: string;
        option: string;
      };
      useDecisionStore
        .getState()
        .resolveDecision(payload.decisionId, payload.option);
      break;
    }
    case "activity.new": {
      const payload = notif.params as { entry: ActivityEntry };
      useActivityStore.getState().addEntry(serverId, payload.entry);
      break;
    }
    case "hook.stop": {
      const payload = notif.params as {
        sessionId: string;
        projectId: string;
        projectName: string;
        lastMessage: string;
        stopReason: string;
      };
      handleHookStop(serverId, payload);
      break;
    }
    default:
      break;
  }
}

async function handleHookStop(
  serverId: string,
  payload: {
    sessionId: string;
    projectId: string;
    projectName: string;
    lastMessage: string;
    stopReason: string;
  },
): Promise<void> {
  let apiKey: string | null = null;
  try {
    apiKey = localStorage.getItem("opsveil:apiKey");
  } catch {
    // localStorage may not be available
  }

  try {
    const decision = await interpretStopEvent(payload, apiKey);
    useDecisionStore.getState().addDecision(serverId, decision, payload);
  } catch (err) {
    console.error("[handleHookStop] Failed to interpret stop event:", err);
  }
}
