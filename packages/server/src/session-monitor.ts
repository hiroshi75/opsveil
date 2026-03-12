// ============================================================
// SessionMonitor — watches ~/.claude JSONL session files
// ============================================================

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { watch, type FSWatcher } from "chokidar";
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
  private watcher: FSWatcher | null = null;
  private claudeDir: string;
  private activities: ActivityEntry[] = [];
  private maxActivities = 5000;

  constructor(claudeDir?: string) {
    super();
    this.claudeDir = claudeDir ?? path.join(os.homedir(), ".claude");
  }

  /** Start watching JSONL session files */
  async start(): Promise<void> {
    const globPattern = path.join(
      this.claudeDir,
      "projects",
      "*",
      "sessions",
      "*.jsonl"
    );

    this.watcher = watch(globPattern, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    this.watcher.on("add", (filePath: string) => {
      this.handleFileChange(filePath).catch((err) =>
        console.error(`[SessionMonitor] Error on add ${filePath}:`, err)
      );
    });

    this.watcher.on("change", (filePath: string) => {
      this.handleFileChange(filePath).catch((err) =>
        console.error(`[SessionMonitor] Error on change ${filePath}:`, err)
      );
    });

    console.log(`[SessionMonitor] Watching ${globPattern}`);
  }

  /** Stop the file watcher */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /** Get all project states */
  getProjects(): ProjectState[] {
    return Array.from(this.projects.values());
  }

  /** Get a project by ID */
  getProject(projectId: string): ProjectState | undefined {
    return this.projects.get(projectId);
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
    // Try to find by path
    for (const p of this.projects.values()) {
      if (p.path === projectPath || p.name === projectPath) {
        return { projectId: p.id, projectName: p.name };
      }
    }
    // Fallback: derive from the path
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
    const session = this.ensureSession(project, filePath, ctx.sessionId);

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

    session.lastActivityAt = Date.now();
    session.isActive = true;
    project.lastActivity = Date.now();

    this.emit("project:updated", project);
    this.emit("session:activity", { projectId: project.id, sessionId: session.id });
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
    // Expected: ~/.claude/projects/<url-encoded-path>/sessions/<uuid>.jsonl
    const parts = filePath.split(path.sep);
    const sessionsIdx = parts.lastIndexOf("sessions");
    if (sessionsIdx < 1) return null;

    const projectDirName = parts[sessionsIdx - 1];
    const sessionFile = parts[sessionsIdx + 1];
    if (!projectDirName || !sessionFile) return null;

    const sessionId = sessionFile.replace(/\.jsonl$/, "");
    const projectPath = this.decodeProjectDirName(projectDirName);

    return { projectDirName, projectPath, sessionId };
  }

  private decodeProjectDirName(encoded: string): string {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  private ensureProject(dirName: string, projectPath: string): ProjectState {
    // Use dirName as the key for dedup
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
    sessionId: string
  ): SessionState {
    const existing = project.sessions.find((s) => s.id === sessionId);
    if (existing) return existing;

    const session: SessionState = {
      id: sessionId,
      projectId: project.id,
      tmuxSession: null,
      filePath,
      lastLine: 0,
      isActive: true,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
    project.sessions.push(session);
    project.agentCount = project.sessions.filter((s) => s.isActive).length;

    // Log activity
    this.addActivity({
      id: nanoid(),
      timestamp: Date.now(),
      projectId: project.id,
      projectName: project.name,
      sessionId: session.id,
      action: "New session detected",
      type: "running",
    });

    return session;
  }

  private processJsonlEntry(
    project: ProjectState,
    session: SessionState,
    entry: Record<string, unknown>
  ): void {
    session.lastLine++;

    // Extract role
    const role = entry.role as string | undefined;

    // Update phase based on role
    if (role === "assistant") {
      project.phase = "autonomous";
    }

    // Extract token usage
    const usage = entry.usage as Record<string, number> | undefined;
    if (usage) {
      if (usage.input_tokens) session.tokenUsage.inputTokens += usage.input_tokens;
      if (usage.output_tokens) session.tokenUsage.outputTokens += usage.output_tokens;
      if (usage.cache_read_input_tokens)
        session.tokenUsage.cacheReadTokens += usage.cache_read_input_tokens;
      if (usage.cache_creation_input_tokens)
        session.tokenUsage.cacheWriteTokens += usage.cache_creation_input_tokens;

      // Update project token spend (rough estimate: $0.003 per 1k input, $0.015 per 1k output)
      project.tokenSpend =
        project.sessions.reduce(
          (sum, s) => sum + s.tokenUsage.inputTokens + s.tokenUsage.outputTokens,
          0
        );
    }

    // Detect tool calls
    const toolName = entry.tool_name as string | undefined;
    if (toolName) {
      this.addActivity({
        id: nanoid(),
        timestamp: Date.now(),
        projectId: project.id,
        projectName: project.name,
        sessionId: session.id,
        action: `Tool: ${toolName}`,
        type: "tool_use",
      });
    }

    // Detect errors
    const isError = entry.is_error as boolean | undefined;
    if (isError) {
      this.addActivity({
        id: nanoid(),
        timestamp: Date.now(),
        projectId: project.id,
        projectName: project.name,
        sessionId: session.id,
        action: `Error in session`,
        type: "error",
        detail: typeof entry.content === "string" ? entry.content : undefined,
      });
    }
  }
}
