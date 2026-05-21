// Local document storage for the standalone scripts: createDoc() writes a
// Markdown file to ./output and returns a file:// URL. The scheduled routine
// does NOT use this — it stores the resume/cover letter via its connectors
// (in the Notion page and/or Google Docs).

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type DocKind = "resume" | "cover_letter";

const OUTPUT_DIR = "./output";

function safeName(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

/**
 * Create (or overwrite) a document locally and return a file:// URL.
 * Standalone-only. The scheduled routine stores docs via its connectors.
 */
export async function createDoc(
  kind: DocKind,
  title: string,
  body: string,
): Promise<string> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `${safeName(title)}.${kind}.md`);
  await writeFile(file, `# ${title}\n\n${body}\n`, "utf8");
  return pathToFileURL(path.resolve(file)).href;
}
