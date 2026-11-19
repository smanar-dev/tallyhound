// File preparation with the real libraries: rotation, resizing, the text inside a PDF, and what happens to a file that is not what it says.
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { pdfText, prepareOpts, ready, LONG_SIDE } from "../src/files.ts";
import { createEngine } from "../src/kit.ts";
import { createRequire } from "node:module";
const precheck = createRequire(import.meta.url)("../../../packages/core/precheck.js") as { fromText(t: string, forms?: unknown): { form: string | null; year: number | null }; photoOk(m: unknown): { ok: boolean; why?: string } };

// A one-page PDF with real text in it, written by hand so the test needs no PDF writer.
function pdfWith(lines: string[]): Buffer {
  const stream = "BT /F1 12 Tf 50 740 Td " + lines.map((l) => "(" + l.replace(/[()\\]/g, "") + ") Tj 0 -16 Td").join(" ") + " ET";
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n"; const at: number[] = [];
  objs.forEach((o, i) => { at.push(out.length); out += i + 1 + " 0 obj\n" + o + "\nendobj\n"; });
  const xref = out.length; out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n" + at.map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("") + "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(out, "latin1");
}
const opt = prepareOpts();

test("files: a phone photo is turned upright, shrunk to the model's useful size and comes out as a JPEG", async () => {
  // 4000 x 3000 from the sensor, tagged "rotate 90 degrees" the way a phone held upright tags it.
  const raw = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 200, b: 190 } } }).withMetadata({ orientation: 6 }).png().toBuffer();
  const f = await ready({ bytes: raw, contentType: "image/heic", name: "IMG_0001.HEIC" }, opt);   // the label is wrong on purpose: the bytes decide
  assert.equal(f.contentType, "image/jpeg"); assert.equal(f.bytes[0], 0xff); assert.equal(f.bytes[1], 0xd8);
  assert.equal(f.height, LONG_SIDE, "upright: the long side is now the height"); assert.equal(f.width, 1500); assert.ok(f.bytes.length < raw.length * 4);
  const meta = await sharp(f.bytes).metadata(); assert.ok(!meta.orientation || meta.orientation === 1, "the rotation tag is gone, so nothing turns it twice");
});

test("files: a small photo is not blown up, and a dark one is measured as dark", async () => {
  const small = await ready({ bytes: await sharp({ create: { width: 800, height: 600, channels: 3, background: "#ffffff" } }).jpeg().toBuffer() }, opt);
  assert.equal(small.width, 800); assert.equal(small.height, 600);
  const m = await opt.image!(await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#101010" } }).jpeg().toBuffer());
  assert.equal(precheck.photoOk(m).why, "dark"); assert.ok(precheck.photoOk(await opt.image!(await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#b0b0b0" } }).jpeg().toBuffer())).ok);
});

test("files: the text inside a payroll PDF is read, and the kit's second reader finds the form and the year from it", async () => {
  const pdf = pdfWith(["Form W-2 Wage and Tax Statement 2026", "Employer: Acme Logistics", "Employee: Jo Day", "Copy B To Be Filed With Employee's FEDERAL Tax Return"]);
  const text = await pdfText(pdf); assert.match(text, /W-2 Wage and Tax Statement 2026/);
  const f = await ready({ bytes: pdf, contentType: "application/octet-stream", name: "w2.pdf" }, opt); assert.equal(f.contentType, "application/pdf"); assert.equal(f.locked, false); assert.ok(f.text);
  const r = precheck.fromText(f.text!, createEngine().FORMS); assert.equal(r.form, "W2"); assert.equal(r.year, 2026);
});

test("files: a locked PDF is marked locked, a scan has no text, and a file that is not what it says is refused, never opened", async () => {
  const locked = await ready({ bytes: Buffer.concat([pdfWith(["secret"]), Buffer.from("\n/Encrypt 9 0 R\n")]), contentType: "application/pdf" }, opt); assert.equal(locked.locked, true); assert.equal(locked.text, undefined);
  assert.equal(await pdfText(Buffer.from("%PDF-1.4 not really a pdf")), "");
  const exe = await ready({ bytes: Buffer.concat([Buffer.from("MZ"), Buffer.alloc(500)]), contentType: "image/jpeg", name: "w2.jpg" }, opt); assert.ok(!/^image\//.test(exe.contentType!), "a program named w2.jpg is not treated as a photo");
  const broken = await ready({ bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 1)]), contentType: "image/jpeg" }, opt); assert.equal(broken.contentType, "application/x-unreadable", "a damaged photo is asked for again instead of crashing the worker");
  const infected = await ready({ bytes: Buffer.from("%PDF-1.4 x x x x"), contentType: "application/pdf" }, { ...opt, scan: async () => ({ clean: false, name: "Eicar" }) }); assert.equal(infected.contentType, "application/x-unreadable"); assert.equal(infected.bytes.length, 0, "the bytes of a refused file are not kept");
  assert.equal((await ready({ bytes: Buffer.alloc(0), contentType: "application/x-too-large" }, opt)).contentType, "application/x-too-large");
});
