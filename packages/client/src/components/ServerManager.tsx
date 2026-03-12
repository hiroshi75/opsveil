import { useState } from "react";
import { useConnectionStore } from "../stores/connection-store";
import { useDecisionStore } from "../stores/decision-store";
import { interpretStopEvent } from "../lib/state-interpreter";

// ---------------------------------------------------------------------------
// Status styles
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  connected: "text-phase-autonomous",
  connecting: "text-phase-review",
  disconnected: "text-phase-idle",
  error: "text-phase-blocked",
};

const STATUS_DOT: Record<string, string> = {
  connected: "bg-phase-autonomous",
  connecting: "bg-phase-review",
  disconnected: "bg-phase-idle",
  error: "bg-phase-blocked",
};

// ---------------------------------------------------------------------------
// Language options
// ---------------------------------------------------------------------------

const LANGUAGES = [
  { code: "ja", label: "\u65E5\u672C\u8A9E" },
  { code: "en", label: "English" },
  { code: "zh", label: "\u4E2D\u6587" },
  { code: "ko", label: "\uD55C\uAD6D\uC5B4" },
  { code: "es", label: "Espa\u00F1ol" },
  { code: "fr", label: "Fran\u00E7ais" },
  { code: "de", label: "Deutsch" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ServerManager({ onClose }: { onClose: () => void }) {
  const connections = useConnectionStore((s) => s.connections);
  const addServer = useConnectionStore((s) => s.addServer);
  const removeServer = useConnectionStore((s) => s.removeServer);
  const connect = useConnectionStore((s) => s.connect);
  const disconnect = useConnectionStore((s) => s.disconnect);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("ws://localhost:7432");
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem("opsveil:apiKey") ?? "",
  );
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [language, setLanguage] = useState(
    () => localStorage.getItem("opsveil:language") ?? "en",
  );
  const [isReinterpreting, setIsReinterpreting] = useState(false);

  function handleSaveApiKey() {
    const trimmed = apiKey.trim();
    if (trimmed) {
      localStorage.setItem("opsveil:apiKey", trimmed);
    } else {
      localStorage.removeItem("opsveil:apiKey");
    }
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
  }

  async function handleLanguageChange(newLang: string) {
    setLanguage(newLang);
    localStorage.setItem("opsveil:language", newLang);

    // Re-interpret all existing decisions with the new language
    const key = localStorage.getItem("opsveil:apiKey");
    if (!key) return;

    const decisions = useDecisionStore.getState().decisions;
    const toReinterpret = decisions.filter((d) => d.sourceParams);
    if (toReinterpret.length === 0) return;

    setIsReinterpreting(true);
    try {
      await Promise.all(
        toReinterpret.map(async (d) => {
          try {
            const fresh = await interpretStopEvent(d.sourceParams!, key, newLang);
            useDecisionStore.getState().updateDecision(d.id, {
              summary: fresh.summary,
              detail: fresh.detail,
              options: fresh.options,
              estimatedTime: fresh.estimatedTime,
              priority: fresh.priority,
              agentNote: fresh.agentNote,
            });
          } catch {
            // Skip failed re-interpretation
          }
        }),
      );
    } finally {
      setIsReinterpreting(false);
    }
  }

  function handleAdd() {
    const trimmedName = name.trim() || "Server";
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    const id = addServer(trimmedName, trimmedUrl);
    connect(id);
    setName("");
    setUrl("ws://localhost:7432");
  }

  const serverList = Array.from(connections.values());

  return (
    <div className="absolute top-12 right-4 z-50 w-96 bg-surface-0 border border-surface-3 rounded-lg shadow-2xl">
      {/* Header */}
      <div className="flex justify-between items-center px-4 py-3 border-b border-surface-3">
        <span className="text-sm font-semibold text-slate-200 font-mono">
          Settings
        </span>
        <button
          onClick={onClose}
          className="bg-transparent border-none text-slate-500 cursor-pointer text-sm hover:text-slate-300 transition-colors"
        >
          {"\u2715"}
        </button>
      </div>

      {/* Server list */}
      <div className="max-h-60 overflow-y-auto">
        {serverList.length === 0 && (
          <div className="text-center text-slate-600 text-xs py-6 font-mono">
            No servers configured
          </div>
        )}
        {serverList.map((conn) => (
          <div
            key={conn.id}
            className="flex items-center justify-between px-4 py-2.5 border-b border-surface-2 last:border-b-0"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[conn.status]}`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-slate-200 font-mono truncate">
                  {conn.name}
                </div>
                <div className="text-[10px] text-slate-500 font-mono truncate">
                  {conn.url}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              <span
                className={`text-[10px] font-mono ${STATUS_STYLES[conn.status]}`}
              >
                {conn.status}
              </span>
              {conn.status !== "connected" && conn.status !== "connecting" && (
                <button
                  onClick={() => connect(conn.id)}
                  className="text-[10px] px-2 py-1 bg-accent/20 text-accent-light border-none rounded cursor-pointer font-mono hover:bg-accent/30 transition-colors"
                >
                  Connect
                </button>
              )}
              {conn.status === "connected" && (
                <button
                  onClick={() => disconnect(conn.id)}
                  className="text-[10px] px-2 py-1 bg-white/[0.04] text-slate-400 border-none rounded cursor-pointer font-mono hover:bg-white/[0.08] transition-colors"
                >
                  Disconnect
                </button>
              )}
              <button
                onClick={() => removeServer(conn.id)}
                className="text-[10px] px-1.5 py-1 bg-transparent text-slate-600 border-none rounded cursor-pointer hover:text-phase-blocked transition-colors"
              >
                {"\u2715"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Display Language */}
      <div className="p-4 border-t border-surface-3">
        <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-2 font-mono">
          Queue Language
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleLanguageChange(lang.code)}
              disabled={isReinterpreting}
              className={`px-2.5 py-1.5 rounded-md text-[11px] font-mono border cursor-pointer transition-colors disabled:opacity-50 ${
                language === lang.code
                  ? "bg-accent/20 text-accent-light border-accent/40"
                  : "bg-white/[0.04] text-slate-400 border-white/[0.08] hover:bg-white/[0.06]"
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>
        {isReinterpreting && (
          <div className="text-[9px] text-accent mt-1.5 font-mono">
            Updating queue...
          </div>
        )}
      </div>

      {/* LLM API Key */}
      <div className="p-4 border-t border-surface-3">
        <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-2 font-mono">
          LLM API Key (Gemini)
        </div>
        <div className="flex gap-1.5">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="GOOGLE_API_KEY"
            className="flex-1 px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-md text-slate-200 text-xs outline-none font-mono focus:border-accent/40 transition-colors"
          />
          <button
            onClick={handleSaveApiKey}
            className="px-3 py-2 bg-accent/20 text-accent-light border-none rounded-md text-xs cursor-pointer font-mono hover:bg-accent/30 transition-colors shrink-0"
          >
            {apiKeySaved ? "\u2713" : "Save"}
          </button>
        </div>
        {apiKey && (
          <div className="text-[9px] text-slate-600 mt-1 font-mono">
            {apiKeySaved ? "Saved" : "Key set"}
          </div>
        )}
      </div>

      {/* Add server form */}
      <div className="p-4 border-t border-surface-3">
        <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-2 font-mono">
          Add Server
        </div>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Server name"
            className="px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-md text-slate-200 text-xs outline-none font-mono focus:border-accent/40 transition-colors"
          />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="ws://localhost:7432"
            className="px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-md text-slate-200 text-xs outline-none font-mono focus:border-accent/40 transition-colors"
          />
          <button
            onClick={handleAdd}
            className="px-3 py-2 bg-accent border-none rounded-md text-white text-xs font-semibold cursor-pointer font-mono hover:bg-accent-dark transition-colors"
          >
            Add & Connect
          </button>
        </div>
      </div>
    </div>
  );
}
