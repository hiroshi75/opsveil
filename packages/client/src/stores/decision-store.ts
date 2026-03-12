import { create } from "zustand";
import type { DecisionItem, DecisionPriority } from "@opsveil/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DecisionEntry extends DecisionItem {
  serverId: string;
}

export interface ResolvedEntry {
  id: string;
  serverId: string;
  projectName: string;
  summary: string;
  option: string;
  resolvedAt: number;
}

interface DecisionStore {
  decisions: DecisionEntry[];
  resolvedDecisions: ResolvedEntry[];

  // Actions
  addDecision: (serverId: string, decision: DecisionItem) => void;
  removeDecision: (decisionId: string) => void;
  resolveDecision: (decisionId: string, option: string) => void;

  // Computed
  sortedDecisions: () => DecisionEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<DecisionPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useDecisionStore = create<DecisionStore>((set, get) => ({
  decisions: [],
  resolvedDecisions: [],

  addDecision(serverId: string, decision: DecisionItem) {
    set((state) => {
      // Prevent duplicates
      if (state.decisions.some((d) => d.id === decision.id)) {
        return state;
      }
      return {
        decisions: [...state.decisions, { ...decision, serverId }],
      };
    });
  },

  removeDecision(decisionId: string) {
    set((state) => ({
      decisions: state.decisions.filter((d) => d.id !== decisionId),
    }));
  },

  resolveDecision(decisionId: string, option: string) {
    const decision = get().decisions.find((d) => d.id === decisionId);
    set((state) => ({
      decisions: state.decisions.filter((d) => d.id !== decisionId),
      resolvedDecisions: [
        ...state.resolvedDecisions,
        {
          id: decisionId,
          serverId: decision?.serverId ?? "",
          projectName: decision?.projectName ?? "",
          summary: decision?.summary ?? "",
          option,
          resolvedAt: Date.now(),
        },
      ],
    }));
  },

  sortedDecisions(): DecisionEntry[] {
    return [...get().decisions].sort(
      (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
    );
  },
}));
