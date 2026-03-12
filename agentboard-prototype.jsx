import { useState, useEffect, useCallback } from "react";

// ============================================================
// AgentBoard - Agent Command Center IDE Prototype
// ============================================================

// Mock data simulating what the server would provide
const MOCK_PROJECTS = [
  {
    id: "repoton",
    name: "Repoton",
    branch: "main",
    phase: "autonomous",
    agentCount: 2,
    lastActivity: Date.now() - 45000,
    tokenSpend: 12840,
    progress: 0.35,
    description: "Agent-native Git hosting platform",
  },
  {
    id: "bizcruncher-agent-api",
    name: "BizCruncher Agent API",
    branch: "feature/agent-auth",
    phase: "blocked",
    agentCount: 1,
    lastActivity: Date.now() - 5000,
    tokenSpend: 8920,
    progress: 0.72,
    description: "Agent API key authentication layer",
  },
  {
    id: "nexus-shell",
    name: "NEXUS Shell",
    branch: "dev",
    phase: "autonomous",
    agentCount: 1,
    lastActivity: Date.now() - 120000,
    tokenSpend: 5340,
    progress: 0.55,
    description: "SF-aesthetic GUI shell (C++/raylib)",
  },
  {
    id: "electron-terminal",
    name: "Electron Terminal",
    branch: "feature/heatmap",
    phase: "review",
    agentCount: 1,
    lastActivity: Date.now() - 300000,
    tokenSpend: 15200,
    progress: 0.88,
    description: "Terminal app with heatmap minimap",
  },
  {
    id: "palib",
    name: "palib",
    branch: "main",
    phase: "autonomous",
    agentCount: 3,
    lastActivity: Date.now() - 20000,
    tokenSpend: 22100,
    progress: 0.45,
    description: "Common library for agent/patent/trading",
  },
  {
    id: "cultchain",
    name: "CULTCHAIN",
    branch: "feature/arweave-integration",
    phase: "idle",
    agentCount: 0,
    lastActivity: Date.now() - 3600000,
    tokenSpend: 3200,
    progress: 0.6,
    description: "Blockchain digital culture preservation",
  },
  {
    id: "trading-bot",
    name: "J-Quants Trading",
    branch: "strategy/event-driven",
    phase: "autonomous",
    agentCount: 1,
    lastActivity: Date.now() - 90000,
    tokenSpend: 7650,
    progress: 0.25,
    description: "Event-driven strategy for JP equities",
  },
  {
    id: "patent-search",
    name: "Patent Search Pipeline",
    branch: "main",
    phase: "blocked",
    agentCount: 1,
    lastActivity: Date.now() - 15000,
    tokenSpend: 11300,
    progress: 0.82,
    description: "Multi-stage LLM patent search",
  },
  {
    id: "openclaw-config",
    name: "OpenClaw Config",
    branch: "experiment/multi-model",
    phase: "review",
    agentCount: 1,
    lastActivity: Date.now() - 600000,
    tokenSpend: 4100,
    progress: 0.92,
    description: "Multi-model routing optimization",
  },
  {
    id: "agentboard",
    name: "AgentBoard",
    branch: "main",
    phase: "autonomous",
    agentCount: 1,
    lastActivity: Date.now() - 10000,
    tokenSpend: 1800,
    progress: 0.08,
    description: "This IDE itself (meta!)",
  },
];

