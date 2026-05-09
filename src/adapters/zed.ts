import { Database } from "bun:sqlite";
import type { Adapter, SqliteDatabase } from "../types";
import { homeDir, isDir, joinPath, readDir, readText } from "../fs";
import { extractModel } from "./shared";

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
export function zedAdapter(): Adapter {
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
      const conversationModel = extractModel(conversation);
      for (const msg of conversation.messages) {
        if (msg.role !== "user") continue;
        const text = typeof msg.content === "string" ? msg.content : null;
        if (!text) continue;
        yield {
          text,
          session,
          model: extractModel(msg) ?? conversationModel
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