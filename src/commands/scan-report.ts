import { allAdapters, createAdapter } from "../adapters/index";
import { detect } from "../detector";
import type { AgentStats, CountMap, GroupReport, ScanOptions, ScanReport, VariantTally } from "../types";

export type ScanProgress = { adapter: string };

export async function createScanReport(
  options: ScanOptions,
  onProgress?: (progress: ScanProgress) => void
): Promise<ScanReport> {
  const groupBy = options.by ?? "harness";
  const adapters = options.agent ? [createAdapter(options.agent)] : allAdapters();
  const groupTally: CountMap = {};
  const variantTally: VariantTally = {};
  let totalMessages = 0;
  let totalSwears = 0;
  const perHarness: Record<string, AgentStats> = {};
  const perModel: Record<string, AgentStats> = {};
  const sessions = new Set<string>();
  const sessionsWithSwears = new Set<string>();

  for (const adapter of adapters) {
    onProgress?.({ adapter: adapter.name });
    for await (const message of adapter.messages({ since: options.since })) {
      totalMessages++;
      const harnessStats = perHarness[adapter.name] ??= { messages: 0, swears: 0 };
      const modelStats = perModel[message.model ?? "unknown"] ??= { messages: 0, swears: 0 };
      harnessStats.messages++;
      modelStats.messages++;

      const sessionKey = message.session ? `${adapter.name}\0${message.session}` : undefined;
      if (sessionKey) {
        sessions.add(sessionKey);
      }

      const result = detect(message.text);
      if (result.count === 0) continue;

      totalSwears += result.count;
      harnessStats.swears += result.count;
      modelStats.swears += result.count;
      if (sessionKey) {
        sessionsWithSwears.add(sessionKey);
      }
      for (const match of result.matches) {
        groupTally[match.group] = (groupTally[match.group] ?? 0) + 1;
        const variants = variantTally[match.group] ??= {};
        variants[match.word] = (variants[match.word] ?? 0) + 1;
      }
    }
  }

  const groupsBy = {
    harness: toGroupReports(perHarness),
    model: toGroupReports(perModel)
  };

  const topWords = Object.entries(groupTally).sort(([, a], [, b]) => b - a).slice(0, 10).map(([group, count]) => ({
    group,
    count,
    variants: Object.entries(variantTally[group] ?? {})
      .sort(([, a], [, b]) => b - a)
      .filter(([variant]) => variant !== group)
      .slice(0, 15)
      .map(([word, count]) => ({ word, count }))
  }));

  return {
    groupBy,
    totalMessages,
    totalSwears,
    groups: groupsBy[groupBy],
    groupsBy,
    topWords,
    sessions: sessions.size > 0 ? {
      sessions: sessions.size,
      sessionsWithSwears: sessionsWithSwears.size,
      rate: sessionsWithSwears.size / sessions.size * 100
    } : null
  };
}

function toGroupReports(groups: Record<string, AgentStats>): GroupReport[] {
  return Object.entries(groups).map(([name, stats]) => ({
    name,
    messages: stats.messages,
    swears: stats.swears,
    rate: stats.messages === 0 ? 0 : stats.swears / stats.messages * 100
  }));
}
