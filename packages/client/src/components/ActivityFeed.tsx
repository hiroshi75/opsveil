import {
  useActivityStore,
  type ActivityEntryWithServer,
} from "../stores/activity-store";
import type { ActivityType } from "@opsveil/shared";

// ---------------------------------------------------------------------------
// Color config
// ---------------------------------------------------------------------------

const TYPE_DOT_COLOR: Record<ActivityType, string> = {
  commit: "bg-phase-autonomous",
  blocked: "bg-phase-blocked",
  running: "bg-accent",
  tool_use: "bg-purple-400",
  error: "bg-phase-blocked",
  decision_resolved: "bg-phase-autonomous",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ---------------------------------------------------------------------------
// Entry row
// ---------------------------------------------------------------------------

function ActivityRow({ entry }: { entry: ActivityEntryWithServer }) {
  return (
    <div className="flex gap-2.5 py-1.5 text-[11px] border-b border-white/[0.03] items-baseline">
      <span className="text-slate-600 font-mono w-[60px] shrink-0">
        {formatTime(entry.timestamp)}
      </span>
      <span
        className={`w-1 h-1 rounded-full shrink-0 mt-[5px] ${TYPE_DOT_COLOR[entry.type] ?? "bg-slate-600"}`}
      />
      <span className="text-slate-400 font-mono">
        <span className="text-slate-500">{entry.projectName}</span>{" "}
        {entry.action}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full feed (for center panel)
// ---------------------------------------------------------------------------

export default function ActivityFeed() {
  const entries = useActivityStore((s) => s.entries);

  return (
    <div className="flex flex-col max-w-[700px]">
      {entries.length === 0 ? (
        <div className="text-center py-16 text-slate-600 text-xs font-mono">
          No activity yet
        </div>
      ) : (
        entries.map((entry) => <ActivityRow key={entry.id} entry={entry} />)
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filtered feed (for detail panel)
// ---------------------------------------------------------------------------

export function ProjectActivityFeed({ projectId }: { projectId: string }) {
  const filterByProject = useActivityStore((s) => s.filterByProject);
  const entries = filterByProject(projectId);

  return (
    <div className="flex flex-col">
      {entries.length === 0 ? (
        <div className="text-slate-600 text-[10px] font-mono py-4">
          No activity for this project
        </div>
      ) : (
        entries.map((entry) => <ActivityRow key={entry.id} entry={entry} />)
      )}
    </div>
  );
}
