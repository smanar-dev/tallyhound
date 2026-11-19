// Claude API client for the pipeline's `ai` interface. STARTER: written from the public API shape, not yet run
// against the live API. Check request fields and current model names at https://docs.claude.com before first use (T-10).
const MODELS = { quick: process.env.TH_MODEL_QUICK || "claude-haiku-5-5", default: process.env.TH_MODEL_DEFAULT || "claude-sonnet-5-5" };
function anthropic({ apiKey, fetchImpl }) {
  const f = fetchImpl || fetch;
  return {
    async json(prompt, { images, tier } = {}) {
      const content = (images || []).map((b) => {
        const isPdf = b.subarray(0, 4).toString() === "%PDF";
        return isPdf ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b.toString("base64") } }
                     : { type: "image", source: { type: "base64", media_type: b[0] === 0x89 ? "image/png" : "image/jpeg", data: b.toString("base64") } };
      });
      content.push({ type: "text", text: prompt });
      const res = await f("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: MODELS[tier] || MODELS.default, max_tokens: 1024, messages: [{ role: "user", content }] }) });
      if (!res.ok) throw new Error("Claude API " + res.status);
      const data = await res.json(), text = (data.content || []).filter((x) => x.type === "text").map((x) => x.text).join("");
      const m = /\{[\s\S]*\}/.exec(text); if (!m) throw new Error("No JSON in the model's answer");
      return JSON.parse(m[0]);
    }
  };
}
module.exports = { anthropic, MODELS };
