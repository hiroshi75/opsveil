// ============================================================
// OpsVeil Shared Types
// ============================================================

/** Agent phase / status */
export type AgentPhase = "autonomous" | "blocked" | "review" | "idle";

/** Priority level for decision items */
export type DecisionPriority = "high" | "medium" | "low";

/** Hook event types from Claude Code */
export type HookEventType = "Stop" | "Notification" | "PostToolUse";

// ---- Project & Session ----

export interface ProjectState {
  id: string;
  name: string;
  path: string;
  branch: string;
  phase: AgentPhase;
  agentCount: number;
  lastActivity: number; // unix ms
  tokenSpend: number;
  progress: number; // 0-1
  description: string;
  sessions: SessionState[];
}

export interface SessionState {
  id: string;
  projectId: string;
  tmuxSession: string | null;
  filePath: string;
  lastLine: number;
  isActive: boolean;
  startedAt: number;
  lastActivityAt: number;
  /** The type of the most recent JSONL entry ("assistant"|"user"|etc.) */
  lastEntryType: string | null;
  /** Per-session phase (derived from lastEntryType + age) */
  phase: AgentPhase;
  /** True if the Claude process has exited (stop_hook_summary seen) */
  terminated: boolean;
  tokenUsage: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

// ---- Decision Queue ----

export interface DecisionOption {
  key: string;
  label: string;
  confidence: number; // 0-1
}

export interface DecisionItem {
  id: string;
  projectId: string;
  projectName: string;
  sessionId: string;
  summary: string;
  detail: string;
  options: DecisionOption[];
  estimatedTime: string;
  priority: DecisionPriority;
  timestamp: number;
  agentNote: string;
  /** False when agent completed normally and no user action is needed */
  requiresAction?: boolean;
  hasScreenshot?: boolean;
  screenshotUrl?: string;
  resolved?: boolean;
  resolvedOption?: string;
  resolvedAt?: number;
}

// ---- Activity Log ----

export type ActivityType = "commit" | "blocked" | "running" | "tool_use" | "error" | "decision_resolved";

export interface ActivityEntry {
  id: string;
  timestamp: number;
  projectId: string;
  projectName: string;
  sessionId?: string;
  action: string;
  type: ActivityType;
  detail?: string;
}

// ---- Hook Payloads (from Claude Code) ----

export interface HookStopPayload {
  session_id: string;
  project: string;
  last_message: string;
  stop_reason: string;
  transcript_path: string;
}

export interface HookNotificationPayload {
  session_id: string;
  project: string;
  title: string;
  message: string;
}

export interface HookPostToolUsePayload {
  session_id: string;
  project: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output: string;
}

// ---- tmux / Agent Control ----

export interface TmuxSession {
  name: string;
  projectId: string;
  isAttached: boolean;
  lastActivity: number;
  windowCount: number;
}

export interface LaunchAgentRequest {
  projectPath: string;
  sessionName: string;
  prompt?: string;
  dangerouslySkipPermissions?: boolean;
}

export interface SendKeysRequest {
  sessionName: string;
  text: string;
}

// ---- Server Configuration ----

export interface ServerConfig {
  port: number;
  host: string;
  claudeDir: string; // default: ~/.claude
  llm: LLMConfig;
}

export interface LLMConfig {
  provider: "google" | "anthropic" | "openai";
  model: string;
  apiKey: string;
}

// ---- Server Connection (for multi-server client) ----

export interface ServerConnection {
  id: string;
  name: string;
  url: string; // ws://host:port
  status: "connected" | "connecting" | "disconnected" | "error";
  lastConnected?: number;
}
