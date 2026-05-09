#!/usr/bin/env bun

// src/adapters/amp.ts
import { Database } from "bun:sqlite";

type Severity = "mild" | "moderate" | "strong";
type MessageOptions = { since?: Date };
type AgentMessage = {
  text: string;
  timestamp?: string;
  session?: string;
  project?: string;
};
type Adapter = {
  name: string;
  messages(options?: MessageOptions): AsyncGenerator<AgentMessage>;
};
type ScanOptions = MessageOptions & { agent?: string };
type CountMap = Record<string, number>;
type VariantTally = Record<string, CountMap>;
type AgentStats = { messages: number; swears: number };
type SqliteDatabase = InstanceType<typeof Database>;
type CursorContext = { session?: string; project?: string; timestamp?: string; since?: Date };

const globEntries = new Bun.Glob("*");

function homeDir() {
  return Bun.env["HOME"] ?? Bun.env["USERPROFILE"] ?? "";
}

function joinPath(...parts: string[]) {
  const [first = "", ...rest] = parts;
  const joined = rest.reduce((path, part) => {
    const left = path.replace(/[\\/]+$/, "");
    const right = part.replace(/^[\\/]+/, "");
    return left ? `${left}/${right}` : right;
  }, first);
  return joined.replace(/\\/g, "/");
}

async function readDir(path: string) {
  return Array.fromAsync(globEntries.scan({ cwd: path, dot: true, onlyFiles: false }));
}

async function readText(path: string) {
  return Bun.file(path).text();
}

async function pathExists(path: string) {
  return Bun.file(path).exists();
}

async function isDir(path: string) {
  try {
    await readDir(path);
    return true;
  } catch {
    return false;
  }
}

async function* readLines(path: string) {
  const text = await readText(path);
  for (const line of text.split(/\r?\n/)) yield line;
}

