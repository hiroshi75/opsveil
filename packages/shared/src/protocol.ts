// ============================================================
// OpsVeil JSON-RPC Protocol
// ============================================================

import type {
  ProjectState,
  DecisionItem,
  ActivityEntry,
  TmuxSession,
  LaunchAgentRequest,
  SendKeysRequest,
  ServerConfig,
} from "./types.js";

// ---- JSON-RPC Base ----

export interface JsonRpcRequest<M extends string = string, P = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  method: M;
  params?: P;
}

export interface JsonRpcResponse<R = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  result?: R;
  error?: JsonRpcError;
}

export interface JsonRpcNotification<M extends string = string, P = unknown> {
  jsonrpc: "2.0";
  method: M;
  params?: P;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ---- Server → Client Notifications ----

export type ServerNotification =
  | JsonRpcNotification<"projects.updated", { projects: ProjectState[] }>
  | JsonRpcNotification<"project.updated", { project: ProjectState }>
  | JsonRpcNotification<"decision.new", { decision: DecisionItem }>
  | JsonRpcNotification<"decision.resolved", { decisionId: string; option: string }>
  | JsonRpcNotification<"activity.new", { entry: ActivityEntry }>
  | JsonRpcNotification<"tmux.updated", { sessions: TmuxSession[] }>
  | JsonRpcNotification<"server.config", { config: Omit<ServerConfig, "llm"> }>;

// ---- Client → Server Requests ----

/** Get all project states */
export type GetProjectsRequest = JsonRpcRequest<"projects.list">;
export type GetProjectsResponse = JsonRpcResponse<{ projects: ProjectState[] }>;

/** Get decision queue */
export type GetDecisionsRequest = JsonRpcRequest<"decisions.list">;
export type GetDecisionsResponse = JsonRpcResponse<{ decisions: DecisionItem[] }>;

/** Resolve a decision */
export type ResolveDecisionRequest = JsonRpcRequest<
  "decisions.resolve",
  { decisionId: string; option: string; message?: string }
>;
export type ResolveDecisionResponse = JsonRpcResponse<{ success: boolean }>;

/** Get activity log */
export type GetActivityRequest = JsonRpcRequest<
  "activity.list",
  { projectId?: string; limit?: number }
>;
export type GetActivityResponse = JsonRpcResponse<{ entries: ActivityEntry[] }>;

/** List tmux sessions */
export type ListTmuxRequest = JsonRpcRequest<"tmux.list">;
export type ListTmuxResponse = JsonRpcResponse<{ sessions: TmuxSession[] }>;

/** Launch a new agent */
export type LaunchAgentRpcRequest = JsonRpcRequest<"agent.launch", LaunchAgentRequest>;
export type LaunchAgentRpcResponse = JsonRpcResponse<{ sessionName: string; pid: number }>;

/** Stop an agent */
export type StopAgentRequest = JsonRpcRequest<"agent.stop", { sessionName: string }>;
export type StopAgentResponse = JsonRpcResponse<{ success: boolean }>;

/** Send keys to agent */
export type SendKeysRpcRequest = JsonRpcRequest<"agent.sendKeys", SendKeysRequest>;
export type SendKeysRpcResponse = JsonRpcResponse<{ success: boolean }>;

/** Capture tmux pane content */
export type CapturePaneRequest = JsonRpcRequest<"tmux.capture", { sessionName: string }>;
export type CapturePaneResponse = JsonRpcResponse<{ content: string }>;

/** Install hooks */
export type InstallHooksRequest = JsonRpcRequest<"hooks.install">;
export type InstallHooksResponse = JsonRpcResponse<{ success: boolean }>;

/** Get server info */
export type ServerInfoRequest = JsonRpcRequest<"server.info">;
export type ServerInfoResponse = JsonRpcResponse<{
  version: string;
  uptime: number;
  claudeDir: string;
  projectCount: number;
  activeAgents: number;
}>;

// ---- Method name union (for dispatch) ----

export type ClientMethod =
  | "projects.list"
  | "decisions.list"
  | "decisions.resolve"
  | "activity.list"
  | "tmux.list"
  | "agent.launch"
  | "agent.stop"
  | "agent.sendKeys"
  | "tmux.capture"
  | "hooks.install"
  | "server.info";
