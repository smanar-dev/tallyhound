// Building a checklist from last year's return (T-46).
import test from "node:test";
import assert from "node:assert/strict";
import { build, KINDS, pdfPagesWith } from "./harness.ts";
import { createEngine } from "../src/kit.ts";
import { createPrior } from "../src/prior.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const RETURN = pdfPagesWith([["Form 1040 U.S. Individual Income Tax Return 2025", "SSN 123-45-6789", "Wages 52,310.00"], ["Schedule B Interest", "First Farmers Bank"], ["Schedule A Mortgage interest"]]);
for (const kind of KINDS) {
  test("prior (" + kind + "): off until an owner switches it on; then a return is read page by page, never stored, and only what a person ticks is added", async () => {
    const seen: { prompt: string; images: Buffer[] }[] = [];
    const H = await build(kind, { prior: (prompt, images) => { seen.push({ prompt, images }); return { tax_year: 2025, is_return: true, note: "A 2025 return with wages of $52,310.00", items: [{ form: "W2", payer: "Acme Logistics", why: "Wages on line 1" }, { form: "1099INT", payer: "First Farmers Bank", why: "Schedule B" }, { form: "1098", payer: "", why: "Mortgage interest, SSN 123-45-6789" }, { form: "1099INT", payer: "first farmers bank", why: "again" }, { form: "NOT_A_FORM", payer: "x", why: "" }, { form: "K1", payer: "EIN 12-3456789", why: "Partnership" }] }; } });
    const { firmId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test"); await owner.post("/api/users", { name: "Alex Staff", email: "alex@firm1.test", role: "staff" }); await owner.post("/api/users", { name: "Rae Reader", email: "rae@firm1.test", role: "read_only" });
    await owner.post("/api/act", { fn: "addClient", args: [{ first: "Jo", last: "Day", email: "jo@x.example" }] }); const state = async () => { const T = createEngine(); T.load(await H.store.readState(firmId)); return T; }, eid = (await state()).S.engs[0].id;
    const alex = await H.signInAs("alex@firm1.test"), send = (b: any, id: string, bytes: Buffer) => H.server.inject({ method: "POST", url: "/api/clients/" + id + "/prior", payload: bytes, headers: { "content-type": "application/pdf", "x-tallyhound": "1", origin: "https://app.tallyhound.test", cookie: b.cookie() } });
    assert.equal((await owner.get("/api/features")).json.prior, true);
    // Off: nothing is read, and nothing can be added by that route either.
    let r = await send(alex, eid, RETURN); assert.equal(r.statusCode, 403); assert.match(r.json().message, /owner has not switched on/); assert.equal(seen.length, 0); assert.match((await alex.post("/api/act", { fn: "addFromPrior", args: [eid, [{ form: "W2", payer: "Acme" }]] })).json.result, /not switched this on/);
    assert.equal((await alex.post("/api/act", { fn: "setPriorReturn", args: [true] })).status, 403); assert.equal((await owner.post("/api/act", { fn: "setPriorReturn", args: [true] })).status, 200);
    assert.equal((await send(await H.signInAs("rae@firm1.test"), eid, RETURN)).statusCode, 403); assert.equal((await send(alex, "nobody", RETURN)).statusCode, 404); assert.equal((await send(alex, eid, Buffer.from("not a pdf at all"))).statusCode, 400);
    const files = H.inner.files ? H.inner.files.size : null;
    r = await send(alex, eid, RETURN); assert.equal(r.statusCode, 200); const p = r.json(); assert.equal(seen.length, 1); assert.equal(seen[0]!.images.length, 3, "every page went to the model as a picture"); assert.equal(seen[0]!.images[0]!.subarray(0, 2).toString("hex"), "ffd8");
    // What comes back: known forms only, the same document once, and no field that carries a number off the return.
    assert.deepEqual(p.items, [{ form: "W2", payer: "Acme Logistics", why: "Wages on line 1" }, { form: "1099INT", payer: "First Farmers Bank", why: "Schedule B" }, { form: "1098", payer: "", why: "" }, { form: "K1", payer: "", why: "Partnership" }]);
    assert.equal(p.year, 2025); assert.equal(p.note, "", "a note with an amount in it is dropped"); assert.equal(p.pages, 3); assert.doesNotMatch(r.body, /123-45-6789|52,310|12-3456789/);
    // Nothing was stored and nothing was added yet.
    if (files !== null) assert.equal(H.inner.files.size, files, "the return was not kept"); let T = await state(); const before = T.itemsOf(eid).length; assert.ok(T.S.audit.some((a: any) => a.action === "prior.read" && /3 pages.*not kept/.test(a.detail))); assert.doesNotMatch(await H.store.readState(firmId) as string, /123-45-6789|52,310/);
    // A person ticks two of the four.
    assert.equal((await alex.post("/api/act", { fn: "addFromPrior", args: [eid, [p.items[1], p.items[2]]] })).status, 200); T = await state(); const added = T.itemsOf(eid).filter((i: any) => i.source === "prior").map((i: any) => i.form).sort();
    assert.ok(T.itemsOf(eid).length >= before); assert.ok(added.length <= 2); assert.ok(T.itemsOf(eid).some((i: any) => i.form === "1099INT" && i.payer === "First Farmers Bank"));
    await H.close();
  });
}

test("prior: a long return goes to the model in batches, something that is not a return is said to be so, and the model being down is an error, not an empty list", async () => {
  const pages = Array.from({ length: 25 }, (_, i) => Buffer.from([0xff, 0xd8, i])), sizes: number[] = [], forms = () => createEngine().FORMS;
  const many = createPrior({ read: async (_f, _p, images) => { sizes.push(images.length); return { is_return: true, tax_year: 2025, items: [{ form: "W2", payer: "Employer " + sizes.length, why: "" }] }; }, prompt: () => "p", forms, render: async () => pages });
  const out = await many("f1", Buffer.from("%PDF-1.4 x")); assert.deepEqual(sizes, [10, 10, 5]); assert.equal(out.items.length, 3); assert.equal(out.pages, 25);
  const notOne = createPrior({ read: async () => ({ is_return: false, items: [] }), prompt: () => "p", forms, render: async () => pages.slice(0, 2) }); await assert.rejects(notOne("f1", Buffer.from("%PDF-1.4 x")), /does not look like a tax return/);
  const down = createPrior({ read: async () => null, prompt: () => "p", forms, render: async () => pages.slice(0, 2) }); await assert.rejects(down("f1", Buffer.from("%PDF-1.4 x")), /could not be read just now/);
  const cap = createPrior({ read: async (_f, _p, images) => { sizes.push(images.length); return { is_return: true, items: [{ form: "W2", payer: "", why: "" }] }; }, prompt: () => "p", forms, render: async () => Array.from({ length: 200 }, () => Buffer.from([0xff, 0xd8])) }); const big = await cap("f1", Buffer.from("%PDF-1.4 x")); assert.equal(big.pages, 60); assert.equal(big.total, 200);
});
