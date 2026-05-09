import type { Adapter } from "../types";
import { homeDir, isDir, joinPath, readDir, readLines } from "../fs";
import { extractModel } from "./shared";

var PI_SESSIONS_DIR = joinPath(homeDir(), ".pi", "agent", "sessions");
export function piAdapter(): Adapter {
  return {
    name: "pi",
    async *messages(options) {
      yield* walkPiSessions(PI_SESSIONS_DIR, options, void 0);
    }
  };
}
async function* walkPiSessions(dir, options, project) {
  let entries;
  try {
    entries = await readDir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = joinPath(dir, entry);
    if (await isDir(fullPath)) {
      yield* walkPiSessions(fullPath, options, project ?? entry);
    } else if (entry.endsWith(".jsonl")) {
      const session = entry.replace(".jsonl", "");
      yield* parsePiJsonl(fullPath, { session, project, since: options?.since });
    }
  }
}
async function* parsePiJsonl(filePath, context) {
  let project = context.project;
  let model = context.model;
  for await (const line of readLines(filePath)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      model = extractModel(entry) ?? model;
      if (entry.type === "session") {
        project = entry.cwd ?? project;
        continue;
      }
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (!message || message.role !== "user") continue;
      const text = piContentToString(message.content);
      if (!text) continue;
      const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : typeof message.timestamp === "number" ? new Date(message.timestamp).toISOString() : void 0;
      if (context.since && timestamp) {
        const ts = new Date(timestamp);
        if (ts < context.since) continue;
      }
      yield {
        text,
        timestamp,
        session: context.session,
        project,
        model: extractModel(message) ?? model
      };
    } catch {
    }
  }
}
function piContentToString(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.filter(
      (p) => typeof p === "object" && p !== null && p.type === "text" && typeof p.text === "string"
    ).map((p) => p.text);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
}