import type { Adapter } from "../types";
import { homeDir, isDir, joinPath, readDir, readLines } from "../fs";

var CLAUDE_DIR = joinPath(homeDir(), ".claude", "projects");
export function claudeAdapter(): Adapter {
  return {
    name: "claude",
    async *messages(options) {
      const projectsDir = CLAUDE_DIR;
      let projectDirs;
      try {
        projectDirs = await readDir(projectsDir);
      } catch {
        return;
      }
      for (const projectDir of projectDirs) {
        const projectPath = joinPath(projectsDir, projectDir);
        if (!await isDir(projectPath)) continue;
        const entries = await readDir(projectPath);
        const jsonlFiles = entries.filter((f) => f.endsWith(".jsonl"));
        for (const file of jsonlFiles) {
          const filePath = joinPath(projectPath, file);
          const session = file.replace(".jsonl", "");
          yield* parseClaudeJsonl(filePath, {
            session,
            project: projectDir,
            since: options?.since
          });
        }
        const subdirs = entries.filter((f) => !f.includes("."));
        for (const subdir of subdirs) {
          const subagentsDir = joinPath(projectPath, subdir, "subagents");
          try {
            const subFiles = await readDir(subagentsDir);
            const subJsonl = subFiles.filter((f) => f.endsWith(".jsonl"));
            for (const file of subJsonl) {
              yield* parseClaudeJsonl(joinPath(subagentsDir, file), {
                session: `${subdir}/${file.replace(".jsonl", "")}`,
                project: projectDir,
                since: options?.since
              });
            }
          } catch {
          }
        }
      }
    }
  };
}
async function* parseClaudeJsonl(filePath, context) {
  let model = context.model;
  for await (const line of readLines(filePath)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      model = extractModel(entry) ?? model;
      const text = extractUserText(entry);
      if (!text) continue;
      const timestamp = extractTimestamp(entry);
      if (context.since && timestamp) {
        const ts = new Date(timestamp);
        if (ts < context.since) continue;
      }
      yield {
        text,
        timestamp: timestamp ?? void 0,
        session: context.session,
        project: context.project,
        model
      };
    } catch {
    }
  }
}
function extractUserText(entry) {
  if (entry["type"] === "user") {
    const message = entry["message"];
    if (!message) return null;
    return contentToString(message["content"]);
  }
  if (entry["type"] === "human") {
    const message = entry["message"];
    if (!message) return null;
    return contentToString(message["content"]);
  }
  if (entry["role"] === "user") {
    return contentToString(entry["content"]);
  }
  return null;
}
function contentToString(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.filter(
      (p) => typeof p === "object" && p !== null && p.type === "text"
    ).map((p) => p.text);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
}
function extractTimestamp(entry) {
  if (typeof entry["timestamp"] === "string") return entry["timestamp"];
  if (typeof entry["createdAt"] === "string") return entry["createdAt"];
  return null;
}
function extractModel(value: unknown): string | undefined {
  return extractModelFrom(value, new Set(), 0);
}
function extractModelFrom(value: unknown, seen: Set<unknown>, depth: number): string | undefined {
  if (!value || typeof value !== "object" || depth > 4 || seen.has(value)) return void 0;
  seen.add(value);
  const obj = value as Record<string, unknown>;
  const modelKeys = ["model", "modelId", "modelName", "model_name", "selectedModel", "chatModel"];
  for (const key of modelKeys) {
    const model = normalizeModel(obj[key]);
    if (model) return model;
  }
  for (const child of Object.values(obj)) {
    const model = extractModelFrom(child, seen, depth + 1);
    if (model) return model;
  }
  return void 0;
}
function normalizeModel(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}