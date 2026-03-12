import { create } from "zustand";
import type { AgentPhase, ProjectState } from "@opsveil/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectEntry extends ProjectState {
  serverId: string;
  /** Composite key: serverId:projectId */
  key: string;
}

interface ProjectStore {
  /** Projects keyed by "serverId:projectId" */
  projects: Map<string, ProjectEntry>;
  selectedKey: string | null;

  // Actions
  setProjects: (serverId: string, projects: ProjectState[]) => void;
  updateProject: (serverId: string, project: ProjectState) => void;
  selectProject: (key: string) => void;
  clearSelection: () => void;

  // Computed helpers
  allProjects: () => ProjectEntry[];
  projectsByPhase: (phase: AgentPhase) => ProjectEntry[];
  selectedProject: () => ProjectEntry | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKey(serverId: string, projectId: string): string {
  return `${serverId}:${projectId}`;
}

function toEntry(serverId: string, project: ProjectState): ProjectEntry {
  return {
    ...project,
    serverId,
    key: makeKey(serverId, project.id),
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: new Map(),
  selectedKey: null,

  setProjects(serverId: string, projects: ProjectState[]) {
    set((state) => {
      const next = new Map(state.projects);
      // Remove existing projects for this server
      for (const [key] of next) {
        if (key.startsWith(`${serverId}:`)) {
          next.delete(key);
        }
      }
      // Add new ones
      for (const p of projects) {
        const entry = toEntry(serverId, p);
        next.set(entry.key, entry);
      }
      return { projects: next };
    });
  },

  updateProject(serverId: string, project: ProjectState) {
    set((state) => {
      const next = new Map(state.projects);
      const entry = toEntry(serverId, project);
      next.set(entry.key, entry);
      return { projects: next };
    });
  },

  selectProject(key: string) {
    set({ selectedKey: key });
  },

  clearSelection() {
    set({ selectedKey: null });
  },

  allProjects(): ProjectEntry[] {
    return Array.from(get().projects.values()).sort(
      (a, b) => b.lastActivity - a.lastActivity,
    );
  },

  projectsByPhase(phase: AgentPhase): ProjectEntry[] {
    return get()
      .allProjects()
      .filter((p) => p.phase === phase);
  },

  selectedProject(): ProjectEntry | null {
    const { selectedKey, projects } = get();
    if (!selectedKey) return null;
    return projects.get(selectedKey) ?? null;
  },
}));
