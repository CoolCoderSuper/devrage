import { Database } from "bun:sqlite";
import type { Adapter, AgentMessage, MessageOptions, SqliteDatabase } from "../types";
import { homeDir, joinPath, pathExists } from "../fs";
import { normalizeModel } from "./shared";

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
export function opencodeAdapter(): Adapter {
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
      json_extract(p.data, '$.text') as text,
      json_extract(m.data, '$.model') as model
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
  const rows = db.prepare(query).all() as { text?: string; model?: string; time_created: number; session_id: string }[];
  for (const row of rows) {
    if (!row.text || !row.text.trim()) continue;
    yield {
      text: row.text,
      timestamp: new Date(row.time_created).toISOString(),
      session: row.session_id,
      model: normalizeModel(row.model)
    };
  }
}