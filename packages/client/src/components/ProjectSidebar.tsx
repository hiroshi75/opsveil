import { useProjectStore, type ProjectEntry } from "../stores/project-store";
import { useConnectionStore } from "../stores/connection-store";
import type { AgentPhase } from "@opsveil/shared";

// ---------------------------------------------------------------------------
// Phase config
// ---------------------------------------------------------------------------

const PHASE_LABELS: Record<AgentPhase, string> = {
  autonomous: "\u81EA\u5F8B\u9032\u884C\u4E2D",
  blocked: "\u5224\u65AD\u5F85\u3061",
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
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

// ---------------------------------------------------------------------------
// ProjectCard
// ---------------------------------------------------------------------------

function ProjectCard({
  project,
  isSelected,
  serverName,
  onClick,
}: {
  project: ProjectEntry;
  isSelected: boolean;
  serverName: string;
  onClick: () => void;
}) {
  const baseBorder = isSelected
    ? PHASE_BG_SELECTED[project.phase]
    : "bg-white/[0.02] border-white/[0.06]";

  return (
    <button
      onClick={onClick}
      className={`flex flex-col gap-1.5 p-2.5 px-3 border border-l-[3px] rounded-md text-left w-full transition-all duration-150 outline-none hover:bg-white/[0.04] ${PHASE_BORDER[project.phase]} ${baseBorder}`}
    >
      {/* Row 1: Name + Phase */}
      <div className="flex justify-between items-center">
        <span className="text-slate-200 text-[13px] font-semibold font-mono truncate">
          {project.name}
        </span>
        <span
          className={`text-[10px] font-mono shrink-0 ${PHASE_TEXT[project.phase]}`}
        >
          {PHASE_LABELS[project.phase]}
        </span>
      </div>

      {/* Row 2: Branch + Agent count */}
      <div className="flex justify-between items-center">
        <span className="text-slate-500 text-[10px] font-mono truncate">
          {project.branch}
        </span>
        <span className="text-slate-500 text-[10px]">
          {project.agentCount > 0
            ? `${project.agentCount} agent${project.agentCount > 1 ? "s" : ""}`
            : "idle"}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-[3px] bg-white/5 rounded-sm overflow-hidden">
        <div
          className={`h-full rounded-sm transition-all duration-500 ${PHASE_BAR[project.phase]}`}
          style={{ width: `${project.progress * 100}%`, opacity: 0.8 }}
        />
      </div>

      {/* Row 3: Stats */}
      <div className="flex justify-between text-[9px] text-slate-600">
        <span>{Math.round(project.progress * 100)}%</span>
        <span>{timeAgo(project.lastActivity)}</span>
        <span>{(project.tokenSpend / 1000).toFixed(1)}k tok</span>
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
  const allProjects = useProjectStore((s) => s.allProjects);
  const selectedKey = useProjectStore((s) => s.selectedKey);
  const selectProject = useProjectStore((s) => s.selectProject);
  const clearSelection = useProjectStore((s) => s.clearSelection);
  const connections = useConnectionStore((s) => s.connections);

  const projects = allProjects();

  function getServerName(serverId: string): string {
    return connections.get(serverId)?.name ?? "";
  }

  return (
    <div className="w-72 shrink-0 border-r border-surface-3 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-surface-2 font-mono">
        Projects ({projects.length})
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {projects.length === 0 && (
          <div className="text-center text-slate-600 text-xs py-8 font-mono">
            No projects connected
          </div>
        )}
        {projects.map((project) => (
          <ProjectCard
            key={project.key}
            project={project}
            isSelected={selectedKey === project.key}
            serverName={getServerName(project.serverId)}
            onClick={() =>
              selectedKey === project.key
                ? clearSelection()
                : selectProject(project.key)
            }
          />
        ))}
      </div>
    </div>
  );
}
