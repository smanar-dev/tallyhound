// The master key in a cloud key service (T-102). Each firm's data key is made and unwrapped by AWS KMS: this service may use the
// master key and can never read or export it. Same two methods as packages/core/crypto.js localKeyring, which stays for tests
// and development. Turn on automatic rotation on the KMS key itself; KMS still opens what older versions of the key wrapped.
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";

export interface Keyring { newDataKey(label: string): Promise<{ plain: Buffer; wrapped: Buffer }>; unwrap(wrapped: Buffer, label: string): Promise<Buffer> }
interface KmsLike { send(cmd: unknown): Promise<unknown> }
const MARK = Buffer.from("KMS1");   // says which keyring wrapped a key, so a firm made before the move still opens with the old one

export function kmsKeyring(o: { keyId: string; region?: string; client?: KmsLike; before?: Keyring }): Keyring {
  const kms: KmsLike = o.client || new KMSClient({ region: o.region || "us-east-1" });
  // The firm's id is bound into the wrapped key: KMS refuses to open one firm's key when asked in another firm's name.
  const context = (label: string) => ({ tallyhound_firm: label });
  return {
    async newDataKey(label) {
      const r = (await kms.send(new GenerateDataKeyCommand({ KeyId: o.keyId, KeySpec: "AES_256", EncryptionContext: context(label) }))) as { Plaintext?: Uint8Array; CiphertextBlob?: Uint8Array };
      if (!r.Plaintext || !r.CiphertextBlob || r.Plaintext.length !== 32) throw new Error("The key service did not return a data key");
      return { plain: Buffer.from(r.Plaintext), wrapped: Buffer.concat([MARK, Buffer.from(r.CiphertextBlob)]) };
    },
    async unwrap(wrapped, label) {
      if (!wrapped.subarray(0, MARK.length).equals(MARK)) { if (o.before) return o.before.unwrap(wrapped, label); throw new Error("This firm's key was wrapped by a different master key"); }
      const r = (await kms.send(new DecryptCommand({ KeyId: o.keyId, CiphertextBlob: wrapped.subarray(MARK.length), EncryptionContext: context(label) }))) as { Plaintext?: Uint8Array };
      if (!r.Plaintext || r.Plaintext.length !== 32) throw new Error("The key service did not open the data key"); return Buffer.from(r.Plaintext);
    }
  };
}
