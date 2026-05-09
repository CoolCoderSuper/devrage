import type { Adapter } from "../types";
import { homeDir, isDir, joinPath, readDir, readLines } from "../fs";
import { extractModel } from "./shared";

var CODEX_SESSIONS_DIR = joinPath(homeDir(), ".codex", "sessions");
export function codexAdapter(): Adapter {
  return {
    name: "codex",
    async *messages(options) {
      yield* walkCodexSessions(CODEX_SESSIONS_DIR, options);
    }
  };
}
async function* walkCodexSessions(dir, options) {
  let entries;
  try {
    entries = await readDir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = joinPath(dir, entry);
    if (await isDir(fullPath)) {
      yield* walkCodexSessions(fullPath, options);
    } else if (entry.endsWith(".jsonl")) {
      const session = entry.replace(".jsonl", "");
      yield* parseCodexJsonl(fullPath, { session, since: options?.since });
    }
  }
}
async function* parseCodexJsonl(filePath, context) {
  let model = context.model;
  for await (const line of readLines(filePath)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      model = extractModel(entry) ?? model;
      if (entry.type !== "response_item") continue;
      const payload = entry.payload;
      if (!payload || payload.role !== "user") continue;
      const text = extractText3(payload.content);
      if (!text) continue;
      if (text.startsWith("<environment_context>")) continue;
      if (text.startsWith("<permissions instructions>")) continue;
      if (context.since && entry.timestamp) {
        const ts = new Date(entry.timestamp);
        if (ts < context.since) continue;
      }
      yield {
        text,
        timestamp: entry.timestamp,
        session: context.session,
        model: extractModel(payload) ?? model
      };
    } catch {
    }
  }
}
function extractText3(content) {
  if (!Array.isArray(content)) return null;
  const parts = content.filter(
    (p) => typeof p === "object" && p !== null && p.type === "input_text" && typeof p.text === "string"
  ).map((p) => p.text);
  return parts.length > 0 ? parts.join(" ") : null;
}