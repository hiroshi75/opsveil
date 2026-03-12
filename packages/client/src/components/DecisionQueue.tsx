import { useState } from "react";
import { useDecisionStore, type DecisionEntry } from "../stores/decision-store";
import { useRpc } from "../hooks/use-rpc";
import type { DecisionPriority } from "@opsveil/shared";

// ---------------------------------------------------------------------------
// Priority config
// ---------------------------------------------------------------------------

const PRIORITY_STYLES: Record<DecisionPriority, string> = {
  high: "text-phase-blocked bg-red-500/[0.08]",
  medium: "text-phase-review bg-amber-500/[0.08]",
  low: "text-phase-idle bg-gray-500/[0.08]",
};

// ---------------------------------------------------------------------------
// DecisionCard
// ---------------------------------------------------------------------------

function DecisionCard({
  decision,
  onResolve,
}: {
  decision: DecisionEntry;
  onResolve: (decisionId: string, option: string) => void;
}) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded font-mono ${PRIORITY_STYLES[decision.priority]}`}
            >
              {decision.priority}
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              {decision.projectName}
            </span>
            <span className="text-[10px] text-slate-600">
              ~{decision.estimatedTime}
            </span>
          </div>
          <div className="text-slate-200 text-sm font-semibold">
            {decision.summary}
          </div>
        </div>
      </div>

      {/* Agent Note */}
      <div className="bg-accent/[0.06] border border-accent/[0.15] rounded-md px-3 py-2.5 text-xs text-accent-light leading-relaxed font-mono">
        <span className="text-[10px] text-accent mr-1.5">AGENT:</span>
        {decision.agentNote}
      </div>

      {/* Expandable Detail */}
      <button
        onClick={() => setShowDetail(!showDetail)}
        className="bg-transparent border-none text-slate-500 text-[11px] cursor-pointer text-left p-0 font-mono hover:text-slate-400 transition-colors"
      >
        {showDetail ? "\u25BC" : "\u25B6"} \u8A73\u7D30
      </button>
      {showDetail && (
        <div className="text-slate-400 text-xs leading-relaxed pl-3 border-l-2 border-white/[0.06]">
          {decision.detail}
        </div>
      )}

      {/* Options */}
      <div className="flex flex-col gap-1.5">
        {decision.options.map((opt) => {
          const isSelected = selectedOption === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setSelectedOption(opt.key)}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-md border text-left transition-all duration-100 outline-none cursor-pointer ${
                isSelected
                  ? "bg-accent/[0.12] border-accent/40"
                  : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]"
              }`}
            >
              <span
                className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold font-mono shrink-0 ${
                  isSelected
                    ? "bg-accent text-white"
                    : "bg-white/[0.06] text-slate-500"
                }`}
              >
                {opt.key}
              </span>
              <span className="text-slate-200 text-[13px] flex-1">
                {opt.label}
              </span>
              {/* Confidence bar */}
              <div className="w-[50px] h-1 bg-white/[0.06] rounded-sm overflow-hidden">
                <div
                  className={`h-full rounded-sm ${
                    opt.confidence > 0.5
                      ? "bg-phase-autonomous"
                      : opt.confidence > 0.3
                        ? "bg-phase-review"
                        : "bg-phase-idle"
                  }`}
                  style={{ width: `${opt.confidence * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-600 font-mono w-[30px] text-right">
                {Math.round(opt.confidence * 100)}%
              </span>
            </button>
          );
        })}
      </div>

      {/* Submit */}
      {selectedOption && (
        <button
          onClick={() => onResolve(decision.id, selectedOption)}
          className="self-end px-5 py-2.5 bg-gradient-to-br from-accent to-accent-dark border-none rounded-md text-white text-[13px] font-semibold cursor-pointer font-mono transition-transform duration-100 hover:scale-[1.02] active:scale-[0.98]"
        >
          {selectedOption}\u6848\u3067\u9001\u4FE1 \u2192
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DecisionQueue
// ---------------------------------------------------------------------------

export default function DecisionQueue() {
  const sortedDecisions = useDecisionStore((s) => s.sortedDecisions);
  const resolveDecision = useDecisionStore((s) => s.resolveDecision);
  const resolvedDecisions = useDecisionStore((s) => s.resolvedDecisions);
  const { rpc } = useRpc();

  const decisions = sortedDecisions();

  function handleResolve(decisionId: string, option: string) {
    // Optimistic local update
    resolveDecision(decisionId, option);

    // Send to server (fire and forget)
    const decision = decisions.find((d) => d.id === decisionId);
    if (decision) {
      rpc(
        "decisions.resolve",
        { decisionId, option },
        decision.serverId,
      ).catch(() => {
        // Silently fail -- server will reconcile
      });
    }
  }

  return (
    <div className="flex flex-col gap-3 max-w-[700px]">
      {/* Active decisions */}
      {decisions.length === 0 ? (
        <div className="text-center py-16 text-slate-600 text-[13px]">
          <div className="text-3xl mb-3 text-phase-autonomous">{"\u2713"}</div>
          <div className="font-semibold mb-1">
            {"\u5168\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u81EA\u5F8B\u9032\u884C\u4E2D"}
          </div>
          <div className="text-[11px]">
            {"\u5224\u65AD\u5F85\u3061\u306E\u9805\u76EE\u306F\u3042\u308A\u307E\u305B\u3093"}
          </div>
        </div>
      ) : (
        decisions.map((d) => (
          <DecisionCard key={d.id} decision={d} onResolve={handleResolve} />
        ))
      )}

      {/* Resolved decisions */}
      {resolvedDecisions.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/[0.06]">
          <div className="text-[11px] text-slate-600 mb-2 font-mono">
            RESOLVED ({resolvedDecisions.length})
          </div>
          {resolvedDecisions.map((r) => (
            <div
              key={r.id}
              className="px-3 py-2 bg-green-500/5 border border-green-500/[0.15] rounded-md text-xs text-phase-autonomous mb-1 font-mono"
            >
              {"\u2713"} {r.projectName}: {r.summary} {"\u2192"} {r.option}
              {"\u6848"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
