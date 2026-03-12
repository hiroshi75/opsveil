import { create } from "zustand";
import type { ActivityEntry } from "@opsveil/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivityEntryWithServer extends ActivityEntry {
  serverId: string;
}

interface ActivityStore {
  entries: ActivityEntryWithServer[];

  // Actions
  addEntry: (serverId: string, entry: ActivityEntry) => void;
  clear: () => void;

  // Computed
  filterByProject: (projectId: string) => ActivityEntryWithServer[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 500;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useActivityStore = create<ActivityStore>((set, get) => ({
  entries: [],

  addEntry(serverId: string, entry: ActivityEntry) {
    set((state) => {
      const updated = [{ ...entry, serverId }, ...state.entries];
      if (updated.length > MAX_ENTRIES) {
        return { entries: updated.slice(0, MAX_ENTRIES) };
      }
      return { entries: updated };
    });
  },

  clear() {
    set({ entries: [] });
  },

  filterByProject(projectId: string): ActivityEntryWithServer[] {
    return get().entries.filter((e) => e.projectId === projectId);
  },
}));
