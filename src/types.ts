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
export type GroupReport = AgentStats & { name: string; rate: number };
export type WordReport = { group: string; count: number; variants: { word: string; count: number }[] };
export type SessionReport = { sessions: number; sessionsWithSwears: number; rate: number };
export type ScanReport = {
  groupBy: GroupBy;
  totalMessages: number;
  totalSwears: number;
  groups: GroupReport[];
  groupsBy: Record<GroupBy, GroupReport[]>;
  topWords: WordReport[];
  sessions: SessionReport | null;
};
export type SqliteDatabase = InstanceType<typeof Database>;
export type CursorContext = { session?: string; project?: string; timestamp?: string; since?: Date; model?: string };
