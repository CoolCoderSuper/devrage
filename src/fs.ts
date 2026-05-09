const globEntries = new Bun.Glob("*");

export function homeDir() {
  return Bun.env["HOME"] ?? Bun.env["USERPROFILE"] ?? "";
}

export function joinPath(...parts: string[]) {
  const [first = "", ...rest] = parts;
  const joined = rest.reduce((path, part) => {
    const left = path.replace(/[\\/]+$/, "");
    const right = part.replace(/^[\\/]+/, "");
    return left ? `${left}/${right}` : right;
  }, first);
  return joined.replace(/\\/g, "/");
}

export async function readDir(path: string) {
  return Array.fromAsync(globEntries.scan({ cwd: path, dot: true, onlyFiles: false }));
}

export async function readText(path: string) {
  return Bun.file(path).text();
}

export async function pathExists(path: string) {
  return Bun.file(path).exists();
}

export async function isDir(path: string) {
  try {
    await readDir(path);
    return true;
  } catch {
    return false;
  }
}

export async function* readLines(path: string) {
  const text = await readText(path);
  for (const line of text.split(/\r?\n/)) yield line;
}
