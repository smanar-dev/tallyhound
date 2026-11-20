// Building this year's checklist from last year's return (T-46). A member of staff gives Tallyhound the PDF of a client's prior
// return; the model lists the source documents the client will most likely owe again; staff tick the ones to add.
//
// A tax return holds Social Security numbers and every amount on it. So, deliberately:
//   - the file is never stored. It is held in memory for the length of the request and then gone;
//   - nothing from it is logged: only that a read happened and how many pages;
//   - what the model says back is cut down to a form code, a payer name and a few words, and anything that looks like a
//     Social Security number or a dollar amount is removed before it reaches the browser or the firm's state;
//   - nothing is added to a checklist until a person ticks it (the engine's addFromPrior).
// It is off for every firm until an owner switches it on, and the switch says why to ask counsel first: disclosing a return
// to a service provider is governed by Section 7216, and the firm needs its own consent wording in place.
import type { Engine } from "./kit.ts";
import { pdfPages } from "./files.ts";

export const PRIOR_MAX_PAGES = 60, PRIOR_BATCH = 10, PRIOR_MAX_ITEMS = 40;
export interface PriorItem { form: string; payer: string; why: string }
export interface PriorProposal { items: PriorItem[]; year: number | null; note: string; pages: number; total: number }
export class PriorError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
export interface PriorDeps { /** The model, called on this firm's behalf. */ read(firmId: string, prompt: string, images: Buffer[]): Promise<Record<string, unknown> | null>; prompt(): string; forms(): Record<string, unknown>; render?: (pdf: Buffer) => Promise<Buffer[] | null> }

// A Social Security number, an employer or taxpayer id, or a dollar amount. If the model put one in a field, the field is emptied.
const SENSITIVE = /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b|\b\d{2}-\d{7}\b|\$\s?\d|\b\d{1,3}(,\d{3})+(\.\d{2})?\b|\b\d+\.\d{2}\b/;
const safe = (v: unknown, max: number) => { const t = String(v ?? "").replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); return SENSITIVE.test(t) ? "" : t; };   // eslint-disable-line no-control-regex

export function createPrior(d: PriorDeps) {
  const render = d.render || pdfPages;
  return async function readPrior(firmId: string, pdf: Buffer): Promise<PriorProposal> {
    if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new PriorError("Give last year's return as a PDF");
    let pages = await render(pdf);
    if (!pages) pages = [pdf];   // a one-page PDF, or one that would not draw: the model reads the file itself
    const total = pages.length, use = pages.filter((p) => p.length).slice(0, PRIOR_MAX_PAGES); if (!use.length) throw new PriorError("That PDF could not be opened. If it has a password, save a copy without one");
    const forms = d.forms(), seen = new Map<string, PriorItem>(); let year: number | null = null, note = "", isReturn = false, answered = 0;
    for (let i = 0; i < use.length; i += PRIOR_BATCH) {
      const out = await d.read(firmId, d.prompt(), use.slice(i, i + PRIOR_BATCH)); if (!out) continue; answered++;
      if (out.is_return === true) isReturn = true; const y = Math.floor(Number(out.tax_year)); if (!year && y >= 2015 && y <= 2100) year = y; if (!note) note = safe(out.note, 200);
      for (const x of Array.isArray(out.items) ? out.items : []) {
        const it = (x && typeof x === "object" ? x : {}) as Record<string, unknown>, form = String(it.form || ""); if (!Object.hasOwn(forms, form) || form === "OTHER") continue;
        const payer = safe(it.payer, 60), key = form + "|" + payer.toLowerCase(); if (!seen.has(key) && seen.size < PRIOR_MAX_ITEMS) seen.set(key, { form, payer, why: safe(it.why, 140) });
      }
    }
    if (!answered) throw new PriorError("The return could not be read just now. Try again in a moment", 502);
    // A form listed once with a payer and once without is the same document: keep the one with the name.
    const items = [...seen.values()].filter((x) => x.payer || ![...seen.values()].some((y) => y.form === x.form && y.payer));
    if (!items.length) throw new PriorError(isReturn ? "No documents to ask for could be found on those pages" : "That does not look like a tax return. Nothing was read from it");
    return { items, year, note, pages: use.length, total };
  };
}
export type ReadPrior = ReturnType<typeof createPrior>;
/** Whether this firm may use it at all. */
export const priorOn = (T: Engine): boolean => T.S.firm.priorReturn === true;
