import { homeDir, joinPath } from "../fs";

export function getVSCodeGlobalStoragePaths() {
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
export function getVSCodeUserPaths() {
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
