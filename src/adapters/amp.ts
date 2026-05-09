import type { Adapter } from "../types";
import { homeDir, joinPath, readDir, readText } from "../fs";
import { extractModel } from "./shared";

function getAmpThreadsDir() {
  return joinPath(
    Bun.env["XDG_DATA_HOME"] ?? joinPath(homeDir(), ".local", "share"),
    "amp",
    "threads"
  );
}
export function ampAdapter(): Adapter {
  return {
    name: "amp",
    async *messages(options) {
      const threadsDir = getAmpThreadsDir();
      let files;
      try {
        files = await readDir(threadsDir);
      } catch {
        return;
      }
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      for (const file of jsonFiles) {
        const filePath = joinPath(threadsDir, file);
        const threadId = file.replace(".json", "");
        try {
          const raw = await readText(filePath);
          const thread = JSON.parse(raw);
          if (!thread.messages || !Array.isArray(thread.messages)) continue;
          const threadModel = extractModel(thread);
          for (const msg of thread.messages) {
            if (msg.role !== "user") continue;
            const text = extractText(msg.content);
            if (!text) continue;
            const timestamp = msg.timestamp ?? msg.createdAt ?? void 0;
            if (options?.since && timestamp) {
              const ts = new Date(timestamp);
              if (ts < options.since) continue;
            }
            yield {
              text,
              timestamp,
              session: threadId,
              model: extractModel(msg) ?? threadModel
            };
          }
        } catch {
        }
      }
    }
  };
}
function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.filter(
      (p) => typeof p === "object" && p !== null && typeof p.text === "string"
    ).map((p) => p.text);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
}