const MOCK_DECISIONS = [
  {
    id: "d1",
    projectId: "bizcruncher-agent-api",
    project: "BizCruncher Agent API",
    summary: "API key hashing algorithm selection",
    detail: "Agent API key authentication: bcrypt vs argon2 for key hashing. Agent keys will be validated on every request, so performance matters.",
    options: [
      { key: "A", label: "bcrypt (battle-tested, slower)", confidence: 0.4 },
      { key: "B", label: "argon2id (modern, faster verify)", confidence: 0.6 },
    ],
    estimatedTime: "30s",
    priority: "high",
    timestamp: Date.now() - 5000,
    agentNote: "argon2idが推奨。verify速度がbcryptの3倍。ただしbcryptのほうが実績あり。",
  },
  {
    id: "d2",
    projectId: "patent-search",
    project: "Patent Search Pipeline",
    summary: "Search result ranking: BM25 vs hybrid",
    detail: "Patent search results ranking method. BM25 alone misses semantic matches. Hybrid adds vector similarity but doubles latency.",
    options: [
      { key: "A", label: "BM25 only (fast, keyword-based)", confidence: 0.3 },
      { key: "B", label: "Hybrid BM25+Vector (slower, better recall)", confidence: 0.55 },
      { key: "C", label: "Two-pass: BM25 first, re-rank top-50 with vector", confidence: 0.15 },
    ],
    estimatedTime: "2min",
    priority: "high",
    timestamp: Date.now() - 15000,
    agentNote: "Hybridが一般的だが、特許検索ではキーワード精度が高いためBM25も有力。Two-passはレイテンシと精度のバランスが良いが実装が複雑。",
  },
  {
    id: "d3",
    projectId: "electron-terminal",
    project: "Electron Terminal",
    summary: "Heatmap color scheme review",
    detail: "The inverse-activity heatmap minimap is implemented. Please review the color gradient.",
    options: [
      { key: "A", label: "Approve current (blue→red)", confidence: 0.7 },
      { key: "B", label: "Switch to green→yellow→red", confidence: 0.2 },
    ],
    estimatedTime: "30s",
    priority: "medium",
    hasScreenshot: true,
    timestamp: Date.now() - 300000,
    agentNote: "現在のblue→red gradientは視認性が高い。色覚多様性を考慮するならgreen系は避けたほうが良い。",
  },
  {
    id: "d4",
    projectId: "openclaw-config",
    project: "OpenClaw Config",
    summary: "Cost threshold for model fallback",
    detail: "When should the orchestrator fall back from Claude Sonnet to Haiku? Need to set the token-cost threshold per task.",
    options: [
      { key: "A", label: "$0.05/task threshold", confidence: 0.3 },
      { key: "B", label: "$0.10/task threshold", confidence: 0.5 },
      { key: "C", label: "Dynamic (based on task complexity score)", confidence: 0.2 },
    ],
    estimatedTime: "2min",
    priority: "low",
    timestamp: Date.now() - 600000,
    agentNote: "Dynamic routingが理想だが、まずは固定閾値で検証してからでよいと思う。",
  },
];

const MOCK_ACTIVITY_LOG = [
  { time: "14:32:05", project: "palib", action: "Committed: refactor credential store interface", type: "commit" },
  { time: "14:31:42", project: "BizCruncher Agent API", action: "⏸ Waiting: API key hashing algorithm decision", type: "blocked" },
  { time: "14:31:20", project: "Repoton", action: "Running: integration test suite (47/120 passed)", type: "running" },
  { time: "14:30:55", project: "Patent Search Pipeline", action: "⏸ Waiting: search ranking method decision", type: "blocked" },
  { time: "14:30:12", project: "J-Quants Trading", action: "Analyzing: sector rotation signals for March", type: "running" },
  { time: "14:29:48", project: "AgentBoard", action: "Implementing: WebSocket connection handler", type: "running" },
  { time: "14:28:33", project: "palib", action: "Committed: add async retry decorator", type: "commit" },
  { time: "14:27:01", project: "Repoton", action: "Committed: agent permission model schema", type: "commit" },
  { time: "14:25:15", project: "NEXUS Shell", action: "Building: window compositor module", type: "running" },
];

// ============================================================
// Components
// ============================================================

