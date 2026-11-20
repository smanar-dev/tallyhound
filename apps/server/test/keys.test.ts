// The cloud key service keyring (T-102), against a stand-in for AWS KMS that behaves the way KMS does where it matters:
// it never gives out its master key, and it will not open a wrapped key under a different context.
import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { kmsKeyring } from "../src/keys.ts";
import { kitCrypto, kitMemory } from "../src/kit.ts";

function fakeKms() {
  const master = randomBytes(32), calls: string[] = [];
  const wrap = (plain: Buffer, ctx: string) => { const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", master, iv); c.setAAD(Buffer.from(ctx)); const body = Buffer.concat([c.update(plain), c.final()]); return Buffer.concat([iv, c.getAuthTag(), body]); };
  const open = (blob: Buffer, ctx: string) => { const d = createDecipheriv("aes-256-gcm", master, blob.subarray(0, 12)); d.setAAD(Buffer.from(ctx)); d.setAuthTag(blob.subarray(12, 28)); return Buffer.concat([d.update(blob.subarray(28)), d.final()]); };
  return { calls, async send(cmd: unknown) {
    const c = cmd as { constructor: { name: string }; input: { KeyId: string; EncryptionContext: Record<string, string>; CiphertextBlob?: Uint8Array } }, ctx = JSON.stringify(c.input.EncryptionContext); calls.push(c.constructor.name);
    if (c.input.KeyId !== "alias/tallyhound") throw new Error("NotFoundException");
    if (c.constructor.name === "GenerateDataKeyCommand") { const plain = randomBytes(32); return { Plaintext: plain, CiphertextBlob: wrap(plain, ctx) }; }
    try { return { Plaintext: open(Buffer.from(c.input.CiphertextBlob!), ctx) }; } catch { throw new Error("InvalidCiphertextException"); }
  } };
}

test("keys: a firm's data key is made and opened by the key service, and one firm's key will not open in another firm's name", async () => {
  const kms = fakeKms(), ring = kmsKeyring({ keyId: "alias/tallyhound", client: kms });
  const a = await ring.newDataKey("f_one"); assert.equal(a.plain.length, 32); assert.equal(a.wrapped.subarray(0, 4).toString(), "KMS1"); assert.ok(!a.wrapped.includes(a.plain), "the wrapped key does not contain the key");
  assert.deepEqual(await ring.unwrap(a.wrapped, "f_one"), a.plain); await assert.rejects(ring.unwrap(a.wrapped, "f_two"), /InvalidCiphertext/);
  const b = await ring.newDataKey("f_one"); assert.notDeepEqual(b.plain, a.plain);
});

test("keys: the encrypted store works on top of the key service, and a firm made under the old local key still opens after the move", async () => {
  const inner = kitMemory.memoryStore(), local = kitCrypto.localKeyring(randomBytes(32)), old = kitCrypto.encryptedStore(inner, local);
  await old.create("f_old", '{"hello":"old"}', { name: "Old" });
  const kms = fakeKms(), store = kitCrypto.encryptedStore(inner, kmsKeyring({ keyId: "alias/tallyhound", client: kms, before: local }));
  assert.equal(await store.readState("f_old"), '{"hello":"old"}', "opened with the key from before");
  await store.create("f_new", '{"hello":"new"}', { name: "New" }); assert.equal(await store.readState("f_new"), '{"hello":"new"}'); assert.ok(kms.calls.includes("GenerateDataKeyCommand"));
  assert.ok(!String(inner.firms.get("f_new")).includes("hello"), "what rests in the store is sealed");
  // A second process with no cache has to ask the key service, and gets the same key back.
  const cold = kitCrypto.encryptedStore(inner, kmsKeyring({ keyId: "alias/tallyhound", client: kms, before: local })); assert.equal(await cold.readState("f_new"), '{"hello":"new"}'); assert.ok(kms.calls.includes("DecryptCommand"));
  // Without the old key to hand, the old firm does not open: it is refused, not guessed at.
  const strict = kitCrypto.encryptedStore(inner, kmsKeyring({ keyId: "alias/tallyhound", client: kms })); await assert.rejects(strict.readState("f_old"), /different master key/);
});
