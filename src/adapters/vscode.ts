import type { Adapter, AgentMessage, CursorContext, MessageOptions } from "../types";
import { isDir, joinPath, readDir, readLines, readText } from "../fs";
import { extractModel } from "./shared";
import { getVSCodeUserPaths } from "./paths";

export function vscodeAdapter(): Adapter {
  return {
    name: "vscode",
    async *messages(options) {
      for (const userPath of getVSCodeUserPaths()) {
        yield* walkVSCodeChatSessions(joinPath(userPath, "globalStorage", "emptyWindowChatSessions"), options, void 0);
        const workspaceStorage = joinPath(userPath, "workspaceStorage");
        let workspaces;
        try {
          workspaces = await readDir(workspaceStorage);
        } catch {
          continue;
        }
        for (const workspace of workspaces) {
          const workspacePath = joinPath(workspaceStorage, workspace);
          if (!await isDir(workspacePath)) continue;
          yield* walkVSCodeChatSessions(joinPath(workspacePath, "chatSessions"), options, workspace);
        }
      }
    }
  };
}
async function* walkVSCodeChatSessions(dir: string, options: MessageOptions | undefined, project: string | undefined): AsyncGenerator<AgentMessage> {
  let files;
  try {
    files = await readDir(dir);
  } catch {
    return;
  }
  for (const file of files) {
    if (file.endsWith(".jsonl")) {
      yield* parseVSCodeJsonl(joinPath(dir, file), { session: file.replace(".jsonl", ""), project, since: options?.since });
    } else if (file.endsWith(".json")) {
      yield* parseVSCodeJson(joinPath(dir, file), { session: file.replace(".json", ""), project, since: options?.since });
    }
  }
}
async function* parseVSCodeJson(filePath: string, context: CursorContext): AsyncGenerator<AgentMessage> {
  try {
    const data = JSON.parse(await readText(filePath));
    const session = typeof data.sessionId === "string" ? data.sessionId : context.session;
    const requests = Array.isArray(data.requests) ? data.requests : [];
    const sessionModel = extractModel(data) ?? context.model;
    for (const req of requests) {
      const text = typeof req?.message?.text === "string" ? req.message.text : null;
      if (!text) continue;
      const timestamp = vscodeTimestamp(req) ?? vscodeTimestamp(data);
      if (context.since && timestamp && new Date(timestamp) < context.since) continue;
      yield { text, timestamp, session, project: context.project, model: extractModel(req) ?? sessionModel };
    }
  } catch {
  }
}
async function* parseVSCodeJsonl(filePath: string, context: CursorContext): AsyncGenerator<AgentMessage> {
  const state = await reconstructVSCodeSession(filePath);
  if (!state) return;
  const session = typeof state.sessionId === "string" ? state.sessionId : context.session;
  const requests = Array.isArray(state.requests) ? state.requests : [];
  const sessionModel = extractModel(state) ?? context.model;
  for (const req of requests) {
    const text = extractVSCodeUserText(req?.result?.metadata?.renderedUserMessage);
    if (!text) continue;
    const timestamp = vscodeTimestamp(req) ?? vscodeTimestamp(state);
    if (context.since && timestamp && new Date(timestamp) < context.since) continue;
    yield { text, timestamp, session, project: context.project, model: extractModel(req) ?? sessionModel };
  }
}
async function reconstructVSCodeSession(filePath: string) {
  let state: Record<string, unknown> | null = null;
  for await (const line of readLines(filePath)) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.kind === 0) {
        state = obj.v;
      } else if (obj.kind === 1 && state && Array.isArray(obj.k)) {
        applyVSCodePatch(state, obj.k, obj.v);
      }
    } catch {
    }
  }
  return state;
}
function applyVSCodePatch(state: Record<string, unknown>, path: (string | number)[], value: unknown) {
  let target: any = state;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (target[key] === void 0) target[key] = typeof path[i + 1] === "number" ? [] : {};
    target = target[key];
  }
  target[path[path.length - 1]] = value;
}
function extractVSCodeUserText(renderedParts: unknown) {
  if (!Array.isArray(renderedParts)) return null;
  for (const part of renderedParts) {
    if (!part || typeof part !== "object") continue;
    const text = (part as Record<string, unknown>).text;
    if (typeof text !== "string") continue;
    const userRequest = text.match(/<userRequest>([\s\S]*?)<\/userRequest>/);
    if (userRequest?.[1]?.trim()) return userRequest[1].trim();
    const stripped = text.replace(/<context>[\s\S]*?<\/context>/g, "").replace(/<reminderInstructions>[\s\S]*?<\/reminderInstructions>/g, "").replace(/<attachments>[\s\S]*?<\/attachments>/g, "").trim();
    if (stripped) return stripped;
  }
  return null;
}
function vscodeTimestamp(value: Record<string, unknown> | undefined) {
  if (!value) return null;
  const raw = value.timestamp ?? value.creationDate ?? value.lastMessageDate ?? value.createdAt;
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return new Date(raw).toISOString();
  return null;
}