const phaseConfig = {
  autonomous: { color: "#22c55e", bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.25)", label: "自律進行中", icon: "●" },
  blocked: { color: "#ef4444", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.3)", label: "判断待ち", icon: "◼" },
  review: { color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)", label: "レビュー待ち", icon: "◆" },
  idle: { color: "#6b7280", bg: "rgba(107,114,128,0.08)", border: "rgba(107,114,128,0.2)", label: "停止中", icon: "○" },
};

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function ProjectCard({ project, isSelected, onClick }) {
  const phase = phaseConfig[project.phase];
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "10px 12px",
        background: isSelected ? phase.bg : "rgba(255,255,255,0.02)",
        border: `1px solid ${isSelected ? phase.border : "rgba(255,255,255,0.06)"}`,
        borderLeft: `3px solid ${phase.color}`,
        borderRadius: "6px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        transition: "all 0.15s ease",
        outline: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#e2e8f0", fontSize: "13px", fontWeight: 600, fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
          {project.name}
        </span>
        <span style={{ color: phase.color, fontSize: "10px", fontFamily: "'JetBrains Mono', monospace" }}>
          {phase.icon} {phase.label}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#64748b", fontSize: "10px", fontFamily: "'JetBrains Mono', monospace" }}>
          {project.branch}
        </span>
        <span style={{ color: "#64748b", fontSize: "10px" }}>
          {project.agentCount > 0 ? `${project.agentCount} agent${project.agentCount > 1 ? "s" : ""}` : "idle"}
        </span>
      </div>
      {/* Progress bar */}
      <div style={{ width: "100%", height: "3px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden" }}>
        <div style={{
          width: `${project.progress * 100}%`,
          height: "100%",
          background: `linear-gradient(90deg, ${phase.color}88, ${phase.color})`,
          borderRadius: "2px",
          transition: "width 0.5s ease",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#475569" }}>
        <span>{Math.round(project.progress * 100)}%</span>
        <span>{timeAgo(project.lastActivity)}</span>
        <span>{(project.tokenSpend / 1000).toFixed(1)}k tok</span>
      </div>
    </button>
  );
}

function DecisionCard({ decision, onDecide }) {
  const [selectedOption, setSelectedOption] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const priorityColors = { high: "#ef4444", medium: "#f59e0b", low: "#6b7280" };

  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: "8px",
      padding: "16px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{
              fontSize: "9px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: priorityColors[decision.priority],
              background: `${priorityColors[decision.priority]}15`,
              padding: "2px 6px",
              borderRadius: "3px",
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {decision.priority}
            </span>
            <span style={{ fontSize: "11px", color: "#64748b", fontFamily: "'JetBrains Mono', monospace" }}>
              {decision.project}
            </span>
            <span style={{ fontSize: "10px", color: "#475569" }}>
              ~{decision.estimatedTime}
            </span>
          </div>
          <div style={{ color: "#e2e8f0", fontSize: "14px", fontWeight: 600 }}>
            {decision.summary}
          </div>
        </div>
      </div>

      {/* Agent Note */}
      <div style={{
        background: "rgba(99,102,241,0.06)",
        border: "1px solid rgba(99,102,241,0.15)",
        borderRadius: "6px",
        padding: "10px 12px",
        fontSize: "12px",
        color: "#a5b4fc",
        lineHeight: "1.5",
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        <span style={{ fontSize: "10px", color: "#6366f1", marginRight: "6px" }}>AGENT:</span>
        {decision.agentNote}
      </div>

      {/* Expandable Detail */}
      <button
        onClick={() => setShowDetail(!showDetail)}
        style={{
          background: "none",
          border: "none",
          color: "#64748b",
          fontSize: "11px",
          cursor: "pointer",
          textAlign: "left",
          padding: "0",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {showDetail ? "▼" : "▶"} 詳細
      </button>
      {showDetail && (
        <div style={{ color: "#94a3b8", fontSize: "12px", lineHeight: "1.6", paddingLeft: "12px", borderLeft: "2px solid rgba(255,255,255,0.06)" }}>
          {decision.detail}
        </div>
      )}

      {/* Options */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {decision.options.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setSelectedOption(opt.key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 14px",
              background: selectedOption === opt.key ? "rgba(99,102,241,0.12)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${selectedOption === opt.key ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.06)"}`,
              borderRadius: "6px",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.1s ease",
              outline: "none",
            }}
          >
            <span style={{
              width: "24px",
              height: "24px",
              borderRadius: "4px",
              background: selectedOption === opt.key ? "#6366f1" : "rgba(255,255,255,0.06)",
              color: selectedOption === opt.key ? "#fff" : "#64748b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              flexShrink: 0,
            }}>
              {opt.key}
            </span>
            <span style={{ color: "#e2e8f0", fontSize: "13px", flex: 1 }}>{opt.label}</span>
            {/* Confidence bar */}
            <div style={{ width: "50px", height: "4px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{
                width: `${opt.confidence * 100}%`,
                height: "100%",
                background: opt.confidence > 0.5 ? "#22c55e" : opt.confidence > 0.3 ? "#f59e0b" : "#64748b",
                borderRadius: "2px",
              }} />
            </div>
            <span style={{ fontSize: "10px", color: "#475569", fontFamily: "'JetBrains Mono', monospace", width: "30px", textAlign: "right" }}>
              {Math.round(opt.confidence * 100)}%
            </span>
          </button>
        ))}
      </div>

      {/* Submit */}
      {selectedOption && (
        <button
          onClick={() => onDecide(decision.id, selectedOption)}
          style={{
            padding: "10px 20px",
            background: "linear-gradient(135deg, #6366f1, #4f46e5)",
            border: "none",
            borderRadius: "6px",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
            alignSelf: "flex-end",
            fontFamily: "'JetBrains Mono', monospace",
            transition: "transform 0.1s ease",
          }}
        >
          {selectedOption}案で送信 →
        </button>
      )}
    </div>
  );
}

function ActivityFeed({ log }) {
  const typeColors = {
    commit: "#22c55e",
    blocked: "#ef4444",
    running: "#6366f1",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      {log.map((entry, i) => (
        <div key={i} style={{
          display: "flex",
          gap: "10px",
          padding: "6px 0",
          fontSize: "11px",
          borderBottom: "1px solid rgba(255,255,255,0.03)",
          alignItems: "baseline",
        }}>
          <span style={{ color: "#475569", fontFamily: "'JetBrains Mono', monospace", width: "60px", flexShrink: 0 }}>
            {entry.time}
          </span>
          <span style={{
            width: "4px",
            height: "4px",
            borderRadius: "50%",
            background: typeColors[entry.type] || "#475569",
            flexShrink: 0,
            marginTop: "5px",
          }} />
          <span style={{ color: "#94a3b8", fontFamily: "'JetBrains Mono', monospace" }}>
            <span style={{ color: "#64748b" }}>{entry.project}</span>{" "}
            {entry.action}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Main App
// ============================================================

export default function AgentBoard() {
  const [selectedProject, setSelectedProject] = useState(null);
  const [decisions, setDecisions] = useState(MOCK_DECISIONS);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [activeTab, setActiveTab] = useState("decisions"); // decisions | activity | detail
  const [resolvedDecisions, setResolvedDecisions] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 5000);
    return () => clearInterval(interval);
  }, []);

  const handleDecide = useCallback((decisionId, option) => {
    setResolvedDecisions(prev => [...prev, { id: decisionId, option, time: Date.now() }]);
    setDecisions(prev => prev.filter(d => d.id !== decisionId));
  }, []);

  const blockedCount = MOCK_PROJECTS.filter(p => p.phase === "blocked").length;
  const reviewCount = MOCK_PROJECTS.filter(p => p.phase === "review").length;
  const autonomousCount = MOCK_PROJECTS.filter(p => p.phase === "autonomous").length;
  const totalAgents = MOCK_PROJECTS.reduce((sum, p) => sum + p.agentCount, 0);
  const totalTokens = MOCK_PROJECTS.reduce((sum, p) => sum + p.tokenSpend, 0);

  const sortedDecisions = [...decisions].sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  return (
    <div style={{
      width: "100%",
      minHeight: "100vh",
      background: "#0a0e17",
      color: "#e2e8f0",
      fontFamily: "'Inter', -apple-system, sans-serif",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Top Bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 20px",
        background: "rgba(255,255,255,0.02)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{
            fontSize: "16px",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            background: "linear-gradient(135deg, #6366f1, #a855f7)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          }}>
            AgentBoard
          </span>
          <span style={{ color: "#475569", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" }}>
            v0.1.0-prototype
          </span>
        </div>
        {/* Status summary */}
        <div style={{ display: "flex", gap: "16px", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" }}>
          <span style={{ color: "#ef4444" }}>◼ {blockedCount} blocked</span>
          <span style={{ color: "#f59e0b" }}>◆ {reviewCount} review</span>
          <span style={{ color: "#22c55e" }}>● {autonomousCount} auto</span>
          <span style={{ color: "#64748b" }}>│</span>
          <span style={{ color: "#94a3b8" }}>{totalAgents} agents</span>
          <span style={{ color: "#94a3b8" }}>{(totalTokens / 1000).toFixed(0)}k tokens</span>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left Panel: Layer 1 - Project Overview */}
        <div style={{
          width: "280px",
          flexShrink: 0,
          borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          <div style={{
            padding: "12px 16px",
            fontSize: "11px",
            fontWeight: 700,
            color: "#64748b",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            Projects ({MOCK_PROJECTS.length})
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
            {MOCK_PROJECTS.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                isSelected={selectedProject === project.id}
                onClick={() => setSelectedProject(selectedProject === project.id ? null : project.id)}
              />
            ))}
          </div>
        </div>

        {/* Center: Layer 2 - Decision Queue + Activity */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Tabs */}
          <div style={{
            display: "flex",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}>
            {[
              { key: "decisions", label: `判断キュー (${decisions.length})`, color: decisions.length > 0 ? "#ef4444" : "#64748b" },
              { key: "activity", label: "アクティビティ", color: "#64748b" },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: "10px 20px",
                  background: activeTab === tab.key ? "rgba(255,255,255,0.03)" : "transparent",
                  border: "none",
                  borderBottom: activeTab === tab.key ? "2px solid #6366f1" : "2px solid transparent",
                  color: activeTab === tab.key ? "#e2e8f0" : "#64748b",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace",
                  transition: "all 0.15s ease",
                  outline: "none",
                }}
              >
                {tab.key === "decisions" && decisions.length > 0 && (
                  <span style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: tab.color,
                    marginRight: "6px",
                    animation: "pulse 2s infinite",
                  }} />
                )}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
            {activeTab === "decisions" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "700px" }}>
                {sortedDecisions.length === 0 ? (
                  <div style={{
                    textAlign: "center",
                    padding: "60px 20px",
                    color: "#475569",
                    fontSize: "13px",
                  }}>
                    <div style={{ fontSize: "32px", marginBottom: "12px" }}>✓</div>
                    <div style={{ fontWeight: 600, marginBottom: "4px" }}>全エージェント自律進行中</div>
                    <div style={{ fontSize: "11px" }}>判断待ちの項目はありません</div>
                  </div>
                ) : (
                  sortedDecisions.map(d => (
                    <DecisionCard key={d.id} decision={d} onDecide={handleDecide} />
                  ))
                )}

                {resolvedDecisions.length > 0 && (
                  <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ fontSize: "11px", color: "#475569", marginBottom: "8px", fontFamily: "'JetBrains Mono', monospace" }}>
                      RESOLVED ({resolvedDecisions.length})
                    </div>
                    {resolvedDecisions.map((r, i) => {
                      const original = MOCK_DECISIONS.find(d => d.id === r.id);
                      return (
                        <div key={i} style={{
                          padding: "8px 12px",
                          background: "rgba(34,197,94,0.05)",
                          border: "1px solid rgba(34,197,94,0.15)",
                          borderRadius: "6px",
                          fontSize: "12px",
                          color: "#22c55e",
                          marginBottom: "4px",
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>
                          ✓ {original?.project}: {original?.summary} → {r.option}案
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === "activity" && (
              <div style={{ maxWidth: "700px" }}>
                <ActivityFeed log={MOCK_ACTIVITY_LOG} />
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Layer 3 - Detail (when project selected) */}
        {selectedProject && (
          <div style={{
            width: "320px",
            flexShrink: 0,
            borderLeft: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}>
            {(() => {
              const project = MOCK_PROJECTS.find(p => p.id === selectedProject);
              const phase = phaseConfig[project.phase];
              return (
                <>
                  <div style={{
                    padding: "16px",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <span style={{ fontSize: "15px", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                        {project.name}
                      </span>
                      <button
                        onClick={() => setSelectedProject(null)}
                        style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: "16px", outline: "none" }}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "12px" }}>{project.description}</div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: "10px", padding: "3px 8px", borderRadius: "4px",
                        background: phase.bg, color: phase.color, border: `1px solid ${phase.border}`,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>
                        {phase.label}
                      </span>
                      <span style={{
                        fontSize: "10px", padding: "3px 8px", borderRadius: "4px",
                        background: "rgba(255,255,255,0.04)", color: "#94a3b8",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>
                        {project.branch}
                      </span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                      {[
                        { label: "Agents", value: project.agentCount },
                        { label: "Progress", value: `${Math.round(project.progress * 100)}%` },
                        { label: "Tokens", value: `${(project.tokenSpend / 1000).toFixed(1)}k` },
                        { label: "Last Active", value: timeAgo(project.lastActivity) },
                      ].map((stat, i) => (
                        <div key={i}>
                          <div style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "'JetBrains Mono', monospace" }}>
                            {stat.label}
                          </div>
                          <div style={{ fontSize: "16px", fontWeight: 700, color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace" }}>
                            {stat.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Direct input */}
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ fontSize: "10px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px", fontFamily: "'JetBrains Mono', monospace" }}>
                      Direct Input (→ tmux send-keys)
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <input
                        type="text"
                        placeholder="エージェントに指示を送る..."
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: "6px",
                          color: "#e2e8f0",
                          fontSize: "12px",
                          outline: "none",
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      />
                      <button style={{
                        padding: "8px 12px",
                        background: "#6366f1",
                        border: "none",
                        borderRadius: "6px",
                        color: "#fff",
                        fontSize: "12px",
                        cursor: "pointer",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>
                        送信
                      </button>
                    </div>
                  </div>

                  {/* Recent activity for this project */}
                  <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
                    <div style={{ fontSize: "10px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px", fontFamily: "'JetBrains Mono', monospace" }}>
                      Activity Log
                    </div>
                    <ActivityFeed log={MOCK_ACTIVITY_LOG.filter(e => e.project === project.name || Math.random() > 0.6)} />
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* CSS for pulse animation */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap');
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
        input::placeholder { color: #475569; }
      `}</style>
    </div>
  );
}
