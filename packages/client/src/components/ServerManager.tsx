import { useState } from "react";
import { useConnectionStore } from "../stores/connection-store";

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
          Server Connections
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
