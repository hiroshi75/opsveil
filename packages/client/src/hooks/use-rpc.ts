import { useCallback } from "react";
import { useConnectionStore } from "../stores/connection-store";

/**
 * Hook that returns a helper to call RPC methods on connected servers.
 *
 * If no serverId is provided, defaults to the first connected server.
 */
export function useRpc() {
  const sendRpc = useConnectionStore((s) => s.sendRpc);
  const connections = useConnectionStore((s) => s.connections);

  const getDefaultServerId = useCallback((): string | null => {
    for (const [id, conn] of connections) {
      if (conn.status === "connected") return id;
    }
    return null;
  }, [connections]);

  const rpc = useCallback(
    async <T = unknown>(
      method: string,
      params?: Record<string, unknown>,
      serverId?: string,
    ): Promise<T> => {
      const targetId = serverId ?? getDefaultServerId();
      if (!targetId) {
        throw new Error("No connected server available");
      }
      return sendRpc(targetId, method, params) as Promise<T>;
    },
    [sendRpc, getDefaultServerId],
  );

  return { rpc, getDefaultServerId };
}
