import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Load explicitly with pi -e /path/to/pi-bridge.ts, then /cleanup-connect SESSION_DIR. */
export default function cleanupBridge(pi: ExtensionAPI) {
  let socket: WebSocket | undefined;
  let bound: string | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopRequested = true;
  let streamId = crypto.randomUUID();

  function disconnect() {
    stopRequested = true;
    clearTimeout(retry);
    socket?.close();
    socket = undefined;
    bound = undefined;
  }

  pi.registerCommand("cleanup-connect", {
    description: "Connect this Pi conversation to a local cleanup review session",
    handler: async (argument, ctx) => {
      disconnect();
      const raw = argument.trim();
      if (!raw) {
        ctx.ui.notify("Usage: /cleanup-connect /absolute/path/to/review-session", "error");
        return;
      }
      const root = path.resolve(raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw);
      const file = path.join(root, "bridge/state/connection.json");
      let config: {
        host: string;
        port: number;
        agentToken: string;
        piSessionId?: string;
      };
      try {
        config = JSON.parse(fs.readFileSync(file, "utf8"));
        if (config.host !== "pi" || !config.agentToken || !config.port)
          throw Error("Start this session with --host pi first");
        bound = ctx.sessionManager.getSessionId();
        if (config.piSessionId && config.piSessionId !== bound)
          throw Error("The review is bound to another Pi conversation");
      } catch (error) {
        ctx.ui.notify(String(error), "error");
        return;
      }
      stopRequested = false;
      const receiptsFile = path.join(root, "bridge/state/pi-receipts.json");
      let receipts: Record<string, boolean> = {};
      if (fs.existsSync(receiptsFile)) receipts = JSON.parse(fs.readFileSync(receiptsFile, "utf8"));
      const connect = () => {
        if (stopRequested || ctx.sessionManager.getSessionId() !== bound) return;
        // Re-read the port after a local bridge restart. Tokens and session binding must match.
        let current: typeof config;
        try {
          current = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch (error) {
          ctx.ui.notify("Cleanup connection file is unavailable: " + String(error), "error");
          disconnect();
          return;
        }
        if (current.agentToken !== config.agentToken || (current.piSessionId && current.piSessionId !== bound))
          return disconnect();
        const ws = new WebSocket(`ws://127.0.0.1:${current.port}/agent?token=${config.agentToken}`);
        socket = ws;
        ws.onopen = () => ws.send(JSON.stringify({ type: "bind", sessionId: bound }));
        ws.onmessage = (event) => {
          let message: { type?: string; requestId?: string; text?: string };
          try {
            message = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (message.type !== "user" || typeof message.requestId !== "string" || typeof message.text !== "string")
            return;
          const { requestId, text } = message;
          if (
            !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId) ||
            text.length > 100000 ||
            ctx.sessionManager.getSessionId() !== bound
          )
            return;
          try {
            if (requestId in receipts) {
              ws.send(
                JSON.stringify({
                  type: "ack",
                  requestId,
                  accepted: receipts[requestId],
                  error: receipts[requestId]
                    ? undefined
                    : "Delivery is uncertain. Check the conversation before retrying.",
                }),
              );
              return;
            }
            const save = () => {
              fs.writeFileSync(receiptsFile + ".tmp", JSON.stringify(receipts), { mode: 0o600 });
              fs.renameSync(receiptsFile + ".tmp", receiptsFile);
            };
            receipts[requestId] = false;
            save();
            pi.sendUserMessage(
              text,
              ctx.isIdle() ? { expandPromptTemplates: false } : { deliverAs: "followUp", expandPromptTemplates: false },
            );
            receipts[requestId] = true;
            save();
            ws.send(JSON.stringify({ type: "ack", requestId, accepted: true }));
          } catch (error) {
            ws.send(
              JSON.stringify({
                type: "ack",
                requestId,
                accepted: false,
                error: String(error),
              }),
            );
          }
        };
        ws.onerror = () => {};
        ws.onclose = (event) => {
          if (socket !== ws || stopRequested) return;
          if (event.code === 1008) {
            ctx.ui.notify("Cleanup connection rejected: " + event.reason, "error");
            disconnect();
          } else retry = setTimeout(connect, 2500);
        };
      };
      connect();
      ctx.ui.notify("Cleanup bridge attached. The page will show when this conversation is connected.", "info");
    },
  });

  function forward(message: unknown, streaming: boolean, ctx: ExtensionContext) {
    if (socket?.readyState !== WebSocket.OPEN || ctx.sessionManager.getSessionId() !== bound) return;
    const value = message as {
      role?: string;
      content?: { type: string; text?: string }[];
    };
    if (value.role !== "assistant" || !Array.isArray(value.content)) return;
    const text = value.content
      .filter((part) => part.type === "text")
      .map((part) => part.text || "")
      .join("\n");
    if (text) socket.send(JSON.stringify({ type: "assistant", id: streamId, text, streaming }));
    if (!streaming) streamId = crypto.randomUUID();
  }
  pi.on("message_update", (event, ctx) => forward(event.message, true, ctx));
  pi.on("message_end", (event, ctx) => forward(event.message, false, ctx));
  pi.on("session_shutdown", () => disconnect());
  pi.registerCommand("cleanup-disconnect", {
    description: "Disconnect the cleanup review page",
    handler: async () => disconnect(),
  });
}
