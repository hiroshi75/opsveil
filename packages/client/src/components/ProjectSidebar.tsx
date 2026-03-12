import { useMemo } from "react";
import { useProjectStore, type ProjectEntry } from "../stores/project-store";
import { useConnectionStore } from "../stores/connection-store";
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

const PHASE_BORDER: Record<AgentPhase, string> = {
  autonomous: "border-l-phase-autonomous",
  blocked: "border-l-phase-blocked",
  review: "border-l-phase-review",
  idle: "border-l-phase-idle",
};

const PHASE_TEXT: Record<AgentPhase, string> = {
  autonomous: "text-phase-autonomous",
  blocked: "text-phase-blocked",
  review: "text-phase-review",
  idle: "text-phase-idle",
};

const PHASE_BG_SELECTED: Record<AgentPhase, string> = {
  autonomous: "bg-green-500/10 border-green-500/25",
  blocked: "bg-red-500/10 border-red-500/30",
  review: "bg-amber-500/10 border-amber-500/25",
  idle: "bg-gray-500/[0.08] border-gray-500/20",
};

const PHASE_BAR: Record<AgentPhase, string> = {
  autonomous: "bg-phase-autonomous",
  blocked: "bg-phase-blocked",
  review: "bg-phase-review",
  idle: "bg-phase-idle",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A flattened sidebar entry — one per active session, or one per idle project */
interface SidebarEntry {
  /** Unique key for React + selection */
  entryKey: string;
  projectKey: string;
  project: ProjectEntry;
  session: SessionState | null;
  displayName: string;
  phase: AgentPhase;
  lastActivity: number;
  tokens: number;
  progress: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function buildSidebarEntries(projects: ProjectEntry[]): SidebarEntry[] {
  const entries: SidebarEntry[] = [];

  for (const project of projects) {
    const activeSessions = project.sessions.filter((s) => s.isActive);

    if (activeSessions.length <= 1) {
      // Single or no active session — show one entry for the project
      const session = activeSessions[0] ?? null;
      entries.push({
        entryKey: session ? `${project.key}:${session.id}` : project.key,
        projectKey: project.key,
        project,
        session,
        displayName: project.name,
        phase: session?.phase ?? project.phase,
        lastActivity: session?.lastActivityAt ?? project.lastActivity,
        tokens:
          session
            ? session.tokenUsage.inputTokens + session.tokenUsage.outputTokens
            : project.tokenSpend,
        progress: project.progress,
      });
    } else {
      // Multiple active sessions — one entry per session
      for (let i = 0; i < activeSessions.length; i++) {
        const session = activeSessions[i];
        entries.push({
          entryKey: `${project.key}:${session.id}`,
          projectKey: project.key,
          project,
          session,
          displayName: `${project.name} #${i + 1}`,
          phase: session.phase,
          lastActivity: session.lastActivityAt,
          tokens:
            session.tokenUsage.inputTokens + session.tokenUsage.outputTokens,
          progress: project.progress,
        });
      }
    }
  }

  // Sort: autonomous first, then blocked, then idle; within same phase, most recent first
  const PHASE_ORDER: Record<AgentPhase, number> = {
    autonomous: 0,
    blocked: 1,
    review: 2,
    idle: 3,
  };
  entries.sort(
    (a, b) =>
      PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] ||
      b.lastActivity - a.lastActivity,
  );

  return entries;
}

// ---------------------------------------------------------------------------
// EntryCard
// ---------------------------------------------------------------------------

function EntryCard({
  entry,
  isSelected,
  serverName,
  onClick,
}: {
  entry: SidebarEntry;
  isSelected: boolean;
  serverName: string;
  onClick: () => void;
}) {
  const baseBorder = isSelected
    ? PHASE_BG_SELECTED[entry.phase]
    : "bg-white/[0.02] border-white/[0.06]";

  return (
    <button
      onClick={onClick}
      className={`flex flex-col gap-1.5 p-2.5 px-3 border border-l-[3px] rounded-md text-left w-full transition-all duration-150 outline-none hover:bg-white/[0.04] ${PHASE_BORDER[entry.phase]} ${baseBorder}`}
    >
      {/* Row 1: Name + Phase */}
      <div className="flex justify-between items-center">
        <span className="text-slate-200 text-[13px] font-semibold font-mono truncate">
          {entry.displayName}
        </span>
        <span
          className={`text-[10px] font-mono shrink-0 ${PHASE_TEXT[entry.phase]}`}
        >
          {PHASE_LABELS[entry.phase]}
        </span>
      </div>

      {/* Row 2: Branch + Session ID hint */}
      <div className="flex justify-between items-center">
        <span className="text-slate-500 text-[10px] font-mono truncate">
          {entry.project.branch}
        </span>
        {entry.session && (
          <span className="text-slate-600 text-[9px] font-mono">
            {entry.session.id.slice(0, 8)}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full h-[3px] bg-white/5 rounded-sm overflow-hidden">
        <div
          className={`h-full rounded-sm transition-all duration-500 ${PHASE_BAR[entry.phase]}`}
          style={{ width: `${entry.progress * 100}%`, opacity: 0.8 }}
        />
      </div>

      {/* Row 3: Stats */}
      <div className="flex justify-between text-[9px] text-slate-600">
        <span>{Math.round(entry.progress * 100)}%</span>
        <span>{timeAgo(entry.lastActivity)}</span>
        <span>{(entry.tokens / 1000).toFixed(1)}k tok</span>
      </div>

      {/* Server name */}
      {serverName && (
        <span className="text-[9px] text-slate-700 font-mono truncate">
          {serverName}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export default function ProjectSidebar() {
  const projectsMap = useProjectStore((s) => s.projects);
  const selectedKey = useProjectStore((s) => s.selectedKey);
  const selectedSessionId = useProjectStore((s) => s.selectedSessionId);
  const selectProject = useProjectStore((s) => s.selectProject);
  const clearSelection = useProjectStore((s) => s.clearSelection);
  const connections = useConnectionStore((s) => s.connections);

  const projects = useMemo(
    () => Array.from(projectsMap.values()),
    [projectsMap],
  );

  const entries = useMemo(() => buildSidebarEntries(projects), [projects]);

  function getServerName(serverId: string): string {
    return connections.get(serverId)?.name ?? "";
  }

  function isEntrySelected(entry: SidebarEntry): boolean {
    if (selectedKey !== entry.projectKey) return false;
    if (entry.session) {
      return selectedSessionId === entry.session.id;
    }
    return selectedSessionId === null;
  }

  function handleClick(entry: SidebarEntry) {
    if (isEntrySelected(entry)) {
      clearSelection();
    } else {
      selectProject(entry.projectKey, entry.session?.id ?? null);
    }
  }

  return (
    <div className="w-72 shrink-0 border-r border-surface-3 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-surface-2 font-mono">
        Projects ({entries.length})
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {entries.length === 0 && (
          <div className="text-center text-slate-600 text-xs py-8 font-mono">
            No projects connected
          </div>
        )}
        {entries.map((entry) => (
          <EntryCard
            key={entry.entryKey}
            entry={entry}
            isSelected={isEntrySelected(entry)}
            serverName={getServerName(entry.project.serverId)}
            onClick={() => handleClick(entry)}
          />
        ))}
      </div>
    </div>
  );
}
