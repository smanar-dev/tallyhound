// Getting a file ready before anything reads it (T-127, T-137): the tools packages/adapters/prepare.js asks for.
//   heic   iPhone photos become JPEG
//   image  turned upright, shrunk to 2,000 px on the long side, brightness measured
//   scan   a ClamAV daemon, when one is configured
// and the text inside a PDF, so packages/core/precheck.js can read the form and year without the model.
import net from "node:net";
import sharp from "sharp";
import { createRequire } from "node:module";
import { kitPrepare, type PrepareOpts } from "./kit.ts";
const require = createRequire(import.meta.url);

export const LONG_SIDE = 2000, PDF_TEXT_PAGES = 5, PDF_TEXT_MAX = 20000;

export function prepareOpts(o: { clamav?: { host: string; port: number } } = {}): PrepareOpts {
  const heicConvert = require("heic-convert") as (a: { buffer: Buffer; format: "JPEG"; quality: number }) => Promise<ArrayBuffer>;
  const opt: PrepareOpts = {
    async heic(bytes) { return Buffer.from(await heicConvert({ buffer: bytes, format: "JPEG", quality: 0.92 })); },
    // rotate() with no angle applies the camera's own orientation tag and then drops it, so the page is upright for the model and for staff.
    // No sharpness number is returned: the kit's threshold for it is a guess until it is tuned on real photos (T-44, T-89).
    async image(bytes) {
      const out = await sharp(bytes, { failOn: "error" }).rotate().resize(LONG_SIDE, LONG_SIDE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
      const st = await sharp(out.data).greyscale().stats();
      return { bytes: out.data, width: out.info.width, height: out.info.height, mean: Math.round(st.channels[0]!.mean) };
    }
  };
  if (o.clamav) { const { clamav } = require("../../../packages/adapters/prepare.js") as { clamav(a: { connect(): net.Socket }): (b: Buffer) => Promise<{ clean: boolean; name?: string }> }; opt.scan = clamav({ connect: () => net.connect(o.clamav!.port, o.clamav!.host) }); }
  return opt;
}

/** The text a PDF carries, first pages only. Empty for a scan, a locked file or anything that will not parse: those go to the model as they are. */
export async function pdfText(bytes: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(bytes)), n = Math.min(doc.numPages, PDF_TEXT_PAGES), parts: string[] = [];
    const all = await extractText(doc, { mergePages: false });
    for (let i = 0; i < n; i++) parts.push(String(all.text[i] || ""));
    return parts.join("\n").replace(/[ \t]+/g, " ").trim().slice(0, PDF_TEXT_MAX);
  } catch { return ""; }
}

export interface InFile { bytes: Buffer; contentType?: string; name?: string; inline?: boolean; width?: number; height?: number; locked?: boolean; text?: string; refused?: string }
/** One arriving file, made ready for the pipeline. Used for texts, email, and staff uploads alike. */
export async function ready(file: InFile, opt: PrepareOpts): Promise<InFile> {
  if (!file.bytes.length) return file;   // the email adapter's marker for a file over the size limit
  let p;
  try { p = await kitPrepare.prepare(file, opt); }
  catch { p = { bytes: file.bytes, refused: "damaged", name: file.name, inline: file.inline }; }   // a file that says it is a photo and is not one
  // A file we cannot open or the scanner refused: the client is asked for a photo or PDF instead.
  if (p.refused) return { bytes: p.bytes as Buffer, contentType: "application/x-unreadable", name: p.name as string | undefined, inline: !!p.inline, refused: String(p.refused) };
  const text = p.contentType === "application/pdf" && !p.locked ? await pdfText(p.bytes) : "";
  return { bytes: p.bytes as Buffer, contentType: p.contentType as string, name: p.name as string | undefined, inline: !!p.inline, width: (p.width ?? file.width) as number | undefined, height: (p.height ?? file.height) as number | undefined, locked: !!p.locked, text: text || undefined };
}
