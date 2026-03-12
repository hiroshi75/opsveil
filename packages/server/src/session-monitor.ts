// ============================================================
// SessionMonitor — watches ~/.claude JSONL session files
// ============================================================

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { nanoid } from "nanoid";
import type {
  ProjectState,
  SessionState,
  TokenUsage,
  ActivityEntry,
  ActivityType,
} from "@opsveil/shared";

interface FileOffset {
  size: number;
}

export class SessionMonitor extends EventEmitter {
  private projects = new Map<string, ProjectState>();
  private fileOffsets = new Map<string, FileOffset>();
  /** Track previous session phases to detect transitions */
  private prevSessionPhases = new Map<string, string>();
  private claudeDir: string;
  private activities: ActivityEntry[] = [];
  private maxActivities = 5000;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private watchers = new Map<string, fs.FSWatcher>();
  private lastScanTime = Date.now();

  constructor(claudeDir?: string) {
    super();
    this.claudeDir = claudeDir ?? path.join(os.homedir(), ".claude");
  }

  /** Start watching JSONL session files */
  async start(): Promise<void> {
    const projectsDir = path.join(this.claudeDir, "projects");
    console.log(`[SessionMonitor] Scanning ${projectsDir}`);

    // Initial scan
    await this.scanAllProjects();

    // Watch the projects directory for new project dirs
    try {
      const dirWatcher = fs.watch(projectsDir, { persistent: true }, () => {
        this.scanAllProjects().catch((err) =>
          console.error("[SessionMonitor] Scan error:", err)
        );
      });
      this.watchers.set("__root__", dirWatcher);
    } catch (err) {
      console.warn("[SessionMonitor] Cannot watch projects dir:", err);
    }

    // Poll for changes every 2 seconds (covers cases fs.watch misses)
    this.pollTimer = setInterval(() => {
      this.scanAllProjects().catch(() => {});
    }, 2000);

    const projectCount = this.projects.size;
    console.log(`[SessionMonitor] Found ${projectCount} projects on initial scan`);
  }

