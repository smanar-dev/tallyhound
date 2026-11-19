// Tallyhound cost model. node tools/cost-model.js
// Every price below is a published list price read in November 2026 or a labelled assumption. Change them here and rerun.
const PRICE = {
  smsBase: 0.0083,          // Twilio, per segment, in or out
  carrierOut: 0.0045,       // carrier fee per outbound segment: $0.0035 to $0.005 by carrier, middle used
  carrierIn: 0.0025,        // carrier fee per inbound segment where charged
  mmsInBase: 0.0165,        // ASSUMPTION: Twilio inbound picture message. Not confirmed this round
  mmsCarrier: 0.009,        // carrier fee per picture message: $0.007 to $0.01
  email: 0.0001,            // Amazon SES, $0.10 per 1,000
  s3GbMonth: 0.023,
  sonnetIn: 2, sonnetOut: 10, haikuIn: 0.10, haikuOut: 0.50,   // dollars per million tokens
  brandOnce: 4.5, campaignOnce: 15, campaignMonth: 1.5, numberMonth: 1.15,   // per firm, low-volume registration
  brandOnceStd: 46, campaignMonthStd: 10,                                      // per firm, standard registration
  stripePct: 0.029 + 0.007, stripeFixed: 0.30
};
// ASSUMPTIONS about one client in one season. "base" is a normal client, "heavy" needs twice the chasing.
const USE = {
  base:  { segOut: 22, segIn: 5, mmsIn: 6, emails: 6, docs: 8, pagesPerDoc: 2, textsRead: 11, written: 16, mb: 16 },
  heavy: { segOut: 48, segIn: 12, mmsIn: 10, emails: 12, docs: 14, pagesPerDoc: 2, textsRead: 22, written: 34, mb: 28 },
  email: { segOut: 0, segIn: 0, mmsIn: 0, emails: 18, docs: 8, pagesPerDoc: 2, textsRead: 6, written: 14, mb: 16 }   // a client who never turns texting on
};
const TOK = { perPage: 3000, docPrompt: 1200, docOut: 200, textIn: 1500, textOut: 150, writeIn: 1200, writeOut: 100 };   // ASSUMPTIONS, to be measured (T-78)
const m = (inTok, outTok, pin, pout) => (inTok * pin + outTok * pout) / 1e6;
function perClient(u, docModel) {
  const text = u.segOut * (PRICE.smsBase + PRICE.carrierOut) + u.segIn * (PRICE.smsBase + PRICE.carrierIn) + u.mmsIn * (PRICE.mmsInBase + PRICE.mmsCarrier);
  const [pin, pout] = docModel === "haiku" ? [PRICE.haikuIn, PRICE.haikuOut] : [PRICE.sonnetIn, PRICE.sonnetOut];
  const docs = u.docs * m(u.pagesPerDoc * TOK.perPage + TOK.docPrompt, TOK.docOut, pin, pout);
  const small = u.textsRead * m(TOK.textIn, TOK.textOut, PRICE.haikuIn, PRICE.haikuOut) + u.written * m(TOK.writeIn, TOK.writeOut, PRICE.haikuIn, PRICE.haikuOut);
  const other = u.emails * PRICE.email + (u.mb / 1024) * PRICE.s3GbMonth * 12;
  return { text, ai: docs + small, other, total: text + docs + small + other };
}
const PLANS = [["Solo", 99, 150], ["Practice", 249, 500], ["Firm", 599, 1000], ["Large", 999, 2500]];
const f = (n) => "$" + n.toFixed(2), pct = (n) => Math.round(n * 100) + "%";
console.log("Cost per client per season");
for (const k of Object.keys(USE)) { const c = perClient(USE[k]), h = perClient(USE[k], "haiku"); console.log("  " + k.padEnd(6) + " texts " + f(c.text) + " | AI " + f(c.ai) + " (all small model: " + f(h.ai) + ") | email and storage " + f(c.other) + " | total " + f(c.total)); }
console.log("\nPer plan, at the client limit, firm pays 9 months (takes the full 3-month pause) or 12");
for (const [name, price, cap] of PLANS) {
  const std = cap > 500, fixed = (std ? PRICE.campaignMonthStd : PRICE.campaignMonth) * 12 + PRICE.numberMonth * 12 + (std ? PRICE.brandOnceStd : PRICE.brandOnce) + PRICE.campaignOnce;
  for (const months of [9, 12]) { const rev = price * months, stripe = months * (price * PRICE.stripePct + PRICE.stripeFixed);
    const row = ["base", "heavy"].map((k) => { const v = cap * perClient(USE[k]).total, cost = v + fixed + stripe; return k + " cost " + f(cost) + " margin " + pct((rev - cost) / rev); }).join(" | ");
    console.log("  " + name.padEnd(9) + months + " mo  revenue " + f(rev) + " (" + f(rev / cap) + " a client) | " + row); }
}
console.log("\nA firm at half its limit pays the same and costs half as much, so real margins sit above these.");
const t = perClient(USE.email); console.log("Trial, worst case: 10 clients by email, 100 documents read = " + f(10 * t.other + 100 * m(2 * TOK.perPage + TOK.docPrompt, TOK.docOut, PRICE.sonnetIn, PRICE.sonnetOut) + 10 * (t.ai - 8 * m(2 * TOK.perPage + TOK.docPrompt, TOK.docOut, PRICE.sonnetIn, PRICE.sonnetOut))));
console.log("Old Firm plan ($599 for 2,000 clients), heavy use, 9 months: margin " + pct((599 * 9 - (2000 * perClient(USE.heavy).total + 181 + 9 * (599 * PRICE.stripePct + 0.3))) / (599 * 9)));
console.log("Spanish: a 150-character text with one accented letter outside the basic set is 3 segments, not 1.");
