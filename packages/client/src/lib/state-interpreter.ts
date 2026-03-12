// ============================================================
// StateInterpreter — Client-side LLM-powered stop event analysis
// ============================================================

import { GoogleGenAI } from "@google/genai";
import type { DecisionItem, DecisionPriority } from "@opsveil/shared";

const MODEL = "gemini-3.1-flash-lite-preview";

export interface HookStopParams {
  sessionId: string;
  projectId: string;
  projectName: string;
  lastMessage: string;
  stopReason: string;
}

/** Read the saved display language (defaults to "en") */
export function getDisplayLanguage(): string {
  try {
    return localStorage.getItem("opsveil:language") ?? "en";
  } catch {
    return "en";
  }
}

/**
 * Analyze a hook stop event using Gemini and produce a DecisionItem.
 * If no apiKey is provided, returns a fallback decision without an LLM call.
 */
export async function interpretStopEvent(
  params: HookStopParams,
  apiKey: string | null,
  language?: string,
): Promise<DecisionItem> {
  const { projectId, projectName, sessionId, lastMessage, stopReason } = params;
  const lang = language ?? getDisplayLanguage();

  if (!apiKey) {
    return buildFallbackDecision(params);
  }

  const genai = new GoogleGenAI({ apiKey });

  const prompt = `You are an AI ops assistant analyzing a Claude Code agent that has stopped.

The agent stopped with reason: "${stopReason}"

Last message from the agent:
---
${lastMessage.slice(0, 4000)}
---

Analyze the situation and respond with ONLY valid JSON (no markdown, no code fences) in this exact format:
{
  "requiresAction": true,
  "summary": "One-line summary",
  "detail": "2-3 sentences explaining the full context",
  "options": [
    { "key": "A", "label": "Description of option A", "confidence": 0.8 },
    { "key": "B", "label": "Description of option B", "confidence": 0.5 }
  ],
  "estimatedTime": "30s",
  "priority": "low",
  "agentNote": "Additional context"
}

Rules:
- ALL text fields MUST be written in ${lang}.
- requiresAction: false if the agent completed its task and no user input is needed. true if the agent is asking a question, requesting permission, or needs guidance.
- When requiresAction is false (task completed):
  - summary: Describe WHAT was accomplished concretely (e.g. "API server implementation complete — 59 tests passing" or "Bug fix applied to auth middleware"). Extract key results from the agent's message.
  - agentNote: List key deliverables or changes briefly (files created, tests passed, features added). Be specific, not generic.
  - detail: Summarize the technical details from the agent's output.
  - options: empty array [].
  - priority: "low".
- When requiresAction is true (needs input):
  - summary: Describe what the agent needs from the user.
  - Provide 2-4 options. The first should be the recommended action.
  - confidence: 0.0-1.0 how likely this is the right choice.
  - priority: "high" if blocking other work, "medium" for normal decisions.
- estimatedTime: how long a human likely needs to decide.`;

  try {
    const response = await genai.models.generateContent({
      model: MODEL,
      contents: prompt,
    });

    const text = response.text ?? "";
    // Try to parse JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return buildFallbackDecision(params, text);
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      requiresAction?: boolean;
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

    const requiresAction = parsed.requiresAction !== false;

    return {
      id: crypto.randomUUID(),
      projectId,
      projectName,
      sessionId,
      requiresAction,
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
    const errMsg = err instanceof Error ? err.message : String(err);
    const isAuthError = errMsg.includes("API key") || errMsg.includes("401") || errMsg.includes("403");
    return buildFallbackDecision(
      params,
      undefined,
      isAuthError ? "API key invalid — check Settings" : undefined,
    );
  }
}

function buildFallbackDecision(
  params: HookStopParams,
  rawText?: string,
  errorHint?: string,
): DecisionItem {
  return {
    id: crypto.randomUUID(),
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
    agentNote: errorHint
      ? errorHint
      : rawText
        ? "LLM response could not be parsed as structured JSON"
        : "LLM unavailable — showing raw stop info",
  };
}