  /** Stop watching */
  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const w of this.watchers.values()) {
      w.close();
    }
    this.watchers.clear();
  }

  /** Get all project states */
  getProjects(): ProjectState[] {
    return Array.from(this.projects.values());
  }

  /** Get a project by ID */
  getProject(projectId: string): ProjectState | undefined {
    return this.projects.get(projectId);
  }

  /** Find a session across all projects */
  getSession(sessionId: string): SessionState | undefined {
    for (const p of this.projects.values()) {
      const s = p.sessions.find((s) => s.id === sessionId);
      if (s) return s;
    }
    return undefined;
  }

  /** Get activity entries, optionally filtered */
  getActivities(projectId?: string, limit?: number): ActivityEntry[] {
    let entries = this.activities;
    if (projectId) {
      entries = entries.filter((e) => e.projectId === projectId);
    }
    if (limit && limit > 0) {
      entries = entries.slice(-limit);
    }
    return entries;
  }

  /** Add an activity entry and broadcast it */
  addActivity(entry: ActivityEntry): void {
    this.activities.push(entry);
    if (this.activities.length > this.maxActivities) {
      this.activities = this.activities.slice(-this.maxActivities);
    }
    this.emit("activity:new", entry);
  }

  /** Resolve projectId + projectName from a Claude hook project path */
  resolveProject(projectPath: string): { projectId: string; projectName: string } | null {
    for (const p of this.projects.values()) {
      // Exact match or cwd is a subdirectory of a known project
      if (p.path === projectPath || p.name === projectPath || projectPath.startsWith(p.path + "/")) {
        return { projectId: p.id, projectName: p.name };
      }
    }
    const name = path.basename(projectPath);
    return { projectId: name, projectName: name };
  }

  /** Update phase for a project */
  updateProjectPhase(projectId: string, phase: ProjectState["phase"]): void {
    const project = this.projects.get(projectId);
    if (project) {
      project.phase = phase;
      project.lastActivity = Date.now();
      this.emit("project:updated", project);
    }
  }

  // ---- Internals ----

  private async scanAllProjects(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastScanTime;
    this.lastScanTime = now;

    // Detect sleep/wake: if poll gap > 10s (normally ~2s), the machine was asleep.
    // Refresh timestamps for sessions that were active before sleep so phase
    // detection doesn't incorrectly mark them as idle.
    if (elapsed > 10_000) {
      console.log(`[SessionMonitor] Sleep/wake detected (gap=${Math.round(elapsed / 1000)}s), refreshing active sessions`);
      for (const project of this.projects.values()) {
        for (const session of project.sessions) {
          if (!session.isActive) continue;
          if (session.lastEntryType === "assistant") {
            // Was waiting for input before sleep → still waiting after wake
            session.lastActivityAt = now - 11_000; // → blocked immediately
          } else if (session.lastEntryType === "user") {
            // Agent was processing before sleep → assume still processing
            session.lastActivityAt = now; // → autonomous
          } else {
            session.lastActivityAt = now - 11_000;
          }
        }
      }
    }

    const projectsDir = path.join(this.claudeDir, "projects");
    let dirs: string[];
    try {
      dirs = await fs.promises.readdir(projectsDir);
    } catch {
      return;
    }

    for (const dirName of dirs) {
      const dirPath = path.join(projectsDir, dirName);
      let entries: string[];
      try {
        entries = await fs.promises.readdir(dirPath);
      } catch {
        continue;
      }

      const jsonlFiles = entries.filter((f) => f.endsWith(".jsonl"));
      for (const file of jsonlFiles) {
        const filePath = path.join(dirPath, file);
        await this.handleFileChange(filePath).catch(() => {});
      }
    }

    // Recalculate phases for ALL known projects based on current time,
    // even if no new data was written (handles transition from autonomous → blocked → idle)
    for (const project of this.projects.values()) {
      const prevPhase = project.phase;
      this.recalcProjectPhase(project);

      // Check per-session phase transitions (autonomous → blocked = waiting for input)
      // Also emit for sessions first seen as blocked (e.g. server start, client reconnect)
      let anySessionChanged = false;
      for (const session of project.sessions) {
        const prevSessionPhase = this.prevSessionPhases.get(session.id);
        if (prevSessionPhase !== undefined && session.phase !== prevSessionPhase) {
          anySessionChanged = true;
        }
        const isNewlyBlocked =
          session.phase === "blocked" &&
          (prevSessionPhase === "autonomous" || prevSessionPhase === undefined);
        if (isNewlyBlocked) {
          this.emitWaitingForInputForSession(project, session);
        }
        this.prevSessionPhases.set(session.id, session.phase);
      }

      if (project.phase !== prevPhase || anySessionChanged) {
        this.emit("project:updated", project);
      }
    }
  }

  private async handleFileChange(filePath: string): Promise<void> {
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat) return;

    const currentSize = stat.size;
    const tracked = this.fileOffsets.get(filePath);
    const previousSize = tracked?.size ?? 0;

    if (currentSize <= previousSize) return;

    // Read only the new bytes
    const newData = await this.readRange(filePath, previousSize, currentSize);
    this.fileOffsets.set(filePath, { size: currentSize });

    if (!newData.trim()) return;

    // Parse the project/session context from the file path
    const ctx = this.parseFilePath(filePath);
    if (!ctx) return;

    // Ensure project exists in map
    const project = this.ensureProject(ctx.projectDirName, ctx.projectPath);
    const session = this.ensureSession(project, filePath, ctx.sessionId, stat.mtimeMs);

    // Process each new JSONL line
    const lines = newData.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        this.processJsonlEntry(project, session, parsed);
      } catch {
        // Skip malformed lines
      }
    }

    const fileAge = Date.now() - stat.mtimeMs;
    const idleThreshold = session.lastEntryType === "assistant" ? 12 * 3_600_000 : 300_000;
    session.isActive = fileAge < idleThreshold;

    this.recalcProjectPhase(project);
    this.emit("project:updated", project);
  }

  /** Recalculate project phase based on session states and last entry type.
   *
   * Idle thresholds vary by last entry type:
   *  - assistant: agent finished, waiting for user input → stays "blocked" for up to 12h
   *  - user/other: agent was processing → idle after 5 min
   *
   * Phase logic:
   *  - lastEntryType === "assistant" + age ≤ 10s → autonomous (still streaming)
   *  - lastEntryType === "assistant" + age > 10s → blocked (waiting for input)
   *  - lastEntryType === "user"     + age ≤ 60s → autonomous (agent processing)
   *  - lastEntryType === "user"     + age > 60s → blocked (stuck)
   */
  private recalcProjectPhase(project: ProjectState): void {
    const now = Date.now();
    let bestPhase: ProjectState["phase"] = "idle";
    let activeCount = 0;

    const IDLE_THRESHOLD_ASSISTANT = 12 * 3_600_000; // 12 hours
    const IDLE_THRESHOLD_DEFAULT = 300_000;           // 5 minutes

    for (const session of project.sessions) {
      const age = now - session.lastActivityAt;

      // Terminated sessions (Claude process exited) are always idle
      if (session.terminated) {
        session.isActive = false;
        session.phase = "idle";
        continue;
      }

      // Use a much longer idle threshold for sessions waiting for user input
      const idleThreshold =
        session.lastEntryType === "assistant"
          ? IDLE_THRESHOLD_ASSISTANT
          : IDLE_THRESHOLD_DEFAULT;

      if (age > idleThreshold) {
        session.isActive = false;
        session.phase = "idle";
        continue;
      }

      session.isActive = true;
      activeCount++;

      let sessionPhase: ProjectState["phase"];

      if (session.lastEntryType === "assistant") {
        sessionPhase = age < 10_000 ? "autonomous" : "blocked";
      } else if (session.lastEntryType === "user") {
        sessionPhase = age < 60_000 ? "autonomous" : "blocked";
      } else {
        sessionPhase = age < 10_000 ? "autonomous" : "blocked";
      }

      session.phase = sessionPhase;

      // Pick the most "active" phase across sessions
      if (sessionPhase === "autonomous") {
        bestPhase = "autonomous";
      } else if (sessionPhase === "blocked" && bestPhase !== "autonomous") {
        bestPhase = "blocked";
      }
    }

    project.agentCount = activeCount;
    project.phase = bestPhase;
  }

  private async readRange(
    filePath: string,
    start: number,
    end: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = fs.createReadStream(filePath, { start, end: end - 1 });
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      stream.on("error", reject);
    });
  }

  private parseFilePath(
    filePath: string
  ): { projectDirName: string; projectPath: string; sessionId: string } | null {
    // Actual structure: ~/.claude/projects/<project-dir>/<uuid>.jsonl
    const parts = filePath.split(path.sep);
    const projectsIdx = parts.indexOf("projects");
    if (projectsIdx < 0 || projectsIdx + 2 >= parts.length) return null;

    const projectDirName = parts[projectsIdx + 1];
    const sessionFile = parts[projectsIdx + 2];
    if (!projectDirName || !sessionFile) return null;

    const sessionId = sessionFile.replace(/\.jsonl$/, "");
    const projectPath = this.decodeProjectDirName(projectDirName);

    return { projectDirName, projectPath, sessionId };
  }

  private decodeProjectDirName(encoded: string): string {
    // Dir names use dashes for path separators: -Users-ayu-dev-opsveil → /Users/ayu/dev/opsveil
    if (encoded.startsWith("-")) {
      return "/" + encoded.slice(1).replace(/-/g, "/");
    }
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  private ensureProject(dirName: string, projectPath: string): ProjectState {
    const existing = this.projects.get(dirName);
    if (existing) return existing;

    const project: ProjectState = {
      id: dirName,
      name: path.basename(projectPath) || dirName,
      path: projectPath,
      branch: "",
      phase: "idle",
      agentCount: 0,
      lastActivity: Date.now(),
      tokenSpend: 0,
      progress: 0,
      description: "",
      sessions: [],
    };
    this.projects.set(dirName, project);
    return project;
  }

  private ensureSession(
    project: ProjectState,
    filePath: string,
    sessionId: string,
    mtimeMs?: number
  ): SessionState {
    const existing = project.sessions.find((s) => s.id === sessionId);
    if (existing) return existing;

    const ts = mtimeMs ?? Date.now();
    const session: SessionState = {
      id: sessionId,
      projectId: project.id,
      tmuxSession: null,
      filePath,
      lastLine: 0,
      isActive: true,
      startedAt: ts,
      lastActivityAt: ts,
      lastEntryType: null,
      phase: "idle",
      terminated: false,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
    project.sessions.push(session);
    project.agentCount = project.sessions.filter((s) => s.isActive).length;

    return session;
  }

  private processJsonlEntry(
    project: ProjectState,
    session: SessionState,
    entry: Record<string, unknown>
  ): void {
    session.lastLine++;

    // JSONL format: { type: "assistant"|"user"|"progress", message: { role, usage, content }, ... }
    const entryType = entry.type as string | undefined;
    const message = entry.message as Record<string, unknown> | undefined;

    // Track the last entry type for phase detection.
    // Only update for meaningful conversation entries (assistant/user),
    // not metadata entries (system, last-prompt, progress, file-history-snapshot, etc.)
    if (entryType === "assistant" || entryType === "user") {
      session.lastEntryType = entryType;
      // A new assistant/user message means the session is alive again
      session.terminated = false;
    }

    // Detect session termination (Claude process exited)
    if (entryType === "system") {
      const subtype = entry.subtype as string | undefined;
      if (subtype === "stop_hook_summary") {
        session.terminated = true;
      }
    }

    // Extract token usage from message.usage
    const usage = (message?.usage ?? entry.usage) as Record<string, number> | undefined;
    if (usage) {
      if (usage.input_tokens) session.tokenUsage.inputTokens += usage.input_tokens;
      if (usage.output_tokens) session.tokenUsage.outputTokens += usage.output_tokens;
      if (usage.cache_read_input_tokens)
        session.tokenUsage.cacheReadTokens += usage.cache_read_input_tokens;
      if (usage.cache_creation_input_tokens)
        session.tokenUsage.cacheWriteTokens += usage.cache_creation_input_tokens;

      project.tokenSpend =
        project.sessions.reduce(
          (sum, s) => sum + s.tokenUsage.inputTokens + s.tokenUsage.outputTokens,
          0
        );
    }

    // Extract timestamp for accurate lastActivity
    const ts = entry.timestamp as string | undefined;
    if (ts) {
      const parsed = new Date(ts).getTime();
      if (!isNaN(parsed)) {
        session.lastActivityAt = Math.max(session.lastActivityAt, parsed);
        project.lastActivity = Math.max(project.lastActivity, parsed);
      }
    }
  }

  /** Emit when a specific session transitions from autonomous → blocked */
  private emitWaitingForInputForSession(project: ProjectState, session: SessionState): void {
    console.log(`[WaitingForInput] session=${session.id.slice(0, 8)} project=${project.name}`);
    // Read the last few lines of the JSONL to get the assistant's last message
    this.getLastAssistantMessage(session.filePath).then((lastMessage) => {
      this.emit("waiting-for-input", {
        sessionId: session.id,
        projectId: project.id,
        projectName: project.name,
        lastMessage,
        stopReason: "waiting_for_input",
      });
    }).catch(() => {});
  }

  /** Read the last assistant message from a JSONL file (tail scan) */
  async getLastAssistantMessage(filePath: string): Promise<string> {
    try {
      const data = await fs.promises.readFile(filePath, "utf-8");
      const lines = data.trim().split("\n");
      // Scan backwards for the last assistant entry with content
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === "assistant" && entry.message?.content) {
            const content = entry.message.content;
            if (typeof content === "string") return content.slice(0, 2000);
            if (Array.isArray(content)) {
              const text = content
                .filter((b: { type: string }) => b.type === "text")
                .map((b: { text: string }) => b.text)
                .join("\n");
              return text.slice(0, 2000);
            }
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* file read error */ }
    return "";
  }
}
