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
    if (conn.ws && conn.status === "connected") return;

    // Clean up previous connection
    if (conn.ws) {
      conn.ws.onclose = null;
      conn.ws.onerror = null;
      conn.ws.onmessage = null;
      conn.ws.close();
    }
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
    }

    get()._setConnectionStatus(id, "connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(conn.url);
    } catch {
      get()._setConnectionStatus(id, "error");
      return;
    }

    ws.onopen = () => {
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
    };

    ws.onmessage = (event) => {
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
      get()._setConnectionStatus(id, "disconnected");
      // Schedule reconnect
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
      get()._setConnectionStatus(id, "error");
    };

    // Store ws reference
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
    const conn = get().connections.get(id);
    if (!conn) return;
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
    }
    if (conn.ws) {
      conn.ws.onclose = null; // prevent auto-reconnect
      conn.ws.close();
    }
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
    default:
      break;
  }
}
