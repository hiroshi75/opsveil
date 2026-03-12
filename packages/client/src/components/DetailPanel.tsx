import { useState, useCallback, useMemo } from "react";
import { useProjectStore } from "../stores/project-store";
import { useConnectionStore } from "../stores/connection-store";
import { useRpc } from "../hooks/use-rpc";
import { ProjectActivityFeed } from "./ActivityFeed";
import type { AgentPhase, SessionState } from "@opsveil/shared";

// ---------------------------------------------------------------------------
// Phase config
// ---------------------------------------------------------------------------

const PHASE_LABELS: Record<AgentPhase, string> = {
  autonomous: "\u81EA\u5F8B\u9032\u884C\u4E2D",
  blocked: "\u5165\u529B\u5F85\u3061",
  review: "\u30EC\u30D3\u30E5\u30FC\u5F85\u3061",
  idle: "\u505C\u6B62\u4E2D",
};

const PHASE_BADGE: Record<AgentPhase, string> = {
  autonomous: "bg-green-500/10 text-phase-autonomous border-green-500/25",
  blocked: "bg-red-500/10 text-phase-blocked border-red-500/30",
  review: "bg-amber-500/10 text-phase-review border-amber-500/25",
  idle: "bg-gray-500/[0.08] text-phase-idle border-gray-500/20",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DetailPanel() {
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const selectedSessionId = useProjectStore((s) => s.selectedSessionId);
  const clearSelection = useProjectStore((s) => s.clearSelection);
  const connections = useConnectionStore((s) => s.connections);
  const { rpc } = useRpc();

  const [directInput, setDirectInput] = useState("");
  const [captureContent, setCaptureContent] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const project = selectedProject();

  const session: SessionState | null = useMemo(() => {
    if (!project || !selectedSessionId) return project?.sessions[0] ?? null;
    return project.sessions.find((s) => s.id === selectedSessionId) ?? project.sessions[0] ?? null;
  }, [project, selectedSessionId]);

  const handleSendKeys = useCallback(async () => {
    if (!project || !session) return;
    if (!directInput.trim()) return;
    if (!session.tmuxSession) return;
    try {
      await rpc(
        "agent.sendKeys",
        { sessionName: session.tmuxSession, text: directInput },
        project.serverId,
      );
      setDirectInput("");
    } catch {
      // Silently fail
    }
  }, [directInput, project, session, rpc]);

  const handleCapture = useCallback(async () => {
    if (!project || !session) return;
    if (!session.tmuxSession) return;
    setIsCapturing(true);
    try {
      const result = (await rpc(
        "tmux.capture",
        { sessionName: session.tmuxSession },
        project.serverId,
      )) as { content: string };
      setCaptureContent(result.content);
    } catch {
      setCaptureContent("Failed to capture pane.");
    } finally {
      setIsCapturing(false);
    }
  }, [project, session, rpc]);

  if (!project) return null;

  const serverName = connections.get(project.serverId)?.name ?? "Unknown";
  const displayPhase = session?.phase ?? project.phase;
  const displayTokens = session
    ? (session.tokenUsage.inputTokens + session.tokenUsage.outputTokens) / 1000
    : project.tokenSpend / 1000;
  const displayLastActive = session?.lastActivityAt ?? project.lastActivity;

  // Show session indicator when project has multiple active sessions
  const activeSessions = project.sessions.filter((s) => s.isActive);
  const displayName =
    activeSessions.length > 1 && session
      ? `${project.name} #${activeSessions.indexOf(session) + 1}`
      : project.name;

  return (
    <div className="w-80 shrink-0 border-l border-surface-3 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-surface-3">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[15px] font-bold font-mono text-slate-200 truncate">
            {displayName}
          </span>
          <button
            onClick={clearSelection}
            className="bg-transparent border-none text-slate-600 cursor-pointer text-base hover:text-slate-400 transition-colors"
          >
            {"\u2715"}
          </button>
        </div>
        <div className="text-xs text-slate-400 mb-3">{project.description}</div>
        <div className="flex gap-2 flex-wrap">
          <span
            className={`text-[10px] px-2 py-0.5 rounded border font-mono ${PHASE_BADGE[displayPhase]}`}
          >
            {PHASE_LABELS[displayPhase]}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-white/[0.04] text-slate-400 font-mono">
            {project.branch}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-white/[0.04] text-slate-500 font-mono">
            {serverName}
          </span>
          {session && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-white/[0.04] text-slate-600 font-mono">
              {session.id.slice(0, 8)}
            </span>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="p-3 px-4 border-b border-surface-2">
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              { label: "Agents", value: String(project.agentCount) },
              {
                label: "Progress",
                value: `${Math.round(project.progress * 100)}%`,
              },
              {
                label: "Tokens",
                value: `${displayTokens.toFixed(1)}k`,
              },
              {
                label: "Last Active",
                value: timeAgo(displayLastActive),
              },
            ] as const
          ).map((stat) => (
            <div key={stat.label}>
              <div className="text-[9px] text-slate-600 uppercase tracking-wide font-mono">
                {stat.label}
              </div>
              <div className="text-base font-bold text-slate-200 font-mono">
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Direct Input */}
      <div className="p-3 px-4 border-b border-surface-2">
        <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-2 font-mono">
          Direct Input ({"\u2192"} tmux send-keys)
        </div>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={directInput}
            onChange={(e) => setDirectInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSendKeys();
            }}
            placeholder={"\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u306B\u6307\u793A\u3092\u9001\u308B..."}
            className="flex-1 px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-md text-slate-200 text-xs outline-none font-mono focus:border-accent/40 transition-colors"
          />
          <button
            onClick={handleSendKeys}
            className="px-3 py-2 bg-accent border-none rounded-md text-white text-xs cursor-pointer font-mono hover:bg-accent-dark transition-colors"
          >
            {"\u9001\u4FE1"}
          </button>
        </div>
      </div>

      {/* Capture Pane */}
      <div className="p-3 px-4 border-b border-surface-2">
        <button
          onClick={handleCapture}
          disabled={isCapturing}
          className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-md text-slate-400 text-[11px] cursor-pointer font-mono hover:bg-white/[0.06] transition-colors disabled:opacity-50"
        >
          {isCapturing ? "Capturing..." : "Capture Pane"}
        </button>
        {captureContent && (
          <pre className="mt-2 p-2 bg-surface-0 border border-white/[0.06] rounded text-[10px] text-slate-400 font-mono overflow-auto max-h-40 whitespace-pre-wrap">
            {captureContent}
          </pre>
        )}
      </div>

      {/* Activity log for this project */}
      <div className="flex-1 overflow-y-auto p-3 px-4">
        <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-2 font-mono">
          Activity Log
        </div>
        <ProjectActivityFeed projectId={project.id} />
      </div>
    </div>
  );
}
