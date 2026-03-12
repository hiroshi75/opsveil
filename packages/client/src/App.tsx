import { useState, useEffect } from "react";
import { useConnectionStore } from "./stores/connection-store";
import { useDecisionStore } from "./stores/decision-store";
import { useProjectStore } from "./stores/project-store";
import TopBar from "./components/TopBar";
import ProjectSidebar from "./components/ProjectSidebar";
import DecisionQueue from "./components/DecisionQueue";
import ActivityFeed from "./components/ActivityFeed";
import DetailPanel from "./components/DetailPanel";

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

type CenterTab = "decisions" | "activity";

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [activeTab, setActiveTab] = useState<CenterTab>("decisions");
  const connections = useConnectionStore((s) => s.connections);
  const decisions = useDecisionStore((s) => s.decisions);
  const selectedKey = useProjectStore((s) => s.selectedKey);
  const projectsMap = useProjectStore((s) => s.projects);

  const project = selectedKey ? projectsMap.get(selectedKey) ?? null : null;

  // Load persisted servers on mount and auto-connect them once
  useEffect(() => {
    useConnectionStore.getState()._loadServers();
    // Auto-connect after a tick so loadServers state is committed
    const timer = setTimeout(() => {
      const conns = useConnectionStore.getState().connections;
      for (const [id, conn] of conns) {
        if (conn.status === "disconnected") {
          useConnectionStore.getState().connect(id);
        }
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="w-full min-h-screen bg-surface-0 text-slate-200 font-sans flex flex-col">
      {/* Top Bar */}
      <TopBar />

      {/* Main 3-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <ProjectSidebar />

        {/* Center panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-surface-3">
            {(
              [
                {
                  key: "decisions" as CenterTab,
                  label: `\u5224\u65AD\u30AD\u30E5\u30FC (${decisions.length})`,
                  hasAlert: decisions.length > 0,
                },
                {
                  key: "activity" as CenterTab,
                  label: "\u30A2\u30AF\u30C6\u30A3\u30D3\u30C6\u30A3",
                  hasAlert: false,
                },
              ]
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-5 py-2.5 border-none text-xs font-semibold cursor-pointer font-mono transition-all duration-150 outline-none ${
                  activeTab === tab.key
                    ? "bg-white/[0.03] text-slate-200 border-b-2 border-b-accent"
                    : "bg-transparent text-slate-500 border-b-2 border-b-transparent hover:text-slate-400"
                }`}
              >
                {tab.hasAlert && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-phase-blocked mr-1.5 animate-pulse-dot" />
                )}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === "decisions" && <DecisionQueue />}
            {activeTab === "activity" && <ActivityFeed />}
          </div>
        </div>

        {/* Right detail panel (shown when project selected) */}
        {project && <DetailPanel />}
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-surface-1 border-t border-surface-3 text-[10px] font-mono text-slate-600">
        <span>
          {Array.from(connections.values()).filter((c) => c.status === "connected").length}{" "}
          / {connections.size} servers connected
        </span>
        <span>OpsVeil v0.1.0</span>
      </div>
    </div>
  );
}