function getAmpThreadsDir() {
  return joinPath(
    Bun.env["XDG_DATA_HOME"] ?? joinPath(homeDir(), ".local", "share"),
    "amp",
    "threads"
  );
}
function ampAdapter(): Adapter {
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
              session: threadId
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

// src/adapters/claude.ts
var CLAUDE_DIR = joinPath(homeDir(), ".claude", "projects");
function claudeAdapter(): Adapter {
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
  for await (const line of readLines(filePath)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
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
        project: context.project
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

// src/adapters/cline.ts
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
function getVSCodeGlobalStoragePaths() {
  const paths = [];
  if (process.platform === "darwin") {
    paths.push(
      joinPath(homeDir(), "Library", "Application Support", "Code", "User", "globalStorage"),
      joinPath(homeDir(), "Library", "Application Support", "Code - Insiders", "User", "globalStorage"),
      joinPath(homeDir(), "Library", "Application Support", "Cursor", "User", "globalStorage")
    );
  } else if (process.platform === "linux") {
    const configBase = Bun.env["XDG_CONFIG_HOME"] ?? joinPath(homeDir(), ".config");
    paths.push(
      joinPath(configBase, "Code", "User", "globalStorage"),
      joinPath(configBase, "Code - Insiders", "User", "globalStorage"),
      joinPath(configBase, "Cursor", "User", "globalStorage")
    );
  } else {
    const appData = Bun.env["APPDATA"] ?? joinPath(homeDir(), "AppData", "Roaming");
    paths.push(
      joinPath(appData, "Code", "User", "globalStorage"),
      joinPath(appData, "Code - Insiders", "User", "globalStorage"),
      joinPath(appData, "Cursor", "User", "globalStorage")
    );
  }
  return paths;
}
function getVSCodeUserPaths() {
  if (process.platform === "darwin") {
    return [
      joinPath(homeDir(), "Library", "Application Support", "Code", "User"),
      joinPath(homeDir(), "Library", "Application Support", "Code - Insiders", "User")
    ];
  }
  if (process.platform === "linux") {
    const configBase = Bun.env["XDG_CONFIG_HOME"] ?? joinPath(homeDir(), ".config");
    return [
      joinPath(configBase, "Code", "User"),
      joinPath(configBase, "Code - Insiders", "User")
    ];
  }
  const appData = Bun.env["APPDATA"] ?? joinPath(homeDir(), "AppData", "Roaming");
  return [
    joinPath(appData, "Code", "User"),
    joinPath(appData, "Code - Insiders", "User")
  ];
}
function vscodeAdapter(): Adapter {
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
    for (const req of requests) {
      const text = typeof req?.message?.text === "string" ? req.message.text : null;
      if (!text) continue;
      const timestamp = vscodeTimestamp(req) ?? vscodeTimestamp(data);
      if (context.since && timestamp && new Date(timestamp) < context.since) continue;
      yield { text, timestamp, session, project: context.project };
    }
  } catch {
  }
}
async function* parseVSCodeJsonl(filePath: string, context: CursorContext): AsyncGenerator<AgentMessage> {
  const state = await reconstructVSCodeSession(filePath);
  if (!state) return;
  const session = typeof state.sessionId === "string" ? state.sessionId : context.session;
  const requests = Array.isArray(state.requests) ? state.requests : [];
  for (const req of requests) {
    const text = extractVSCodeUserText(req?.result?.metadata?.renderedUserMessage);
    if (!text) continue;
    const timestamp = vscodeTimestamp(req) ?? vscodeTimestamp(state);
    if (context.since && timestamp && new Date(timestamp) < context.since) continue;
    yield { text, timestamp, session, project: context.project };
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
function cursorAdapter(): Adapter {
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
      yield* emitCursorMessage({ text, session: context.session, project: context.project }, context.since, seen);
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
        if (text) yield* emitCursorMessage({ text, session: context.session, project: context.project }, context.since, seen);
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
  if (isCursorUserMessage(obj)) {
    const text = cursorText(obj);
    if (text && (!context.since || !timestamp || new Date(timestamp) >= context.since)) {
      const key = `${session ?? ""}\0${timestamp ?? ""}\0${text}`;
      if (!emitted.has(key)) {
        emitted.add(key);
        yield { text, timestamp, session };
      }
    }
  }
  const childContext = { ...context, session, timestamp };
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
function clineAdapter(): Adapter {
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
            for (const msg of messages) {
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
                session: taskId
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

// src/adapters/codex.ts
var CODEX_SESSIONS_DIR = joinPath(homeDir(), ".codex", "sessions");
function codexAdapter(): Adapter {
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
  for await (const line of readLines(filePath)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
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
        session: context.session
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

// src/adapters/opencode.ts
async function getOpencodeDatabasePath() {
  const xdgPath = joinPath(
    Bun.env["XDG_DATA_HOME"] ?? joinPath(homeDir(), ".local", "share"),
    "opencode",
    "opencode.db"
  );
  if (await pathExists(xdgPath)) return xdgPath;
  if (process.platform === "darwin") {
    const macPath = joinPath(
      homeDir(),
      "Library",
      "Application Support",
      "opencode",
      "opencode.db"
    );
    if (await pathExists(macPath)) return macPath;
  }
  return null;
}
function opencodeAdapter(): Adapter {
  return {
    name: "opencode",
    async *messages(options) {
      const dbPath = await getOpencodeDatabasePath();
      if (!dbPath) return;
      let db: SqliteDatabase;
      try {
        db = new Database(dbPath, { readonly: true });
      } catch {
        console.warn(
          "devrage: unable to open OpenCode database, skipping OpenCode sessions"
        );
        return;
      }
      try {
        yield* queryUserMessages(db, options);
      } finally {
        db.close();
      }
    }
  };
}
function* queryUserMessages(db: SqliteDatabase, options: MessageOptions | undefined): Generator<AgentMessage> {
  let query = `
    SELECT
      m.session_id,
      m.time_created,
      json_extract(p.data, '$.text') as text
    FROM message m
    JOIN part p ON p.message_id = m.id
    WHERE json_extract(m.data, '$.role') = 'user'
      AND json_extract(p.data, '$.type') = 'text'
  `;
  if (options?.since) {
    const sinceMs = options.since.getTime();
    query += ` AND m.time_created >= ${sinceMs}`;
  }
  query += ` ORDER BY m.time_created ASC`;
  const rows = db.prepare(query).all() as { text?: string; time_created: number; session_id: string }[];
  for (const row of rows) {
    if (!row.text || !row.text.trim()) continue;
    yield {
      text: row.text,
      timestamp: new Date(row.time_created).toISOString(),
      session: row.session_id
    };
  }
}

// src/adapters/zed.ts
function getZedPaths() {
  if (process.platform === "darwin") {
    const base2 = joinPath(homeDir(), "Library", "Application Support", "Zed");
    return {
      conversations: joinPath(base2, "conversations"),
      db: joinPath(base2, "db")
    };
  }
  const base = joinPath(
    Bun.env["XDG_DATA_HOME"] ?? joinPath(homeDir(), ".local", "share"),
    "zed"
  );
  return {
    conversations: joinPath(base, "conversations"),
    db: joinPath(base, "db")
  };
}
function zedAdapter(): Adapter {
  return {
    name: "zed",
    async *messages(options) {
      const paths = getZedPaths();
      yield* parseTextThreads(paths.conversations, options);
      yield* parseAgentThreads(paths.db, options);
    }
  };
}
async function* parseTextThreads(dir, _options) {
  if (!await isDir(dir)) return;
  let files;
  try {
    files = await readDir(dir);
  } catch {
    return;
  }
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  for (const file of jsonFiles) {
    const filePath = joinPath(dir, file);
    const session = file.replace(".json", "");
    try {
      const raw = await readText(filePath);
      const conversation = JSON.parse(raw);
      if (!conversation.messages || !Array.isArray(conversation.messages)) continue;
      for (const msg of conversation.messages) {
        if (msg.role !== "user") continue;
        const text = typeof msg.content === "string" ? msg.content : null;
        if (!text) continue;
        yield {
          text,
          session
        };
      }
    } catch {
    }
  }
}
async function* parseAgentThreads(dbDir, _options) {
  if (!await isDir(dbDir)) return;
  let dbFiles;
  try {
    const entries = await readDir(dbDir);
    dbFiles = entries.filter((f) => f.endsWith(".db"));
  } catch {
    return;
  }
  if (dbFiles.length === 0) return;
  for (const dbFile of dbFiles) {
    const dbPath = joinPath(dbDir, dbFile);
    let db: SqliteDatabase;
    try {
      db = new Database(
        dbPath,
        { readonly: true }
      );
    } catch {
      continue;
    }
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);
      const msgTable = tableNames.find(
        (t) => t === "messages" || t === "thread_messages" || t.includes("message")
      );
      if (!msgTable) {
        db.close();
        continue;
      }
      const columns = db.prepare(`PRAGMA table_info("${msgTable}")`).all() as { name: string }[];
      const colNames = columns.map((c2) => c2.name);
      const hasRole = colNames.includes("role");
      if (!hasRole) {
        db.close();
        continue;
      }
      const contentCol = colNames.includes("content") ? "content" : colNames.includes("body") ? "body" : "text";
      let query = `SELECT "${contentCol}" as text FROM "${msgTable}" WHERE role = 'user'`;
      const rows = db.prepare(query).all() as { text?: string }[];
      for (const row of rows) {
        if (!row.text?.trim()) continue;
        yield { text: row.text };
      }
    } catch {
    } finally {
      db.close();
    }
  }
}

// src/adapters/pi.ts
var PI_SESSIONS_DIR = joinPath(homeDir(), ".pi", "agent", "sessions");
function piAdapter(): Adapter {
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
  for await (const line of readLines(filePath)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
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
        project
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

// src/adapters/index.ts
var ADAPTERS = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  amp: ampAdapter,
  cursor: cursorAdapter,
  vscode: vscodeAdapter,
  cline: clineAdapter,
  zed: zedAdapter,
  pi: piAdapter
};
function createAdapter(name: string): Adapter {
  const factory = ADAPTERS[name];
  if (!factory) {
    throw new Error(
      `unknown adapter: ${name} (available: ${Object.keys(ADAPTERS).join(", ")})`
    );
  }
  return factory();
}
function allAdapters(): Adapter[] {
  return Object.values(ADAPTERS).map((f) => f());
}

// src/detector/index.ts
var WORDLIST = [
  // === FUCK family (strong) ===
  // Canonical forms
  { word: "fuck", severity: "strong", group: "fuck" },
  { word: "fucking", severity: "strong", group: "fuck" },
  { word: "fucked", severity: "strong", group: "fuck" },
  { word: "fucker", severity: "strong", group: "fuck" },
  { word: "fuckin", severity: "strong", group: "fuck" },
  { word: "fucks", severity: "strong", group: "fuck" },
  // Compound words
  { word: "motherfucker", severity: "strong", group: "fuck" },
  { word: "motherfucking", severity: "strong", group: "fuck" },
  { word: "mothafucka", severity: "strong", group: "fuck" },
  { word: "fuckup", severity: "strong", group: "fuck" },
  { word: "fuckoff", severity: "strong", group: "fuck" },
  { word: "clusterfuck", severity: "strong", group: "fuck" },
  { word: "fuckwit", severity: "strong", group: "fuck" },
  { word: "fucktard", severity: "strong", group: "fuck" },
  { word: "fuckface", severity: "strong", group: "fuck" },
  { word: "fuckhead", severity: "strong", group: "fuck" },
  // Typos — transpositions
  { word: "fukc", severity: "strong", group: "fuck" },
  { word: "fukcing", severity: "strong", group: "fuck" },
  { word: "fukced", severity: "strong", group: "fuck" },
  { word: "fukcer", severity: "strong", group: "fuck" },
  { word: "fcuk", severity: "strong", group: "fuck" },
  { word: "fcuking", severity: "strong", group: "fuck" },
  { word: "fcuked", severity: "strong", group: "fuck" },
  { word: "fuk", severity: "strong", group: "fuck" },
  { word: "fuking", severity: "strong", group: "fuck" },
  { word: "fuked", severity: "strong", group: "fuck" },
  { word: "fuker", severity: "strong", group: "fuck" },
  { word: "fuxk", severity: "strong", group: "fuck" },
  { word: "fuxking", severity: "strong", group: "fuck" },
  // === SHIT family (strong) ===
  { word: "shit", severity: "strong", group: "shit" },
  { word: "shitty", severity: "strong", group: "shit" },
  { word: "shitting", severity: "strong", group: "shit" },
  { word: "shits", severity: "strong", group: "shit" },
  { word: "shitted", severity: "strong", group: "shit" },
  // Compound words
  { word: "bullshit", severity: "strong", group: "shit" },
  { word: "horseshit", severity: "strong", group: "shit" },
  { word: "dipshit", severity: "strong", group: "shit" },
  { word: "shitshow", severity: "strong", group: "shit" },
  { word: "shithead", severity: "strong", group: "shit" },
  { word: "shithole", severity: "strong", group: "shit" },
  { word: "shitface", severity: "strong", group: "shit" },
  { word: "shitfaced", severity: "strong", group: "shit" },
  { word: "shitstain", severity: "strong", group: "shit" },
  { word: "shitbag", severity: "strong", group: "shit" },
  // Typos
  { word: "hsit", severity: "strong", group: "shit" },
  { word: "siht", severity: "strong", group: "shit" },
  { word: "shti", severity: "strong", group: "shit" },
  { word: "sjit", severity: "strong", group: "shit" },
  { word: "shjt", severity: "strong", group: "shit" },
  { word: "bulshit", severity: "strong", group: "shit" },
  { word: "bullsht", severity: "strong", group: "shit" },
  // === ASS family (moderate) ===
  { word: "ass", severity: "moderate", group: "ass" },
  { word: "asses", severity: "moderate", group: "ass" },
  // Compound words (these are strong)
  { word: "asshole", severity: "strong", group: "ass" },
  { word: "assholes", severity: "strong", group: "ass" },
  { word: "jackass", severity: "strong", group: "ass" },
  { word: "dumbass", severity: "strong", group: "ass" },
  { word: "fatass", severity: "moderate", group: "ass" },
  { word: "asshat", severity: "strong", group: "ass" },
  { word: "asswipe", severity: "strong", group: "ass" },
  { word: "badass", severity: "mild", group: "ass" },
  // === DAMN family (moderate) ===
  { word: "damn", severity: "moderate", group: "damn" },
  { word: "damned", severity: "moderate", group: "damn" },
  { word: "damnit", severity: "moderate", group: "damn" },
  { word: "dammit", severity: "moderate", group: "damn" },
  { word: "goddamn", severity: "moderate", group: "damn" },
  { word: "goddamnit", severity: "moderate", group: "damn" },
  { word: "goddammit", severity: "moderate", group: "damn" },
  // === BITCH family (strong) ===
  { word: "bitch", severity: "strong", group: "bitch" },
  { word: "bitches", severity: "strong", group: "bitch" },
  { word: "bitching", severity: "strong", group: "bitch" },
  { word: "bitchy", severity: "strong", group: "bitch" },
  { word: "bitchass", severity: "strong", group: "bitch" },
  // === BASTARD (strong) ===
  { word: "bastard", severity: "strong", group: "bastard" },
  { word: "bastards", severity: "strong", group: "bastard" },
  // === PISS family (moderate) ===
  { word: "piss", severity: "moderate", group: "piss" },
  { word: "pissed", severity: "moderate", group: "piss" },
  { word: "pissing", severity: "moderate", group: "piss" },
  { word: "pissoff", severity: "moderate", group: "piss" },
  // === DICK (moderate) ===
  { word: "dick", severity: "moderate", group: "dick" },
  { word: "dickhead", severity: "strong", group: "dick" },
  // === CRAP (moderate) ===
  { word: "crap", severity: "moderate", group: "crap" },
  { word: "crappy", severity: "moderate", group: "crap" },
  { word: "crapping", severity: "moderate", group: "crap" },
  // === HELL (mild) ===
  { word: "hell", severity: "mild", group: "hell" },
  // === Abbreviations (mild) ===
  { word: "wtf", severity: "mild", group: "wtf" },
  { word: "stfu", severity: "mild", group: "stfu" },
  { word: "lmfao", severity: "mild", group: "lmfao" },
  { word: "lmao", severity: "mild", group: "lmao" },
  // === CUNT (strong) ===
  { word: "cunt", severity: "strong", group: "cunt" },
  { word: "cunts", severity: "strong", group: "cunt" }
] satisfies { word: string; severity: Severity; group: string }[];
function collapseRepeats(text) {
  return text.replace(/(.)\1+/g, "$1");
}
function buildPattern(words) {
  const sorted = [...words].sort((a, b) => b.word.length - a.word.length);
  const pattern = sorted.map((w) => w.word).join("|");
  return new RegExp(`\\b(${pattern})\\b`, "gi");
}
var DEFAULT_PATTERN = buildPattern(WORDLIST);
var WORD_MAP = new Map(WORDLIST.map((w) => [w.word.toLowerCase(), w]));
function detect(text) {
  const matches = [];
  const seen = /* @__PURE__ */ new Set();
  runPattern(text, text.toLowerCase(), matches, seen);
  const collapsed = collapseRepeats(text.toLowerCase());
  if (collapsed !== text.toLowerCase()) {
    runPattern(text, collapsed, matches, seen);
  }
  return { count: matches.length, matches };
}
function runPattern(_originalText, searchText, matches, seen) {
  DEFAULT_PATTERN.lastIndex = 0;
  let match;
  while ((match = DEFAULT_PATTERN.exec(searchText)) !== null) {
    if (seen.has(match.index)) continue;
    const word = match[0].toLowerCase();
    const entry = WORD_MAP.get(word);
    if (!entry) continue;
    seen.add(match.index);
    matches.push({
      word,
      index: match.index,
      severity: entry.severity,
      group: entry.group
    });
  }
}

// src/commands/scan.ts
var c = {
  reset: "\x1B[0m",
  bold: "\x1B[1m",
  dim: "\x1B[2m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  blue: "\x1B[34m",
  magenta: "\x1B[35m",
  cyan: "\x1B[36m",
  white: "\x1B[37m",
  gray: "\x1B[90m"
};
var SPINNER_MESSAGES = [
  "Tallying the damage",
  "Reviewing your outbursts",
  "Judging your vocabulary",
  "Computing your shame",
  "Cataloging the profanity",
  "Measuring your frustration",
  "Assessing the verbal carnage",
  "Quantifying your displeasure",
  "Auditing your language",
  "Tabulating regrets"
];
function createSpinner() {
  let messageIdx = 0;
  let dotCount = 0;
  let timer = null;
  return {
    start() {
      messageIdx = Math.floor(Math.random() * SPINNER_MESSAGES.length);
      timer = setInterval(() => {
        dotCount = (dotCount + 1) % 4;
        const msg = SPINNER_MESSAGES[messageIdx % SPINNER_MESSAGES.length];
        const dots = ".".repeat(dotCount || 1);
        process.stdout.write(
          `\r  ${c.dim}${msg}${dots}${c.reset}   `
        );
      }, 300);
    },
    update() {
      messageIdx++;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      process.stdout.write("\r" + " ".repeat(60) + "\r");
    }
  };
}
function parseArgs(args): ScanOptions {
  const options: ScanOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--agent" || arg === "-a") {
      options.agent = args[++i];
    } else if (arg === "--since" || arg === "-s") {
      const val = args[++i];
      if (val) {
        options.since = new Date(val);
        if (isNaN(options.since.getTime())) {
          console.error(`invalid date: ${val}`);
          process.exit(1);
        }
      }
    } else if (arg === "--help" || arg === "-h") {
      console.log(`devrage scan \u2014 scan sessions for profanity

Options:
  --agent, -a <name>   Scan only a specific agent (claude, codex, opencode, amp, cursor, vscode, cline, zed, pi)
  --since, -s <date>   Only scan messages after this date (ISO 8601)
  --help, -h           Show this help`);
      process.exit(0);
    }
  }
  return options;
}
async function scan(args) {
  const options = parseArgs(args);
  const adapters = options.agent ? [createAdapter(options.agent)] : allAdapters();
  const spinner = createSpinner();
  spinner.start();
  const groupTally: CountMap = {};
  const variantTally: VariantTally = {};
  let totalMessages = 0;
  let totalSwears = 0;
  const perAgent: Record<string, AgentStats> = {};
  const sessions = new Set<string>();
  const sessionsWithSwears = new Set<string>();
  const sessionsByAgent: Record<string, Set<string>> = {};
  const sessionsWithSwearsByAgent: Record<string, Set<string>> = {};
  for (const adapter of adapters) {
    let agentMessages = 0;
    let agentSwears = 0;
    spinner.update();
    for await (const message of adapter.messages({ since: options.since })) {
      totalMessages++;
      agentMessages++;
      const sessionKey = message.session ? `${adapter.name}\0${message.session}` : undefined;
      if (sessionKey) {
        sessions.add(sessionKey);
        (sessionsByAgent[adapter.name] ??= new Set()).add(sessionKey);
      }
      const result = detect(message.text);
      if (result.count > 0) {
        totalSwears += result.count;
        agentSwears += result.count;
        if (sessionKey) {
          sessionsWithSwears.add(sessionKey);
          (sessionsWithSwearsByAgent[adapter.name] ??= new Set()).add(sessionKey);
        }
        for (const match of result.matches) {
          groupTally[match.group] = (groupTally[match.group] ?? 0) + 1;
          const variants = variantTally[match.group] ??= {};
          variants[match.word] = (variants[match.word] ?? 0) + 1;
        }
      }
    }
    if (agentMessages > 0) {
      perAgent[adapter.name] = { messages: agentMessages, swears: agentSwears };
    }
  }
  spinner.stop();
  console.log("");
  console.log(`  ${c.bold}${c.red}devrage${c.reset} ${c.dim}report${c.reset}`);
  console.log(`  ${c.dim}${"\u2500".repeat(30)}${c.reset}`);
  console.log("");
  console.log(`  ${c.dim}messages scanned${c.reset}  ${c.bold}${totalMessages}${c.reset}`);
  console.log(`  ${c.dim}total swears${c.reset}      ${c.bold}${c.red}${totalSwears}${c.reset}`);
  const activeAgents = Object.entries(perAgent);
  if (activeAgents.length > 1) {
    console.log("");
    console.log(`  ${c.bold}by agent${c.reset}`);
    for (const [name, stats] of activeAgents) {
      const rate = (stats.swears / stats.messages * 100).toFixed(1);
      console.log(
        `    ${c.cyan}${name.padEnd(10)}${c.reset} ${c.bold}${String(stats.swears).padStart(4)}${c.reset} ${c.dim}in ${stats.messages} messages (${rate}%)${c.reset}`
      );
    }
  }
  if (totalSwears > 0) {
    const sorted = Object.entries(groupTally).sort(([, a], [, b]) => b - a);
    console.log("");
    console.log(`  ${c.bold}top words${c.reset}`);
    for (const [group, count] of sorted.slice(0, 10)) {
      const variants = variantTally[group] ?? {};
      const variantList = Object.entries(variants).sort(([, a], [, b]) => b - a).filter(([v]) => v !== group).slice(0, 15).map(([v, cnt]) => `${c.dim}${v}${c.reset} ${cnt}`).join(`${c.dim},${c.reset} `);
      const suffix = variantList ? ` ${c.dim}(${c.reset}${variantList}${c.dim})${c.reset}` : "";
      console.log(
        `    ${c.yellow}${group.padEnd(12)}${c.reset} ${c.bold}${String(count).padStart(4)}${c.reset}${suffix}`
      );
    }
  }
  console.log("");
  if (totalSwears === 0) {
    console.log(`  ${c.green}squeaky clean! not a single swear found.${c.reset}`);
    console.log("");
  }
  if (sessions.size > 0) {
    const sessionRate = (sessionsWithSwears.size / sessions.size * 100).toFixed(1);
    console.log(`  ${c.dim}sessions with swearing${c.reset} ${c.bold}${sessionRate}%${c.reset} ${c.dim}(${sessionsWithSwears.size}/${sessions.size})${c.reset}`);
    const sessionAgents = Object.entries(sessionsByAgent);
    if (sessionAgents.length > 1) {
      console.log(`  ${c.dim}by editor${c.reset}`);
      for (const [name, agentSessions] of sessionAgents) {
        const agentSessionsWithSwears = sessionsWithSwearsByAgent[name]?.size ?? 0;
        const agentSessionRate = (agentSessionsWithSwears / agentSessions.size * 100).toFixed(1);
        console.log(`    ${c.cyan}${name.padEnd(10)}${c.reset} ${c.bold}${agentSessionRate.padStart(5)}%${c.reset} ${c.dim}(${agentSessionsWithSwears}/${agentSessions.size})${c.reset}`);
      }
    }
    console.log("");
  }
}

// src/cli.ts
var COMMANDS = {
  scan
};
function usage() {
  console.log(`devrage \u2014 count how many times you swear at your coding agents

Usage:
  devrage <command> [options]

Commands:
  scan          Scan sessions for profanity

Options:
  --help, -h    Show this help message
  --version     Show version

Examples:
  devrage scan
  devrage scan --agent claude
  devrage scan --since 2025-01-01`);
}
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === "--help" || command === "-h") {
    usage();
    process.exit(0);
  }
  if (command === "--version") {
    console.log("0.0.3");
    process.exit(0);
  }
  const handler = command ? COMMANDS[command] : void 0;
  if (handler) {
    await handler(args.slice(1));
  } else {
    await scan(args);
  }
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
//# sourceMappingURL=cli.js.map
