import { Database } from "bun:sqlite";
import type { Adapter, AgentMessage, CursorContext, MessageOptions, SqliteDatabase } from "../types";
import { homeDir, isDir, joinPath, pathExists, readDir, readLines } from "../fs";
import { contentToString, extractModel } from "./shared";

function getCursorUserPath() {
  if (process.platform === "darwin") {
    return joinPath(homeDir(), "Library", "Application Support", "Cursor", "User");
  }
  if (process.platform === "linux") {
    const configBase = Bun.env["XDG_CONFIG_HOME"] ?? joinPath(homeDir(), ".config");
    return joinPath(configBase, "Cursor", "User");
  }
  const appData = Bun.env["APPDATA"] ?? joinPath(homeDir(), "AppData", "Roaming");
  return joinPath(appData, "Cursor", "User");
}
export function cursorAdapter(): Adapter {
  return {
    name: "cursor",
    async *messages(options) {
      const seen = new Set<string>();
      yield* walkCursorAgentTranscripts(joinPath(homeDir(), ".cursor", "projects"), options, seen);
      yield* walkCursorChatStores(joinPath(homeDir(), ".cursor", "chats"), options, seen);
      yield* parseCursorGlobalStateDb(joinPath(getCursorUserPath(), "globalStorage", "state.vscdb"), options, seen);
      const workspaceStorage = joinPath(getCursorUserPath(), "workspaceStorage");
      let workspaces;
      try {
        workspaces = await readDir(workspaceStorage);
      } catch {
        return;
      }
      for (const workspace of workspaces) {
        const workspacePath = joinPath(workspaceStorage, workspace);
        if (!await isDir(workspacePath)) continue;
        yield* parseCursorStateDb(joinPath(workspacePath, "state.vscdb"), {
          session: workspace,
          since: options?.since
        }, seen);
      }
    }
  };
}
async function* walkCursorAgentTranscripts(dir: string, options: MessageOptions | undefined, seen: Set<string>, project?: string): AsyncGenerator<AgentMessage> {
  let entries;
  try {
    entries = await readDir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = joinPath(dir, entry);
    if (await isDir(fullPath)) {
      yield* walkCursorAgentTranscripts(fullPath, options, seen, project ?? entry);
    } else if (entry.endsWith(".jsonl")) {
      const session = entry.replace(".jsonl", "");
      yield* parseCursorAgentJsonl(fullPath, { session, project, since: options?.since }, seen);
    }
  }
}
async function* parseCursorAgentJsonl(filePath: string, context: CursorContext, seen: Set<string>): AsyncGenerator<AgentMessage> {
  for await (const line of readLines(filePath)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.role !== "user") continue;
      let text = contentToString(entry.message?.content);
      if (!text) continue;
      text = cleanCursorTranscriptText(text);
      if (!text) continue;
      yield* emitCursorMessage({ text, session: context.session, project: context.project, model: extractModel(entry) ?? context.model }, context.since, seen);
    } catch {
    }
  }
}
function cleanCursorTranscriptText(text: string) {
  return text.replace(/<\/??user_query>/g, "").replace(/<attached_files>[\s\S]*?<\/attached_files>/g, "").replace(/<image_files>[\s\S]*?<\/image_files>/g, "[image]").trim();
}
async function* walkCursorChatStores(dir: string, options: MessageOptions | undefined, seen: Set<string>, workspace?: string): AsyncGenerator<AgentMessage> {
  let entries;
  try {
    entries = await readDir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = joinPath(dir, entry);
    if (!await isDir(fullPath)) continue;
    const storeDb = joinPath(fullPath, "store.db");
    if (await pathExists(storeDb)) {
      yield* parseCursorStoreDb(storeDb, { session: entry, project: workspace, since: options?.since }, seen);
    } else {
      yield* walkCursorChatStores(fullPath, options, seen, workspace ?? entry);
    }
  }
}
function* parseCursorStoreDb(dbPath: string, context: CursorContext, seen: Set<string>): Generator<AgentMessage> {
  let db: SqliteDatabase;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return;
  }
  try {
    const meta = readCursorStoreMeta(db);
    const rootBlobId = meta?.latestRootBlobId;
    if (typeof rootBlobId !== "string") return;
    yield* walkCursorStoreBlob(db, rootBlobId, context, seen, new Set<string>());
  } catch {
  } finally {
    db.close();
  }
}
function readCursorStoreMeta(db: SqliteDatabase) {
  const row = db.prepare("SELECT value FROM meta WHERE key = '0'").get() as { value?: string | Uint8Array } | null;
  const raw = cursorValueToString(row?.value);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(hexToString(raw));
    } catch {
      return null;
    }
  }
}
function hexToString(hex: string) {
  let value = "";
  for (let i = 0; i < hex.length; i += 2) value += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return value;
}
function* walkCursorStoreBlob(db: SqliteDatabase, blobId: string, context: CursorContext, seen: Set<string>, visited: Set<string>): Generator<AgentMessage> {
  if (visited.has(blobId)) return;
  visited.add(blobId);
  const row = db.prepare("SELECT data FROM blobs WHERE id = ?").get(blobId) as { data?: string | Uint8Array } | null;
  if (!row?.data) return;
  const raw = cursorValueToString(row.data);
  if (raw) {
    try {
      const message = JSON.parse(raw);
      if (message.role === "user") {
        const text = contentToString(message.content);
        if (text) yield* emitCursorMessage({ text, session: context.session, project: context.project, model: extractModel(message) ?? context.model }, context.since, seen);
        return;
      }
    } catch {
    }
  }
  for (const ref of parseCursorTreeBlob(row.data)) yield* walkCursorStoreBlob(db, ref, context, seen, visited);
}
function parseCursorTreeBlob(data: string | Uint8Array) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const refs: string[] = [];
  let offset = 0;
  while (offset + 34 <= bytes.length) {
    const tag = bytes[offset];
    const len = bytes[offset + 1];
    if ((tag !== 0x0a && tag !== 0x12) || len !== 0x20) break;
    refs.push(Array.from(bytes.slice(offset + 2, offset + 34)).map((b) => b.toString(16).padStart(2, "0")).join(""));
    offset += 34;
  }
  return refs;
}
function* parseCursorGlobalStateDb(dbPath: string, options: MessageOptions | undefined, seen: Set<string>): Generator<AgentMessage> {
  let db: SqliteDatabase;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return;
  }
  try {
    const composers = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as { key: string; value?: string | Uint8Array }[];
    for (const row of composers) {
      const composerId = row.key.replace("composerData:", "");
      const raw = cursorValueToString(row.value);
      if (!raw) continue;
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      yield* extractCursorMessages(data, { session: composerId, since: options?.since }, seen);
      const bubbles = db.prepare("SELECT value FROM cursorDiskKV WHERE key LIKE ? ORDER BY key").all(`bubbleId:${composerId}:%`) as { value?: string | Uint8Array }[];
      for (const bubble of bubbles) {
        const bubbleRaw = cursorValueToString(bubble?.value);
        if (!bubbleRaw) continue;
        try {
          yield* extractCursorMessages(JSON.parse(bubbleRaw), { session: composerId, since: options?.since }, seen);
        } catch {
        }
      }
    }
  } catch {
  } finally {
    db.close();
  }
}
function* parseCursorStateDb(dbPath: string, context: CursorContext, seen: Set<string>): Generator<AgentMessage> {
  let db: SqliteDatabase;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return;
  }
  try {
    const rows = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").all() as { value?: string | Uint8Array }[];
    for (const row of rows) {
      const raw = cursorValueToString(row.value);
      if (!raw) continue;
      try {
        yield* extractCursorMessages(JSON.parse(raw), context, seen);
      } catch {
      }
    }
  } catch {
  } finally {
    db.close();
  }
}
function* emitCursorMessage(message: AgentMessage, since: Date | undefined, seen: Set<string>): Generator<AgentMessage> {
  if (since && message.timestamp && new Date(message.timestamp) < since) return;
  const key = `${message.session ?? ""}\0${message.timestamp ?? ""}\0${message.text}`;
  if (seen.has(key)) return;
  seen.add(key);
  yield message;
}
function cursorValueToString(value: string | Uint8Array | undefined) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return null;
}
function* extractCursorMessages(value: unknown, context: CursorContext, emitted: Set<string>): Generator<AgentMessage> {
  const visited = new Set<unknown>();
  yield* walkCursorValue(value, context, visited, emitted);
}
function* walkCursorValue(value: unknown, context: CursorContext, seen: Set<unknown>, emitted: Set<string>): Generator<AgentMessage> {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) yield* walkCursorValue(item, context, seen, emitted);
    return;
  }
  const obj = value as Record<string, unknown>;
  const session = typeof obj.composerId === "string" ? obj.composerId : typeof obj.conversationId === "string" ? obj.conversationId : typeof obj.id === "string" ? obj.id : context.session;
  const timestamp = cursorTimestamp(obj) ?? context.timestamp;
  const model = extractModel(obj) ?? context.model;
  if (isCursorUserMessage(obj)) {
    const text = cursorText(obj);
    if (text && (!context.since || !timestamp || new Date(timestamp) >= context.since)) {
      const key = `${session ?? ""}\0${timestamp ?? ""}\0${text}`;
      if (!emitted.has(key)) {
        emitted.add(key);
        yield { text, timestamp, session, model };
      }
    }
  }
  const childContext = { ...context, session, timestamp, model };
  for (const child of Object.values(obj)) yield* walkCursorValue(child, childContext, seen, emitted);
}
function isCursorUserMessage(obj: Record<string, unknown>) {
  return obj.role === "user" || obj.type === "user" || obj.type === 1 || obj.sender === "user" || obj.author === "user" || obj.isUser === true || typeof obj.text === "string" && obj.humanChanges !== void 0;
}
function cursorText(obj: Record<string, unknown>) {
  return contentToString(obj.content) ?? contentToString(obj.text) ?? contentToString(obj.message) ?? contentToString(obj.query);
}
function cursorTimestamp(obj: Record<string, unknown>) {
  const value = obj.timestamp ?? obj.createdAt ?? obj.lastUpdatedAt;
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value).toISOString();
  return null;
}