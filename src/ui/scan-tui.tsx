import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import type { ScrollBoxRenderable } from "@opentui/core";
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { createScanReport } from "../commands/scan-report";
import type { GroupBy, GroupReport, ScanOptions, ScanReport, WordReport } from "../types";

const SPINNER_MESSAGES = [
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

export async function renderScanTui(options: ScanOptions) {
  await new Promise<void>((resolve, reject) => {
    render(() => <ScanApp options={options} />, {
      screenMode: "alternate-screen",
      consoleMode: "disabled",
      exitOnCtrlC: true,
      targetFps: 30,
      onDestroy: resolve
    }).catch(reject);
  });
}

function ScanApp(props: { options: ScanOptions }) {
  const renderer = useRenderer();
  const [report, setReport] = createSignal<ScanReport | null>(null);
  const [activeGroup, setActiveGroup] = createSignal<GroupBy>(props.options.by ?? "harness");
  const [showAllModels, setShowAllModels] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [messageIndex, setMessageIndex] = createSignal(Math.floor(Math.random() * SPINNER_MESSAGES.length));
  const [dotCount, setDotCount] = createSignal(1);
  const [currentAdapter, setCurrentAdapter] = createSignal<string | null>(null);

  useKeyboard((key) => {
    const name = key.name?.toLowerCase();
    if (name === "q" || name === "escape" || key.ctrl && name === "c") {
      renderer.destroy();
    } else if (name === "tab" || name === "right" || name === "left") {
      setActiveGroup((group) => group === "harness" ? "model" : "harness");
    } else if (name === "a" && activeGroup() === "model") {
      setShowAllModels((value) => !value);
    }
  });

  onMount(() => {
    const timer = setInterval(() => {
      setDotCount((count) => count % 3 + 1);
      setMessageIndex((index) => index + 1);
    }, 300);
    onCleanup(() => clearInterval(timer));

    createScanReport(props.options, ({ adapter }) => setCurrentAdapter(adapter))
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  });

  return (
    <box width="100%" height="100%" padding={1} flexDirection="column" backgroundColor="#0b0d12">
      <Show when={error()}>
        {(message) => <ErrorView message={message()} />}
      </Show>
      <Show when={!error() && !report()}>
        <LoadingView
          message={SPINNER_MESSAGES[messageIndex() % SPINNER_MESSAGES.length]}
          dots={".".repeat(dotCount())}
          adapter={currentAdapter()}
        />
      </Show>
      <Show when={report()}>
        {(value) => (
          <ReportView
            report={value()}
            activeGroup={activeGroup()}
            setActiveGroup={setActiveGroup}
            showAllModels={showAllModels()}
            setShowAllModels={setShowAllModels}
          />
        )}
      </Show>
    </box>
  );
}

function Header() {
  return (
    <box flexShrink={0} flexDirection="column" marginBottom={1}>
      <text fg="#ff4d6d">devrage report</text>
      <text fg="#394150">────────────────────────────────────────</text>
    </box>
  );
}

function LoadingView(props: { message: string; dots: string; adapter: string | null }) {
  return (
    <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center">
      <text fg="#b7c0d8">{props.message}{props.dots}</text>
      <Show when={props.adapter}>
        {(adapter) => <text fg="#6f7787" marginTop={1}>scanning {adapter()}</text>}
      </Show>
    </box>
  );
}

function ErrorView(props: { message: string }) {
  return (
    <box border borderColor="#ff4d6d" padding={1} flexDirection="column">
      <text fg="#ff4d6d">scan failed</text>
      <text fg="#d7dbea" marginTop={1} wrapMode="word">{props.message}</text>
    </box>
  );
}

function ReportView(props: {
  report: ScanReport;
  activeGroup: GroupBy;
  setActiveGroup: (group: GroupBy) => void;
  showAllModels: boolean;
  setShowAllModels: (showAll: boolean | ((showAll: boolean) => boolean)) => void;
}) {
  let scrollbox: ScrollBoxRenderable | undefined;
  const dimensions = useTerminalDimensions();
  const report = () => props.report;
  const groups = () => {
    const groups = report().groupsBy[props.activeGroup];
    if (props.activeGroup !== "model" || props.showAllModels) return groups;
    return groups.filter((group) => group.swears >= 5);
  };
  const hiddenModelCount = () => report().groupsBy.model.filter((group) => group.swears < 5).length;
  const needsScroll = () => estimateContentRows(report(), groups()) > dimensions().height - 12;

  createEffect(() => {
    props.activeGroup;
    props.showAllModels;
    report();
    scrollbox?.scrollTo(0);
  });

  return (
    <box width="100%" height="100%" flexDirection="column">
      <Header />
      <box flexShrink={0} flexDirection="row" columnGap={3} marginBottom={1}>
        <Metric label="messages scanned" value={String(report().totalMessages)} color="#d7dbea" />
        <Metric label="total swears" value={String(report().totalSwears)} color="#ff4d6d" />
      </box>

      <GroupTabs activeGroup={props.activeGroup} setActiveGroup={props.setActiveGroup} />
      <Show when={props.activeGroup === "model" && hiddenModelCount() > 0}>
        <ModelFilterToggle
          showAll={props.showAllModels}
          hiddenCount={hiddenModelCount()}
          onToggle={() => props.setShowAllModels((showAll) => !showAll)}
        />
      </Show>
      <Show
        when={needsScroll()}
        fallback={(
          <box width="100%" flexGrow={1} flexShrink={1} flexDirection="column">
            <ReportContent report={report()} groups={groups()} emptyMessage={props.activeGroup === "model" ? "no models with 5+ swears." : undefined} />
          </box>
        )}
      >
        <scrollbox
          ref={scrollbox}
          width="100%"
          flexGrow={1}
          flexShrink={1}
          flexDirection="column"
          stickyScroll
          stickyStart="top"
          scrollY
          verticalScrollbarOptions={{ visible: false }}
        >
          <ReportContent report={report()} groups={groups()} emptyMessage={props.activeGroup === "model" ? "no models with 5+ swears." : undefined} />
        </scrollbox>
      </Show>
      <text fg="#6f7787" flexShrink={0} marginTop={1}>
        Tab/Left/Right switches view. {props.activeGroup === "model" ? "Press a to show all models. " : ""}Press q, Esc, or Ctrl+C to exit.
      </text>
    </box>
  );
}

function ReportContent(props: { report: ScanReport; groups: GroupReport[]; emptyMessage?: string }) {
  return (
    <box width="100%" flexDirection="column">
      <GroupView groups={props.groups} emptyMessage={props.emptyMessage} />
      <SummaryView report={props.report} />
    </box>
  );
}

function estimateContentRows(report: ScanReport, groups: GroupReport[]) {
  let rows = 1 + groups.length;
  if (report.topWords.length > 0) rows += 1 + report.topWords.length;
  if (report.totalSwears === 0) rows += 1;
  if (report.sessions) rows += 2;
  return rows;
}

function SummaryView(props: { report: ScanReport }) {
  return (
    <box flexDirection="column">
      <Show when={props.report.topWords.length > 0}>
        <SectionTitle>top words</SectionTitle>
        <For each={props.report.topWords}>
          {(word) => <WordRow word={word} />}
        </For>
      </Show>

      <Show when={props.report.totalSwears === 0}>
        <text fg="#7ee787" marginTop={1}>squeaky clean! not a single swear found.</text>
      </Show>

      <Show when={props.report.sessions}>
        {(sessions) => <text fg="#d7dbea" marginTop={1}>sessions with swearing {sessions().rate.toFixed(1)}% ({sessions().sessionsWithSwears}/{sessions().sessions})</text>}
      </Show>
    </box>
  );
}

function GroupTabs(props: { activeGroup: GroupBy; setActiveGroup: (group: GroupBy) => void }) {
  return (
    <box flexShrink={0} flexDirection="row" columnGap={2} marginTop={1} marginBottom={1}>
      <TabLabel label="harness" active={props.activeGroup === "harness"} onSelect={() => props.setActiveGroup("harness")} />
      <TabLabel label="model" active={props.activeGroup === "model"} onSelect={() => props.setActiveGroup("model")} />
    </box>
  );
}

function TabLabel(props: { label: GroupBy; active: boolean; onSelect: () => void }) {
  const marker = props.active ? "●" : "○";
  return <text fg={props.active ? "#ff4d6d" : "#6f7787"} onMouseDown={props.onSelect}>{marker} {props.label}</text>;
}

function ModelFilterToggle(props: { showAll: boolean; hiddenCount: number; onToggle: () => void }) {
  const marker = props.showAll ? "●" : "○";
  const label = props.showAll ? "showing all models" : `hiding ${props.hiddenCount} model${props.hiddenCount === 1 ? "" : "s"} under 5 swears`;
  return (
    <text fg={props.showAll ? "#ff4d6d" : "#6f7787"} marginBottom={1} onMouseDown={props.onToggle}>
      {marker} {label}
    </text>
  );
}

function GroupView(props: { groups: GroupReport[]; emptyMessage?: string }) {
  return (
    <box flexDirection="column">
      <Show when={props.groups.length > 0} fallback={<text fg="#6f7787" marginLeft={2}>{props.emptyMessage ?? "no groups found."}</text>}>
        <text fg="#6f7787" marginLeft={2}>{formatGroupHeader()}</text>
        <For each={props.groups}>
        {(group) => (
          <text fg="#d7dbea" marginLeft={2} truncate>{formatGroupRow(group)}</text>
        )}
        </For>
      </Show>
    </box>
  );
}

function formatGroupHeader() {
  return `${"model/harness".padEnd(34)} ${"swears".padStart(4)} in messages (rate)`;
}

function formatGroupRow(group: GroupReport) {
  const name = truncateLabel(formatGroupName(group.name), 34).padEnd(34);
  return `${name} ${String(group.swears).padStart(4)} in ${group.messages} messages (${group.rate.toFixed(1)}%)`;
}

function formatGroupName(name: string) {
  if (!name.startsWith("{")) return name;
  try {
    const parsed = JSON.parse(name) as { modelID?: unknown; model?: unknown; providerID?: unknown };
    const model = typeof parsed.modelID === "string" ? parsed.modelID : typeof parsed.model === "string" ? parsed.model : null;
    const provider = typeof parsed.providerID === "string" ? parsed.providerID : null;
    if (model && provider) return `${provider}/${model}`;
    if (model) return model;
  } catch {
    return name;
  }
  return name;
}

function truncateLabel(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function Metric(props: { label: string; value: string; color: string }) {
  return (
    <text fg="#6f7787">{props.label} <span>{props.value}</span></text>
  );
}

function SectionTitle(props: { children: unknown }) {
  return <text fg="#d7dbea" marginTop={1}>{props.children}</text>;
}

function WordRow(props: { word: WordReport }) {
  const variants = () => props.word.variants.map((variant) => `${variant.word} ${variant.count}`).join(", ");
  return (
    <text fg="#ffd166" marginLeft={2} wrapMode="word">
      {props.word.group.padEnd(12)} {String(props.word.count).padStart(4)}
      <Show when={variants()}>
        {(value) => ` (${value()})`}
      </Show>
    </text>
  );
}
