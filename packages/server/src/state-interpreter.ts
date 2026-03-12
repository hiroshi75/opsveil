// ============================================================
// StateInterpreter — LLM-powered summarization of agent state
// ============================================================

import { GoogleGenAI } from "@google/genai";
import { nanoid } from "nanoid";
import type { DecisionItem, DecisionPriority } from "@opsveil/shared";

export class StateInterpreter {
  private genai: GoogleGenAI | null = null;
  private model = "gemini-2.0-flash-lite";

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.GOOGLE_API_KEY;
    if (key) {
      this.genai = new GoogleGenAI({ apiKey: key });
    } else {
      console.warn(
        "[StateInterpreter] No GOOGLE_API_KEY found — LLM summarization disabled"
      );
    }
  }

  /**
   * Analyze the last N messages from a stopped agent and produce a DecisionItem.
   */
  async interpretStop(params: {
    projectId: string;
    projectName: string;
    sessionId: string;
    lastMessage: string;
    stopReason: string;
  }): Promise<DecisionItem> {
    const { projectId, projectName, sessionId, lastMessage, stopReason } = params;

    if (!this.genai) {
      return this.buildFallbackDecision(params);
    }

    const prompt = `You are an AI ops assistant analyzing a Claude Code agent that has stopped.

The agent stopped with reason: "${stopReason}"

Last message from the agent:
---
${lastMessage.slice(0, 4000)}
---

Analyze the situation and respond with ONLY valid JSON (no markdown, no code fences) in this exact format:
{
  "summary": "One-line summary of what the agent needs",
  "detail": "2-3 sentences explaining the full context",
  "options": [
    { "key": "A", "label": "Description of option A", "confidence": 0.8 },
    { "key": "B", "label": "Description of option B", "confidence": 0.5 },
    { "key": "C", "label": "Description of option C", "confidence": 0.3 }
  ],
  "estimatedTime": "30s or 2min or needs-deep-review",
  "priority": "high or medium or low",
  "agentNote": "Any additional context for the human operator"
}

Rules:
- Provide 2-4 options. The first should be the recommended action.
- confidence is 0.0 to 1.0 indicating how likely this is the right choice.
- priority: "high" if blocking other work, "medium" for normal decisions, "low" for optional/non-urgent.
- estimatedTime: how long a human likely needs to decide.`;

    try {
      const response = await this.genai.models.generateContent({
        model: this.model,
        contents: prompt,
      });

      const text = response.text ?? "";
      // Try to parse JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.buildFallbackDecision(params, text);
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        summary?: string;
        detail?: string;
        options?: Array<{ key?: string; label?: string; confidence?: number }>;
        estimatedTime?: string;
        priority?: string;
        agentNote?: string;
      };

      const validPriority: DecisionPriority =
        parsed.priority === "high" || parsed.priority === "medium" || parsed.priority === "low"
          ? parsed.priority
          : "medium";

      return {
        id: nanoid(),
        projectId,
        projectName,
        sessionId,
        summary: parsed.summary ?? "Agent stopped — needs input",
        detail: parsed.detail ?? lastMessage.slice(0, 500),
        options: (parsed.options ?? []).map((o, i) => ({
          key: o.key ?? String.fromCharCode(65 + i),
          label: o.label ?? "Option " + String.fromCharCode(65 + i),
          confidence: typeof o.confidence === "number" ? o.confidence : 0.5,
        })),
        estimatedTime: parsed.estimatedTime ?? "1min",
        priority: validPriority,
        timestamp: Date.now(),
        agentNote: parsed.agentNote ?? "",
      };
    } catch (err) {
      console.error("[StateInterpreter] LLM error:", err);
      return this.buildFallbackDecision(params);
    }
  }

  private buildFallbackDecision(
    params: {
      projectId: string;
      projectName: string;
      sessionId: string;
      lastMessage: string;
      stopReason: string;
    },
    rawText?: string
  ): DecisionItem {
    return {
      id: nanoid(),
      projectId: params.projectId,
      projectName: params.projectName,
      sessionId: params.sessionId,
      summary: `Agent stopped: ${params.stopReason}`,
      detail: rawText ?? params.lastMessage.slice(0, 500),
      options: [
        { key: "A", label: "Continue — approve and proceed", confidence: 0.6 },
        { key: "B", label: "Provide guidance", confidence: 0.3 },
        { key: "C", label: "Stop agent", confidence: 0.1 },
      ],
      estimatedTime: "1min",
      priority: "medium",
      timestamp: Date.now(),
      agentNote: rawText ? "LLM response could not be parsed as structured JSON" : "LLM unavailable — showing raw stop info",
    };
  }
}
