/**
 * Web implementation of the app's file store, backed by localStorage.
 *
 * The browser build exists for development - it lets every screen be opened
 * and a ride be previewed without a phone - so this only needs to be correct,
 * not roomy.
 */

const PREFIX = "rallyfs:";

const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function readTextSync(path: string): string | null {
  return storage()?.getItem(PREFIX + path) ?? null;
}

export async function readText(path: string): Promise<string | null> {
  return readTextSync(path);
}

export function writeText(path: string, text: string): void {
  const store = storage();
  if (!store) throw new Error("no storage available");
  store.setItem(PREFIX + path, text);
}

export function removeFile(path: string): void {
  storage()?.removeItem(PREFIX + path);
}

export function fileExists(path: string): boolean {
  return readTextSync(path) !== null;
}

export function listFiles(dir: string): string[] {
  const store = storage();
  if (!store) return [];
  const prefix = `${PREFIX}${dir}/`;
  const names: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(prefix)) {
      const rest = key.slice(prefix.length);
      if (!rest.includes("/")) names.push(rest);
    }
  }
  return names;
}

export function fileUri(path: string): string {
  return PREFIX + path;
}

export async function readExternal(uri: string): Promise<string> {
  const response = await fetch(uri);
  return response.text();
}

export function writeTemp(name: string, text: string): string {
  writeText(`tmp/${name}`, text);
  return fileUri(`tmp/${name}`);
}
