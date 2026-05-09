import type { Adapter, AdapterFactory } from "../types";
import { ampAdapter } from "./amp";
import { claudeAdapter } from "./claude";
import { clineAdapter } from "./cline";
import { codexAdapter } from "./codex";
import { cursorAdapter } from "./cursor";
import { opencodeAdapter } from "./opencode";
import { piAdapter } from "./pi";
import { vscodeAdapter } from "./vscode";
import { zedAdapter } from "./zed";

const ADAPTERS: Record<string, AdapterFactory> = {
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

export function createAdapter(name: string): Adapter {
  const factory = ADAPTERS[name];
  if (!factory) {
    throw new Error(
      `unknown adapter: ${name} (available: ${Object.keys(ADAPTERS).join(", ")})`
    );
  }
  return factory();
}

export function allAdapters(): Adapter[] {
  return Object.values(ADAPTERS).map((factory) => factory());
}
