import { create } from "zustand";
import type { DecisionItem, DecisionPriority } from "@opsveil/shared";
import type { HookStopParams } from "../lib/state-interpreter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DecisionEntry extends DecisionItem {
  serverId: string;
  /** Original params for re-interpretation when language changes */
  sourceParams?: HookStopParams;
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
  addDecision: (serverId: string, decision: DecisionItem, sourceParams?: HookStopParams) => void;
  updateDecision: (decisionId: string, updates: Partial<DecisionItem>) => void;
  removeDecision: (decisionId: string) => void;
  dismissDecision: (decisionId: string) => void;
  dismissByProject: (projectId: string) => void;
  dismissBySession: (sessionId: string) => void;
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

  addDecision(serverId: string, decision: DecisionItem, sourceParams?: HookStopParams) {
    set((state) => {
      // Prevent duplicates
      if (state.decisions.some((d) => d.id === decision.id)) {
        return state;
      }
      return {
        decisions: [...state.decisions, { ...decision, serverId, sourceParams }],
      };
    });
  },

  updateDecision(decisionId: string, updates: Partial<DecisionItem>) {
    set((state) => ({
      decisions: state.decisions.map((d) =>
        d.id === decisionId ? { ...d, ...updates } : d,
      ),
    }));
  },

  removeDecision(decisionId: string) {
    set((state) => ({
      decisions: state.decisions.filter((d) => d.id !== decisionId),
    }));
  },

  dismissDecision(decisionId: string) {
    set((state) => ({
      decisions: state.decisions.filter((d) => d.id !== decisionId),
    }));
  },

  dismissByProject(projectId: string) {
    set((state) => ({
      decisions: state.decisions.filter((d) => d.projectId !== projectId),
    }));
  },

  dismissBySession(sessionId: string) {
    set((state) => ({
      decisions: state.decisions.filter((d) => d.sessionId !== sessionId),
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
