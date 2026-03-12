import { useState } from "react";
import { useProjectStore } from "../stores/project-store";
import { useDecisionStore } from "../stores/decision-store";
import { useConnectionStore } from "../stores/connection-store";
import ServerManager from "./ServerManager";

const STATUS_DOT: Record<string, string> = {
  connected: "bg-phase-autonomous",
  connecting: "bg-phase-review",
  disconnected: "bg-phase-idle",
  error: "bg-phase-blocked",
};

export default function TopBar() {
  const [showServerManager, setShowServerManager] = useState(false);
  const projectsMap = useProjectStore((s) => s.projects);
  const decisions = useDecisionStore((s) => s.decisions);
  const connections = useConnectionStore((s) => s.connections);

  const projects = Array.from(projectsMap.values()).sort(
    (a, b) => b.lastActivity - a.lastActivity,
  );
  const blockedCount = projects.filter((p) => p.phase === "blocked").length;
  const reviewCount = projects.filter((p) => p.phase === "review").length;
  const autonomousCount = projects.filter(
    (p) => p.phase === "autonomous",
  ).length;
  const totalAgents = projects.reduce((sum, p) => sum + p.agentCount, 0);
  const totalTokens = projects.reduce((sum, p) => sum + p.tokenSpend, 0);

  return (
    <>
      <div className="flex items-center justify-between px-5 py-3 bg-surface-1 border-b border-surface-3">
        {/* Left: Logo */}
        <div className="flex items-center gap-3">
          <span className="text-base font-extrabold tracking-tight font-mono bg-gradient-to-r from-accent to-purple-500 bg-clip-text text-transparent">
            OpsVeil
          </span>
          <span className="text-slate-600 text-xs font-mono">v0.1.0</span>
        </div>

        {/* Center: Status summary */}
        <div className="flex gap-4 text-xs font-mono">
          {blockedCount > 0 && (
            <span className="text-phase-blocked">
              {decisions.length > 0 && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-phase-blocked mr-1.5 animate-pulse-dot" />
              )}
              {blockedCount} blocked
            </span>
          )}
          {reviewCount > 0 && (
            <span className="text-phase-review">{reviewCount} review</span>
          )}
          <span className="text-phase-autonomous">
            {autonomousCount} auto
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">{totalAgents} agents</span>
          <span className="text-slate-400">
            {(totalTokens / 1000).toFixed(0)}k tokens
          </span>
        </div>

        {/* Right: Server indicators */}
        <button
          onClick={() => setShowServerManager(!showServerManager)}
          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-2 transition-colors"
        >
          {Array.from(connections.values()).map((conn) => (
            <div key={conn.id} className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${STATUS_DOT[conn.status] ?? "bg-phase-idle"}`}
              />
              <span className="text-xs text-slate-500 font-mono">
                {conn.name}
              </span>
            </div>
          ))}
          {connections.size === 0 && (
            <span className="text-xs text-slate-600 font-mono">
              No servers
            </span>
          )}
        </button>
      </div>

      {showServerManager && (
        <ServerManager onClose={() => setShowServerManager(false)} />
      )}
    </>
  );
}
