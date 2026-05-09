import { Database } from "bun:sqlite";

export type Severity = "mild" | "moderate" | "strong";
export type MessageOptions = { since?: Date };
export type AgentMessage = {
  text: string;
  timestamp?: string;
  session?: string;
  project?: string;
  model?: string;
};
export type Adapter = {
  name: string;
  messages(options?: MessageOptions): AsyncGenerator<AgentMessage>;
};
export type AdapterFactory = () => Adapter;
export type GroupBy = "harness" | "model";
export type ScanOptions = MessageOptions & { agent?: string; by?: GroupBy };
export type CountMap = Record<string, number>;
export type VariantTally = Record<string, CountMap>;
export type AgentStats = { messages: number; swears: number };
export type SqliteDatabase = InstanceType<typeof Database>;
export type CursorContext = { session?: string; project?: string; timestamp?: string; since?: Date; model?: string };
