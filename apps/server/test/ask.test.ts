// Ask the Hound: the model looks things up with read-only tools and answers. Tested against a stand-in for the Claude API.
import test from "node:test";
import assert from "node:assert/strict";
import { build, KINDS } from "./harness.ts";
import { claude, ModelError } from "../src/model.ts";
import { lookUp, TOOLS } from "../src/ask.ts";
import { createEngine, type Engine } from "../src/kit.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const msg = (content: unknown[], stop: string) => ({ id: "msg_1", type: "message", role: "assistant", model: "m", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 120 } });
function api(script: unknown[]) {
  const calls: any[] = []; let i = 0;
  const f = (async (_url: unknown, init: RequestInit) => { calls.push(JSON.parse(String(init.body))); const r = script[Math.min(i++, script.length - 1)]; return typeof r === "number" ? new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "x" } }), { status: r, headers: { "content-type": "application/json" } }) : new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } }); }) as unknown as typeof fetch;
  return { f, calls };
}
const seed = (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.importRows(T.parseCSV("First,Last,Email\nJo,Day,jo@x.example\nSam,Lee,sam@x.example")); for (const e of T.S.engs) { e.confirmed = true; T.start(e.id); } };

test("ask: the look-ups read the firm's state and never change it", () => {
  const T = createEngine(); T.blank({}); seed(T); const before = T.dump();
  const all = lookUp(T, "find_clients", {}) as any[]; assert.deepEqual(all.map((r) => r.name).sort(), ["Jo Day", "Sam Lee"]); assert.equal(all[0].status, "collecting"); assert.ok(all[0].missing.length > 0);
  assert.equal((lookUp(T, "find_clients", { status: "complete" }) as any[]).length, 0); assert.equal((lookUp(T, "find_clients", { missing_form: "w-2" }) as any[]).length, 2);
  const jo = lookUp(T, "client_detail", { name: "jo" }) as any; assert.equal(jo.name, "Jo Day"); assert.ok(jo.checklist.some((l: string) => /W-2/.test(l))); assert.ok(Array.isArray(jo.messages));
  assert.deepEqual(lookUp(T, "client_detail", { name: "nobody at all" }), { error: "No client by that name" }); assert.ok(Array.isArray((lookUp(T, "hound_activity", { limit: 500 }) as any).decisions));
  assert.deepEqual(lookUp(T, "delete_everything", {}), { error: "Unknown look-up" }); assert.equal(T.dump(), before, "nothing changed");
  for (const t of TOOLS) assert.ok(!/send|delete|change|set_|propose/i.test(t.name), "every tool is a look-up");
});

for (const kind of KINDS) {
  const name = (s: string) => "ask (" + kind + "): " + s;
  test(name("a question is answered after the model looks things up; each round is counted and recorded; only the firm's own people can ask"), async () => {
    const A = api([msg([{ type: "text", text: "Let me look." }, { type: "tool_use", id: "tu_1", name: "find_clients", input: { status: "collecting" } }, { type: "tool_use", id: "tu_2", name: "no_such_tool", input: {} }], "tool_use"), msg([{ type: "text", text: "Jo Day and Sam Lee are both still collecting." }], "end_turn")]);
    const seen: any[] = [], ai = claude({ apiKey: "k", fetch: A.f, record: (c) => { seen.push(c); } }), H = await build(kind, { converse: ai }), { firmId, ownerId } = await H.newFirm(); await H.app.staff(firmId, ownerId, seed);
    const owner = await H.signInAs("pat1@firm1.test"), r = await owner.post("/api/hound/ask", { messages: [{ role: "user", text: "Who is still collecting?" }] });
    assert.equal(r.status, 200); assert.equal(r.json.text, "Jo Day and Sam Lee are both still collecting.");
    // What went to the API: our instructions, three look-up tools and nothing that acts, then the results of both calls in one message.
    assert.equal(A.calls.length, 2); assert.match(A.calls[0].system, /You can read and you cannot act/); assert.match(A.calls[0].system, /Test CPAs 1/); assert.deepEqual(A.calls[0].tools.map((t: any) => t.name), ["find_clients", "client_detail", "hound_activity"]);
    const back = A.calls[1].messages.at(-1); assert.equal(back.role, "user"); assert.deepEqual(back.content.map((b: any) => b.tool_use_id), ["tu_1", "tu_2"]); assert.match(back.content[0].content, /Jo Day/); assert.match(back.content[1].content, /Unknown look-up/);
    assert.deepEqual(seen.map((c) => [c.firmId, c.tier, c.outcome]), [[firmId, "ask", "ok"], [firmId, "ask", "ok"]]); assert.ok(ai.spentToday(firmId).usd > 0); assert.ok((await H.auditRows()).some((a) => a.action === "hound.asked"));
    // Asking changed nothing in the firm's state, and needs a signed-in person and a question.
    const T = createEngine(); T.load(await H.store.readState(firmId)); assert.ok(!T.S.audit.some((a: any) => /ask/i.test(a.action)));
    assert.equal((await H.browser().post("/api/hound/ask", { messages: [{ role: "user", text: "hi" }] })).status, 401); assert.equal((await owner.post("/api/hound/ask", { messages: [] })).status, 400); assert.equal((await owner.post("/api/hound/ask", { messages: [{ role: "assistant", text: "I say" }] })).status, 400);
    await H.close();
  });
}

test("ask: with no model connected the answer says so; a refusal, a failure and a model that never stops looking are errors, not answers", async () => {
  const H = await build("memory"); await H.newFirm(); const owner = await H.signInAs("pat1@firm1.test"), none = await owner.post("/api/hound/ask", { messages: [{ role: "user", text: "hi" }] }); assert.equal(none.status, 503); assert.match(none.json.message, /once Claude is connected/); await H.close();
  const code = async (p: Promise<unknown>) => { try { await p; return "no error"; } catch (e) { return e instanceof ModelError ? e.code : "other"; } }, ask = (script: unknown[], extra = {}) => claude({ apiKey: "k", fetch: api(script).f, retries: 0, ...extra }).converse({ firmId: "f1", system: "s", messages: [{ role: "user", text: "q" }], tools: TOOLS, run: () => ({}) });
  assert.equal(await code(ask([msg([], "refusal")])), "refusal"); assert.equal(await code(ask([500])), "api_500");
  assert.equal(await code(ask([msg([{ type: "tool_use", id: "t", name: "find_clients", input: {} }], "tool_use")])), "rounds");
  assert.equal(await code(ask([msg([{ type: "text", text: "ok" }], "end_turn")], { dailyCapUsd: 0 })), "cap");
});
