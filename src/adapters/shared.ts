export function extractModel(value: unknown): string | undefined {
  return extractModelFrom(value, new Set(), 0);
}

function extractModelFrom(value: unknown, seen: Set<unknown>, depth: number): string | undefined {
  if (!value || typeof value !== "object" || depth > 4 || seen.has(value)) return void 0;
  seen.add(value);
  const obj = value as Record<string, unknown>;
  const modelKeys = ["model", "modelId", "modelName", "model_name", "selectedModel", "chatModel"];
  for (const key of modelKeys) {
    const model = normalizeModel(obj[key]);
    if (model) return model;
  }
  for (const child of Object.values(obj)) {
    const model = extractModelFrom(child, seen, depth + 1);
    if (model) return model;
  }
  return void 0;
}

export function normalizeModel(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}

export function contentToString(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.filter(
      (p) => typeof p === "object" && p !== null && (p as Record<string, unknown>).type === "text" && typeof (p as Record<string, unknown>).text === "string"
    ).map((p) => (p as Record<string, string>).text);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
}
