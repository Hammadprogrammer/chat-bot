import { htmlToText, normalizeWhitespace } from "@/lib/text";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const SUPPORTED_EXTENSIONS = ["pdf", "docx", "txt", "md", "markdown", "csv", "html", "htm", "json"] as const;

export class ExtractError extends Error {}

export function fileExtension(name: string) {
  return name.toLowerCase().split(".").pop() ?? "";
}

export function isSupportedFile(name: string) {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(fileExtension(name));
}

async function extractPdf(buffer: Buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return { text: result.text, pages: result.total ?? 0 };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractDocx(buffer: Buffer) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function jsonToText(raw: string) {
  const walk = (v: unknown, path: string[]): string[] => {
    if (v === null || v === undefined) return [];
    if (typeof v !== "object") return [`${path.join(".")}: ${String(v)}`];
    if (Array.isArray(v)) return v.flatMap((item, i) => walk(item, [...path, String(i)]));
    return Object.entries(v as Record<string, unknown>).flatMap(([k, val]) => walk(val, [...path, k]));
  };
  try {
    return walk(JSON.parse(raw), []).join("\n");
  } catch {
    return raw;
  }
}

/** Extract plain text from an uploaded file. */
export async function extractFromFile(buffer: Buffer, filename: string): Promise<{ text: string; pages: number }> {
  if (buffer.byteLength > MAX_FILE_BYTES) throw new ExtractError("File exceeds the 10 MB limit");
  const ext = fileExtension(filename);
  switch (ext) {
    case "pdf": {
      const { text, pages } = await extractPdf(buffer);
      return { text: normalizeWhitespace(text), pages };
    }
    case "docx":
      return { text: normalizeWhitespace(await extractDocx(buffer)), pages: 1 };
    case "html":
    case "htm":
      return { text: htmlToText(buffer.toString("utf8")), pages: 1 };
    case "json":
      return { text: normalizeWhitespace(jsonToText(buffer.toString("utf8"))), pages: 1 };
    case "txt":
    case "md":
    case "markdown":
    case "csv":
      return { text: normalizeWhitespace(buffer.toString("utf8")), pages: 1 };
    default:
      throw new ExtractError(`Unsupported file type ".${ext}". Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`);
  }
}
