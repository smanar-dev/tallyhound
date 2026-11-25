// The synthetic test set (docs/FETCH.md, "Test set"): 60 made-up clients with made-up payers. Returning and new clients, joint
// returns, Schedules A to E, the Schedule 1-A lines, organizers, returns with W-2 copies attached, source documents, and scanned
// files with no text. Each file carries the truth: what a perfect reader would find. No real client data, anywhere.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface TFile { name: string; kind: "organizer" | "return" | "source_doc" | "unknown"; pages: string[]; truth: { payers: [string, string][]; schedules: string[]; lines: string[]; scanned?: boolean } }
export interface TClient { ref: string; first: string; last: string; spouse: string | null; email: string; phone: string; returning: boolean; files: TFile[] }
const FIRST = ["Maria", "Luis", "Ken", "Ana", "Daniel", "Erin", "Sofia", "Arjun", "Grace", "Omar", "Priya", "Tom", "Leah", "Noah", "Hana", "Ivan", "June", "Ravi", "Zoe", "Eli"];
const LAST = ["Garcia", "Ortega", "Sato", "Ruiz", "Brooks", "Okafor", "Nguyen", "Patel", "Kim", "Haddad", "Larsen", "Moreau", "Silva", "Novak", "Reyes", "Chen", "Abara", "Dubois", "Iversen", "Mendez"];
const EMPLOYERS = ["Midtown Transit Authority", "Riverbend Hospital", "Acme Logistics", "Bluebird Cafe", "Harpeth Schools", "Cumberland Steel", "Northside Clinic", "Granite Software"];
const BANKS = ["First Farmers Bank", "Pinnacle Bank", "Volunteer Credit Union", "Harbor Savings"], BROKERS = ["Schwab", "Fidelity Investments", "Vanguard"], LENDERS = ["Hillcrest Mortgage", "Lakeside Home Loans"], SCHOOLS = ["Belmont University", "Lipscomb University"];
const pick = <T,>(a: T[], k: number) => a[k % a.length]!;
const money = (k: number) => (1000 + (k * 7919) % 90000).toLocaleString("en-US") + "." + String(k % 100).padStart(2, "0");
const CODES: Record<string, string> = { W2: "W-2", "1099INT": "1099-INT", "1099DIV": "1099-DIV", "1099B": "1099-B", "1098": "1098", "1098T": "1098-T", "1099R": "1099-R", SSA1099: "SSA-1099", K1: "K-1", "1099NEC": "1099-NEC" };
function doc(form: string, payer: string, who: string, k: number): string {
  const W = who.toUpperCase();
  if (form === "W2") return ["Form W-2 Wage and Tax Statement 2025", "b Employer identification number EIN 62-" + String(1000000 + k * 37).slice(0, 7), "c Employer's name, address, and ZIP code", payer, k % 3 + 100 + " Main Street, Nashville TN 37201", "e Employee's first name and initial Last name", W, "1 Wages, tips, other compensation " + money(k), "2 Federal income tax withheld " + money(k + 1)].join("\n");
  if (form === "1098") return ["Form 1098 Mortgage Interest Statement 2025", "RECIPIENT'S/LENDER'S name, street address, city", payer, "PAYER'S/BORROWER'S name", W, "1 Mortgage interest received from payer/borrower $" + money(k)].join("\n");
  if (form === "1098T") return ["Form 1098-T Tuition Statement 2025", "FILER'S name, street address, city or town", payer, "STUDENT'S name", W, "1 Payments received for qualified tuition " + money(k)].join("\n");
  const title: Record<string, string> = { "1099INT": "Form 1099-INT Interest Income 2025", "1099DIV": "Form 1099-DIV Dividends and Distributions 2025", "1099B": "Form 1099-B Proceeds From Broker and Barter Exchange Transactions 2025", "1099R": "Form 1099-R Distributions From Pensions, Annuities, Retirement 2025", "1099NEC": "Form 1099-NEC Nonemployee Compensation 2025" };
  return [title[form] || form, "PAYER'S name, street address, city or town", payer, "PAYER'S TIN 12-" + String(3000000 + k).slice(0, 7), "RECIPIENT'S name", W, "Account number 4455" + String(667788 + k), "1 Amount $" + money(k)].join("\n");
}
export function testSet(): TClient[] {
  const out: TClient[] = [];
  for (let k = 0; k < 60; k++) {
    const first = pick(FIRST, k), last = pick(LAST, Math.floor(k / 3) + k), joint = k % 3 === 0, spouse = joint ? pick(FIRST, k + 7) : null, returning = k % 4 !== 3, who = first + " " + last, ref = String(2001 + k);
    const payers: [string, string][] = [["W2", pick(EMPLOYERS, k)]]; if (k % 2 === 0) payers.push(["1099INT", pick(BANKS, k)]); if (k % 5 === 0) payers.push(["1099B", pick(BROKERS, k)]); if (k % 4 === 0) payers.push(["1098", pick(LENDERS, k)]); if (joint) payers.push(["W2", pick(EMPLOYERS, k + 3)]); if (k % 9 === 0) payers.push(["1098T", pick(SCHOOLS, k)]);
    const sched: string[] = []; if (k % 4 === 0) sched.push("Schedule A"); if (k % 2 === 0) sched.push("Schedule B"); if (k % 6 === 1) sched.push("Schedule C", "Schedule SE"); if (k % 5 === 0) sched.push("Schedule D"); if (k % 7 === 2) sched.push("Schedule E");
    const lines: string[] = ["wages"]; if (k % 8 === 5) lines.push("tips"); if (k % 10 === 3) lines.push("car loan interest"); if (k % 11 === 4) lines.push("overtime"); if (k % 6 === 1) lines.push("estimated payments");
    const files: TFile[] = [];
    if (returning && k % 3 === 0) {
      // The organizer: a payer per line, with last year's figure at the end (which the reader must drop), and the schedules.
      files.push({ name: ref + " " + last + " 2025 organizer.pdf", kind: "organizer", truth: { payers, schedules: sched.filter((x) => x !== "Schedule SE"), lines: [] },
        pages: [["2025 Tax Organizer", "Prior Year Summary for " + last + ", " + first + (spouse ? " and " + spouse : ""), "Client ID " + ref + "   SSN ***-**-" + String(1000 + k).slice(-4)].concat(payers.map(([f, p], i) => CODES[f] + "   " + p + "   " + money(k + i)), sched.filter((x) => x !== "Schedule SE").map((x) => x + " " + ({ "Schedule A": "Itemized Deductions", "Schedule B": "Interest and Ordinary Dividends", "Schedule C": "Profit or Loss From Business", "Schedule D": "Capital Gains and Losses", "Schedule E": "Supplemental Income and Loss" } as Record<string, string>)[x]!)).join("\n")] });
    } else if (returning && k % 3 === 1) {
      // Last year's return as a text PDF, with the W-2 copies attached at the back.
      const p1 = ["Form 1040 U.S. Individual Income Tax Return 2025", "Your first name and middle initial " + first + "   Last name " + last, "Your social security number 123-45-" + String(6000 + k).slice(-4), "1a Total amount from Forms W-2, box 1   " + money(k), "11 Adjusted gross income   " + money(k + 2)];
      if (lines.includes("estimated payments")) p1.push("26 2025 estimated tax payments and amount applied from 2024 return   " + money(k + 3));
      const pages = [p1.join("\n")];
      if (sched.includes("Schedule A")) pages.push(["SCHEDULE A Form 1040 Itemized Deductions 2025", "8a Home mortgage interest and points reported to you on Form 1098   " + money(k)].join("\n"));
      if (sched.includes("Schedule B")) pages.push(["SCHEDULE B Form 1040 Interest and Ordinary Dividends 2025", "Part I Interest", "1 List name of payer. If any interest is from a seller-financed mortgage", payers.filter(([f]) => f === "1099INT").map(([, p]) => p + "   " + money(k)).join("\n") || "None", "4 Add the amounts on line 1   " + money(k)].join("\n"));
      if (sched.includes("Schedule C")) pages.push(["SCHEDULE C Form 1040 Profit or Loss From Business 2025", "A Principal business or profession   Design services", "31 Net profit or loss   " + money(k)].join("\n"), ["SCHEDULE SE Form 1040 Self-Employment Tax 2025", "12 Self-employment tax   " + money(k)].join("\n"));
      if (sched.includes("Schedule D")) pages.push(["SCHEDULE D Form 1040 Capital Gains and Losses 2025", "16 Combine lines 7 and 15   " + money(k)].join("\n"));
      if (sched.includes("Schedule E")) pages.push(["SCHEDULE E Form 1040 Supplemental Income and Loss 2025", "1a Physical address of each property   12 Elm Street", "26 Total rental real estate income   " + money(k)].join("\n"));
      const one = lines.filter((x) => ["tips", "car loan interest", "overtime"].includes(x)); if (one.length) pages.push(["SCHEDULE 1-A Form 1040 Additional Deductions 2025"].concat(one.map((x) => ({ tips: "Qualified tips   ", "car loan interest": "Qualified passenger vehicle loan interest   ", overtime: "Qualified overtime compensation   " } as Record<string, string>)[x] + money(k))).join("\n"));
      payers.filter(([f]) => f === "W2").forEach(([f, p], i) => pages.push(doc(f, p, i ? spouse + " " + last : who, k + i)));
      files.push({ name: "return " + first + " " + last + ".pdf", kind: "return", pages, truth: { payers: payers.filter(([f]) => f === "W2" || f === "1099INT"), schedules: sched, lines } });
    } else if (returning) {
      // Last year's source documents, one per file, from the firm's 2025 folder. Every fourth one is a scan with no text.
      payers.forEach(([f, p], i) => { const scanned = k % 4 === 2 && i === payers.length - 1 && payers.length > 1; files.push({ name: "scan" + String(k * 10 + i).padStart(4, "0") + ".pdf", kind: scanned ? "unknown" : "source_doc", pages: [scanned ? "" : doc(f, p, f === "W2" && i ? spouse + " " + last : who, k + i)], truth: { payers: scanned ? [] : [[f, p]], schedules: [], lines: [], scanned } }); });
    }
    out.push({ ref, first, last, spouse, email: first.toLowerCase() + "." + last.toLowerCase() + k + "@example.com", phone: "615555" + String(1000 + k), returning, files });
  }
  return out;
}
export function testSetCsv(set = testSet()): string { return "Client ID,Last name,First name,Spouse,Email,Phone,SSN,Status\n" + set.map((c) => [c.ref, c.last, c.first, c.spouse || "", c.email, c.phone, "123-45-" + String(6000 + +c.ref).slice(-4), c.returning ? "returning" : "new"].join(",")).join("\n"); }
