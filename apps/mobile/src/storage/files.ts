/**
 * The app's private files: routes, ride logs, crash notes.
 *
 * A thin wrapper so the rest of the app deals in relative paths ("routes/abc.json")
 * and never in platform file APIs. The web build has its own implementation in
 * files.web.ts, which is what lets the whole UI run in a browser for development.
 *
 * Writes are synchronous on purpose: the crash breadcrumbs depend on a write
 * having reached the disk before the next native call is made.
 */

import { Directory, File, Paths } from "expo-file-system";

function resolve(path: string): File {
  const parts = path.split("/");
  const name = parts.pop()!;
  if (parts.length === 0) return new File(Paths.document, name);
  const dir = new Directory(Paths.document, ...parts);
  if (!dir.exists) dir.create({ intermediates: true });
  return new File(dir, name);
}

export function readTextSync(path: string): string | null {
  try {
    const file = resolve(path);
    return file.exists ? file.textSync() : null;
  } catch {
    return null;
  }
}

export async function readText(path: string): Promise<string | null> {
  try {
    const file = resolve(path);
    return file.exists ? await file.text() : null;
  } catch {
    return null;
  }
}

/** Throws on failure: callers that can carry on without the write catch it. */
export function writeText(path: string, text: string): void {
  const file = resolve(path);
  file.create({ overwrite: true });
  file.write(text);
}

export function removeFile(path: string): void {
  try {
    const file = resolve(path);
    if (file.exists) file.delete();
  } catch {
    // Already gone, which is what was wanted.
  }
}

export function fileExists(path: string): boolean {
  try {
    return resolve(path).exists;
  } catch {
    return false;
  }
}

/** File names (not paths) directly inside a directory. */
export function listFiles(dir: string): string[] {
  try {
    const directory = new Directory(Paths.document, ...dir.split("/"));
    if (!directory.exists) return [];
    return directory
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .map((file) => file.name);
  } catch {
    return [];
  }
}

/** A URI other apps can be handed, for the share sheet. */
export function fileUri(path: string): string {
  return resolve(path).uri;
}

/** Read a file picked or shared from outside the app. */
export async function readExternal(uri: string): Promise<string> {
  return new File(uri).text();
}

/** Write a file to the cache directory (for sharing) and return its URI. */
export function writeTemp(name: string, text: string): string {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(text);
  return file.uri;
}
