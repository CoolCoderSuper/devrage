import type { Adapter } from "../types";
import { homeDir, isDir, joinPath, readDir, readText } from "../fs";
import { extractModel } from "./shared";
import { getVSCodeGlobalStoragePaths } from "./paths";

async function getClineTaskDirs() {
  const dirs = [];
  const vscodePaths = getVSCodeGlobalStoragePaths();
  const extensionIds = ["saoudrizwan.claude-dev", "rooveterinaryinc.roo-cline"];
  for (const basePath of vscodePaths) {
    for (const extId of extensionIds) {
      const tasksDir = joinPath(basePath, extId, "tasks");
      if (await isDir(tasksDir)) dirs.push(tasksDir);
    }
  }
  const clineStandalone = joinPath(homeDir(), ".cline", "data", "tasks");
  if (await isDir(clineStandalone)) dirs.push(clineStandalone);
  return dirs;
}
export function clineAdapter(): Adapter {
  return {
    name: "cline",
    async *messages(options) {
      const taskDirs = await getClineTaskDirs();
      for (const tasksDir of taskDirs) {
        let taskIds;
        try {
          taskIds = await readDir(tasksDir);
        } catch {
          continue;
        }
        for (const taskId of taskIds) {
          const taskDir = joinPath(tasksDir, taskId);
          if (!await isDir(taskDir)) continue;
          const historyFile = joinPath(taskDir, "api_conversation_history.json");
          try {
            const raw = await readText(historyFile);
            const messages = JSON.parse(raw);
            if (!Array.isArray(messages)) continue;
            let model: string | undefined;
            for (const msg of messages) {
              model = extractModel(msg) ?? model;
              if (msg.role !== "user") continue;
              const text = extractText2(msg.content);
              if (!text) continue;
              const timestamp = msg.ts ?? void 0;
              if (options?.since && timestamp) {
                const ts = new Date(timestamp);
                if (ts < options.since) continue;
              }
              yield {
                text,
                session: taskId,
                model
              };
            }
          } catch {
          }
        }
      }
    }
  };
}
function extractText2(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.filter(
      (p) => typeof p === "object" && p !== null && p.type === "text" && typeof p.text === "string"
    ).map((p) => p.text);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
}