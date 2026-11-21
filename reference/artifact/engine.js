/* Tallyhound engine: product rules in plain code. Sample data only. No network. */
(function () {
  "use strict";
  const DAY = 864e5, HOUR = 36e5, MIN = 6e4;

  const FORMS = {
    W2: { plain: "W-2 wage statement", es: "formulario W-2 de salarios", issuer: "your employer", issuerEs: "su empleador", hint: "Employers send these by the end of January.", hintEs: "Los empleadores los envían antes de fines de enero.", order: 10 },
    "1099NEC": { plain: "1099 for contract work", es: "formulario 1099 por trabajo independiente", issuer: "the business that paid you", issuerEs: "la empresa que le pagó", hint: "These are sent by the end of January.", hintEs: "Se envían antes de fines de enero.", order: 20 },
    "1099MISC": { plain: "1099 for other income", es: "formulario 1099 de otros ingresos", issuer: "the payer", issuerEs: "el pagador", hint: "These are sent by the end of January.", hintEs: "Se envían antes de fines de enero.", order: 22 },
    "1099K": { plain: "payment app or card sales statement", es: "formulario 1099-K de pagos", issuer: "the payment platform", issuerEs: "la plataforma de pagos", hint: "Look in the app under tax documents.", hintEs: "Busque en la aplicación, en documentos de impuestos.", order: 24 },
    "1099INT": { plain: "interest statement", es: "formulario 1099 de intereses", issuer: "your bank", issuerEs: "su banco", hint: "Banks send these by the end of January.", hintEs: "Los bancos los envían antes de fines de enero.", order: 30 },
    "1099DIV": { plain: "dividend statement", es: "formulario 1099 de dividendos", issuer: "your bank or broker", issuerEs: "su banco o corredor", hint: "These are sent by the end of January.", hintEs: "Se envían antes de fines de enero.", order: 32 },
    "1099CONS": { plain: "brokerage tax statement", es: "estado fiscal consolidado de su corredor", issuer: "your broker", issuerEs: "su corredor", hint: "Brokers post these from mid February.", hintEs: "Los corredores los publican desde mediados de febrero.", order: 34 },
    "1099R": { plain: "retirement distribution statement", es: "formulario 1099-R de retiro", issuer: "your retirement plan", issuerEs: "su plan de retiro", hint: "These are sent by the end of January.", hintEs: "Se envían antes de fines de enero.", order: 36 },
    SSA1099: { plain: "Social Security benefit statement", es: "formulario SSA-1099 del Seguro Social", issuer: "the Social Security Administration", issuerEs: "la Administración del Seguro Social", hint: "It is mailed in January.", hintEs: "Se envía por correo en enero.", order: 38 },
    "1099G": { plain: "unemployment or state refund statement", es: "formulario 1099-G", issuer: "your state agency", issuerEs: "la agencia de su estado", hint: "These are sent by the end of January.", hintEs: "Se envían antes de fines de enero.", order: 40 },
    "1098": { plain: "mortgage interest statement", es: "formulario 1098 de intereses hipotecarios", issuer: "your mortgage company", issuerEs: "su compañía hipotecaria", hint: "Mortgage companies send these by the end of January.", hintEs: "Se envían antes de fines de enero.", order: 50 },
    "1098T": { plain: "tuition statement", es: "formulario 1098-T de matrícula", issuer: "the college", issuerEs: "la universidad", hint: "Colleges post these by the end of January.", hintEs: "Las universidades los publican antes de fines de enero.", order: 52 },
    "1098E": { plain: "student loan interest statement", es: "formulario 1098-E de préstamo estudiantil", issuer: "your loan servicer", issuerEs: "su administrador de préstamos", hint: "These are sent by the end of January.", hintEs: "Se envían antes de fines de enero.", order: 54 },
    "1095A": { plain: "health marketplace statement", es: "formulario 1095-A del mercado de seguros", issuer: "the health marketplace", issuerEs: "el mercado de seguros", hint: "It is posted to your marketplace account by the end of January.", hintEs: "Se publica en su cuenta antes de fines de enero.", order: 60 },
    K1: { plain: "K-1 from a partnership or S corporation", es: "anexo K-1", issuer: "the business", issuerEs: "la empresa", hint: "These often arrive in March or later.", hintEs: "Suelen llegar en marzo o después.", order: 70 },
    "1099SA": { plain: "HSA distribution statement", es: "formulario 1099-SA de su cuenta HSA", issuer: "your HSA provider", issuerEs: "su proveedor de HSA", hint: "Look in your HSA account under tax forms.", hintEs: "Busque en su cuenta HSA, en formularios de impuestos.", order: 62 },
    PTAX: { plain: "property tax bill", es: "recibo del impuesto predial", issuer: "your county", issuerEs: "su condado", hint: "Your county trustee's website has a copy.", hintEs: "El sitio web de su condado tiene una copia.", order: 56 },
    RENTAL: { plain: "rental income and expense summary", es: "resumen de ingresos y gastos de alquiler", issuer: "you or your property manager", issuerEs: "usted o su administrador", hint: "A spreadsheet or the property manager's year-end statement works.", hintEs: "Sirve una hoja de cálculo o el estado anual del administrador.", order: 72 },
    CHILDCARE: { plain: "childcare provider statement", es: "estado de cuenta de la guardería", issuer: "your childcare provider", issuerEs: "su guardería", hint: "Ask the provider for a year-end statement with their tax ID.", hintEs: "Pida a la guardería un estado anual con su número fiscal.", order: 80 },
    CHARITY: { plain: "donation receipts", es: "recibos de donaciones", issuer: "the charities you gave to", issuerEs: "las organizaciones benéficas", hint: "Year-end giving statements usually arrive by email in January.", hintEs: "Los resúmenes anuales suelen llegar por correo en enero.", order: 82 },
    ESTPAY: { plain: "estimated tax payment confirmations", es: "confirmaciones de pagos estimados", issuer: "IRS Direct Pay or your bank", issuerEs: "IRS Direct Pay o su banco", hint: "A screenshot of each payment confirmation works.", hintEs: "Sirve una captura de cada confirmación de pago.", order: 84 },
    PRIOR: { plain: "copy of last year's tax return", es: "copia de su declaración del año pasado", issuer: "your previous preparer", issuerEs: "su preparador anterior", hint: "A PDF from your previous preparer or tax software works.", hintEs: "Sirve un PDF de su preparador anterior o de su programa.", order: 5 },
    PNL: { plain: "profit and loss statement for the year", es: "estado de resultados del año", issuer: "your bookkeeper or accounting software", issuerEs: "su contador o programa de contabilidad", hint: "A report from the first to the last day of the tax year works.", hintEs: "Sirve un informe del primer al último día del año fiscal.", order: 110 },
    BALANCE_SHEET: { plain: "year-end balance sheet", es: "balance general de fin de año", issuer: "your bookkeeper or accounting software", issuerEs: "su contador o programa de contabilidad", hint: "Dated the last day of the tax year.", hintEs: "Con fecha del último día del año fiscal.", order: 112 },
    TRIAL_BALANCE: { plain: "trial balance or general ledger", es: "balanza de comprobación o libro mayor", issuer: "your bookkeeper or accounting software", issuerEs: "su contador o programa de contabilidad", hint: "An export from your accounting software is fine.", hintEs: "Sirve una exportación de su programa de contabilidad.", order: 114 },
    BANK_STATEMENT: { plain: "year-end bank and credit card statements", es: "estados de cuenta bancarios y de tarjetas de fin de año", issuer: "your bank", issuerEs: "su banco", hint: "The statement that includes the last day of the tax year, for each account.", hintEs: "El estado que incluye el último día del año fiscal, de cada cuenta.", order: 116 },
    PAYROLL_REPORT: { plain: "year-end payroll reports", es: "informes de nómina de fin de año", issuer: "your payroll provider", issuerEs: "su proveedor de nómina", hint: "The W-3 and the four quarterly 941s, or the year-end summary from your payroll provider.", hintEs: "El W-3 y los cuatro 941 trimestrales, o el resumen anual de su proveedor de nómina.", order: 118 },
    ASSET_LIST: { plain: "list of equipment and vehicles bought or sold", es: "lista de equipos y vehículos comprados o vendidos", issuer: "you", issuerEs: "usted", hint: "Date, what it was and the price for each. Invoices work too.", hintEs: "Fecha, qué fue y el precio de cada uno. También sirven las facturas.", order: 120 },
    LOAN_STATEMENT: { plain: "year-end loan statements", es: "estados de préstamos de fin de año", issuer: "your lender", issuerEs: "su prestamista", hint: "Showing the balance and the interest paid for the year.", hintEs: "Con el saldo y los intereses pagados en el año.", order: 122 },
    FORMS_ISSUED: { plain: "copies of the 1099s and W-2s the business issued", es: "copias de los 1099 y W-2 que emitió el negocio", issuer: "your payroll provider or bookkeeper", issuerEs: "su proveedor de nómina o contador", hint: "The filed copies, or the summary page.", hintEs: "Las copias presentadas o la página de resumen.", order: 124 },
    OTHER: { plain: "document", es: "documento", issuer: "", issuerEs: "", hint: "", hintEs: "", order: 99 }
  };
  const PR = [["payer", "Payer name and TIN"], ["recipient", "Recipient name"]];
  const ELEMENTS = {
    W2: [["employer", "Employer name and EIN (boxes b, c)"], ["employee", "Employee name (box e)"], ["wages", "Wages and withholding (boxes 1, 2)"], ["state", "State section (boxes 15 to 17)"]],
    "1099INT": PR.concat([["box1", "Interest income (box 1)"]]), "1099DIV": PR.concat([["box1a", "Ordinary and qualified dividends (boxes 1a, 1b)"]]), "1099NEC": PR.concat([["box1", "Nonemployee compensation (box 1)"]]), "1099MISC": PR.concat([["boxes", "Income boxes 1 to 3"]]),
    "1099K": PR.concat([["box1a", "Gross amount (box 1a)"], ["months", "Monthly totals (boxes 5a to 5l)"]]), "1099CONS": [["summary", "Summary page"], ["pages", "Every page of the statement"], ["basis", "Cost basis detail for sales"]],
    "1099R": PR.concat([["box1", "Gross and taxable amounts (boxes 1, 2a)"], ["code", "Distribution code (box 7)"]]), SSA1099: [["recipient", "Beneficiary name"], ["box5", "Net benefits (box 5)"]], "1099G": PR.concat([["box1", "Payment amounts (boxes 1, 2)"]]),
    "1098": [["lender", "Lender name"], ["borrower", "Borrower name"], ["box1", "Mortgage interest (box 1)"], ["box10", "Property tax paid (box 10)"]], "1098T": [["filer", "School name"], ["student", "Student name"], ["box1", "Tuition paid (box 1)"], ["box5", "Scholarships (box 5)"]],
    "1098E": [["lender", "Lender name"], ["borrower", "Borrower name"], ["box1", "Student loan interest (box 1)"]], "1095A": [["recipient", "Recipient and policy number"], ["months", "All 12 months in Part III"], ["slcsp", "Second lowest cost plan column (B)"]],
    K1: [["entity", "Partnership name and EIN"], ["partner", "Partner name"], ["boxes", "Part III income boxes"], ["statements", "Supporting statements"]], "1099SA": PR.concat([["box1", "Gross distribution (box 1)"], ["code", "Distribution code (box 3)"]]),
    PTAX: [["owner", "Owner name and parcel"], ["amount", "Tax amount and date paid"]], RENTAL: [["income", "Rent received"], ["expenses", "Expenses by category"]], CHILDCARE: [["provider", "Provider name and tax ID"], ["amount", "Amount paid"]],
    CHARITY: [["org", "Charity name"], ["amount", "Amount and date"], ["noGoods", "No goods or services statement"]], ESTPAY: [["amount", "Amount and date of each payment"]], PRIOR: [["pages", "Every page and schedule"], ["filed", "The return as filed"]], OTHER: []
  };
  const MISSTXT = {
    state: ["the state boxes at the bottom are cut off", "a photo with the whole bottom of the form showing", "las casillas del estado en la parte inferior quedaron cortadas", "una foto con toda la parte inferior visible"],
    box10: ["box 10 at the bottom is cut off", "a photo of the whole form", "la casilla 10 quedó cortada", "una foto del formulario completo"],
    pages: ["only some of the pages came through", "every page, including the ones after page 1", "solo llegaron algunas páginas", "todas las páginas"],
    basis: ["the cost basis pages are missing", "the pages that show what you paid for what you sold", "faltan las páginas del costo base", "las páginas con el costo de lo que vendió"],
    statements: ["the statements that come with it are missing", "the statements attached to the K-1", "faltan los anexos que lo acompañan", "los anexos del K-1"],
    months: ["some months are missing", "the page that lists all 12 months", "faltan algunos meses", "la página con los 12 meses"],
    summary: ["the summary page is missing", "the summary page", "falta la página de resumen", "la página de resumen"],
    box5: ["box 5 is cut off", "a photo of the whole form", "la casilla 5 quedó cortada", "una foto del formulario completo"],
    noGoods: ["the receipt doesn't say whether you got anything in return", "the receipt with that statement on it", "el recibo no indica si recibió algo a cambio", "el recibo con esa declaración"]
  };
  const RELEASE = { "1099CONS": [1, 15], K1: [2, 15] };
  const FACTS = [["w2", "Has a W-2 job"], ["newJob", "Started a new job"], ["selfEmp", "Freelance or contract work"], ["gig", "Sells through payment apps"], ["interest", "Has bank interest"], ["investments", "Gets dividends"], ["brokerage", "Sold investments"], ["retire", "Took retirement distributions"], ["ss", "Gets Social Security"], ["homeowner", "Owns a home with a mortgage"], ["rental", "Owns a rental property"], ["k1", "Owns part of a partnership or S corp"], ["student", "Paid college tuition"], ["studentLoan", "Pays student loan interest"], ["market", "Marketplace health insurance"], ["hsa", "Used an HSA"], ["childcare", "Pays for childcare"], ["charity", "Gives to charity"], ["estPay", "Made estimated tax payments"], ["newClient", "New to the firm"]];
  ["PNL", "BALANCE_SHEET", "TRIAL_BALANCE", "BANK_STATEMENT", "PAYROLL_REPORT", "ASSET_LIST", "LOAN_STATEMENT", "FORMS_ISSUED"].forEach((k) => { ELEMENTS[k] = [["entity", "The business or account name"], ["period", "The dates it covers"]]; });
  // Every kind of return a firm prepares. Each starts from its own list of documents; the firm edits from there.
  const BOOKS = ["PNL", "BALANCE_SHEET", "BANK_STATEMENT", "PAYROLL_REPORT", "ASSET_LIST", "LOAN_STATEMENT", "PRIOR"];
  const RETURNS = {
    "1040": { label: "Individual", form: "Form 1040", items: null },
    "1120S": { label: "S corporation", form: "Form 1120-S", items: BOOKS },
    "1065": { label: "Partnership", form: "Form 1065", items: BOOKS },
    "1120": { label: "C corporation", form: "Form 1120", items: BOOKS },
    "1041": { label: "Trust or estate", form: "Form 1041", items: ["1099INT", "1099DIV", "1099CONS", "K1", "PRIOR"] },
    "990": { label: "Nonprofit", form: "Form 990", items: ["PNL", "BALANCE_SHEET", "BANK_STATEMENT", "PAYROLL_REPORT", "PRIOR"] }
  };
  function returnType(text) { const t = " " + String(text || "").toLowerCase() + " "; if (!t.trim()) return "";
    if (/1120-?s|s[\s-]?corp|sub ?s\b/.test(t)) return "1120S"; if (/1065|partner|multi-member/.test(t)) return "1065"; if (/1120|c[\s-]?corp|corporation/.test(t)) return "1120";
    if (/1041|trust|estate|fiduciar/.test(t)) return "1041"; if (/\b990|non-?profit|exempt/.test(t)) return "990"; if (/1040|individual|personal/.test(t)) return "1040"; return ""; }
  const RULES = { w2: ["W2"], newJob: ["W2"], selfEmp: ["1099NEC"], gig: ["1099K"], interest: ["1099INT"], investments: ["1099DIV"], brokerage: ["1099CONS"], retire: ["1099R"], ss: ["SSA1099"], homeowner: ["1098", "PTAX"], rental: ["RENTAL"], k1: ["K1"], student: ["1098T"], studentLoan: ["1098E"], market: ["1095A"], hsa: ["1099SA"], childcare: ["CHILDCARE"], charity: ["CHARITY"], estPay: ["ESTPAY"], newClient: ["PRIOR"] };
  const PORTALQ = [["newJob", "Did you start a new job in {year}?", "¿Empezó un trabajo nuevo en {year}?"], ["homeowner", "Do you own a home with a mortgage?", "¿Tiene una casa con hipoteca?"], ["selfEmp", "Did you do any freelance or contract work?", "¿Hizo trabajo independiente o por contrato?"], ["gig", "Did you get business payments through apps like PayPal or Venmo?", "¿Recibió pagos de negocio por aplicaciones como PayPal o Venmo?"], ["brokerage", "Did you sell any stocks or funds?", "¿Vendió acciones o fondos?"], ["student", "Did you pay college tuition?", "¿Pagó matrícula universitaria?"], ["childcare", "Did you pay for childcare so you could work?", "¿Pagó guardería para poder trabajar?"], ["charity", "Did you give to charity?", "¿Hizo donaciones a organizaciones benéficas?"], ["hsa", "Did you use a health savings account (HSA)?", "¿Usó una cuenta de ahorros para la salud (HSA)?"], ["market", "Did you buy health insurance through the marketplace?", "¿Compró seguro médico en el mercado de seguros?"], ["rental", "Do you own a rental property?", "¿Tiene una propiedad en alquiler?"], ["estPay", "Did you make estimated tax payments?", "¿Hizo pagos de impuestos estimados?"]];
  const FORMWORDS = [["W2", /\bw-?2s?\b/i], ["1098", /\b1098\b(?!-?[te])|mortgage/i], ["1099INT", /1099-?int|interest statement|bank interest/i], ["1099DIV", /1099-?div|dividend/i], ["1099CONS", /brokerage|consolidated|1099-?b\b|schwab|fidelity|vanguard|etrade/i], ["K1", /\bk-?1\b/i], ["1095A", /1095|marketplace/i], ["1098E", /student loan/i], ["1098T", /1098-?t|tuition/i], ["SSA1099", /social security|ssa/i], ["1099R", /1099-?r\b|retirement|ira|401/i], ["1099NEC", /1099-?nec|contract work|freelance/i], ["PTAX", /property tax/i], ["CHILDCARE", /daycare|childcare|child care/i], ["CHARITY", /donation|charit/i], ["ESTPAY", /estimated/i], ["PNL", /p\s*&\s*l\b|profit (and|&) loss|income statement/i], ["BALANCE_SHEET", /balance sheet/i], ["TRIAL_BALANCE", /trial balance|general ledger/i], ["BANK_STATEMENT", /bank statements?|credit card statements?/i], ["PAYROLL_REPORT", /payroll|\b941s?\b|\bw-?3\b/i], ["ASSET_LIST", /fixed assets?|equipment|depreciation/i], ["LOAN_STATEMENT", /loan statements?/i], ["FORMS_ISSUED", /1099s? (we |the business )?issued|issued 1099/i]];

  const TPL = {
    en: {
      M34: "Thanks, {first}. We'll ask them for it, or follow up with you.",
      M35: "Thanks, {first}. We have your {plain_name}{from_payer} and are checking it now.",
      M35R: "Thanks, {first}. We don't have your {plain_name}{from_payer} yet. Could you send it again? A photo by reply works, or use this page: {link}",
      M36: "Thanks for letting us know, {first}. I've passed that to {preparer}.",
      M37: "Sorry about that. {firm} will check and stop these messages.",
      M20D: "No rush. I'll check back after {date}.",
      M22: "Thanks, we got your {plain_name}{from_payer}, but {missing}. Could you send {fix}?",
      M22R: "Hi {first}, {firm} here. We still need {fix} for your {plain_name}{from_payer}. A photo by reply works.",
      M23: "{summary}",
      M24: "Thanks, {first}. I've passed this to {preparer} at {firm}, who will get back to you.",
      M25: "Sorry for all the reminders, {first}. I'll pause them for a few days. {preparer} will be in touch if anything is urgent.",
      M1: "Hi {first}, it's {preparer} at {firm}. This year you can send your tax documents by text. Take a photo and reply. To turn this on, confirm your mobile number here: {link}. Prefer email? Reply to this message with your documents attached.{verify}",
      M1R: "Hi {first}, a quick reminder. Confirm your mobile number here to send documents by text: {link}. Or reply to this email with them attached.",
      M2: "{firm}: You're set up to send tax documents by text. Message frequency varies. Msg and data rates may apply. Reply HELP for help, STOP to opt out.",
      M3: "Hi {first}, it's {firm}. We need {n} documents for your {year} return{for_entity}. First: your {plain_name}{from_payer}. Reply with a photo when you have it. {sign_off}",
      M4: "Thanks, got it. Next: your {plain_name}{from_payer}. {where_hint}",
      M5: "Hi {first}, {firm} here. We still need your {plain_name}{from_payer} for {year}. A photo by reply works.",
      M6: "{firm}: we are still missing {k} documents for your {year} return. Reply here or call us on {firm_phone}. We'll pause reminders for now.",
      M7: "Thanks. That one is for {doc_year}. We need the {year} version of your {plain_name}{from_payer}. {where_hint}",
      M8: "Thanks. We can't read part of that photo. Could you retake it flat, in good light, with all four corners showing?",
      M8L: "Still hard to read, sorry. This page keeps full quality: {link}",
      M9: "Thanks. That looks like one page of a longer document. Please send the other pages too.",
      M10: "Quick question for your {year} return: {question} Reply YES or NO.",
      M11: "Thanks, we already have that one. Nothing more needed for it.",
      M12: "Thanks. I've passed that to {preparer} at {firm}, who will take a look.",
      M13: "That's everything. {firm} has all {n} documents for your {year} return. Thank you.",
      M33: "This is a message for {first} from {firm}. We are still waiting for documents for your {year} tax return. Please look for our text or email, or call our office. Thank you.",
      M32: "{firm} has every document on your list. One last thing: did anything change this year that we have not asked about, such as a new job, a move or a sale? Reply YES or NO.",
      M14: "Good question. I've passed it to {preparer}, who will get back to you.",
      M15: "Your {plain_name} comes from {issuer}. {where_hint} If you have an online account with them, look under tax documents.",
      M16: "{firm}: You're unsubscribed and will get no more texts. Reply START to resubscribe.",
      M16H: "{firm}: Document collection for your tax return. Call {firm_phone} or email {firm_email}. Reply STOP to opt out.",
      M19: "No problem, I've let {preparer} know. Next: your {plain_name}{from_payer}.",
      M19X: "No problem, I've let {preparer} know.",
      M20: "No rush. I'll check back in a few days.",
      M21: "This number is used by {firm} for client documents. Please call {firm_phone}.",
      M26: "Still needed for your {year} return: {list}. Reply with a photo of any of them.",
      M27: "Thanks, got it. {firm} will be in touch if anything else is needed.",
      M28: "Hi {first}, it's {firm}. Before we ask for your {year} tax documents, a 2-minute check-in so we only ask for what you have. Just tap what applies: {link}",
      M28R: "Hi {first}, {firm} here. A reminder about the 2-minute check-in for your {year} taxes: {link}",
      M29: "Thanks {first}. {firm} is putting your list together and will send it shortly.",
      M30L: "Thanks {first}. That PDF is locked with a password, so {firm} could not open it. Please send a copy without the password, or a photo of each page.",
      M30T: "Thanks {first}. {firm} could not open that kind of file. A photo of the page or a PDF works best.",
      M30K: "Thanks {first}. {firm} cannot open links. Please send the photo or PDF itself in a reply.",
      M31: "{firm} is not collecting documents here right now. Please contact {firm} directly: call {firm_phone} or email {firm_email}."
    },
    es: {
      M34: "Gracias, {first}. Se lo pediremos a esa persona, o le escribiremos a usted.",
      M35: "Gracias, {first}. Tenemos su {plain_name}{from_payer} y lo estamos revisando.",
      M35R: "Gracias, {first}. Aún no tenemos su {plain_name}{from_payer}. ¿Podría enviarlo de nuevo? Puede responder con una foto o usar esta página: {link}",
      M36: "Gracias por avisarnos, {first}. Se lo pasé a {preparer}.",
      M37: "Disculpe. {firm} lo revisará y dejará de enviar estos mensajes.",
      M20D: "Sin prisa. Le escribiré después del {date}.",
      M24: "Gracias, {first}. Se lo pasé a {preparer} de {firm}, quien le responderá.",
      M25: "Disculpe tantos recordatorios, {first}. Los pausaré unos días. {preparer} le escribirá si algo es urgente.",
      M22: "Gracias, recibimos su {plain_name}{from_payer}, pero {missing}. ¿Podría enviar {fix}?",
      M22R: "Hola {first}, le escribe {firm}. Aún necesitamos {fix} de su {plain_name}{from_payer}. Puede responder con una foto.",
      M23: "{summary}",
      M1: "Hola {first}, le escribe {preparer} de {firm}. Este año puede enviar sus documentos de impuestos por mensaje de texto. Tome una foto y responda. Para activarlo, confirme su número de celular aquí: {link}.{verify}",
      M1R: "Hola {first}, un recordatorio. Confirme su número de celular aquí para enviar documentos por texto: {link}.",
      M2: "{firm}: Ya puede enviar documentos de impuestos por texto. La frecuencia de mensajes varía. Pueden aplicar cargos de mensajes y datos. Responda AYUDA para ayuda, ALTO para cancelar.",
      M3: "Hola {first}, le escribe {firm}. Necesitamos {n} documentos para su declaración de {year}{for_entity}. Primero: su {plain_name}{from_payer}. Responda con una foto cuando lo tenga. {sign_off}",
      M4: "Gracias, recibido. Siguiente: su {plain_name}{from_payer}. {where_hint}",
      M5: "Hola {first}, le escribe {firm}. Aún necesitamos su {plain_name}{from_payer} de {year}. Puede responder con una foto.",
      M6: "{firm}: aún faltan {k} documentos para su declaración de {year}. Responda aquí o llámenos al {firm_phone}. Pausaremos los recordatorios por ahora.",
      M7: "Gracias. Ese documento es de {doc_year}. Necesitamos el de {year}: su {plain_name}{from_payer}. {where_hint}",
      M8: "Gracias. No podemos leer parte de la foto. ¿Puede tomarla de nuevo sobre una superficie plana, con buena luz y mostrando las cuatro esquinas?",
      M8L: "Aún es difícil de leer, disculpe. Esta página mantiene la calidad completa: {link}",
      M9: "Gracias. Parece una página de un documento más largo. Por favor envíe también las otras páginas.",
      M10: "Una pregunta rápida para su declaración de {year}: {question} Responda SI o NO.",
      M11: "Gracias, ya tenemos ese documento. No necesitamos nada más de ese.",
      M12: "Gracias. Se lo pasé a {preparer} de {firm}, quien lo revisará.",
      M13: "Eso es todo. {firm} tiene los {n} documentos para su declaración de {year}. Gracias.",
      M33: "Este es un mensaje para {first} de {firm}. Seguimos esperando documentos para su declaración de {year}. Busque nuestro mensaje de texto o correo, o llame a nuestra oficina. Gracias.",
      M32: "{firm} ya tiene todos los documentos de su lista. Una última cosa: ¿cambió algo este año que no le hayamos preguntado, como un trabajo nuevo, una mudanza o una venta? Responda SÍ o NO.",
      M14: "Buena pregunta. Se la pasé a {preparer}, quien le responderá.",
      M15: "Su {plain_name} lo envía {issuer}. {where_hint} Si tiene una cuenta en línea con ellos, busque en documentos de impuestos.",
      M16: "{firm}: Canceló su suscripción y no recibirá más mensajes. Responda START para volver a suscribirse.",
      M16H: "{firm}: Recepción de documentos para su declaración de impuestos. Llame al {firm_phone} o escriba a {firm_email}. Responda ALTO para cancelar.",
      M19: "No hay problema, ya le avisé a {preparer}. Siguiente: su {plain_name}{from_payer}.",
      M19X: "No hay problema, ya le avisé a {preparer}.",
      M20: "Sin prisa. Le escribiré de nuevo en unos días.",
      M21: "{firm} usa este número para documentos de clientes. Por favor llame al {firm_phone}.",
      M26: "Aún falta para su declaración de {year}: {list}. Responda con una foto de cualquiera.",
      M27: "Gracias, recibido. {firm} le avisará si necesita algo más.",
      M28: "Hola {first}, le escribe {firm}. Antes de pedirle sus documentos de impuestos de {year}, 2 minutos de preguntas para pedirle solo lo que tiene. Toque lo que aplica: {link}",
      M28R: "Hola {first}, le escribe {firm}. Un recordatorio de las preguntas de 2 minutos para sus impuestos de {year}: {link}",
      M29: "Gracias {first}. {firm} está preparando su lista y se la enviará pronto.",
      M30L: "Gracias {first}. Ese PDF tiene contraseña y {firm} no pudo abrirlo. Envíe una copia sin contraseña, o una foto de cada página.",
      M30T: "Gracias {first}. {firm} no pudo abrir ese tipo de archivo. Lo mejor es una foto de la página o un PDF.",
      M30K: "Gracias {first}. {firm} no puede abrir enlaces. Envíe la foto o el PDF directamente en una respuesta.",
      M31: "{firm} no está recibiendo documentos aquí por ahora. Comuníquese con {firm} directamente: llame al {firm_phone} o escriba a {firm_email}."
    }
  };
  const TPL_USE = { M34: "Someone else has the document", M35: "Says it was already sent: we have it", M35R: "Says it was already sent: asked again", M36: "A change passed to the preparer", M37: "Says the messages are not theirs", M20D: "Will send after a date", M33: "Voicemail after the final reminder", M32: "The closing question", M31: "Auto-reply while the firm is paused", M30L: "Locked PDF", M30T: "A file we cannot open", M30K: "A link instead of a file", M1: "Invitation to text (email)", M1R: "Invitation reminder (email)", M2: "Texting turned on", M3: "First request", M4: "Next request", M5: "Reminder", M6: "Final reminder", M7: "Wrong year", M8: "Photo too hard to read", M8L: "Photo too hard to read, second time", M9: "Missing page", M10: "Did anything change this year?", M11: "Duplicate", M12: "Passed to your team", M13: "Everything is in", M14: "Question passed to a person", M15: "Where to find a form", M16: "Texting turned off (STOP)", M16H: "Reply to HELP", M19: "Client has none, next request", M19X: "Client has none", M20: "Will send later", M21: "Unknown sender", M26: "What is still needed", M27: "Document arrived before we asked", M28: "Check-in invitation", M28R: "Check-in reminder", M29: "Check-in thanks", M22: "Part of a document is missing", M22R: "Reminder for the missing part", M23: "One reply for several documents", M24: "Passed to a person", M25: "Pause when a client is upset" };
  const COMPLIANCE = ["M1", "M1R", "M2", "M16", "M16H", "M21"];
  /* Voice (TH-VOI, docs/REBRAND.md section 5). How the firm's messages sound: Warm, Professional or Brief, for the firm or for one
     client. Professional is TPL above. Warm and Brief are written by hand below, one for one; nothing here is written by a model.
     Every version passes outputCheck (a test fills each with the longest realistic values). No exclamation marks and no emoji in
     any voice. Messages the law words for us (opting in, STOP, HELP, a wrong number) and the recorded call have one wording.
     The Spanish versions are drafts until a fluent speaker has reviewed them (T-31); Spanish stays off for pilot firms. */
  const VOICES = {
    warm: { label: "Warm", note: "A friendly opener, a thank-you and your sign-off" },
    professional: { label: "Professional", note: "Clear and polite. The standard wording" },
    brief: { label: "Brief", note: "One sentence: the ask and nothing else" }
  };
  const VOICE_FIXED = ["M1", "M1R", "M2", "M16", "M16H", "M21", "M23", "M31", "M33"];
  const VOICE_TPL = {
    warm: {
      en: {
        M34: "Thank you for letting us know, {first}. We'll ask them for it, or follow up with you.",
        M35: "Thank you, {first}. We have your {plain_name}{from_payer} and are checking it now. We'll be in touch if anything is missing.",
        M35R: "Thank you, {first}. Sorry, we don't have your {plain_name}{from_payer} yet. Could you send it once more? A photo by reply is perfect, or use this page: {link}",
        M36: "Thank you for letting us know, {first}. I've passed that to {preparer}, who will take it from here.",
        M37: "We're sorry about that. {firm} will check and stop these messages.",
        M20D: "No rush, {first}. I'll check back after {date}.",
        M3: "Hi {first}, it's {firm}. Hope the new year is going well. We need {n} documents for your {year} return{for_entity}. Could you start with your {plain_name}{from_payer}? {how_send} Thank you. {sign_off}",
        M4: "Thank you, {first}, got it. Next on the list is your {plain_name}{from_payer}. {where_hint}",
        M5: "Hi {first}, {firm} here with a friendly reminder. We still need your {plain_name}{from_payer} for {year}. A photo by reply is perfect. Thank you. {sign_off}",
        M6: "Hi {first}, it's {firm}. We are still missing {k} documents for your {year} return. Whenever you are ready, reply here or call us on {firm_phone}. We'll pause the reminders for now. Thank you.",
        M7: "Thank you, {first}. That one is for {doc_year}, and we need the {year} version of your {plain_name}{from_payer}. {where_hint}",
        M8: "Thank you, {first}. Part of that photo is hard to read. Could you take it again with the page flat, in good light, with all four corners showing?",
        M8L: "Sorry, {first}, it is still hard to read. This page keeps the photo at full quality: {link}",
        M9: "Thank you, {first}. That looks like one page of a longer document. Could you send the other pages too?",
        M10: "Hi {first}, a quick question from {firm} for your {year} return: {question} Reply YES or NO. Thank you.",
        M11: "Thank you, {first}. We already have that one, so nothing more is needed for it.",
        M12: "Thank you, {first}. I've passed that to {preparer} at {firm}, who will take a look.",
        M13: "That's everything, {first}. {firm} has all {n} documents for your {year} return. Thank you for getting them to us. {sign_off}",
        M14: "Good question, {first}. I've passed it to {preparer}, who will get back to you.",
        M15: "Happy to help, {first}. Your {plain_name} comes from {issuer}. {where_hint} If you have an online account with them, look under tax documents.",
        M19: "No problem at all, {first}. I've let {preparer} know. Next on the list is your {plain_name}{from_payer}.",
        M19X: "No problem at all, {first}. I've let {preparer} know.",
        M20: "No rush, {first}. I'll check back in a few days.",
        M22: "Thank you, {first}, we got your {plain_name}{from_payer}, but {missing}. Could you send {fix}?",
        M22R: "Hi {first}, {firm} here with a friendly reminder. We still need {fix} for your {plain_name}{from_payer}. A photo by reply is perfect. Thank you.",
        M24: "Thank you, {first}. I've passed this to {preparer} at {firm}, who will get back to you.",
        M25: "Sorry for all the reminders, {first}. I'll pause them for a few days. {preparer} will be in touch if anything is urgent.",
        M26: "Hi {first}, here is what is still needed for your {year} return: {list}. Reply with a photo of any of them whenever you can. Thank you.",
        M27: "Thank you, {first}, got it. {firm} will be in touch if anything else is needed.",
        M28: "Hi {first}, it's {firm}. Before we ask for your {year} tax documents, here is a 2-minute check-in so we only ask for what you have. Just tap what applies: {link} Thank you.",
        M28R: "Hi {first}, {firm} here with a friendly reminder about the 2-minute check-in for your {year} taxes: {link}",
        M29: "Thank you, {first}. {firm} is putting your list together and will send it shortly.",
        M30L: "Thank you, {first}. That PDF is locked with a password, so {firm} could not open it. Could you send a copy without the password, or a photo of each page?",
        M30T: "Thank you, {first}. {firm} could not open that kind of file. A photo of the page or a PDF works best.",
        M30K: "Thank you, {first}. {firm} cannot open links. Could you send the photo or PDF itself in a reply?",
        M32: "{firm} has every document on your list, {first}. Thank you. One last thing: did anything change this year that we have not asked about, such as a new job, a move or a sale? Reply YES or NO."
      },
      es: {
        M34: "Gracias por avisarnos, {first}. Se lo pediremos a esa persona, o le escribiremos a usted.",
        M35: "Gracias, {first}. Tenemos su {plain_name}{from_payer} y lo estamos revisando. Le escribiremos si falta algo.",
        M35R: "Gracias, {first}. Disculpe, aún no tenemos su {plain_name}{from_payer}. ¿Podría enviarlo una vez más? Puede responder con una foto o usar esta página: {link}",
        M36: "Gracias por avisarnos, {first}. Se lo pasé a {preparer}, quien se encargará.",
        M37: "Le pedimos una disculpa. {firm} lo revisará y dejará de enviar estos mensajes.",
        M20D: "Sin prisa, {first}. Le escribiré de nuevo después del {date}.",
        M3: "Hola {first}, le escribe {firm}. Esperamos que el año haya empezado bien. Necesitamos {n} documentos para su declaración de {year}{for_entity}. ¿Podría empezar con su {plain_name}{from_payer}? {how_send} Gracias. {sign_off}",
        M4: "Gracias, {first}, recibido. Lo siguiente en la lista es su {plain_name}{from_payer}. {where_hint}",
        M5: "Hola {first}, le escribe {firm} con un recordatorio amable. Aún necesitamos su {plain_name}{from_payer} de {year}. Una foto como respuesta es suficiente. Gracias. {sign_off}",
        M6: "Hola {first}, le escribe {firm}. Aún faltan {k} documentos para su declaración de {year}. Cuando pueda, responda aquí o llámenos al {firm_phone}. Pausaremos los recordatorios por ahora. Gracias.",
        M7: "Gracias, {first}. Ese documento es de {doc_year} y necesitamos el de {year}: su {plain_name}{from_payer}. {where_hint}",
        M8: "Gracias, {first}. Parte de la foto es difícil de leer. ¿Podría tomarla de nuevo sobre una superficie plana, con buena luz y mostrando las cuatro esquinas?",
        M8L: "Disculpe, {first}, aún es difícil de leer. Esta página mantiene la foto con calidad completa: {link}",
        M9: "Gracias, {first}. Parece una página de un documento más largo. ¿Podría enviar también las otras páginas?",
        M10: "Hola {first}, una pregunta rápida de {firm} para su declaración de {year}: {question} Responda SI o NO. Gracias.",
        M11: "Gracias, {first}. Ya tenemos ese documento, así que no necesitamos nada más de ese.",
        M12: "Gracias, {first}. Se lo pasé a {preparer} de {firm}, quien lo revisará.",
        M13: "Eso es todo, {first}. {firm} tiene los {n} documentos para su declaración de {year}. Gracias por enviarlos. {sign_off}",
        M14: "Buena pregunta, {first}. Se la pasé a {preparer}, quien le responderá.",
        M15: "Con gusto, {first}. Su {plain_name} viene de {issuer}. {where_hint} Si tiene una cuenta en línea con ellos, busque en documentos de impuestos.",
        M19: "No hay problema, {first}. Ya le avisé a {preparer}. Lo siguiente en la lista es su {plain_name}{from_payer}.",
        M19X: "No hay problema, {first}. Ya le avisé a {preparer}.",
        M20: "Sin prisa, {first}. Le escribiré de nuevo en unos días.",
        M22: "Gracias, {first}, recibimos su {plain_name}{from_payer}, pero {missing}. ¿Podría enviar {fix}?",
        M22R: "Hola {first}, le escribe {firm} con un recordatorio amable. Aún necesitamos {fix} de su {plain_name}{from_payer}. Una foto como respuesta es suficiente. Gracias.",
        M24: "Gracias, {first}. Se lo pasé a {preparer} de {firm}, quien le responderá.",
        M25: "Disculpe tantos recordatorios, {first}. Los pausaré unos días. {preparer} le escribirá si algo es urgente.",
        M26: "Hola {first}, esto es lo que aún falta para su declaración de {year}: {list}. Responda con una foto de cualquiera de ellos cuando pueda. Gracias.",
        M27: "Gracias, {first}, recibido. {firm} le escribirá si se necesita algo más.",
        M28: "Hola {first}, le escribe {firm}. Antes de pedirle sus documentos de impuestos de {year}, le dejamos unas preguntas de 2 minutos para pedirle solo lo que usted tiene. Toque lo que corresponda: {link} Gracias.",
        M28R: "Hola {first}, le escribe {firm} con un recordatorio amable de las preguntas de 2 minutos para sus impuestos de {year}: {link}",
        M29: "Gracias, {first}. {firm} está preparando su lista y se la enviará pronto.",
        M30L: "Gracias, {first}. Ese PDF tiene contraseña y {firm} no pudo abrirlo. ¿Podría enviar una copia sin contraseña, o una foto de cada página?",
        M30T: "Gracias, {first}. {firm} no pudo abrir ese tipo de archivo. Una foto de la página o un PDF funciona mejor.",
        M30K: "Gracias, {first}. {firm} no puede abrir enlaces. ¿Podría enviar la foto o el PDF en una respuesta?",
        M32: "{firm} ya tiene todos los documentos de su lista, {first}. Gracias. Una última cosa: ¿cambió algo este año que no le hayamos preguntado, como un trabajo nuevo, una mudanza o una venta? Responda SI o NO."
      }
    },
    brief: {
      en: {
        M34: "Thanks. We'll ask them, or follow up.",
        M35: "We have your {plain_name}{from_payer} and are checking it.",
        M35R: "We don't have your {plain_name}{from_payer} yet. Please send it again here: {link}",
        M36: "Thanks. Passed to {preparer}.",
        M37: "Sorry. {firm} will stop these messages.",
        M20D: "No rush. We'll check back after {date}.",
        M3: "{firm}: please send your {plain_name}{from_payer} for your {year} return{for_entity}. {how_send}",
        M4: "Got it, thanks. Next: your {plain_name}{from_payer}.",
        M5: "{firm}: still need your {plain_name}{from_payer} for {year}. A photo by reply works.",
        M6: "{firm}: {k} documents still missing for {year}. Reply here or call us on {firm_phone}. Reminders are paused.",
        M7: "That one is for {doc_year}. Please send the {year} {plain_name}{from_payer}.",
        M8: "We can't read that photo. Please retake it flat, in good light, all four corners showing.",
        M8L: "Still hard to read. Please use this page: {link}",
        M9: "That is one page of a longer document. Please send the other pages.",
        M10: "{firm}, for your {year} return: {question} Reply YES or NO.",
        M11: "We already have that one. Thanks.",
        M12: "Thanks. Passed to {preparer} at {firm}.",
        M13: "{firm} has all {n} documents for your {year} return. Thank you.",
        M14: "Passed to {preparer}, who will get back to you.",
        M15: "Your {plain_name} comes from {issuer}. {where_hint}",
        M19: "Noted, {preparer} knows. Next: your {plain_name}{from_payer}.",
        M19X: "Noted, {preparer} knows.",
        M20: "No rush. We'll check back in a few days.",
        M22: "Got your {plain_name}{from_payer}, but {missing}. Please send {fix}.",
        M22R: "{firm}: still need {fix} for your {plain_name}{from_payer}. A photo by reply works.",
        M24: "Thanks. Passed to {preparer} at {firm}.",
        M25: "Sorry for the reminders. They are paused for a few days.",
        M26: "{firm}: still needed for {year}: {list}. Reply with a photo of any.",
        M27: "Got it, thanks.",
        M28: "{firm}: a 2-minute check-in before we ask for your {year} tax documents: {link}",
        M28R: "{firm}: reminder, your 2-minute check-in for {year}: {link}",
        M29: "Thanks. {firm} will send your list shortly.",
        M30L: "That PDF is locked. Please send a copy without the password, or a photo of each page.",
        M30T: "{firm} could not open that file. Please send a photo or a PDF.",
        M30K: "{firm} cannot open links. Please send the photo or PDF itself.",
        M32: "{firm} has every document on your list. Did anything else change this year, such as a new job, a move or a sale? Reply YES or NO."
      },
      es: {
        M34: "Gracias. Se lo pediremos, o le escribiremos.",
        M35: "Tenemos su {plain_name}{from_payer} y lo estamos revisando.",
        M35R: "Aún no tenemos su {plain_name}{from_payer}. Por favor envíelo de nuevo aquí: {link}",
        M36: "Gracias. Se lo pasé a {preparer}.",
        M37: "Disculpe. {firm} dejará de enviar estos mensajes.",
        M20D: "Sin prisa. Le escribiremos después del {date}.",
        M3: "{firm}: por favor envíe su {plain_name}{from_payer} para su declaración de {year}{for_entity}. {how_send}",
        M4: "Recibido, gracias. Siguiente: su {plain_name}{from_payer}.",
        M5: "{firm}: aún necesitamos su {plain_name}{from_payer} de {year}. Puede responder con una foto.",
        M6: "{firm}: aún faltan {k} documentos de {year}. Responda aquí o llámenos al {firm_phone}. Los recordatorios quedan en pausa.",
        M7: "Ese documento es de {doc_year}. Por favor envíe el de {year}: su {plain_name}{from_payer}.",
        M8: "No podemos leer la foto. Por favor tómela de nuevo, plana, con buena luz y las cuatro esquinas visibles.",
        M8L: "Aún es difícil de leer. Por favor use esta página: {link}",
        M9: "Es una página de un documento más largo. Por favor envíe las otras páginas.",
        M10: "{firm}, para su declaración de {year}: {question} Responda SI o NO.",
        M11: "Ya tenemos ese documento. Gracias.",
        M12: "Gracias. Se lo pasé a {preparer} de {firm}.",
        M13: "{firm} tiene los {n} documentos para su declaración de {year}. Gracias.",
        M14: "Se la pasé a {preparer}, quien le responderá.",
        M15: "Su {plain_name} viene de {issuer}. {where_hint}",
        M19: "Anotado, {preparer} ya lo sabe. Siguiente: su {plain_name}{from_payer}.",
        M19X: "Anotado, {preparer} ya lo sabe.",
        M20: "Sin prisa. Le escribiremos en unos días.",
        M22: "Recibimos su {plain_name}{from_payer}, pero {missing}. Por favor envíe {fix}.",
        M22R: "{firm}: aún necesitamos {fix} de su {plain_name}{from_payer}. Puede responder con una foto.",
        M24: "Gracias. Se lo pasé a {preparer} de {firm}.",
        M25: "Disculpe los recordatorios. Quedan en pausa unos días.",
        M26: "{firm}: aún falta para {year}: {list}. Responda con una foto de cualquiera.",
        M27: "Recibido, gracias.",
        M28: "{firm}: unas preguntas de 2 minutos antes de pedirle sus documentos de impuestos de {year}: {link}",
        M28R: "{firm}: recordatorio, sus preguntas de 2 minutos para {year}: {link}",
        M29: "Gracias. {firm} le enviará su lista pronto.",
        M30L: "Ese PDF tiene contraseña. Por favor envíe una copia sin contraseña, o una foto de cada página.",
        M30T: "{firm} no pudo abrir ese archivo. Por favor envíe una foto o un PDF.",
        M30K: "{firm} no puede abrir enlaces. Por favor envíe la foto o el PDF.",
        M32: "{firm} ya tiene todos los documentos de su lista. ¿Cambió algo más este año, como un trabajo nuevo, una mudanza o una venta? Responda SI o NO."
      }
    }
  };
  const SCOPE = { documents: "Documents", tax_question: "Tax question", billing: "Billing", scheduling: "Scheduling", personal: "Personal", complaint: "Complaint", other: "Other" };

  const QUESTIONS = [
    { en: "Did you start a new job in {year}?", es: "¿Empezó un trabajo nuevo en {year}?", add: [["W2", null]] },
    { en: "Did you buy, sell or refinance a home in {year}?", es: "¿Compró, vendió o refinanció una casa en {year}?", add: [["1098", null]] },
    { en: "Did you earn money from self-employment or a side business in {year}?", es: "¿Ganó dinero por trabajo independiente en {year}?", add: [["1099NEC", null], ["1099K", null]] }
  ];
  const STUCK = {
    no_reply: ["No reply after the final reminder", "Call the client, or send a manual message"],
    question_waiting: ["The client asked a question", "Answer in the thread"],
    review_waiting: ["A document has waited more than a day for you", "Open the review queue"],
    not_delivering: ["Messages are not being delivered", "Check the number and email"],
    client_says_none: ["The client says they don't have a document", "Waive it or re-ask"],
    opted_out: ["The client opted out with documents missing", "Contact them another way"],
    no_consent: ["No response to the invitation", "Call, or switch to email only"]
  };
  const BLOCK = ["refund", "deduct", "deductible", "owe", "write off", "should file", "audit", "penalty", "reembolso", "deducible", "multa"];
  /* US federal holidays for any year, with the observed day when one falls on a weekend. */
  function holidaysOf(y) {
    const nth = (m, wd, n) => { const d = new Date(y, m, 1); d.setDate(1 + ((wd - d.getDay() + 7) % 7) + (n - 1) * 7); return d; }, last = (m, wd) => { const d = new Date(y, m + 1, 0); d.setDate(d.getDate() - ((d.getDay() - wd + 7) % 7)); return d; };
    const obs = (m, day) => { const d = new Date(y, m, day); if (d.getDay() === 6) d.setDate(day - 1); else if (d.getDay() === 0) d.setDate(day + 1); return d; };
    return [obs(0, 1), nth(0, 1, 3), nth(1, 1, 3), last(4, 1), obs(5, 19), obs(6, 4), nth(8, 1, 1), nth(9, 1, 2), obs(10, 11), nth(10, 4, 4), obs(11, 25)].map(dayKey);
  }
  const HCACHE = {};
  function isHoliday(d) { const y = d.getFullYear(); if (!HCACHE[y]) HCACHE[y] = holidaysOf(y).concat(holidaysOf(y + 1).slice(0, 1)); return HCACHE[y].includes(dayKey(d)); }

  let S = null, seq = 0;
  const id = (p) => p + (++seq);
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const client = (cid) => S.clients.find((c) => c.id === cid);
  const eng = (eid) => S.engs.find((e) => e.id === eid);
  const engOf = (cid) => S.engs.find((e) => e.clientId === cid);
  const itemsOf = (eid) => S.items.filter((i) => i.engId === eid && i.state !== "removed").sort((a, b) => FORMS[a.form].order - FORMS[b.form].order);
  const OPEN = ["expected", "requested", "partial", "in_review", "says_none"];
  const openItems = (eid) => itemsOf(eid).filter((i) => OPEN.includes(i.state));
  const progress = (eid) => { const it = itemsOf(eid); return { done: it.filter((i) => !OPEN.includes(i.state)).length, total: it.length }; };
  function audit(action, detail, actor) { S.audit.unshift({ at: new Date(S.now), actor: actor || S.user.name, action, detail }); }
  function timeline(e, text, actor) { e.timeline.unshift({ at: new Date(S.now), text, actor: actor || "Tallyhound" }); }
  function hlog(e, kind, text, why, model) { S.hlog.unshift({ id: id("h"), at: new Date(S.now), engId: e ? e.id : null, kind, text, why: why || "", model: model || "Rules" }); if (S.hlog.length > 800) S.hlog.length = 800; }
  function alertx(e, level, kind, text, key) { if (key && S.alerts.some((a) => a.key === key)) return; S.alerts.unshift({ id: id("a"), at: new Date(S.now), engId: e ? e.id : null, level, kind, text, key: key || null, read: false }); hlog(e, "alert", text, "", "Rules"); }
  /* TH-MEM-7: when a client tends to reply. After SEND_HOUR_MIN_REPLIES replies inside the same two-hour window, that client's
     reminders are planned for the start of the window, always inside sending hours. One number; nothing else is kept. */
  const SEND_HOUR_MIN_REPLIES = 3;
  function bestHour(e) {
    const h = (e.hours || []).filter((x) => x >= S.firm.quietStart && x < S.firm.quietEnd); if (h.length < SEND_HOUR_MIN_REPLIES) return null;
    let best = null, top = 0; for (let a = S.firm.quietStart; a < S.firm.quietEnd; a++) { const n = h.filter((x) => x === a || x === a + 1).length; if (n > top) { top = n; best = a; } }
    return top >= SEND_HOUR_MIN_REPLIES ? best : null;
  }
  const hourLabel = (h) => (h % 12 || 12) + (h >= 12 ? " pm" : " am");
  const dlabel = (d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + (d.getMonth() + 1) + "/" + d.getDate() + " " + hourLabel(d.getHours());
  function schedule(e, days, why) {
    const c = client(e.clientId), near = e.target && e.target > S.now && e.target - S.now < 7 * DAY, d = near ? Math.min(days, 1) : days, bh = bestHour(e);
    const t = new Date(S.now.getTime() + d * DAY); t.setHours(bh != null ? bh : S.firm.newDayHour, 0, 0, 0); e.next = nextAllowed(t);
    hlog(e, "schedule", "Next follow-up for " + c.first + ": " + dlabel(e.next), [why, bh != null ? c.first + " usually replies around " + hourLabel(bh) + ", so it goes then." : "", near ? "The target date is close, so following up daily." : ""].filter(Boolean).join(" "), "Rules");
  }
  function classify(text) {
    const t = text.toLowerCase();
    const sentiment = /annoy|bugging|stop (texting|messaging|bothering|sending)|frustrat|ridiculous|enough already|leave me alone|so many (texts|messages)|!!!/.test(t) ? "frustrated" : /confus|don'?t understand|what is (a|this)|no idea/.test(t) ? "confused" : "calm";
    const scope = /deduct|write.?off|\bowe\b|refund|should i|can i claim|bracket|irs letter|audit|penalt|tax (advice|question)|estimated payment amount/.test(t) ? "tax_question" : /invoice|\bbill\b|\bfees?\b|pay you|charge|price|cost of/.test(t) ? "billing" : /appointment|meeting|reschedul|schedule|call me|come in|meet with/.test(t) ? "scheduling" : sentiment === "frustrated" && /stop|leave/.test(t) && !/send|later|weekend|week/.test(t) ? "complaint" : "documents";
    let memory = null; const m1 = /(out of town|traveling|travelling|away|on vacation)( until| till)? ([a-z]+ \d{1,2})?/.exec(t), m2 = /my (husband|wife|spouse|partner|accountant|son|daughter) (has|handles|does|keeps|gets)[^.!?]*/.exec(t), m3 = /(evenings?|mornings?|weekends?) (work|are) best|text me (in the )?(evening|morning)/.exec(t);
    if (m1) memory = "Away" + (m1[3] ? " until " + m1[3] : " for a while") + " (said " + (S.now.getMonth() + 1) + "/" + S.now.getDate() + ")"; else if (m2) memory = "Their " + m2[1] + " " + m2[2] + text.slice(m2.index + m2[0].indexOf(m2[2]) + m2[2].length, m2.index + m2[0].length).trim().replace(/^/, " ").replace(/\s+/g, " "); else if (m3) memory = "Prefers " + (m3[1] || m3[4] || "").replace(/s$/, "") + " messages";
    return { scope, sentiment, memory };
  }
  /* Data minimisation. Clients sometimes type an SSN, a card number or a bank account into a text or email.
     Tallyhound has no use for any of them, so they are removed before the message is stored, logged or shown to a model. */
  const luhn = (d) => { let t = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } t += n; alt = !alt; } return t % 10 === 0; };
  function scrub(text) {
    let t = String(text == null ? "" : text); const hit = [];
    t = t.replace(/(^|[^\d-])(\d{3})[- .](\d{2})[- .](\d{4})(?![\d-])/g, (m, a) => { hit.push("ssn"); return a + "[SSN removed]"; });
    t = t.replace(/\b(ssn|ss#|social(?:\s+security)?(?:\s+(?:number|no\.?|#))?|itin|tax\s*id)(\s*(?:is|:|#|=)?\s*)(\d{9})\b/gi, (m, k, sep) => { hit.push("ssn"); return k + sep + "[SSN removed]"; });
    t = t.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => { const d = m.replace(/\D/g, ""); if (d.length >= 13 && d.length <= 19 && luhn(d)) { hit.push("card"); return "[card number removed]" + (/[ -]$/.test(m) ? " " : ""); } return m; });
    t = t.replace(/\b(routing|account|acct|aba)(\s*(?:number|no\.?|num|#)?\s*(?:is|:|#|=)?\s*)(\d[\d -]{5,20}\d)\b/gi, (m, k, sep) => { hit.push("bank"); return k + sep + "[account number removed]"; });
    return { text: t, hit: [...new Set(hit)] };
  }
  const SCRUB_WORD = { ssn: "a Social Security number", card: "a card number", bank: "a bank account number" };
  function scrubIn(text, e) { const r = scrub(text); if (r.hit.length && e) { hlog(e, "guardrail", "Removed " + r.hit.map((k) => SCRUB_WORD[k]).join(" and ") + " from a message before storing it", "Tallyhound never keeps these. The rest of the message is unchanged.", "Rules"); audit("privacy.scrub", client(e.clientId).last + ": " + r.hit.join(", "), "Tallyhound"); } return r.text; }
  function remember(e, text, source) { if (!text) return; text = scrub(text).text; e.memory = e.memory || []; if (e.memory.some((m) => m.text === text)) return; e.memory.unshift({ at: new Date(S.now), text, source }); hlog(e, "memory", "Remembered: " + text, "Used to word and time future messages", source === "Claude" ? "Claude" : "Rules"); }
  function releaseOf(it, e) { const r = RELEASE[it.form]; if (!r) return null; const d = new Date((e ? e.year : 2026) + 1, r[0], r[1]); d.setHours(S.firm.newDayHour, 0, 0, 0); return d; }
  const expectYear = (form, e) => (form === "PRIOR" ? e.year - 1 : e.year);
  function missText(keys, lang, form) {
    const es = lang === "es", parts = keys.map((k) => MISSTXT[k] || [null, null, null, null]);
    const lab = (k) => { const own = (ELEMENTS[form] || []).find((y) => y[0] === k); if (own) return own[1].charAt(0).toLowerCase() + own[1].slice(1); for (const f in ELEMENTS) { const x = ELEMENTS[f].find((y) => y[0] === k); if (x) return x[1].charAt(0).toLowerCase() + x[1].slice(1); } return k; };
    const miss = parts.map((p, i) => (es ? p[2] || "falta parte del documento" : p[0] || lab(keys[i]) + " can't be seen"));
    const fix = parts.map((p, i) => (es ? p[3] || "una foto del documento completo" : p[1] || "a photo that shows " + lab(keys[i])));
    const join = (a) => [...new Set(a)].join(es ? " y " : " and ");
    return { missing: join(miss), fix: join(fix) };
  }

  /* ---------- time rules ---------- */
  function allowed(d) {
    const f = S.firm, h = d.getHours() + d.getMinutes() / 60;
    return h >= f.quietStart && h < f.quietEnd && d.getDay() !== 0 && !isHoliday(d) && !(f.closedDays || []).includes(dayKey(d));
  }
  /* T-63: days the firm itself is closed, beyond Sundays and federal holidays. Nothing automated is sent on them. Owner only.
     Given as dates (YYYY-MM-DD). Past dates are dropped; at most 60 are kept. */
  function setClosedDays(list) {
    if (!may("owner")) return "Only an owner can do this"; const out = [], today = dayKey(S.now), bad = [];
    for (const raw of Array.isArray(list) ? list : []) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw).trim()); if (!m) { if (String(raw).trim()) bad.push(String(raw).trim().slice(0, 20)); continue; } const d = new Date(+m[1], +m[2] - 1, +m[3]); if (d.getMonth() !== +m[2] - 1) { bad.push(m[0]); continue; } const k = dayKey(d); if (k >= today && !out.includes(k)) out.push(k); }
    if (bad.length) return "Not a date: " + bad[0]; if (out.length > 60) return "At most 60 closed days";
    S.firm.closedDays = out.sort(); audit("settings.closed", out.length ? out.length + " closed day" + (out.length === 1 ? "" : "s") : "No closed days"); S.engs.forEach((e) => { if (e.next && !allowedC(e.next, client(e.clientId))) e.next = nextAllowedC(e.next, client(e.clientId)); }); return null;
  }
  function nextAllowed(d) {
    if (allowed(d)) return new Date(d);
    let x = new Date(d);
    if (x.getHours() + x.getMinutes() / 60 < S.firm.quietStart && x.getDay() !== 0 && !isHoliday(x)) { x.setHours(S.firm.newDayHour, 0, 0, 0); return x; }
    for (let i = 0; i < 10; i++) { x = new Date(x.getTime() + DAY); x.setHours(S.firm.newDayHour, 0, 0, 0); if (allowed(x)) return x; }
    return x;
  }
  const live = (e) => e.lastIn && S.now - e.lastIn <= S.firm.liveMin * MIN;

  /* ---------- templates ---------- */
  const LONGDOC = ["1099CONS", "K1", "PRIOR", "PNL", "BALANCE_SHEET", "TRIAL_BALANCE", "BANK_STATEMENT", "PAYROLL_REPORT", "FORMS_ISSUED"];
  const LONGHOW = { en: ["Reply with a photo when you have it.", "It usually runs to several pages, so a PDF by email works best."], es: ["Responda con una foto cuando lo tenga.", "Suele tener varias páginas, así que lo mejor es enviar el PDF por correo electrónico."] };
  /* Links to the client's own pages (consent, upload, check-in). The demo uses a fixed sample link. A production firm has
     firm.linkBase (the host) and firm.slug (which firm), and each client gets a private key of 28 letters (128 bits), so the link never
     trips the digit check in outputCheck. A key is good for LINK_DAYS; the next message that carries a link after that makes a new one. */
  const LINK_DAYS = 14, LINK_SAMPLE = "go.tallyhound.example";
  const linkHost = () => S.firm.linkBase || LINK_SAMPLE;
  function linkKey() { const A = "abcdefghijkmnpqrstuvwxyz", b = new Uint8Array(28); globalThis.crypto.getRandomValues(b); let k = ""; for (const x of b) k += A[x % A.length]; return k; }
  function linkLive(c) { return !!(c && c.key && c.keyAt && S.now - new Date(c.keyAt) <= LINK_DAYS * DAY); }
  function linkFresh(c) { if (!S.firm.linkBase || !c) return; if (!linkLive(c)) { c.key = linkKey(); c.keyAt = new Date(S.now); } }
  function linkFor(c, kind) { return S.firm.linkBase ? S.firm.linkBase + "/" + kind + "/" + (S.firm.slug ? S.firm.slug + "-" : "") + ((c && c.key) || "") : LINK_SAMPLE + "/" + kind + "/k3x9"; }
  function voiceFor(c) { const k = (c && c.voice) || (S.firm.hound && S.firm.hound.voice) || "professional"; return VOICES[k] ? k : "professional"; }
  function setVoice(k) { if (!may("owner")) return "Only an owner can change this"; if (!VOICES[k]) return "Choose Warm, Professional or Brief"; const H = S.firm.hound; if ((H.voice || "professional") === k) return null; H.voice = k; audit("firm.voice_changed", "Messages now sound " + VOICES[k].label); return null; }
  function setClientVoice(cid, k) { const c = client(cid); if (!c) return "Unknown client"; if (!may()) return "Not allowed"; if (k && !VOICES[k]) return "Choose Warm, Professional or Brief"; if ((c.voice || null) === (k || null)) return null; if (k) c.voice = k; else delete c.voice; const e = engOf(cid); if (e) timeline(e, "Voice: " + (k ? VOICES[k].label : "the firm's (" + VOICES[voiceFor(c)].label + ")"), S.user.name); audit("client.voice_changed", c.first + " " + c.last + ": " + (k ? VOICES[k].label : "firm default")); return null; }
  /* TH-VOI-4: the sign-off a firm puts at the end of its requests. Up to 30 characters, and it must pass the same check as a message. */
  function setSignOff(text) {
    if (!may("owner")) return "Only an owner can change this"; const v = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    if (v.length > 30) return "Keep the sign-off to 30 characters"; if (/[{}!]/.test(v)) return "No exclamation marks or brackets in a sign-off"; if (/\d/.test(v)) return "No numbers in a sign-off";
    const errs = outputCheck(v, "text", {}); if (errs.length) return "That sign-off cannot be used: " + errs.join(", ");
    if ((S.firm.signOff || "") === v) return null; S.firm.signOff = v; audit("firm.signoff_changed", v ? "Sign-off set" : "Sign-off removed"); return null;
  }
  /* TH-VOI-6: what a request reads like in a voice and language, for the settings page. Sample data only: Maria, and a W-2 from
     Acme Health. Never a real client. The firm's own name and sign-off are used, because that is what the owner is choosing. */
  function previewVoice(code, voice, lang) {
    const c = { id: "", first: "Maria", last: "Garcia", lang: lang === "es" ? "es" : "en", preparer: S.user ? S.user.id : null, voice: VOICES[voice] ? voice : "professional" };
    return fill(TPL.en[code] ? code : "M3", c, null, { voice: c.voice, item: { form: "W2", payer: "Acme Health" }, n: 3, k: 2, doc_year: (S.firm.taxYear || 2026) - 1, link: LINK_SAMPLE + "/u/k3x9", list: "W-2 from Acme Health, 1099-INT from First Farmers Bank", question: PORTALQ[0][lang === "es" ? 2 : 1].replace("{year}", S.firm.taxYear || 2026), missing: "page 2 is missing", fix: "page 2", summary: "" });
  }
  function fill(code, c, e, extra) {
    const lang = c && c.lang === "es" ? "es" : "en", voice = (extra && extra.voice && VOICES[extra.voice] ? extra.voice : voiceFor(c)), std = (S.firm.templates[lang] || {})[code] || TPL[lang][code] || TPL.en[code];
    const t = voice === "professional" || VOICE_FIXED.includes(code) ? std : (((S.firm.templatesBy || {})[voice] || {})[lang] || {})[code] || VOICE_TPL[voice][lang][code] || VOICE_TPL[voice].en[code] || std;
    const it = extra && extra.item, F = it ? FORMS[it.form] : null, p = progress(e ? e.id : "");
    const prep = c ? (S.users.find((u) => u.id === c.preparer) || {}).first || S.firm.sender : S.firm.sender;
    const v = Object.assign({
      for_entity: c && c.entity && c.entity !== c.first ? (lang === "es" ? " de " : " for ") + c.entity : "",
      verify: S.firm.phone ? (lang === "es" ? " Para confirmar que este mensaje es nuestro, llame a la oficina al " : " To check this message is really from us, call the office at ") + S.firm.phone + "." : "",
      firm: S.firm.sender, first: c ? c.first : "", preparer: prep, year: e ? e.year : S.firm.taxYear || 2026, n: p.total, k: e ? openItems(e.id).length : 0,
      plain_name: F ? (it.custom ? ((x) => (/^[A-ZÁÉÍÓÚ][a-záéíóúñ]/.test(x) ? x[0].toLowerCase() + x.slice(1) : x))(lang === "es" && it.customEs ? it.customEs : it.custom) : lang === "es" ? F.es : F.plain) : "", from_payer: it && it.payer ? (lang === "es" ? " de " : " from ") + it.payer : "",
      where_hint: F ? (lang === "es" ? F.hintEs : F.hint) : "", issuer: F ? (lang === "es" ? F.issuerEs : F.issuer) : "",
      link: linkFor(c, code.startsWith("M1") ? "c" : "u"), firm_phone: S.firm.phone, firm_email: S.firm.email,
      how_send: LONGHOW[lang][it && LONGDOC.includes(it.form) ? 1 : 0],
      // The firm's sign-off (up to 30 characters). With none set, Warm signs with the preparer's first name and Professional does not sign.
      sign_off: S.firm.signOff || (voice === "warm" && prep && prep !== S.firm.sender ? prep : "")
    }, extra || {});
    let tt = t; if (it && LONGDOC.includes(it.form)) tt = tt.replace(LONGHOW[lang][0], LONGHOW[lang][1]);
    if (!String(S.firm.phone || "").trim()) tt = tt.replace(" or call us on {firm_phone}", "").replace("Call {firm_phone} or email {firm_email}", "Email {firm_email}").replace("Please call {firm_phone}.", "Please contact your preparer directly.").replace(" o llámenos al {firm_phone}", "").replace("Llame al {firm_phone} o escriba a {firm_email}", "Escriba a {firm_email}").replace("Por favor llame al {firm_phone}.", "Por favor contacte a su preparador directamente.").replace(/\{firm_phone\}/g, S.firm.email || "");
    return tt.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined && v[k] !== null ? v[k] : m)).replace(/\s+/g, " ")
      .replace(/\b(need|missing) 1 documents\b/g, "$1 1 document").replace(/\ball 1 documents\b/g, "your document").replace(/\b(Necesitamos|faltan) 1 documentos\b/g, (m, w) => (w === "faltan" ? "falta 1 documento" : "Necesitamos 1 documento")).replace(/\blos 1 documentos\b/g, "su documento").replace(/([A-Za-z])\.\.(?=\s|$)/g, "$1.").trim();   // a firm name ending in a full stop does not double it
  }
  function outputCheck(body, channel, vars) {
    const errs = [];
    if (/\{\w+\}/.test(body)) errs.push("unfilled variable");
    if (channel === "text" && body.length > 320) errs.push("over 320 characters");
    const allowedNums = [String((vars && vars.year) || 2026), String((vars && vars.doc_year) || ""), S.firm.phone.replace(/\D/g, ""), "1040", "1095", "1098", "1099", "1065", "1120", "2441", "5498", "8879"];
    (body.replace(/[().\-\s]/g, (m) => (m === " " ? " " : "")).match(/\d{4,}/g) || []).forEach((n) => { if (!allowedNums.some((a) => a && a.includes(n) || n.includes(a) && a)) errs.push("digit run " + n); });
    const low = body.toLowerCase(); BLOCK.forEach((w) => { if (new RegExp("\\b" + w + "\\b").test(low)) errs.push('blocked word "' + w + '"'); });
    if (channel === "text" && !body.includes(S.firm.sender) && vars && vars.needFirm) errs.push("firm name missing");
    return errs;
  }
  function channelFor(c, e) {
    if (c.textConsent === "given" && c.mobile && S.firm.senderStatus === "approved") return "text";
    if (c.email && c.emailOk) return "email";
    return null;
  }
  /* A message a staff action triggers. Outside sending hours it waits for the next allowed time instead of texting a client at night. */
  function sendSoon(e, code, extra) {
    const c = client(e.clientId);
    if (allowedC(S.now, c)) return send(e, code, extra);
    if (e.status === "stuck") unstick(e);
    const it = extra && extra.item;
    e.queue = (e.queue || []).concat([{ code, itemId: it && it.id ? it.id : null, item: it ? { form: it.form, payer: it.payer || null } : null, doc_year: extra && extra.doc_year }]);
    e.next = nextAllowedC(S.now, c); timeline(e, "Held until sending hours: " + (TPL_USE[code] || code).toLowerCase()); return null;
  }
  const PROACTIVE = ["M3", "M5", "M6", "M10", "M22R"];
  /* ---------- billing: a short trial, then a paid plan; an off-season pause that only stores data ---------- */
  // Plans go by client count only. Prices are working figures. See docs/PRICING.md for the cost model behind them.
  const PLANS = [["Solo", 99, 150, 1], ["Practice", 249, 500, 5], ["Firm", 599, 1000, 15], ["Large", 999, 2500, 99]];
  /* T-97: the price test. Firms that sign themselves up after the pilot may be put on the second price list. A firm's list never
     changes by itself: pilot firms stay on the first. T-98: above the largest plan the price goes up by one block per 1,000 clients. */
  const PRICE_B = { Solo: 149, Practice: 349, Firm: 799, Large: 1299 }, QUOTE_BLOCK = 1000, QUOTE_BLOCK_PRICE = 350;
  const plans = () => PLANS.map((p) => (S.firm.priceBook === "B" ? [p[0], PRICE_B[p[0]], p[2], p[3]] : p.slice()));
  function quoteFor(n) {
    n = Math.floor(+n); if (!(n >= 1) || n > 100000) return null; const L = plans(), fit = L.find((p) => n <= p[2]);
    if (fit) return { plan: fit[0], monthly: fit[1], clients: fit[2], blocks: 0 };
    const top = L[L.length - 1], blocks = Math.ceil((n - top[2]) / QUOTE_BLOCK); return { plan: top[0], monthly: top[1] + blocks * QUOTE_BLOCK_PRICE, clients: top[2] + blocks * QUOTE_BLOCK, blocks };
  }
  const TRIAL_DAYS = 14, TRIAL_CLIENTS = 10, TRIAL_DOCS = 100, PAUSE_MAX_DAYS = 90;
  // Fair use: a yearly allowance per plan, sized at more than twice normal use. Going over never cuts a firm off.
  const FAIR = { segs: 60, docs: 25 };   // text segments and document reads per client on the plan, per 12 months
  // What each unit costs us, in dollars. Checked against published prices in November 2026; see docs/PRICING.md.
  const RATES = { segOut: 0.0128, segIn: 0.0108, mmsIn: 0.026, email: 0.0001, docRead: 0.0164, textRead: 0.0003, write: 0.0003, storeGbMonth: 0.023, lookup: 0.008, voice: 0.03 };   // lookup: one landline check (T-119). voice: one reminder call of under a minute, with answering-machine detection (T-50)
  const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-.\/:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\\[~\]|€]*$/;
  // How many billable segments a text is. One accented letter outside the basic set (á, í, ó, ú) makes the whole text cost more.
  function segs(body) { const t = String(body || ""), n = [...t].length; if (!n) return 0; return GSM.test(t) ? (n <= 160 ? 1 : Math.ceil(n / 153)) : (n <= 70 ? 1 : Math.ceil(n / 67)); }
  function meter(kind, n) { const u = S.usage = S.usage || {}, k = S.now.getFullYear() + "-" + String(S.now.getMonth() + 1).padStart(2, "0"); const m = u[k] = u[k] || {}; m[kind] = (m[kind] || 0) + (n == null ? 1 : n); }
  function usage() {
    const b = billing(), tot = { segOut: 0, segIn: 0, mmsIn: 0, email: 0, docRead: 0, textRead: 0, write: 0, lookup: 0, voice: 0 }, from = new Date(S.now.getTime() - 365 * DAY), fk = from.getFullYear() + "-" + String(from.getMonth() + 1).padStart(2, "0");
    Object.keys(S.usage || {}).forEach((k) => { if (k >= fk) Object.keys(tot).forEach((x) => { tot[x] += S.usage[k][x] || 0; }); });
    const p = PLANS.find((x) => x[0] === b.plan), trial = b.state === "trial" || b.state === "expired", cap = p ? p[2] : TRIAL_CLIENTS;
    const allow = { segs: trial ? 0 : cap * FAIR.segs, docs: trial ? TRIAL_DOCS : cap * FAIR.docs }, used = { segs: tot.segOut + tot.segIn + tot.mmsIn, docs: tot.docRead };
    const cost = Object.keys(tot).reduce((a, k) => a + tot[k] * (RATES[k] || 0), 0);
    return { totals: tot, used, allow, pct: { segs: allow.segs ? used.segs / allow.segs : 0, docs: allow.docs ? used.docs / allow.docs : 0 }, cost: Math.round(cost * 100) / 100, perClient: S.clients.length ? Math.round((cost / S.clients.length) * 100) / 100 : 0 };
  }
  // Over the text allowance, reminders go by email where the client has one. Replies and legal messages still go by text.
  const overTexts = () => { const u = usage(); return u.allow.segs > 0 && u.used.segs >= u.allow.segs; };
  // False when a document should be stored and held instead of read: a trial that has used its reads, or no access.
  function canRead() { if (!access().ok) return false; const b = billing(); return !(b.state === "trial" && usage().used.docs >= TRIAL_DOCS); }
  function fairCheck() { const u = usage(), b = billing(); if (b.state !== "active") return; [["segs", "text messages"], ["docs", "document checks"]].forEach(([k, what]) => { const lvl = u.pct[k] >= 1 ? 100 : u.pct[k] >= 0.8 ? 80 : 0; if (lvl && (b.warned || {})[k] !== lvl) { b.warned = Object.assign({}, b.warned, { [k]: lvl }); alertx(null, lvl === 100 ? "medium" : "low", "fair_use", lvl === 100 ? "You have used this year's allowance of " + what + " for the " + b.plan + " plan. Nothing stops." + (k === "segs" ? " Reminders now go by email where a client has one." : "") + " The next plan up has more room." : "You have used 80% of this year's allowance of " + what + " for the " + b.plan + " plan.", "fair" + k + lvl + S.now.getFullYear()); } }); }
  function billing() { const f = S.firm; if (!f.billing) f.billing = { state: "active", plan: PLANS.some((p) => p[0] === f.plan) ? f.plan : "Practice" }; return f.billing; }
  function access() {
    const b = billing();
    if (b.state === "trial" && b.trialEnds && S.now > b.trialEnds) { b.state = "expired"; audit("billing.trial_ended", "No plan chosen", "Tallyhound"); }
    if (b.state === "paused" && b.pausedUntil && S.now >= b.pausedUntil) { b.state = "active"; b.pausedUntil = null; audit("billing.resumed", "The pause ended. Billing and full access are back on", "Tallyhound"); wake(); }
    // A firm that has not passed the firm check, or has been suspended, sends nothing and reads nothing. Deleting on schedule carries on.
    if (S.firm.verified === false) return { ok: false, state: "checking", until: null, reason: FIRMCHECK };
    if (b.state === "trial") return { ok: true, state: "trial", daysLeft: Math.max(0, Math.ceil((b.trialEnds - S.now) / DAY)), clientsLeft: trialRoom() };
    if (b.state === "active") return { ok: true, state: "active", plan: b.plan };
    return { ok: false, state: b.state, until: b.pausedUntil || null, reason: b.state === "paused" ? "Paused. Your data is stored and nothing runs." : b.lapsed ? "Your plan has ended. Choose a plan to keep collecting." : "The free trial has ended. Choose a plan to keep collecting." };
  }
  const halted = () => !!S.firm.stopped || !access().ok;
  // A trial collects from a small number of clients. A client counts once anything has been sent to them.
  const reached = (e) => !!e.startedAt || !!(e.checkin && e.checkin.sentAt);
  const trialRoom = () => Math.max(0, TRIAL_CLIENTS - S.engs.filter(reached).length);
  const trialFull = (e) => billing().state === "trial" && !reached(e) && trialRoom() <= 0 ? "The free trial collects from " + TRIAL_CLIENTS + " clients. Choose a plan to start the rest" : null;
  function wake() { S.engs.forEach((e) => { if (["in_progress", "awaiting_consent"].includes(e.status) && (!e.next || e.next < S.now)) e.next = nextAllowed(new Date(S.now.getTime() + HOUR)); }); }
  const planFor = (n) => (PLANS.find((p) => n <= p[2]) || PLANS[PLANS.length - 1])[0];
  /* T-81: a paid plan that ended, because it was cancelled or the card kept failing. The same lock as an ended trial: data is kept,
     nothing is sent or read, deletion on schedule carries on. Choosing a plan again lifts it. */
  function planEnded(why) { const b = billing(); if (b.state !== "active" && b.state !== "paused") return false; b.state = "expired"; b.lapsed = true; b.pausedUntil = null; audit("billing.plan_ended", String(why || "The plan ended"), "Tallyhound"); return true; }
  function choosePlan(name) { const p = PLANS.find((x) => x[0] === name); if (!p) return "Unknown plan"; const b = billing(); b.lapsed = false; if (S.clients.length > p[2]) return name + " covers up to " + p[2] + " clients. You have " + S.clients.length + (name === "Large" ? ". Contact us for a price for your client count" : ""); b.plan = name; b.state = "active"; b.pausedUntil = null; if (S.firm.senderStatus === "none") { S.firm.senderStatus = "submitted"; S.firm.senderSubmittedAt = new Date(S.now); audit("sender.status", "Text number registration sent to the carriers", "Tallyhound"); } b.since = b.since || new Date(S.now); b.warned = {}; S.firm.plan = name; S.firm.included = p[2]; audit("billing.plan", name + " at $" + p[1] + " a month"); wake(); return null; }
  // A pause is always the firm's choice, never automatic. At most 90 days in any 12 months, in one stretch or several.
  function pauseUsed() { const b = billing(), from = S.now.getTime() - 365 * DAY; return Math.round((b.pauses || []).reduce((a, p) => a + Math.max(0, Math.min(+new Date(p.to), S.now.getTime()) - Math.max(+new Date(p.from), from)), 0) / DAY); }
  const pauseLeft = () => Math.max(0, PAUSE_MAX_DAYS - pauseUsed());
  function pauseSeason(until) {
    const b = billing(), d = new Date(until); if (b.state !== "active") return "Only a firm on a paid plan can pause"; if (!(d > S.now)) return "Pick a date in the future";
    const want = Math.ceil((d - S.now) / DAY), left = pauseLeft(); if (want > left) return left <= 0 ? "You have used your 3 months of pause for this year" : "A pause can last up to 3 months in any 12 months. You have " + left + " days left";
    b.state = "paused"; b.pausedUntil = d; b.pausedAt = new Date(S.now); b.pauses = (b.pauses || []).concat([{ from: new Date(S.now), to: d }]); audit("billing.paused", "Until " + d.toDateString() + ". Data is stored, nothing runs, nothing is billed"); return null;
  }
  function resumeNow() { const b = billing(); if (b.state !== "paused") return "Not paused"; const p = (b.pauses || [])[(b.pauses || []).length - 1]; if (p) p.to = new Date(S.now); b.state = "active"; b.pausedUntil = null; audit("billing.resumed", "Resumed early"); wake(); return null; }
  // While the firm is paused or its trial has ended, a client who writes in is told to contact the firm directly. Once a week at most.
  function awayReply(e, c) { if (access().ok || !e) return false; if (!e.awayAt || S.now - new Date(e.awayAt) > 7 * DAY) { const m = send(e, "M31", {}); if (m) e.awayAt = new Date(S.now); } return true; }
  function send(e, code, extra, forceChannel) {
    const c = client(e.clientId); let ch = forceChannel || channelFor(c, e);
    if (ch === "text" && !forceChannel && ["M5", "M6", "M22R", "M28R", "M1R"].includes(code) && c.email && c.emailOk && overTexts()) ch = "email";
    if (!ch) { if (code === "M31") return null; setStuck(e, c.textConsent === "withdrawn" ? "opted_out" : "not_delivering"); return null; }
    if (halted() && !["M16", "M16H"].includes(code) && !(code === "M31" && !S.firm.stopped)) return null;
    if (e.status === "closed" && !COMPLIANCE.includes(code) && !["M12", "M14", "M24", "M11"].includes(code)) return null;
    if (e.status === "not_started" && ["M3", "M4", "M5", "M6", "M10", "M22R"].includes(code)) return null;
    if (S.hold && code !== "M23") { S.hold.push({ code, extra }); return null; }
    if (e.takeover && !COMPLIANCE.includes(code)) { hlog(e, "held", "Held " + (TPL_USE[code] || code).toLowerCase() + ": " + e.takeover.by + " has this conversation", "The Hound listens but does not reply while staff are in control", "Rules"); return null; }
    linkFresh(c);
    const body = fill(code, c, e, extra), errs = outputCheck(body, ch, { year: e.year, doc_year: extra && extra.doc_year }).filter((x) => !(code === "M23" && x.startsWith("digit run")));
    if (errs.length) { addTask({ kind: "output_check", reason: "Message blocked: " + errs.join(", "), engId: e.id }); audit("message.blocked", code + " for " + c.last + ": " + errs.join(", "), "Tallyhound"); return null; }
    const H = S.firm.hound, comp = COMPLIANCE.includes(code) || code === "M31", it0 = extra && extra.item;
    let status = "delivered", after = "delivered";
    if (!comp && H.mode === "copilot") { after = "approval"; status = H.aiLive ? "writing" : "approval"; if (PROACTIVE.includes(code)) S.msgs.forEach((x) => { if (x.engId === e.id && x.status === "approval" && PROACTIVE.includes(x.tpl)) { x.status = "discarded"; x.note = "Replaced by a newer draft"; } }); } else if (!comp && H.aiLive) status = "writing";
    const m = { id: id("m"), engId: e.id, dir: "out", kind: "auto", tpl: code, voice: voiceFor(c), body, base: body, channel: ch, at: new Date(S.now), status, after, itemId: it0 ? it0.id : null, why: (extra && extra.why) || "", ctx: { use: TPL_USE[code] || code, item: it0 ? (it0.custom || FORMS[it0.form].plain) + (it0.payer ? " from " + it0.payer : "") : "", missing: extra && extra.missing, fix: extra && extra.fix, doc_year: extra && extra.doc_year } };
    S.msgs.push(m); e.lastOut = new Date(S.now);
    if (status === "delivered") { meter(ch === "text" ? "segOut" : "email", ch === "text" ? segs(body) : 1); fairCheck(); } if (status === "writing") meter("write");
    hlog(e, "message", (status === "approval" ? "Drafted for approval: " : status === "writing" ? "Writing: " : "Sent: ") + (TPL_USE[code] || code).toLowerCase() + " by " + ch, m.why, status === "writing" ? "Claude" : "Rules");
    if (!["M2", "M16", "M16H", "M1", "M1R"].includes(code)) e.lastAutoDay = dayKey(S.now);
    audit("message.sent", code + " to " + c.first + " " + c.last[0] + ". by " + ch, "Tallyhound");
    return m;
  }

  /* ---------- status ---------- */
  /* Fetch until verified (TH-CMP, docs/REBRAND.md section 5). A file that stops moving never just sits: it always has an item in
     the review queue. Where the reason already put one there (a question, a document to look at, an "I don't have it"), that is
     the item. Otherwise a "gone quiet" item is opened, saying what is still missing and how many times each was asked. */
  const BACKED = { question_waiting: "question", review_waiting: "document", client_says_none: "says_none" };
  const askedCount = (e, i) => S.msgs.filter((m) => m.engId === e.id && m.dir === "out" && m.itemId === i.id && !["discarded", "approval", "writing"].includes(m.status)).length;
  function callScript(e, c) { const open = openItems(e.id); return "Hi " + c.first + ", it's " + ((S.users.find((u) => u.id === c.preparer) || {}).first || "your preparer") + " at " + S.firm.name + ". We're still missing " + open.length + " document" + (open.length === 1 ? "" : "s") + " for your return: " + open.map((i) => (i.custom || FORMS[i.form].plain) + (i.payer ? " from " + i.payer : "")).join(", ") + ". Is there anything making these hard to get? You can text photos to the same number we've been using."; }
  function quietTask(e, reason) {
    const mine = S.tasks.filter((t) => t.status === "open" && t.engId === e.id);
    if (mine.some((t) => t.kind === "gone_quiet") || (BACKED[reason] && mine.some((t) => t.kind === BACKED[reason]))) return null;
    const c = client(e.clientId);
    return addTask({ kind: "gone_quiet", reason: STUCK[reason][0], why: reason, engId: e.id, script: c ? callScript(e, c) : "",
      context: { missing: openItems(e.id).map((i) => ({ itemId: i.id, asked: askedCount(e, i) })), lastAsked: e.lastOut || null } });
  }
  // A gone-quiet item is only open while the file is not moving. Whatever got it moving again settles the item.
  function settleQuiet(e) { S.tasks.forEach((t) => { if (t.status === "open" && t.kind === "gone_quiet" && t.engId === e.id) { t.status = "decided"; t.decision = "moving_again"; t.by = "Tallyhound"; t.decidedAt = new Date(S.now); } }); }
  function setStuck(e, reason) { if (["complete", "closed", "paused"].includes(e.status)) return; e.status = "stuck"; e.stuck = reason; e.next = null; timeline(e, "Gone quiet: " + STUCK[reason][0]); quietTask(e, reason); }
  function unstick(e) { if (e.status === "stuck") { e.status = "in_progress"; e.stuck = null; e.step = 0; settleQuiet(e); } }
  /** TH-CMP-2: how much of the checklist is in and verified. Received or confirmed as not needed counts; "the client says they
      don't have it" does not, until a person confirms. */
  function verified(eid) { const L = itemsOf(eid).filter((i) => ["expected", "requested", "partial", "in_review", "says_none", "received", "waived"].includes(i.state)); return { n: L.filter((i) => i.state === "received" || i.state === "waived").length, m: L.length }; }
  /* T-120: the closing question. When a checklist is finished and the firm has switched this on, the client is asked once whether
     anything changed this year that nobody asked about. NO, or three days of silence, gets "that's everything". YES goes to a
     person. A client who already answered the check-in has been asked, so is not asked again. */
  const CLOSING_WAIT_DAYS = 3;
  function finished(e) {
    if (S.firm.hound.closingQ !== true || e.closing || (e.checkin && e.checkin.doneAt)) { send(e, "M13", {}); return; }
    e.closing = { askedAt: new Date(S.now) }; send(e, "M32", {}); timeline(e, "Asked whether anything else changed this year");
  }
  function closingReply(e, c, yes) {
    e.closing.answeredAt = new Date(S.now); e.closing.answer = yes ? "yes" : "no";
    if (!yes) { timeline(e, "Nothing else changed this year", c.first); send(e, "M13", {}); return; }
    addTask({ kind: "question", category: "other", reason: "Question", engId: e.id, text: "Says something changed this year that was not asked about" }); timeline(e, "Says something else changed this year: passed to a person", c.first); send(e, "M12", {});
  }
  function closingSweep() { S.engs.forEach((e) => { if (e.closing && !e.closing.answeredAt && e.status === "complete" && S.now - new Date(e.closing.askedAt) > CLOSING_WAIT_DAYS * DAY) { e.closing.answeredAt = new Date(S.now); e.closing.answer = "none"; send(e, "M13", {}); } }); }
  function checkComplete(e) {
    if (S.tasks.some((t) => t.status === "open" && t.engId === e.id && ["document", "says_none", "change_noted"].includes(t.kind))) return false;   // TH-CMP-6
    if (openItems(e.id).length === 0 && itemsOf(e.id).length && !["complete", "closed"].includes(e.status)) {
      e.status = "complete"; e.stuck = null; e.next = null; e.completedAt = new Date(S.now); settleQuiet(e); memoryWrite(e); timeline(e, "All fetched: every document in and verified"); return true;
    }
    return false;
  }
  function nextItem(e) {
    const ok = (i) => !(i.laterUntil && i.laterUntil > S.now) && !(releaseOf(i, e) && releaseOf(i, e) > S.now);
    // TH-MEM-5: something already asked for stays first; otherwise what was slow last year is asked for before the rest.
    const L = itemsOf(e.id), open = (i) => (i.state === "requested" || i.state === "expected") && ok(i);
    return L.find((i) => i.state === "partial" && ok(i)) || L.find((i) => i.state === "requested" && ok(i)) || L.find((i) => open(i) && i.carryNote === "Slow last year") || L.find(open);
  }
  // Until when an item is held back: its form is not issued yet, or the client said when they will send it. null when it is not held.
  function heldUntil(i, e) { const a = [releaseOf(i, e), i.laterUntil].filter((x) => x && x > S.now).map((x) => +new Date(x)); return a.length ? new Date(Math.max.apply(null, a)) : null; }
  function waitingRelease(e) { const w = itemsOf(e.id).filter((i) => ["expected", "requested"].includes(i.state)).map((i) => heldUntil(i, e)).filter(Boolean); return w.length ? new Date(Math.min.apply(null, w)) : null; }

  /* ---------- outreach ---------- */
  function start(eid) {
    const e = eng(eid), c = client(e.clientId);
    if (!e.confirmed) return "Checklist not confirmed";
    if (!access().ok) return access().reason;
    if (S.firm.verified === false) return FIRMCHECK;
    if (e.status !== "not_started") return "Already started";
    if (trialFull(e)) return trialFull(e);
    if (!c.email && !c.mobile) return "No contact";
    e.startedAt = new Date(S.now); timeline(e, "Go fetch: requests started", S.user.name); audit("engagement.go_fetch", c.first + " " + c.last);
    if (channelFor(c, e) === "text") { e.status = "in_progress"; e.next = nextAllowed(S.now); }
    else if (c.mobile && c.email && S.firm.senderStatus === "approved" && c.textConsent !== "withdrawn") {
      e.status = "awaiting_consent"; c.textConsent = "invited"; e.invitedAt = new Date(S.now); send(e, "M1", {}, "email"); e.next = new Date(S.now.getTime() + 3 * DAY);
    } else if (c.email) { e.status = "in_progress"; e.emailOnly = true; e.next = nextAllowed(S.now); }
    else { e.status = "awaiting_consent"; setStuck(e, "no_consent"); }
    return null;
  }
  /* T-123: starting many clients at once. The first 50 go at the next allowed moment; each further 50 go half an hour after the
     ones before, so a firm that starts 500 is not answering 500 replies in the same ten minutes and the carriers are not asked to
     carry them all at once. Invitations to text (which go by email) are not held back. */
  const PACE_BATCH = 50, PACE_GAP_MIN = 30;
  function startMany(eids) {
    const out = { started: 0, capped: 0, refused: [], paced: 0, lastAt: null }; let slot = 0;
    for (const eid of Array.isArray(eids) ? eids : []) {
      const e = eng(eid); if (!e) continue; const r = start(eid); if (r) { if (/free trial/.test(r)) out.capped++; else if (!out.refused.includes(r)) out.refused.push(r); continue; }
      out.started++; if (e.status !== "in_progress" || !e.next) continue;
      const wave = Math.floor(slot++ / PACE_BATCH); if (wave > 0) { e.next = nextAllowedC(new Date(S.now.getTime() + wave * PACE_GAP_MIN * 60000), client(e.clientId)); out.paced++; out.lastAt = e.next; }
    }
    if (out.paced) audit("outreach.paced", out.started + " started. The first " + PACE_BATCH + " go now, the rest in groups of " + PACE_BATCH + " every " + PACE_GAP_MIN + " minutes");
    return out;
  }
  /* Fetch intensity (TH-PAC, docs/REBRAND.md section 5). How hard the hound follows up: for the firm, or for one client.
     days are the days after the first request on which a reminder goes; final is the day of the last note, after which the client
     has gone quiet. Steady is what the engine always did. No preset changes sending hours, Sundays, holidays, the one-a-day
     limit, stopping when a document arrives, or STOP. COUNSEL: confirm Persistent (up to seven automatic texts in 12 days). */
  const CADENCE_PRESETS = {
    gentle: { label: "Gentle", days: [3, 7, 12], final: 18, suits: "Clients who always come through" },
    steady: { label: "Steady", days: [2, 5, 9], final: 14, suits: "Most clients" },
    persistent: { label: "Persistent", days: [1, 3, 5, 7, 10], final: 12, suits: "Clients who leave it to April" }
  };
  const gapsOf = (k) => { const p = CADENCE_PRESETS[k] || CADENCE_PRESETS.steady, d = p.days.concat(p.final); return d.map((x, i) => x - (i ? d[i - 1] : 0)); };
  // The one lookup the scheduler uses: the client's own preset, else the firm's, else Steady.
  function cadenceFor(e) { const c = e && client(e.clientId), k = (c && c.intensity) || (S.firm.hound && S.firm.hound.intensity) || "steady", key = CADENCE_PRESETS[k] ? k : "steady"; return { key, label: CADENCE_PRESETS[key].label, gaps: gapsOf(key), own: !!(c && c.intensity) }; }
  // After a preset changes, the reminder already planned is moved to where the new preset puts it. Never sent at once because a
  // setting changed, and never earlier than one day after the last message.
  function recadence(e) {
    if (e.status !== "in_progress" || !e.next || !(e.step >= 1) || !e.lastOut || e.takeover || (e.quietUntil && e.quietUntil > S.now)) return false;
    const G = cadenceFor(e).gaps, gap = G[Math.min(e.step - 1, G.length - 1)], hour = S.firm.newDayHour;
    let t = new Date(e.lastOut.getTime() + gap * DAY); t.setHours(hour, 0, 0, 0);
    const floor = new Date(e.lastOut.getTime() + DAY), tomorrow = new Date(S.now.getTime() + DAY); tomorrow.setHours(hour, 0, 0, 0);
    if (t <= S.now) t = tomorrow; if (t < floor) t = floor;
    e.next = nextAllowedC(t, client(e.clientId)); return true;
  }
  function setIntensity(k) {
    if (!may("owner")) return "Only an owner can change this"; if (!CADENCE_PRESETS[k]) return "Choose Gentle, Steady or Persistent";
    const H = S.firm.hound; if ((H.intensity || "steady") === k) return null; H.intensity = k;
    let n = 0; S.engs.forEach((e) => { const c = client(e.clientId); if (c && !c.intensity && recadence(e)) n++; });
    audit("firm.cadence_changed", "Fetch intensity is now " + CADENCE_PRESETS[k].label + ". " + n + " planned reminder" + (n === 1 ? "" : "s") + " moved; none sent early"); return null;
  }
  function setClientIntensity(cid, k) {
    const c = client(cid); if (!c) return "Unknown client"; if (!may()) return "Not allowed"; if (k && !CADENCE_PRESETS[k]) return "Choose Gentle, Steady or Persistent";
    if ((c.intensity || null) === (k || null)) return null; if (k) c.intensity = k; else delete c.intensity;
    const e = engOf(cid); if (e) { recadence(e); timeline(e, "Fetch intensity: " + (k ? CADENCE_PRESETS[k].label : "the firm's (" + cadenceFor(e).label + ")"), S.user.name); }
    audit("client.cadence_changed", c.first + " " + c.last + ": " + (k ? CADENCE_PRESETS[k].label : "firm default")); return null;
  }
  function step(e) {
    const c = client(e.clientId);
    const GAPS = cadenceFor(e).gaps;
    if (halted() || !["in_progress", "awaiting_consent"].includes(e.status)) return;
    if (e.takeover) return;
    if (e.quietUntil && e.quietUntil > S.now) { e.next = nextAllowed(e.quietUntil); return; }
    if (!allowedC(S.now, c)) { e.next = nextAllowedC(S.now, c); return; }
    if (e.queue && e.queue.length && e.status === "in_progress") { const q = e.queue; e.queue = []; q.forEach((x) => send(e, x.code, { item: (x.itemId && S.items.find((i) => i.id === x.itemId)) || x.item, doc_year: x.doc_year })); e.step = Math.max(e.step || 0, 1); e.next = nextAllowed(new Date(S.now.getTime() + 2 * DAY)); return; }
    if (e.status === "awaiting_consent") {
      const d = (S.now - e.invitedAt) / DAY;
      if (d >= 7) { setStuck(e, "no_consent"); return; }
      if (d >= 3 && !e.reminded) { send(e, "M1R", {}, "email"); e.reminded = true; }
      e.next = new Date(e.invitedAt.getTime() + 7 * DAY); return;
    }
    if (e.lastAutoDay === dayKey(S.now) && !live(e)) { const t = new Date(S.now.getTime() + DAY); t.setHours(S.firm.newDayHour, 0, 0, 0); e.next = nextAllowed(t); return; }
    if (S.firm.askQuestions && e.qIdx < QUESTIONS.length) {
      if (e.qAsked && S.now - e.qAsked >= 2 * DAY) { e.qIdx = QUESTIONS.length; e.qAsked = null; timeline(e, "Life-change questions skipped: no answer"); }
      else if (!e.qAsked) { const q = QUESTIONS[e.qIdx]; send(e, "M10", { question: (c.lang === "es" ? q.es : q.en).replace("{year}", e.year) }); e.qAsked = new Date(S.now); e.next = new Date(S.now.getTime() + 2 * DAY); return; }
      else { e.next = new Date(e.qAsked.getTime() + 2 * DAY); return; }
    }
    const it = nextItem(e);
    if (!it) { const wr = waitingRelease(e); if (wr && !itemsOf(e.id).some((i) => ["requested", "expected", "partial"].includes(i.state) && !heldUntil(i, e))) { e.next = nextAllowed(wr); return; } e.next = null; if (!checkComplete(e)) { const sn = openItems(e.id).find((i) => i.state === "says_none"); if (sn) setStuck(e, "client_says_none"); } return; }
    let code;
    if (it.state === "partial") { if (e.step >= GAPS.length) { finalNote(e, c); return; } const x = Object.assign({ item: it, why: "Part of the " + FORMS[it.form].plain + " is still missing; reminder " + (e.step + 1) + " of " + GAPS.length }, missText(it.missing || [], c.lang, it.form)); send(e, "M22R", x); escalate(e, c, "M22R", x); schedule(e, GAPS[Math.min(e.step, GAPS.length - 1)], ""); e.step++; return; }
    if (it.state === "expected" || e.step === 0) { code = S.msgs.some((m) => m.engId === e.id && ["M3", "M4", "M19"].includes(m.tpl)) ? "M4" : "M3"; it.state = "requested"; e.step = 0; }
    else if (e.step >= GAPS.length) { finalNote(e, c); return; }
    else code = "M5";
    const x = { item: it, why: code === "M3" ? "Checklist confirmed; first request" : code === "M4" ? "Next open item on the checklist" : "No reply since " + dlabel(e.lastOut || S.now) + "; reminder " + e.step + " of " + GAPS.length };
    send(e, code, x); if (code === "M5") escalate(e, c, code, x);
    schedule(e, GAPS[Math.min(e.step, GAPS.length - 1)], ""); e.step++;
  }
  function escalate(e, c, code, x) {
    const H = S.firm.hound;
    if (e.step >= H.emailAfter && channelFor(c, e) === "text" && c.email && c.emailOk) { send(e, code, Object.assign({}, x, { why: e.step + " text reminders unanswered, so adding email" }), "email"); hlog(e, "escalate", "Also sent by email, because texts went unanswered", e.step + " text reminders without a reply", "Rules"); }
  }
  /* T-50: one recorded reminder by phone, after the final written reminder has gone unanswered. Three things must all be true:
     the firm's owner has switched it on, the firm is on Autopilot, and this client has said calls are fine (setCallOk). The words
     are fixed wording, never written by the model, and pass the same check as every message. At most one per client per season.
     A STOP by text ends calls too. COUNSEL: a recorded call to a mobile needs the client's agreement; confirm how the firm records it. */
  function setCallOk(cid, on, how) {
    const c = client(cid); if (!c) return "Unknown client"; if (!may()) return "Not allowed"; if (on && !c.mobile) return "No phone number on file";
    if (on && c.textConsent === "withdrawn") return c.first + " has asked us to stop. Only " + c.first + " can change that";
    c.callOk = !!on; c.consentLog = c.consentLog || []; c.consentLog.push({ at: new Date(S.now), what: (on ? "Agreed to reminder calls" : "Reminder calls turned off") + ", recorded by " + S.user.name + (how ? ": " + String(how).slice(0, 120) : ""), channel: "call" }); audit("consent.calls", c.first + " " + c.last + (on ? " agreed" : " off")); return null;
  }
  function voicemail(e, c) {
    const H = S.firm.hound; if (H.voicemail !== true || H.mode !== "autopilot" || !c.callOk || !c.mobile || c.mobileBad || c.textConsent === "withdrawn" || e.voicemailAt || e.takeover || halted()) return null;
    const body = fill("M33", c, e, {}), errs = outputCheck(body, "email", { year: e.year }).filter((x) => !x.startsWith("digit run")); if (errs.length) { audit("message.blocked", "M33 for " + c.last + ": " + errs.join(", "), "Tallyhound"); return null; }
    const m = { id: id("m"), engId: e.id, dir: "out", kind: "auto", tpl: "M33", body, base: body, channel: "voice", at: new Date(nextAllowedC(S.now, c)), status: "delivered", after: "delivered", itemId: null, why: "The final reminder went unanswered", ctx: { use: TPL_USE.M33 } };
    S.msgs.push(m); e.voicemailAt = new Date(S.now); meter("voice"); hlog(e, "message", "Reminder call with a recorded message", m.why, "Rules"); audit("message.sent", "M33 to " + c.first + " " + c.last[0] + ". by phone", "Tallyhound"); return m;
  }
  function finalNote(e, c) {
    const GAPS = cadenceFor(e).gaps; send(e, "M6", { why: (GAPS.length - 1) + " reminders unanswered (" + cadenceFor(e).label + ")" }); setStuck(e, "no_reply"); voicemail(e, c);
    alertx(e, "medium", "call", c.first + " " + c.last + " has not replied to " + (GAPS.length - 1) + " reminders. It is in the review queue with what is still missing" + (S.firm.hound.callTask ? " and a call script." : "."), "call" + e.id);
  }
  function tick() {
    // Deleting on schedule is a promise to the firm's clients. It runs whether or not the firm is paying, paused or stopped.
    if (!access().ok && !S.firm.stopped) { S.engs.forEach((e) => { if (e.status === "closed" && e.purgeAfter && e.purgeAfter <= S.now && !e.purged) purge(e.id, "Tallyhound"); }); retentionSweep(); return; }
    closingSweep();
    S.engs.forEach((e) => { if (e.status !== "stuck") settleQuiet(e); });
    S.engs.forEach((e) => { if (e.next && e.next <= S.now) step(e); });
    S.msgs.forEach((m) => { if (m.status === "approved" && m.sendAt && m.sendAt <= S.now) { const e = eng(m.engId), c = e && client(e.clientId); if (!e || e.takeover || ["closed", "opted_out", "paused"].includes(e.status) || (m.channel === "text" && c.textConsent !== "given")) { m.status = "discarded"; m.note = "No longer needed when sending hours began"; } else if (!allowedC(S.now, c)) m.sendAt = nextAllowedC(S.now, c); else { m.status = "delivered"; m.at = new Date(S.now); e.lastOut = new Date(S.now); } }
      if (m.status === "approval" && S.now - m.at > S.firm.hound.slaHours * HOUR) { const e = eng(m.engId); if (e) alertx(e, "medium", "approval_wait", "A message to " + client(e.clientId).first + " " + client(e.clientId).last + " has waited over " + S.firm.hound.slaHours + " hours for approval. Nothing is sent until someone approves it.", "apw" + m.id); } });
    S.engs.forEach((e) => { const k = e.checkin; if (!k || k.doneAt || !k.afterOptIn || !k.pending || e.status !== "in_progress") return; const c = client(e.clientId); if (allowedC(S.now, c) && !e.takeover) { k.pending = null; k.sentAt = new Date(S.now); if (c.textConsent === "given") send(e, "M28", {}, "text"); } });
    S.engs.forEach((e) => { const k = e.checkin; if (!k || k.doneAt || e.status !== "not_started") return; const c = client(e.clientId);
      if (k.pending) { if (allowedC(S.now, c)) { const ch = k.pending; k.pending = null; k.sentAt = new Date(S.now); const use = ch === "text" && c.textConsent !== "given" ? (c.email && c.emailOk ? "email" : null) : ch; if (use) send(e, "M28", {}, use); } return; }
      if (!k.reminded && S.now - k.sentAt > 3 * DAY && allowedC(S.now, c)) { k.reminded = true; send(e, "M28R", {}, c.textConsent === "given" && c.mobile ? "text" : "email"); }
      if (S.now - k.sentAt > 7 * DAY && !k.fallbackAt) {
        if (S.firm.checkinFallback !== false && itemsOf(e.id).some(liveItem) && allowedC(S.now, c)) { k.fallbackAt = new Date(S.now); e.confirmed = true; const why = start(e.id); hlog(e, "decide", "No answer to the check-in after a week: started with the checklist on file", why ? "Could not start: " + why : "The client can still say what they do not have, and anything new is suggested to a person", "Rules"); alertx(e, "low", "checkin_quiet", c.first + " " + c.last + " did not answer the check-in in a week, so collecting started with the checklist on file.", "cq" + e.id); }
        else if (S.firm.checkinFallback === false || !itemsOf(e.id).some(liveItem)) alertx(e, "low", "checkin_quiet", c.first + " " + c.last + " has not answered the check-in after a week. Choose a checklist for them and start collecting.", "cq" + e.id); } });
    S.engs.forEach((e) => { if (e.status === "closed" && e.purgeAfter && e.purgeAfter <= S.now && !e.purged) purge(e.id, "Tallyhound"); });
    retentionSweep();
    const H = S.firm.hound;
    S.tasks.forEach((t) => { if (t.status === "open" && t.kind === "question" && S.now - t.at > H.slaHours * HOUR) { const e = eng(t.engId), c = client(e.clientId); alertx(e, "high", "sla", c.first + " " + c.last + "'s " + (SCOPE[t.category] || "question").toLowerCase() + " has waited over " + H.slaHours + " hours for a person.", "sla" + t.id); } });
    S.engs.forEach((e) => { if (e.target && e.target > S.now && e.target - S.now < 3 * DAY && openItems(e.id).length && !["complete", "closed"].includes(e.status)) { const c = client(e.clientId); alertx(e, "medium", "target", c.first + " " + c.last + " is " + openItems(e.id).length + " document" + (openItems(e.id).length > 1 ? "s" : "") + " short with the target date " + (e.target.getMonth() + 1) + "/" + e.target.getDate() + " in under 3 days.", "tgt" + e.id + dayKey(S.now)); }
      if (e.takeover && S.now - e.takeover.at > DAY && !S.msgs.some((m) => m.engId === e.id && m.kind === "manual" && m.at > e.takeover.at)) { const c = client(e.clientId); alertx(e, "low", "takeover", e.takeover.by + " took over " + c.first + " " + c.last + "'s conversation a day ago and has not replied. Hand it back to the Hound?", "to" + e.id + e.takeover.at.getTime()); } });
    S.tasks.forEach((t) => { if (t.status === "open" && t.kind === "document" && S.now - t.at > DAY) { const e = eng(t.engId); if (e && e.status === "in_progress") setStuck(e, "review_waiting"); } });
  }
  function advance(ms) {
    const end = S.now.getTime() + ms;
    while (S.now.getTime() < end) { S.now = new Date(Math.min(end, S.now.getTime() + 15 * MIN)); tick(); }
  }
  function jumpToNext() {
    const ts = S.engs.filter((e) => e.next).map((e) => e.next.getTime()).filter((t) => t > S.now.getTime());
    if (!ts.length) return false; advance(Math.min.apply(null, ts) - S.now.getTime() + MIN); return true;
  }

  /* ---------- inbound ---------- */
  /* Barks (TH-BRK, docs/REBRAND.md section 5). When something needs a person, Tallyhound barks: one alert to one member of staff
     saying how many things in the review queue need them, by kind. The engine decides who hears about an item and when a bark is
     due; the server only sends the email. Barks are for staff. The word never reaches a client.
       - who: the client's preparer; owners for kinds that are about the system; all owners when a client has no preparer;
         plus whoever the firm's rules add. Each person chooses the kinds they hear about and whether they get the email.
       - when: an item joins that person's open bark the moment it opens (so the app shows it at once). The email goes once the
         bark has stood for BARK_SETTLE_MIN, and never more than one per person per BARK_BATCH_MIN: ten items in five minutes
         are one bark. Outside staff hours a bark is held and counted in the morning note instead.
       - again: an item nobody has dealt with after one working day barks once more, to the owners. */
  const BARK_BATCH_MIN = 30, BARK_SETTLE_MIN = 5, REVIEW_OVERDUE_HOURS = 24, STAFF_HOURS = { start: 8, end: 18 };
  const BARK_KINDS = { document: "to check", question: "question", says_none: "says they don't have it", gone_quiet: "gone quiet", change_noted: "change noted", call: "call to make", output_check: "blocked message" }, BARK_SYSTEM = ["output_check"];
  const staffHours = () => { const h = S.firm.staffHours || {}, a = +h.start, b = +h.end; return a >= 0 && b <= 24 && a < b ? { start: a, end: b } : STAFF_HOURS; };
  const inStaffHours = (d) => { const h = staffHours(), day = d.getDay(); return day >= 1 && day <= 5 && d.getHours() >= h.start && d.getHours() < h.end && allowed(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)); };
  const barkPrefs = (u) => Object.assign({ app: true, email: true, text: false, kinds: null }, (u && u.bark) || {});
  /** Who hears about an item in the review queue. User ids. */
  function barkRoute(t) {
    const e = t.engId ? eng(t.engId) : null, c = e ? client(e.clientId) : null, live = S.users.filter((u) => u.role !== "read_only" && !u.support), owners = live.filter((u) => u.role === "owner");
    const rule = (S.firm.barkRules || {})[t.kind] || {}, out = new Set();
    const prep = c && live.find((u) => u.id === c.preparer);
    if (BARK_SYSTEM.includes(t.kind) || !prep) owners.forEach((u) => out.add(u.id)); else out.add(prep.id);
    if (rule.owners) owners.forEach((u) => out.add(u.id));
    (rule.users || []).forEach((id) => { if (live.some((u) => u.id === id)) out.add(id); });
    return [...out].filter((id) => { const k = barkPrefs(S.users.find((u) => u.id === id)).kinds; return !k || k.includes(t.kind); });
  }
  function barkQueue(t, escalation) {
    if (!BARK_KINDS[t.kind]) return; S.barks = S.barks || [];
    const to = escalation ? S.users.filter((u) => u.role === "owner" && !u.support).map((u) => u.id) : barkRoute(t);
    for (const uid of to) {
      let b = escalation ? null : S.barks.find((x) => x.userId === uid && x.status === "queued" && !x.escalation);
      if (!b) { b = { id: id("b"), userId: uid, taskIds: [], counts: {}, escalation: !!escalation, status: "queued", at: new Date(S.now), sentAt: null, readAt: null }; S.barks.unshift(b); }
      if (b.taskIds.includes(t.id)) continue; b.taskIds.push(t.id); b.counts[t.kind] = (b.counts[t.kind] || 0) + 1;
    }
    if (S.barks.length > 400) S.barks.length = 400;
  }
  /** "3 things need your team." The same words in the app, in the email subject and in the morning note. */
  function barkWords(counts) { const n = Object.keys(counts || {}).reduce((a, k) => a + counts[k], 0); return { n, line: n + (n === 1 ? " thing needs" : " things need") + " your team.", parts: Object.keys(counts || {}).map((k) => counts[k] + " " + BARK_KINDS[k]) }; }
  /** The timer's part. Marks and returns the barks whose email is due now. Call with the firm locked. */
  function barkDue() {
    S.barks = S.barks || []; const out = [], open = (b) => b.taskIds.filter((tid) => S.tasks.some((t) => t.id === tid && t.status === "open"));
    // One more bark, to the owners, for anything that has waited a working day.
    S.tasks.forEach((t) => { if (t.status !== "open" || t.escalatedAt || !BARK_KINDS[t.kind]) return; let h = 0; for (let x = +new Date(t.at); x < +S.now; x += HOUR) { const d = new Date(x); if (d.getDay() >= 1 && d.getDay() <= 5) h++; } if (h >= REVIEW_OVERDUE_HOURS) { t.escalatedAt = new Date(S.now); barkQueue(t, true); } });
    for (const b of S.barks) {
      if (b.status !== "queued") continue;
      if (!open(b).length) { b.status = "settled"; b.readAt = b.readAt || new Date(S.now); continue; }   // everything in it was dealt with before it went
      if (!inStaffHours(S.now)) { b.status = "held"; continue; }   // TH-BRK-6: nobody is barked at in the night; the morning note counts it
      const last = S.barks.filter((x) => x.userId === b.userId && x.sentAt && !x.escalation).map((x) => +new Date(x.sentAt)).sort((x, y) => y - x)[0] || 0;
      if (!b.escalation && (S.now - new Date(b.at) < BARK_SETTLE_MIN * MIN || S.now - last < BARK_BATCH_MIN * MIN)) continue;
      b.status = "sent"; b.sentAt = new Date(S.now);
      const u = S.users.find((x) => x.id === b.userId), t0 = b.escalation ? S.tasks.find((t) => t.id === b.taskIds[0]) : null, e0 = t0 && t0.engId ? eng(t0.engId) : null, c0 = e0 ? client(e0.clientId) : null;
      if (u && (barkPrefs(u).email || barkPrefs(u).text)) out.push({ id: b.id, userId: b.userId, byEmail: !!barkPrefs(u).email, byText: !!barkPrefs(u).text, email: u.email, first: u.first, escalation: b.escalation, counts: b.counts, words: barkWords(b.counts), who: c0 ? c0.first + " " + String(c0.last || "")[0] + "." : null });
    }
    return out;
  }
  /** For the morning note: what was held overnight for this person, as counts by kind. Marks it as counted. */
  function barkHeld(uid) { const counts = {}; (S.barks || []).forEach((b) => { if (b.userId === uid && b.status === "held") { b.status = "digest"; b.sentAt = new Date(S.now); b.taskIds.forEach((tid) => { const t = S.tasks.find((x) => x.id === tid && x.status === "open"); if (t) counts[t.kind] = (counts[t.kind] || 0) + 1; }); } }); return counts; }
  function barkRead(bid) { const me = S.user && S.user.id; let n = 0; (S.barks || []).forEach((b) => { if (b.userId === me && !b.readAt && (bid === "all" || b.id === bid)) { b.readAt = new Date(S.now); n++; } }); return n; }
  function setMyBarks(p) { const u = S.users.find((x) => x.id === (S.user && S.user.id)); if (!u) return "Unknown user"; const kinds = Array.isArray(p && p.kinds) ? p.kinds.filter((k) => BARK_KINDS[k]) : null; u.bark = { app: true, email: !(p && p.email === false), text: !!(p && p.text === true), kinds: kinds && kinds.length < Object.keys(BARK_KINDS).length ? kinds : null }; return null; }
  function setBarkRules(rules) {
    if (!may("owner")) return "Only an owner can change this"; const out = {};
    Object.keys(BARK_KINDS).forEach((k) => { const r = (rules || {})[k]; if (!r) return; const users = (Array.isArray(r.users) ? r.users : []).filter((id) => S.users.some((u) => u.id === id && u.role !== "read_only")); if (r.owners || users.length) out[k] = { owners: !!r.owners, users }; });
    S.firm.barkRules = out; audit("firm.bark_rules", "Who hears about each kind of item was changed"); return null;
  }
  function setStaffHours(start, end) { if (!may("owner")) return "Only an owner can change this"; start = Math.round(+start); end = Math.round(+end); if (!(start >= 0 && end <= 24 && start < end)) return "Choose a start before the end"; S.firm.staffHours = { start, end }; audit("firm.staff_hours", start + ":00 to " + end + ":00"); return null; }
  function addTask(t) { const x = Object.assign({ id: id("t"), at: new Date(S.now), status: "open" }, t); S.tasks.push(x); barkQueue(x, false); return x; }
  function afterAccept(e, c) {
    e.step = 0; e.illeg = 0;
    if (checkComplete(e)) { finished(e); return; }
    if (e.status === "not_started") { send(e, "M27", {}); return; }
    const it = nextItem(e);
    if (it) { if (it.state === "partial") send(e, "M22R", Object.assign({ item: it }, missText(it.missing || [], c.lang, it.form))); else { it.state = "requested"; send(e, "M4", { item: it }); } e.step = 1; e.next = nextAllowed(new Date(S.now.getTime() + cadenceFor(e).gaps[0] * DAY)); }
    else { const wr = waitingRelease(e); e.next = wr ? nextAllowed(wr) : null; }
  }
  /* A document staff add themselves: scanned paper, something emailed to them directly. Checked the same way, but the client is not messaged about it. */
  function staffDoc(cid, spec) { const held = S.hold; S.hold = []; let d; try { d = inboundDoc(cid, spec, "staff", { silent: true }); } finally { S.hold = held; } const e = engOf(cid); if (e && d) { timeline(e, "Document added by " + S.user.name + ": " + (FORMS[d.form] || FORMS.OTHER).plain, S.user.name); audit("document.staff_upload", client(cid).last); } return d; }
  function inboundDoc(cid, spec, channel, opt) {
    const c = cid ? client(cid) : null, e = c ? engOf(c.id) : null;
    const d = { id: id("d"), engId: e ? e.id : null, clientId: cid, form: spec.form, year: spec.year, payer: spec.payer || "", recipient: spec.recipient || "self", qualityKind: spec.quality || "clear", corrected: !!spec.corrected, channel: channel || "text", at: new Date(S.now), state: "stored", findings: [], reasons: [], versions: [], image: spec.image || null, pages: spec.pages || null, read: spec.read || null, recipientName: spec.recipientName || "", missingSpec: spec.missing || [], part: spec.part || null, pageOf: spec.pageOf || null };
    S.docs.push(d); if (e) e.unusable = 0;
    if (e && masterFirst()) d.master = { at: new Date(S.now), place: "incoming" };   // the original goes to the firm's own storage first; checking happens on Tallyhound's working copy
    if (e && !access().ok && channel !== "staff") { d.reasons = ["Arrived while the firm was not collecting. Stored, not checked."]; if (opt && opt.parent) opt.parent.attachments.push(d.id); else S.msgs.push({ id: id("m"), engId: e.id, dir: "in", kind: "client", body: "[a file, while the firm was not collecting]", channel: channel || "text", at: new Date(S.now), docId: d.id }); awayReply(e, c); return d; }
    if (channel !== "staff" || spec.read) meter("docRead"); if ((channel || "text") === "text") meter("mmsIn"); fairCheck();
    if (opt && opt.parent) { opt.parent.attachments.push(d.id); } else S.msgs.push({ id: id("m"), engId: e ? e.id : null, dir: "in", kind: "client", body: "[" + (channel === "email" ? "attachment" : channel === "portal" ? "upload" : channel === "staff" ? "added by staff" : "photo") + "]", channel: channel || "text", at: new Date(S.now), docId: d.id, clientId: cid });
    if (!e) { d.state = "tray"; S.tray.push({ id: id("y"), docId: d.id, from: spec.from || "(615) 555-0199", at: new Date(S.now), channel: channel || "text" }); audit("inbound.unmatched", "Document from an unknown sender", "Tallyhound"); return d; }
    if (e.status === "closed") { check(d); d.state = "in_review"; d.reasons.push("Arrived after this file was closed."); addTask({ kind: "document", reason: "Arrived after close", engId: e.id, docId: d.id }); if (!(opt && opt.parent)) send(e, "M12", {}); timeline(e, "Document arrived after the file was closed"); return d; }
    e.lastIn = new Date(S.now); unstickOnInbound(e);
    check(d); decide(d, e, c);
    if (d.master && d.state === "accepted" && !d.deliveredAt) d.deliveredAt = new Date(S.now);   // accepted: the original is already with the firm and only needs its final name
    const mm = S.msgs.find((m) => m.docId === d.id); if (mm) mm.actions = [d.form + "|" + d.state];
    e.hours = (e.hours || []).concat([S.now.getHours()]).slice(-12);
    hlog(e, "read", c.first + " sent a " + (FORMS[d.form] || FORMS.OTHER).plain + " by " + d.channel, (d.reasons || []).join(" "), d.read ? "Claude" : "Rules");
    return d;
  }
  function unstickOnInbound(e) { if (e.status === "stuck" && ["no_reply", "no_consent"].includes(e.stuck)) unstick(e); }
  function check(d) {
    d.quality = d.read ? +d.read.legible || 0 : d.qualityKind === "clear" ? 0.92 : d.qualityKind === "cropped" ? 0.5 : 0.34;
    d.modelConf = d.read ? (d.read.conf >= 0.9 ? "high" : d.read.conf >= 0.7 ? "medium" : "low") : d.qualityKind === "clear" ? (d.form === "OTHER" ? "medium" : "high") : "low";
    let c = d.read ? Math.round(Math.min(0.99, +d.read.conf || 0) * 100) / 100 : { high: 0.97, medium: 0.75, low: 0.4 }[d.modelConf], cap = null;
    if (d.read && !d.year) { c = Math.min(c, 0.6); cap = "tax year not found"; }
    if (d.form === "OTHER") { c = Math.min(c, 0.5); cap = "not a form we recognise"; }
    if (d.quality < S.firm.qualityMin) { c = Math.min(c, 0.6); cap = "image quality too low"; }
    d.conf = c; d.capReason = cap; d.state = "classified";
    const miss = d.read && Array.isArray(d.read.missing) ? d.read.missing : d.missingSpec || [];
    d.elements = (ELEMENTS[d.form] || []).map((x) => ({ key: x[0], label: x[1], required: !(S.firm.elemOff || {})[d.form + "." + x[0]], status: d.part === "rest" ? "present" : miss.includes(x[0]) ? "missing" : "present" }));
    d.versions.push({ v: 1, by: "system", form: d.form, year: d.year, payer: d.payer });
  }
  /* Which open custom request a non-standard document most likely answers, from what the model says the page is. */
  function bestCustom(d, cu) {
    if (!cu.length) return null;
    const words = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9áéíóúñ ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !["statement", "from", "with", "your", "form", "document", "copy", "this", "that", "para", "the"].includes(w)).map((w) => w.replace(/(ing|s)$/, ""));
    const have = new Set(words((d.read && d.read.note) + " " + d.payer + " " + (d.title || "") + " " + (d.describe || ""))); let best = null, top = 0;
    cu.forEach((i) => { const w = words(i.custom + " " + (i.customEs || "")), sc = w.filter((x) => have.has(x)).length / Math.max(1, w.length); if (sc > top) { top = sc; best = i; } });
    return top > 0 ? best : cu.length === 1 ? cu[0] : null;
  }
  function payerMatch(a, b) {
    const n = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\b(INC|LLC|CORP|CO|NA|FSB|BANK)\b/g, "").replace(/\s+/g, " ").trim();
    const x = n(a), y = n(b); if (!x || !y) return false; if (x === y) return true;
    const A = new Set(x.split(" ")), B = new Set(y.split(" ")); let inter = 0; A.forEach((t) => { if (B.has(t)) inter++; });
    return inter / Math.max(A.size, B.size) >= 0.6;
  }
  function decide(d, e, c) {
    const F = FORMS[d.form] || FORMS.OTHER, items = itemsOf(e.id);
    const review = (reason, why) => { d.state = "in_review"; d.reasons.push(why); addTask({ kind: "document", reason, engId: e.id, docId: d.id }); send(e, "M12", {}); timeline(e, "Document sent to review: " + reason); };
    const dup = S.docs.find((x) => x !== d && x.engId === e.id && x.state === "accepted" && x.form === d.form && x.year === d.year && payerMatch(x.payer, d.payer));
    // A corrected form replaces the copy received earlier. The preparer is told, because the figures may have changed.
    if (dup && d.corrected && !dup.corrected && d.form !== "OTHER" && d.quality >= S.firm.qualityMin) {
      dup.state = "duplicate"; dup.supersededBy = d.id; dup.reasons.push("Replaced by a corrected copy."); d.reasons.push("A corrected copy. It replaces the one received " + dlabel(dup.at) + ".");
      d.state = "accepted"; d.itemId = dup.itemId; const it0 = S.items.find((i) => i.id === dup.itemId); if (it0) it0.docId = d.id;
      alertx(e, "medium", "corrected", c.first + " " + c.last + " sent a corrected " + F.plain + (d.payer ? " from " + d.payer : "") + ". It replaces the earlier copy. If the return is under way, check the figures.", "cf" + d.id);
      timeline(e, "Corrected " + d.form + " received. It replaces the earlier copy"); send(e, "M27", {}); return;
    }
    if (dup && d.form !== "OTHER") { d.state = "duplicate"; d.reasons.push("Same form, year and payer as a document already accepted."); send(e, "M11", {}); timeline(e, "Duplicate " + d.form + " ignored"); return; }
    if (d.quality < S.firm.qualityMin) {
      e.illeg = (e.illeg || 0) + 1; d.findings.push("illegible");
      if (e.illeg <= 2) { d.state = "rejected"; d.reasons.push("Key boxes could not be read (quality " + d.quality.toFixed(2) + ")."); send(e, e.illeg === 1 ? "M8" : "M8L", {}); timeline(e, "Unreadable photo: client re-asked"); return; }
      return review("Low confidence", "Three unreadable attempts.");
    }
    if (d.recipient === "other") { d.findings.push("wrong_person"); return review("Wrong person", "The name on the document matches nobody on this return."); }
    if (d.form === "OTHER") {
      d.findings.push("other_document"); const cu = items.filter((i) => i.custom && OPEN.includes(i.state)), best = bestCustom(d, cu);
      if (best) { d.matchItem = best.id; return review("Custom request", (cu.length === 1 ? "The only custom request open is" : "Closest custom request:") + " " + best.custom + ". Confirm the match."); }
      return review("Other document", cu.length ? "Not a standard form, and it does not clearly match any of the " + cu.length + " custom requests." : "Not one of the forms we check automatically.");
    }
    if (d.conf < S.firm.acceptAt) return review("Low confidence", "Confidence " + d.conf.toFixed(2) + " is under the bar of " + S.firm.acceptAt + ".");
    if (d.year !== expectYear(d.form, e)) {
      d.state = "rejected"; d.findings.push("wrong_year"); d.reasons.push("The form is for " + d.year + ". This return is for " + e.year + ".");
      const it = items.find((i) => i.form === d.form && OPEN.includes(i.state)) || { form: d.form, payer: d.payer };
      send(e, "M7", { item: it, doc_year: d.year }); timeline(e, "Wrong year (" + d.year + "): client re-asked"); return;
    }
    let it = items.find((i) => i.form === d.form && OPEN.includes(i.state) && payerMatch(i.payer, d.payer)) || items.find((i) => i.form === d.form && OPEN.includes(i.state) && !i.payer);
    const gaps = S.firm.docCheck === false ? [] : (d.elements || []).filter((x) => x.status !== "present" && x.required);
    if (gaps.length) {
      if (!it) { it = { id: id("i"), engId: e.id, form: d.form, payer: d.payer, state: "expected", source: "arrived", isNew: true }; S.items.push(it); }
      if (!it.payer) it.payer = d.payer;
      const t = missText(gaps.map((x) => x.key), c.lang, d.form);
      it.state = "partial"; it.partialDoc = d.id; it.missing = gaps.map((x) => x.key); d.itemId = it.id; d.state = "incomplete"; d.findings.push("incomplete");
      d.reasons.push("Form, year and name check out, but required parts are missing: " + gaps.map((x) => x.label.charAt(0).toLowerCase() + x.label.slice(1)).join("; ") + ".");
      send(e, "M22", Object.assign({ item: it }, t)); timeline(e, "Incomplete " + d.form + ": asked for " + t.fix); audit("document.incomplete", d.form + " for " + c.first + " " + c.last[0] + ".", "Tallyhound");
      e.step = 1; e.next = nextAllowed(new Date(S.now.getTime() + 2 * DAY)); return;
    }
    if (it && it.state === "partial") { const prior = S.docs.find((x) => x.id === it.partialDoc); if (prior) { prior.state = "accepted"; (prior.elements || []).forEach((x) => { if (x.status !== "present") x.status = "supplied"; }); prior.reasons.push("Completed by the rest of the document, received " + S.now.toDateString() + "."); } d.parts = prior ? [prior.id] : []; d.reasons.push("Supplies the parts that were missing from the earlier copy."); it.missing = null; }
    d.reasons.push("Form name and year found on the page." + (d.elements && d.elements.length ? " Every required part is present." : ""));
    if (it) { if (!it.payer) it.payer = d.payer; d.reasons.push("Matches the checklist item for " + (it.payer || F.plain) + "."); }
    else { it = { id: id("i"), engId: e.id, form: d.form, payer: d.payer, state: "expected", source: "arrived", isNew: true }; S.items.push(it); d.reasons.push("Not on the checklist: added as a new item."); }
    it.state = "received"; it.docId = d.id; d.itemId = it.id; d.state = "accepted";
    timeline(e, "Accepted " + d.form + (d.payer ? " from " + d.payer : "") + " with no staff touch"); audit("document.accepted", d.form + " for " + c.first + " " + c.last[0] + ".", "Tallyhound");
    afterAccept(e, c);
  }
  const OPTOUT = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|revoke|alto|parar|cancelar)\s*[.!]*\s*$|\b(stop|quit) (texting|messaging|sending|bugging|bothering|contacting)\b|\bopt[ -]?out\b|\bunsubscribe\b|\brevoke\b|don'?t (text|message) me/i;
  function intent(text) {
    const t = text.trim().toLowerCase();
    if (OPTOUT.test(t)) return "stop";
    if (/^(start|unstop)\b/.test(t)) return "start";
    if (/^(help|ayuda|info)\b/.test(t)) return "help";
    if (/^(yes|y|si|sí)\b/.test(t)) return "yes";
    if (/^(no|n)\b[.! ]*$/.test(t)) return "no";
    if (/\bwhat('?s| is| do you| else| other)?\b.{0,24}\b(need|left|missing|outstanding|remaining)\b|\b(anything|what) else\b|\bam i (done|all set)\b|\bis that (all|everything)\b|qu[eé] (m[aá]s )?(falta|necesita)/.test(t)) return "status";
    if (/\bwhere (do|can|is|would|should)\b|how do i (get|find)|where.*find|dónde|donde/.test(t)) return "where_to_find";
    if (/don'?t have|do not have|didn'?t get|never got|no tengo|none this year/.test(t)) return "says_none";
    if (/later|next week|this week|weekend|tomorrow|when i get|soon|in a few days|i'?ll (send|dig|get|find)|después|luego/.test(t)) return "will_send_later";
    if (/^(thanks|thank you|ok|okay|gracias|great)\b/.test(t)) return "thanks";
    return "question";
  }
  const KLABEL = { stop: "Opt out", start: "Opt back in", help: "Asked for help", yes: "Answered yes", no: "Answered no", where_to_find: "Asked where to find a form", status: "Asked what is still needed", says_none: "Says they don't have it", will_send_later: "Will send it later", thanks: "Thanks, no action", question: "Asked a question", other_update: "Update, no action needed", frustrated: "Frustrated: reminders paused", someone_else_has_it: "Says someone else has it", already_sent: "Says it was already sent", life_change: "Mentioned a change", send_after_date: "Will send after a date", not_mine: "Says this is not theirs" };
  // Nothing goes to a client until the firm itself has been checked: a tool that asks people for W-2s is exactly what a fraudster wants.
  const FIRMCHECK = "Your firm is still being checked. This usually takes one business day. You can finish setting up in the meantime.";
  // The firm's legal details for the carriers. Filed as soon as the firm check has passed, plan or no plan, because approval takes weeks.
  function registerSender(d) {
    if (!may("owner")) return "Only an owner can do this"; if (S.firm.verified === false) return FIRMCHECK; d = d || {};
    const t = (k) => String(d[k] || "").trim(), ein = t("ein").replace(/\D/g, "");
    if (t("legalName").length < 2) return "Enter the firm's legal name, exactly as it appears on your IRS letter";
    if (!d.soleProp && ein.length !== 9) return "Enter the firm's 9-digit EIN, or tick that you have none";
    if (t("street").length < 3 || t("city").length < 2 || !/^[A-Za-z]{2}$/.test(t("state")) || !/^\d{5}$/.test(t("zip"))) return "Enter the firm's full address";
    if (t("contact").length < 3) return "Enter the name of someone at the firm the carriers can reach";
    if (d.soleProp && t("ownerMobile").replace(/\D/g, "").length !== 10) return "Carriers send a code to the owner's own mobile. Enter it";
    S.firm.reg = { legalName: t("legalName"), ein: d.soleProp ? "" : ein, soleProp: !!d.soleProp, street: t("street"), city: t("city"), state: t("state").toUpperCase(), zip: t("zip"), contact: t("contact"), ownerMobile: t("ownerMobile").replace(/\D/g, ""), website: t("website"), at: new Date(S.now) };
    if (!["submitted", "approved"].includes(S.firm.senderStatus)) { S.firm.senderStatus = "submitted"; S.firm.senderSubmittedAt = new Date(S.now); }
    audit("sender.register", "Text number registration filed for " + S.firm.reg.legalName); return null;
  }
  function markHeadsUp(on) { S.firm.headsUpAt = on === false ? null : new Date(S.now); audit("firm.headsup", on === false ? "Heads-up to clients not sent yet" : "Heads-up to clients marked as sent"); }
  function setVerified(v) { S.firm.verified = !!v; audit("firm.check", v ? "Firm check passed" : "Firm check pending", "Tallyhound"); }
  const WRONGNO = /\bwrong (number|person|#)\b|\bwho(?:'s| is) this\b|\bn[uú]mero equivocado\b|\bqui[eé]n es\b/i;
  const LINKRE = /https?:\/\/\S+|\b(?:icloud\.com|drive\.google\.com|photos\.app\.goo\.gl|dropbox\.com|1drv\.ms)\//i;
  // The firm already holds the client's agreement (engagement letter, intake form, said so on a call). A named staff member records it.
  function recordConsent(cid, how) {
    const c = client(cid); if (!may()) return "Not allowed"; if (!c || !c.mobile) return "No mobile number on file";
    if (c.mobileBad) return "Check " + c.first + "'s mobile number first. Someone replied that it is the wrong number.";
    if (isLandline(c)) return "The number on file for " + c.first + " is a landline, which cannot get texts. Ask for a mobile number.";
    if (c.textConsent === "withdrawn") return c.first + " opted out. Only " + c.first + " can turn texts back on, by texting START.";
    if (c.textConsent === "given") return null;
    giveConsent(cid, "recorded by " + S.user.name + ": " + (String(how || "").trim() || "agreed with the firm directly")); return null;
  }
  /* ---------- the client's own pages (round 16): consent, email only, stop emails ---------- */
  const CONSENT_WORDING = { v: "v1", text: "By entering your mobile number and tapping Agree, you agree to receive text messages from {firm}, sent using Tallyhound, about the documents needed for your tax return. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Agreeing is not a condition of any service. See the privacy notice and terms." };
  // The client agrees on their own page. They may enter or correct the mobile number there; a changed number is a new number.
  // The record keeps which wording they saw and where the agreement came from, as proof (never the wording of anything else).
  function consentFromPage(cid, o) {
    const c = client(cid); o = o || {}; if (!c) return { ok: false, why: "Unknown client" };
    const mob = String(o.mobile || "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1"); if (mob.length !== 10 || /^[01]/.test(mob)) return { ok: false, why: "Enter a 10-digit mobile number" };
    if (c.textConsent === "given" && c.mobile === mob) return { ok: true, already: true };
    if (c.mobile !== mob) { c.mobile = mob; c.mobileBad = false; if (c.textConsent === "given" || c.textConsent === "withdrawn") c.consentLog.push({ at: new Date(S.now), what: "Reset: the client gave a new mobile number on their page", channel: "text" }); c.textConsent = "none"; }
    if (isLandline(c)) return { ok: false, why: "That number is a landline, which cannot get texts. Enter a mobile number" };
    giveConsent(cid, "page"); if (c.textConsent !== "given") return { ok: false, why: "Texts could not be turned on" };
    Object.assign(c.consentLog[c.consentLog.length - 1], { wording: CONSENT_WORDING.v, shown: CONSENT_WORDING.text.replace("{firm}", S.firm.name), mobile: mob, ip: String(o.ip || "").slice(0, 60), agent: String(o.agent || "").slice(0, 200) });
    return { ok: true };
  }
  // "No thanks, I'll use email." Nothing is texted; collecting carries on by email if there is an address.
  function declineTexts(cid) {
    const c = client(cid), e = c && engOf(cid); if (!c) return { ok: false, why: "Unknown client" }; if (c.textConsent === "given") return { ok: true, already: true };
    c.textConsent = "none"; c.consentLog.push({ at: new Date(S.now), what: "Declined texts on their page: email only", channel: "text" }); audit("consent.declined", c.first + " " + c.last, c.first);
    if (e && e.status === "awaiting_consent") { if (c.email && c.emailOk) { e.status = "in_progress"; e.emailOnly = true; e.stuck = null; e.next = nextAllowed(S.now); timeline(e, "Chose email instead of texts", c.first); } else setStuck(e, "no_consent"); }
    return { ok: true };
  }
  // The unsubscribe link in every email, and the one-click header. No further automated email goes to that address.
  // If that leaves no way to reach the client, the file comes to a person, exactly as a STOP with no email on file does.
  function stopEmail(cid, how) {
    const c = client(cid), e = c && engOf(cid); if (!c) return { ok: false, why: "Unknown client" }; if (c.emailOff) return { ok: true, already: true };
    c.emailOff = true; c.emailOk = false; c.consentLog.push({ at: new Date(S.now), what: "Withdrawn: unsubscribed from email (" + (how || "link") + ")", channel: "email" }); audit("email.unsubscribed", c.first + " " + c.last, c.first);
    if (e) { timeline(e, "Unsubscribed from email", c.first); if (!channelFor(c, e) && !["complete", "closed", "not_started", "paused"].includes(e.status)) { setStuck(e, "opted_out"); alertx(e, "high", "opted_out", c.first + " " + c.last + " unsubscribed from email and cannot be texted. Call them to collect the rest.", "eo" + c.id); } }
    return { ok: true };
  }
  // A key for the unsubscribe link. It never changes, so a link in an old email keeps working.
  function emailKey(c) { if (!c.ekey) c.ekey = linkKey(); return c.ekey; }
  function unsubscribeLink(c) { return S.firm.linkBase && c ? S.firm.linkBase + "/e/" + (S.firm.slug ? S.firm.slug + "-" : "") + emailKey(c) : ""; }
  /* Reply understanding, second version (TH-RPL, docs/REBRAND.md section 5). Five more things a reply can mean. The model (or, with
     no model, a few plain patterns) says which; code checks every field against what it was given and then acts only through
     templates and state changes. Anything it is not sure of goes to a person. A reply never changes a checklist: a life change
     opens an item in the review queue with a suggested edit that a person accepts or dismisses.
     firm.hound.replyV2: "on" acts; "shadow" (a new firm's default) records what it would have understood and acts the old way. */
  const V2 = ["someone_else_has_it", "already_sent", "life_change", "send_after_date", "not_mine"], PERSONS = ["spouse", "employer", "accountant", "other"];
  const LATER_MAX_DAYS = 30, ALREADY_SENT_LOOKBACK_DAYS = 21;
  const WAIVE_REASONS = { sold_home: "Sold the home", account_closed: "Account closed", no_longer_employed: "No longer employed there", not_this_year: "Not this year", combined_elsewhere: "Combined on another document", other: "Other" }, LASTING = ["sold_home", "account_closed", "no_longer_employed"];
  const CHANGE_WORDS = { sold_home: "sold the house", account_closed: "closed the account", no_longer_employed: "no longer works there", not_this_year: "does not have it this year", combined_elsewhere: "it is on another document", other: "something changed" };
  const NOT_MINE = /\b(this|that|it) (is not|isn'?t|ain'?t) (me|mine|my account|my (tax|accountant))\b|\bnot my (account|accountant|taxes)\b|\bwrong person\b|\bi(?:'m| am) not (a |your )?(client|customer)\b|\bno soy (yo|su cliente|cliente)\b|\bpersona equivocada\b|\bno es mi cuenta\b/i;
  const SOMEONE = /\bmy (husband|wife|spouse|partner|employer|boss|company|accountant|bookkeeper)\b.{0,40}\b(has|have|had|keeps|holds|handles|got|sends)\b|\b(mi esposo|mi esposa|mi pareja|mi marido|mi mujer|mi jefe|mi contador)\b.{0,30}\b(tiene|lo tiene|la tiene|los tiene)\b/i;
  const ALREADY = /\balready (sent|emailed|texted|uploaded|mailed|gave)\b|\b(i|we) (sent|emailed|texted|uploaded|mailed) (it|that|this|them)\b.{0,40}\b(last week|yesterday|earlier|before|already|on (mon|tues|wednes|thurs|fri|satur|sun)day)\b|\bya (lo|la|los|las|se lo) (envi[eé]|mand[eé])(?![a-zñ])/i;
  const AFTERDAY = /\b(?:after|on|by|until) (?:the )?(\d{1,2})(?:st|nd|rd|th)?\b(?! ?(?:am|pm|:|\/))|\bdespu[eé]s del? (\d{1,2})\b|\b(?:el|hasta el) (\d{1,2})\b/i, NEXTDOW = /\bnext (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\bel pr[oó]ximo (domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/i;
  const DOWS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"], DOWS_ES = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  // The patterns used when there is no model. Deliberately narrow: they fire on plain statements and leave the rest to the old rules.
  function ruleV2(text, e) {
    const t = String(text || "");
    if (NOT_MINE.test(t)) return { intent: "not_mine", by: "Rules" };
    let m = SOMEONE.exec(t);
    if (m) { const w = (m[1] || m[3] || "").toLowerCase(); return { intent: "someone_else_has_it", by: "Rules", person: /employer|boss|company|jefe/.test(w) ? "employer" : /accountant|bookkeeper|contador/.test(w) ? "accountant" : "spouse", item: formsIn(t, e)[0] || null }; }
    if (ALREADY.test(t)) return { intent: "already_sent", by: "Rules", item: formsIn(t, e)[0] || null };
    if (/\b(we|i|we've|i've) (just |have )?sold (the|our|my) (house|home|condo)\b|\bvend(imos|[ií]) (la|mi|nuestra) casa\b/i.test(t)) return { intent: "life_change", by: "Rules", change: { kind: "remove", form: "1098", reason: "sold_home" } };
    if (/\b(closed|cerr[eé]|cerramos) (the|that|my|our|la|mi|esa) (account|cuenta)\b/i.test(t)) { const it = formsIn(t, e)[0]; if (it) return { intent: "life_change", by: "Rules", change: { kind: "remove", form: it.form, reason: "account_closed" }, item: it }; }
    if (/\b(no longer|don'?t) work (there|for them)\b|\b(left|quit) (that|my) job\b|\bya no trabajo (ah[ií]|all[ií]|con ellos)\b/i.test(t) && itemsOf(e.id).filter((i) => i.form === "W2" && OPEN.includes(i.state)).length === 1) return { intent: "life_change", by: "Rules", change: { kind: "remove", form: "W2", reason: "no_longer_employed" } };
    m = NEXTDOW.exec(t);
    if (m) { const w = (m[1] || m[2] || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""), want = DOWS.indexOf(w) >= 0 ? DOWS.indexOf(w) : DOWS_ES.indexOf(w), d = new Date(S.now); d.setHours(12, 0, 0, 0); do d.setDate(d.getDate() + 1); while (d.getDay() !== want); return { intent: "send_after_date", by: "Rules", date: d, item: formsIn(t, e)[0] || null }; }
    m = AFTERDAY.exec(t);
    if (m && /\b(send|get|have|after|despu[eé]s|until|hasta|payday|back|return|mand|envi)\b/i.test(t)) { const day = +(m[1] || m[2] || m[3]); if (day >= 1 && day <= 31) { const d = new Date(S.now); d.setHours(12, 0, 0, 0); if (d.getDate() >= day) d.setMonth(d.getMonth() + 1, 1); d.setDate(day); if (d.getDate() === day) return { intent: "send_after_date", by: "Rules", date: d, item: formsIn(t, e)[0] || null }; } }
    return null;
  }
  // What the reply was understood as, with every field checked in code. null: nothing new. { low: true }: not sure, so a person decides.
  function replyV2(text, ai, e) {
    let r = null;
    if (ai && V2.includes(ai.intent)) {
      if (ai.confidence !== "high") return { intent: ai.intent, low: true, by: "Claude" };
      const ref = ai.item_ref || ai.item_id || null, it = ref ? S.items.find((i) => i.id === ref && i.engId === e.id && OPEN.includes(i.state)) : null;
      if (ref && !it) return { intent: ai.intent, low: true, by: "Claude" };   // the model named an item that was not on the list it was given
      const ch = ai.change && typeof ai.change === "object" ? { kind: ai.change.kind, form: ai.change.form_code || ai.change.form, reason: ai.change.reason } : null;
      r = { intent: ai.intent, by: "Claude", item: it, person: PERSONS.includes(ai.person) ? ai.person : null, date: typeof ai.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ai.date) ? new Date(+ai.date.slice(0, 4), +ai.date.slice(5, 7) - 1, +ai.date.slice(8, 10), 12) : null, change: ch };
    } else if (!ai || !ai.intent) r = ruleV2(text, e);
    if (!r) return null;
    if (r.intent === "life_change") {
      const ch = r.change; if (!ch || !["add", "remove"].includes(ch.kind) || !Object.hasOwn(FORMS, ch.form) || ch.form === "OTHER") return { intent: r.intent, low: true, by: r.by };
      r.change = { kind: ch.kind, form: ch.form, reason: WAIVE_REASONS[ch.reason] ? ch.reason : "other" };
      if (ch.kind === "remove" && !r.item) r.item = itemsOf(e.id).find((i) => i.form === ch.form && OPEN.includes(i.state)) || null;
    }
    if (r.intent === "send_after_date") {
      const d = r.date instanceof Date && !isNaN(r.date) ? r.date : null;
      if (!d || d <= S.now || d - S.now > 60 * DAY) return { intent: "will_send_later", fallback: true, by: r.by, item: r.item || null };   // no date we can trust: the old "will send later"
      r.date = new Date(Math.min(d.getTime(), S.now.getTime() + LATER_MAX_DAYS * DAY));
    }
    return r;
  }
  const dateWords = (d, lang) => (lang === "es" ? d.getDate() + " de " + ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][d.getMonth()] : MONTHS[d.getMonth()] + " " + d.getDate());
  const linked = (c) => (c && c.spouse ? client(c.spouse) : null);
  /* A spouse or partner who is also a client of the firm, linked by staff. A reply that says "my wife has it" can then move the
     document to her list, if she has agreed to be contacted. The link is the only thing a name in a reply is ever matched to. */
  function setSpouse(cid, other) {
    const c = client(cid), o = other ? client(other) : null; if (!c) return "Unknown client"; if (!may()) return "Not allowed"; if (other && (!o || o.id === c.id)) return "Choose another client";
    const was = linked(c); if (was) delete was.spouse; if (o) { const theirs = linked(o); if (theirs && theirs.id !== c.id) delete theirs.spouse; c.spouse = o.id; o.spouse = c.id; } else delete c.spouse;
    audit("client.spouse", c.first + " " + c.last + (o ? " linked with " + o.first + " " + o.last : " unlinked")); return null;
  }
  // Acts on what was understood. Returns the intent when it has dealt with the reply, or null to let the old rules carry on.
  function actV2(e, c, m, v, cur) {
    const it = v.item || cur || null, name = (i) => (i ? (i.custom || FORMS[i.form].plain) + (i.payer ? " from " + i.payer : "") : "the document"), prep = (S.users.find((u) => u.id === c.preparer) || {}).first || "your preparer";
    const next = () => { e.step = 0; if (e.status === "in_progress") e.next = nextAllowedC(new Date(S.now.getTime() + DAY), c); };
    m.v2 = { intent: v.intent, itemId: it ? it.id : null, person: v.person || null, date: v.intent === "send_after_date" ? v.date : null, change: v.change || null, by: v.by };
    if (v.intent === "someone_else_has_it") {
      const who = v.person || "other", sp = who === "spouse" ? linked(c) : null, se = sp ? engOf(sp.id) : null, reach = sp && (sp.textConsent === "given" || (sp.email && sp.emailOk));
      if (it && sp && se && reach && !["closed", "opted_out", "paused"].includes(se.status)) {
        it.engId = se.id; it.state = "expected"; it.ownerHint = "spouse"; it.movedFrom = c.id; delete it.laterUntil;
        timeline(e, "Moved to " + sp.first + "'s list: " + name(it) + " (" + c.first + " says " + sp.first + " has it)"); timeline(se, "Added from " + c.first + "'s list: " + name(it));
        if (se.status === "complete") { se.status = "in_progress"; se.completedAt = null; } if (["in_progress", "stuck"].includes(se.status)) { if (se.status === "stuck") unstick(se); if (!se.next || se.next > S.now.getTime() + DAY) se.next = nextAllowedC(new Date(S.now.getTime() + HOUR), sp); }
        m.line = "Understood: " + sp.first + " has the " + name(it) + ". Moved to " + sp.first + "'s list; " + sp.first + " is asked next.";
        hlog(e, "decide", "Moved " + name(it) + " to " + sp.first + " " + sp.last, c.first + " said their spouse has it, and " + sp.first + " is a client who has agreed to be contacted", v.by);
        send(e, "M34", { item: it }); if (!checkComplete(e)) next(); else finished(e); return v.intent;
      }
      if (it) it.ownerHint = who;
      addTask({ kind: "question", reason: "Says someone else has it", category: "other", engId: e.id, itemId: it ? it.id : null, msgId: m.id, summary: c.first + " says their " + (who === "other" ? "someone else" : who) + " has the " + name(it) + (who === "spouse" && !sp ? ". No spouse is linked to this client" : who === "spouse" && sp && !reach ? ". " + sp.first + " has not agreed to be contacted" : "") });
      m.line = "Understood: " + (who === "other" ? "someone else" : "their " + who) + " has the " + name(it) + ". Noted on the item. Waiting for you.";
      send(e, "M34", { item: it }); next(); return v.intent;
    }
    if (v.intent === "already_sent") {
      const since = S.now.getTime() - ALREADY_SENT_LOOKBACK_DAYS * DAY, mine = S.docs.filter((d) => d.engId === e.id && +new Date(d.at) >= since && !["discarded", "purged", "duplicate"].includes(d.state));
      const hit = mine.find((d) => it && d.form === it.form) || mine.find((d) => ["in_review", "incomplete", "classified", "stored"].includes(d.state)) || null;
      if (hit && ["in_review", "incomplete", "classified", "stored"].includes(hit.state)) { m.line = "Understood: says it was already sent. One arrived " + dlabel(new Date(hit.at)) + " and is waiting for you."; send(e, "M35", { item: it || { form: hit.form, payer: hit.payer } }); return v.intent; }
      if (hit && hit.state === "accepted" && !(it && OPEN.includes(it.state) && hit.itemId !== it.id)) { m.line = "Understood: says it was already sent. It arrived " + dlabel(new Date(hit.at)) + " and passed the sniff test."; send(e, "M11", {}); return v.intent; }
      m.line = "Understood: says it was already sent. Nothing matching arrived in the last " + ALREADY_SENT_LOOKBACK_DAYS + " days, so it was asked for again with the upload page.";
      linkFresh(c); send(e, "M35R", { item: it || { form: "OTHER", custom: c.lang === "es" ? "documento" : "document" } }); next(); return v.intent;
    }
    if (v.intent === "life_change") {
      const ch = v.change, F = FORMS[ch.form];
      addTask({ kind: "change_noted", reason: "Mentioned a change", engId: e.id, itemId: ch.kind === "remove" && it ? it.id : null, msgId: m.id, change: ch, summary: c.first + " says: " + CHANGE_WORDS[ch.reason] + ". Suggested: " + ch.kind + " " + F.plain });
      m.line = "Understood: " + CHANGE_WORDS[ch.reason] + ". Suggested: " + ch.kind + " " + F.plain + ". Waiting for you.";
      hlog(e, "decide", "Suggested a checklist change: " + ch.kind + " " + F.plain, "A reply never changes a checklist. A person accepts or dismisses it in the review queue", v.by);
      send(e, "M36", {}); next(); return v.intent;
    }
    if (v.intent === "send_after_date") {
      if (it) { it.laterUntil = v.date; it.state = "expected"; }
      m.line = "Understood: will send " + (it ? "the " + name(it) + " " : "") + "after " + dateWords(v.date, "en") + ". Reminders for it wait until then.";
      send(e, "M20D", { date: dateWords(v.date, c.lang) }); e.step = 0; if (e.status === "in_progress") e.next = nextAllowedC(new Date(S.now.getTime() + DAY), c); return v.intent;
    }
    return null;
  }
  function inboundText(cid, text, ai, from) {
    const c = cid ? client(cid) : null, e = c ? engOf(c.id) : null;
    text = scrubIn(text, e);
    if (!e) { S.tray.push({ id: id("y"), text, from: from || "(615) 555-0199", at: new Date(S.now), channel: "text" }); return "unknown"; }   // the placeholder is the demo's; the pipeline always gives the real sender
    let k = ai && KLABEL[ai.intent] && !V2.includes(ai.intent) ? ai.intent : ai && V2.includes(ai.intent) && KLABEL[ai.legacy_intent] && !V2.includes(ai.legacy_intent) ? ai.legacy_intent : intent(text);
    if (OPTOUT.test(text)) k = "stop";
    meter("segIn", segs(text)); if (ai && ai.intent) meter("textRead");
    if (!access().ok && !["stop", "start", "help"].includes(k)) { S.msgs.push({ id: id("m"), engId: e.id, dir: "in", kind: "client", body: text, channel: "text", at: new Date(S.now), intent: k, understood: "Arrived while the firm was not collecting" }); e.lastIn = new Date(S.now); awayReply(e, c); return "away"; }
    const cl = classify(text), scope = ai && SCOPE[ai.scope] ? ai.scope : cl.scope, senti = ai && ai.sentiment ? ai.sentiment : cl.sentiment, model = ai && ai.intent ? "Claude" : "Rules";
    const m = { id: id("m"), engId: e.id, dir: "in", kind: "client", body: text, channel: "text", at: new Date(S.now), intent: k, ai: !!(ai && ai.intent), aiNote: ai && ai.summary, scope, sentiment: senti }; S.msgs.push(m);
    const v2mode = S.firm.hound.replyV2 === "on" ? "on" : "shadow", v2 = ["stop", "start", "help"].includes(k) ? null : replyV2(text, ai, e);
    if (v2 && v2.intent !== "will_send_later" && v2mode !== "on") { m.shadow = { intent: v2.intent, low: !!v2.low, by: v2.by }; hlog(e, "read", "Shadow: the new reply reading would have understood this as \u201c" + KLABEL[v2.intent].toLowerCase() + "\u201d" + (v2.low ? ", not sure" : ""), "Recorded only. The reply was handled the old way", v2.by); }
    if (v2 && v2mode === "on" && v2.intent === "not_mine" && !v2.low) {
      // TH-RPL: "this isn't me". Everything automatic on this conversation stops at once, before any person has looked.
      m.understood = KLABEL.not_mine; m.v2 = { intent: "not_mine", by: v2.by }; m.line = "Understood: says these messages are not theirs. Automatic messages stopped. Waiting for you."; e.lastIn = new Date(S.now);
      S.msgs.forEach((x) => { if (x.engId === e.id && ["approval", "approved", "writing"].includes(x.status)) { x.status = "discarded"; x.note = "The person says these messages are not theirs"; } });
      send(e, "M37", {}); addTask({ kind: "question", urgent: true, reason: "Says this is not theirs", category: "other", engId: e.id, msgId: m.id, summary: c.first + " " + c.last + "'s number or address replied that the messages are not theirs: \u201c" + text.slice(0, 100) + "\u201d" });
      e.notMine = new Date(S.now); pause(e.id); hlog(e, "guardrail", "Stopped automatic messages to " + c.first, "The reply says the messages are not theirs. Nothing more is sent until a person has checked.", v2.by);
      alertx(e, "high", "not_mine", "A reply on " + c.first + " " + c.last + "'s conversation says the messages are not theirs. Automatic messages have stopped. Check the number and the email address.", "nm" + m.id);
      return "not_mine";
    }
    if (k !== "stop" && k !== "start" && k !== "help" && WRONGNO.test(text)) {
      m.understood = "Says this is the wrong number"; e.lastIn = new Date(S.now); c.mobileBad = true;
      if (c.textConsent === "given") { c.textConsent = "none"; c.consentLog.push({ at: new Date(S.now), what: "Texting stopped: the person at this number says it is the wrong number", channel: "text" }); }
      hlog(e, "guardrail", "Stopped texting " + c.first + "'s number", "The reply says it is the wrong number. Nothing more is sent to it until someone checks the number.");
      alertx(e, "high", "wrong_number", "The mobile number for " + c.first + " " + c.last + " may belong to someone else. Texting has stopped. Check the number with " + c.first + ".", "wn" + e.id + m.id);
      return "wrong_number";
    }
    if (LINKRE.test(text) && k !== "stop" && !e.takeover && e.status !== "closed") { m.understood = "Sent a link instead of a file"; e.lastIn = new Date(S.now); hlog(e, "read", c.first + " sent a link", "Tallyhound never opens links. It asked for the photo or PDF itself."); send(e, "M30K", {}); return "link"; }
    e.hours = (e.hours || []).concat([S.now.getHours()]).slice(-12);
    remember(e, (ai && ai.memory) || cl.memory, (ai && ai.memory) ? "Claude" : "Rules");
    if (!OPTOUT.test(text) && !(v2 && v2mode === "on" && v2.intent === "life_change" && !v2.low) && ["in_progress", "stuck", "awaiting_consent", "not_started", "complete"].includes(e.status)) noticeTopics(e, c, text, ai && ai.topics, ai && ai.new_document);
    if (scope !== "documents" && !["stop", "start", "help"].includes(k)) k = "question";
    if ((senti === "frustrated" || senti === "upset") && k === "question" && scope === "documents" && !/\?/.test(text)) k = "frustrated";
    const target = (ai && ai.item_id ? S.items.find((i) => i.id === ai.item_id && i.engId === e.id && OPEN.includes(i.state)) : null) || (!ai && ["will_send_later", "says_none", "where_to_find"].includes(k) ? formsIn(text, e)[0] : null) || null;
    m.understood = KLABEL[k] + (target ? ": " + FORMS[target.form].plain : "");
    if (k === "other_update") k = "thanks";
    e.lastIn = new Date(S.now);
    hlog(e, "read", c.first + " texted: \u201c" + text.slice(0, 70) + (text.length > 70 ? "..." : "") + "\u201d", "Understood as " + m.understood.toLowerCase() + (scope !== "documents" ? "; topic: " + SCOPE[scope].toLowerCase() : "") + (senti !== "calm" ? "; tone: " + senti : ""), model);
    if (e.takeover && !["stop", "start", "help"].includes(k)) { alertx(e, "medium", "takeover_msg", c.first + " " + c.last + " sent a message while " + e.takeover.by + " has the conversation.", "tm" + m.id); return k; }
    if (senti === "frustrated" || senti === "upset") {
      e.quietUntil = new Date(S.now.getTime() + S.firm.hound.pauseDays * DAY); remember(e, "Frustrated by reminders (" + (S.now.getMonth() + 1) + "/" + S.now.getDate() + ")", "Rules");
      alertx(e, "high", "frustrated", c.first + " " + c.last + " sounds " + senti + ": \u201c" + text.slice(0, 60) + "\u201d. Reminders paused " + S.firm.hound.pauseDays + " days.", "fr" + m.id);
      hlog(e, "decide", "Paused reminders for " + S.firm.hound.pauseDays + " days and softened tone", "The client sounds " + senti, model);
      if (k === "question" && scope === "documents" && !/\?/.test(text)) { k = "frustrated"; m.understood = KLABEL.frustrated; }
      if (k !== "question" && k !== "stop") { send(e, "M25", { why: "Client sounds " + senti }); const cur0 = target || itemsOf(e.id).find((i) => i.state === "requested" || i.state === "partial"); if (k === "will_send_later" && cur0) { cur0.laterUntil = new Date(S.now.getTime() + Math.max(S.firm.hound.pauseDays, (ai && +ai.later_days) || 0) * DAY); cur0.state = "expected"; } e.next = nextAllowed(e.quietUntil); return k; }
    }
    if (k === "stop") {
      if (c.textConsent === "withdrawn") { timeline(e, "Client sent STOP again", c.first); return k; }
      c.textConsent = "withdrawn"; c.consentLog.push({ at: new Date(S.now), what: "Withdrawn by STOP", channel: "text" }); if (c.callOk) { c.callOk = false; c.consentLog.push({ at: new Date(S.now), what: "Reminder calls turned off by STOP", channel: "call" }); } send(e, "M16", {}, "text");
      S.msgs.forEach((x) => { if (x.engId === e.id && ["approval", "approved", "writing"].includes(x.status) && x.channel === "text") { x.status = "discarded"; x.note = "Client opted out of texts"; } });
      timeline(e, "Client opted out of texts", c.first); audit("consent.withdrawn", c.first + " " + c.last, c.first);
      if (!(c.email && c.emailOk)) { e.status = "opted_out"; e.stuck = "opted_out"; e.next = null; } else if (e.status === "in_progress") e.next = nextAllowed(new Date(S.now.getTime() + DAY));
      return k;
    }
    if (k === "start") { giveConsent(c.id, "keyword"); return k; }
    if (k === "help") { send(e, "M16H", {}, "text"); return k; }
    unstickOnInbound(e);
    if ((k === "yes" || k === "no") && e.closing && !e.closing.answeredAt) { closingReply(e, c, k === "yes"); return k; }
    if ((k === "yes" || k === "no") && e.qAsked && e.qIdx < QUESTIONS.length) {
      const q = QUESTIONS[e.qIdx];
      if (k === "yes") { q.add.forEach((a) => S.items.push({ id: id("i"), engId: e.id, form: a[0], payer: a[1], state: "expected", source: "question", isNew: true })); timeline(e, "Answered YES: " + q.en.replace("{year}", e.year) + " Items added."); }
      e.qIdx++; e.qAsked = null; e.lastAutoDay = null; step(e); return k;
    }
    const cur = target || itemsOf(e.id).find((i) => i.state === "requested" || i.state === "partial");
    if (v2 && v2mode === "on" && !e.takeover) {
      if (v2.low) { k = "question"; m.understood = "Not sure what this means"; m.line = "Not sure what this means (" + KLABEL[v2.intent].toLowerCase() + "?). Passed to you."; }   // TH-RPL-4
      else if (v2.intent === "will_send_later") k = "will_send_later";
      else { const done = actV2(e, c, m, v2, v2.item || target || cur); if (done) { m.intent = done; m.understood = KLABEL[done] + (m.v2 && m.v2.itemId ? ": " + ((S.items.find((i) => i.id === m.v2.itemId) || {}).custom || FORMS[(S.items.find((i) => i.id === m.v2.itemId) || { form: "OTHER" }).form].plain) : ""); return done; } }
    }
    if (k === "status") {
      const open = openItems(e.id).filter((i) => i.state !== "says_none"), es = c.lang === "es";
      if (!open.length) { send(e, itemsOf(e.id).some((i) => i.state === "says_none" || i.state === "in_review") ? "M12" : "M13", {}); return k; }
      const nm = (i) => (i.custom || (es ? FORMS[i.form].es : FORMS[i.form].plain)) + (i.payer ? (es ? " de " : " from ") + i.payer : ""), first = open.slice(0, 4).map(nm);
      send(e, "M26", { list: first.join("; ") + (open.length > 4 ? (es ? "; y " + (open.length - 4) + " más" : "; and " + (open.length - 4) + " more") : "") }); hlog(e, "decide", "Answered what is still needed", open.length + " open item" + (open.length === 1 ? "" : "s") + " listed", "Rules"); return k;
    }
    if (k === "where_to_find") {
      const named = FORMWORDS.filter((f) => f[1].test(text)).map((f) => f[0])[0];
      if (named && !target && itemsOf(e.id).some((i) => i.form === named && i.state === "received") && !itemsOf(e.id).some((i) => i.form === named && OPEN.includes(i.state))) { send(e, "M11", {}); return k; }
      const about = target || (named ? { form: named, payer: null } : cur);
      if (about && FORMS[about.form] && FORMS[about.form].issuer) { send(e, "M15", { item: about }); return k; }
      if (about) { addTask({ kind: "question", reason: "Asked where to find a custom request", engId: e.id, msgId: m && m.id }); send(e, "M14", {}); return k; }
    }
    if (k === "says_none" && cur) {
      cur.state = "says_none"; addTask({ kind: "says_none", reason: "Client says none", engId: e.id, itemId: cur.id, msgId: m.id }); timeline(e, "Client says they don't have: " + FORMS[cur.form].plain, c.first);
      const nx = nextItem(e); if (nx) { nx.state = "requested"; send(e, "M19", { item: nx }); e.step = 1; e.next = nextAllowed(new Date(S.now.getTime() + 2 * DAY)); } else { send(e, "M19X", {}); setStuck(e, "client_says_none"); }
      return k;
    }
    if (k === "will_send_later" && !cur) { send(e, "M20", {}); return k; }
    if (k === "will_send_later" && cur) { cur.laterUntil = new Date(S.now.getTime() + ((ai && +ai.later_days) || 5) * DAY); cur.state = "expected"; send(e, "M20", {}); e.step = 0; e.next = nextAllowed(new Date(S.now.getTime() + DAY)); return k; }
    if (k === "thanks") return k;
    const cat = scope === "documents" ? "other" : scope, prep = (S.users.find((u) => u.id === c.preparer) || {}).first || "your preparer";
    send(e, cat === "tax_question" ? "M14" : "M24", { why: "Outside document collection (" + SCOPE[cat].toLowerCase() + "), so handed to a person" });
    addTask({ kind: "question", reason: SCOPE[cat], category: cat, engId: e.id, msgId: m.id, summary: (ai && ai.summary) || c.first + " asked: \u201c" + text.slice(0, 120) + "\u201d", suggest: (ai && ai.staff_reply) || (cat === "tax_question" ? "Hi " + c.first + ", good question. I'll go over it with you when we review your return." : cat === "billing" ? "Hi " + c.first + ", thanks for asking. I'll send you the details on fees today." : cat === "scheduling" ? "Hi " + c.first + ", happy to find a time. Does one of these work for you?" : "Hi " + c.first + ", thanks for your message. I'll get back to you shortly."), suggestBy: ai && ai.staff_reply ? "Claude" : "Template" });
    hlog(e, "handoff", "Handed to " + prep + ": " + SCOPE[cat].toLowerCase(), "Tallyhound only handles document collection. A suggested reply is ready for staff to edit.", model);
    alertx(e, "info", "handoff", c.first + " " + c.last + ": " + SCOPE[cat].toLowerCase() + " handed to " + prep + ".", "ho" + m.id);
    setStuck(e, "question_waiting"); return "question";
  }
  function formsIn(text, e) { return FORMWORDS.filter((f) => f[1].test(text)).map((f) => f[0]).map((f) => itemsOf(e.id).find((i) => i.form === f && ["expected", "requested", "partial"].includes(i.state))).filter(Boolean); }
  /* Several documents in one text or one upload: checked one by one, answered once. */
  /* T-118: a second contact for a client, such as a spouse's mobile or another email address, remembered when staff file a
     message from it. Messages that arrive from it are then matched to the client. Nothing is ever sent to it: sending uses
     c.mobile and c.email only, and consent belongs to the client's own number. */
  function addContact(cid, kind, value) {
    const c = client(cid); if (!c) return "Unknown client"; if (!may()) return "Not allowed";
    const v = kind === "mobile" ? String(value || "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1") : kind === "email" ? String(value || "").trim().toLowerCase() : "";
    if (kind === "mobile" ? !/^[2-9]\d{9}$/.test(v) : !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v) || v.length > 254) return kind === "mobile" ? "That is not a 10-digit mobile number" : kind === "email" ? "That is not an email address" : "A second contact is a mobile number or an email address";
    if ((kind === "mobile" ? c.mobile : String(c.email || "").toLowerCase()) === v) return "That is already " + c.first + "'s own " + (kind === "mobile" ? "number" : "address");
    c.also = c.also || []; if (c.also.some((x) => x.kind === kind && x.value === v)) return null; if (c.also.length >= 4) return "A client can have up to 4 second contacts";
    c.also.push({ kind, value: v, at: new Date(S.now), by: S.user.name }); audit("client.contact", c.last + ": a second " + (kind === "mobile" ? "number" : "address") + " remembered"); return null;
  }
  function removeContact(cid, value) { const c = client(cid); if (!c || !may()) return false; const n = (c.also || []).length; c.also = (c.also || []).filter((x) => x.value !== String(value || "").toLowerCase()); if (c.also.length === n) return false; audit("client.contact", c.last + ": a second contact removed"); return true; }
  function inboundBundle(cid, specs, channel) { return inboundEmail(cid, "", specs, null, channel === "portal" ? "portal" : "text"); }
  function inboundUnusable(cid, why, channel) {
    const c = client(cid), e = engOf(cid); if (!c || !e) return null;
    if (!access().ok) { S.msgs.push({ id: id("m"), engId: e.id, dir: "in", kind: "client", body: "[A file, while the firm was not collecting]", channel: channel || "email", at: new Date(S.now), attachments: [] }); awayReply(e, c); return { away: true }; }
    const m = { id: id("m"), engId: e.id, dir: "in", kind: "client", body: why === "locked" ? "[A password-protected PDF]" : "[A file that could not be opened]", channel: channel || "email", at: new Date(S.now), attachments: [] }; S.msgs.push(m);
    e.lastIn = new Date(S.now); unstickOnInbound(e); e.unusable = (e.unusable || 0) + 1;
    hlog(e, "read", c.first + " sent a file that could not be opened", why === "locked" ? "The PDF needs a password. Tallyhound never asks a client for a password. It asks for an unlocked copy or a photo." : "Not a photo or a PDF. Asked for one of those.");
    if (e.takeover) { alertx(e, "medium", "takeover_msg", c.first + " " + c.last + " sent a file that could not be opened while " + e.takeover.by + " has the conversation.", "tm" + m.id); return { m }; }
    if (e.status === "closed") { send(e, "M12", {}); addTask({ kind: "question", reason: "File after close", engId: e.id, msgId: m.id }); return { m }; }
    if (e.unusable >= 2) { addTask({ kind: "question", reason: why === "locked" ? "Locked PDF sent twice" : "Unopenable file sent twice", engId: e.id, msgId: m.id }); send(e, "M12", {}); e.unusable = 0; return { m, handed: true }; }
    send(e, why === "locked" ? "M30L" : "M30T", {}); return { m };
  }
  function inboundEmail(cid, body, specs, ai, via) {
    const c = client(cid), e = engOf(cid), lang = c.lang; body = scrubIn(body, e);
    if (!access().ok) { const m0 = { id: id("m"), engId: e.id, dir: "in", kind: "client", body: via ? "[" + (specs || []).length + " files, while the firm was not collecting]" : body, channel: via || "email", at: new Date(S.now), attachments: [], understood: "Arrived while the firm was not collecting" }; S.msgs.push(m0); e.lastIn = new Date(S.now); awayReply(e, c); return { m: m0, docs: [], away: true }; }
    const m = { id: id("m"), engId: e.id, dir: "in", kind: "client", body: via ? "[" + (specs || []).length + " documents in one " + (via === "portal" ? "upload" : "text") + "]" : body, channel: via || "email", at: new Date(S.now), attachments: [], ai: !!ai, aiNote: ai && ai.summary }; S.msgs.push(m);
    e.lastIn = new Date(S.now); unstickOnInbound(e); S.hold = []; e.hours = (e.hours || []).concat([S.now.getHours()]).slice(-12);
    hlog(e, "read", c.first + (via ? " sent " : " emailed ") + (specs || []).length + " attachment" + ((specs || []).length === 1 ? "" : "s") + " and a note", ai && ai.summary ? ai.summary : "", ai ? "Claude" : "Rules");
    if (!["closed", "opted_out"].includes(e.status)) noticeTopics(e, c, body || "", ai && ai.topics, ai && ai.new_document);
    if (e.takeover) alertx(e, "medium", "takeover_msg", c.first + " " + c.last + " emailed while " + e.takeover.by + " has the conversation.", "tm" + m.id);
    // T-121: a link and no file. Tallyhound never opens links: it says so and asks for the file itself, as it does for a text.
    if (!via && !(specs || []).length && LINKRE.test(body || "") && !e.takeover && e.status !== "closed") { m.understood = "Sent a link instead of a file"; hlog(e, "read", c.first + " emailed a link", "Tallyhound never opens links. It asked for the photo or PDF itself."); S.hold = null; send(e, "M30K", {}); return { m, docs: [], link: true }; }
    const docs = (specs || []).map((sp) => inboundDoc(cid, sp, via || "email", { parent: m }));
    if (e.status === "closed") { S.hold = null; send(e, "M12", {}); if (!docs.length) addTask({ kind: "question", reason: "Email after close", engId: e.id, msgId: m.id }); return { m, docs }; }
    const later = [], none = []; let question = false;
    if (ai && Array.isArray(ai.items)) ai.items.forEach((x) => { const it = S.items.find((i) => i.id === x.item_id && i.engId === e.id && ["expected", "requested", "partial"].includes(i.state)); if (!it) return; if (x.status === "later") later.push([it, +x.days || 7]); if (x.status === "none") none.push(it); });
    else { const its = formsIn(body, e); if (/later|next week|coming|soon|waiting|haven't (got|received)|not yet/i.test(body)) its.forEach((it) => later.push([it, 7])); else if (/don'?t have|do not have|no longer|closed|didn'?t get/i.test(body)) its.forEach((it) => none.push(it)); }
    question = ai ? !!ai.question : /\?/.test(body) && /(should|can i|do i|deduct|owe)/i.test(body);
    later.forEach(([it, days]) => { it.laterUntil = new Date(S.now.getTime() + days * DAY); if (it.state === "requested") it.state = "expected"; timeline(e, "Client says " + FORMS[it.form].plain + " is coming later (email)", c.first); });
    none.forEach((it) => { it.state = "says_none"; addTask({ kind: "says_none", reason: "Client says none", engId: e.id, itemId: it.id, msgId: m.id }); });
    if (question) { addTask({ kind: "question", reason: "Question", engId: e.id, msgId: m.id }); }
    S.hold = null;
    const nm = (d) => (lang === "es" ? FORMS[d.form].es : FORMS[d.form].plain) + (d.payer ? (lang === "es" ? " de " : " from ") + d.payer : "");
    const got = docs.filter((d) => d.state === "accepted"), parts = [];
    if (lang === "es") {
      parts.push("Gracias, " + c.first + ".");
      if (got.length) parts.push("Recibimos: " + got.map(nm).join(", ") + ".");
      docs.filter((d) => d.state === "incomplete").forEach((d) => { const t = missText((S.items.find((i) => i.id === d.itemId) || {}).missing || [], "es", d.form); parts.push("Su " + nm(d) + ": " + t.missing + ". Por favor envíe " + t.fix + "."); });
      docs.filter((d) => d.state === "rejected").forEach((d) => parts.push("Su " + nm(d) + (d.findings.includes("wrong_year") ? " es de " + d.year + "; necesitamos el de " + e.year + "." : " no se puede leer; envíe una copia más clara.")));
      if (docs.some((d) => d.state === "in_review")) parts.push("Pasamos " + docs.filter((d) => d.state === "in_review").length + " documento(s) a " + ((S.users.find((u) => u.id === c.preparer) || {}).first || "su preparador") + " para revisarlos.");
      later.forEach(([it]) => parts.push("Anotamos que su " + FORMS[it.form].es + " llegará más adelante."));
      if (question) parts.push("Le pasamos su pregunta a " + ((S.users.find((u) => u.id === c.preparer) || {}).first || "su preparador") + ".");
    } else {
      parts.push("Thanks, " + c.first + ".");
      if (got.length) parts.push("We received your " + got.map(nm).join(", ") + ".");
      docs.filter((d) => d.state === "incomplete").forEach((d) => { const t = missText((S.items.find((i) => i.id === d.itemId) || {}).missing || [], "en", d.form); parts.push("For your " + nm(d) + ", " + t.missing + ". Please send " + t.fix + "."); });
      docs.filter((d) => d.state === "rejected").forEach((d) => parts.push("Your " + nm(d) + (d.findings.includes("wrong_year") ? " is for " + d.year + "; we need the " + e.year + " version." : " is hard to read; please send a clearer copy.")));
      docs.filter((d) => d.state === "duplicate").forEach((d) => parts.push("We already had your " + nm(d) + ", so nothing more is needed for it."));
      if (docs.some((d) => d.state === "in_review")) parts.push("We passed " + docs.filter((d) => d.state === "in_review").length + " document" + (docs.filter((d) => d.state === "in_review").length > 1 ? "s" : "") + " to " + ((S.users.find((u) => u.id === c.preparer) || {}).first || "your preparer") + " to check.");
      later.forEach(([it]) => parts.push("Noted that your " + FORMS[it.form].plain + " is coming later. We'll check back then."));
      none.forEach((it) => parts.push("Noted that you don't have the " + FORMS[it.form].plain + ". " + ((S.users.find((u) => u.id === c.preparer) || {}).first || "Your preparer") + " will confirm."));
      if (question) parts.push("We passed your question to " + ((S.users.find((u) => u.id === c.preparer) || {}).first || "your preparer") + ", who will reply.");
    }
    const open = openItems(e.id).filter((i) => ["expected", "requested", "partial"].includes(i.state) && !later.some((l) => l[0] === i));
    if (checkComplete(e)) parts.push(lang === "es" ? "Eso es todo lo que necesitamos para su declaración de " + e.year + "." : "That's everything we need for your " + e.year + " return.");
    else if (open.length) parts.push((lang === "es" ? "Aún necesitamos: " : "Still needed: ") + open.map((i) => (lang === "es" ? FORMS[i.form].es : FORMS[i.form].plain) + (i.payer ? (lang === "es" ? " de " : " from ") + i.payer : "")).join(", ") + ".");
    let summary = parts.join(" ");
    if (via === "text" && summary.length > 290) { const bad = docs.length - got.length; summary = lang === "es" ? "Gracias, " + c.first + ". Recibimos " + got.length + " de " + docs.length + " documentos." + (bad ? " " + bad + " necesitan otra revisión; le escribiremos sobre cada uno." : "") : "Thanks, " + c.first + ". We received " + got.length + " of " + docs.length + " documents." + (bad ? " " + bad + " need another look, and we will follow up on each one." : ""); }
    send(e, "M23", { summary }, via ? undefined : "email");
    m.actions = docs.map((d) => d.form + "|" + d.state).concat(later.map((l) => l[0].form + "|later")).concat(none.map((i) => i.form + "|none")).concat(question ? ["|question"] : []);
    m.understood = (docs.length ? docs.length + " attachment" + (docs.length > 1 ? "s" : "") : "No attachments") + (later.length ? ", " + later.length + " coming later" : "") + (none.length ? ", " + none.length + " not available" : "") + (question ? ", a question" : "");
    timeline(e, "Email with " + docs.length + " attachment" + (docs.length === 1 ? "" : "s") + " read and answered in one reply", c.first);
    e.step = 0; if (!["complete", "closed"].includes(e.status)) { if (question && e.status === "in_progress") setStuck(e, "question_waiting"); else if (e.status === "in_progress") e.next = nextAllowed(new Date(S.now.getTime() + 2 * DAY)); }
    return { m, docs };
  }
  function recommend(eid) {
    const e = eng(eid), c = client(e.clientId), f = c.profile || {}, items = itemsOf(e.id), add = [];
    Object.keys(RULES).forEach((k) => { if (!f[k]) return; RULES[k].forEach((form) => { if (!items.some((i) => i.form === form) && !add.some((a) => a.form === form) && !(c.dismissed || []).includes(form)) add.push({ form, fact: k, reason: FACTS.find((x) => x[0] === k)[1] }); }); });
    const backed = (i) => i.source === "prior_year" || i.source === "last_season" || i.source === "question" || i.source === "arrived" || Object.keys(RULES).some((k) => f[k] && RULES[k].includes(i.form));
    return { add, unbacked: items.filter((i) => !backed(i) && i.state !== "waived") };
  }
  function addRecommended(eid, forms) {
    const e = eng(eid), r = recommend(eid); let n = 0;
    r.add.filter((a) => !forms || forms.includes(a.form)).forEach((a) => { S.items.push({ id: id("i"), engId: eid, form: a.form, payer: null, state: "expected", source: "recommended", reason: a.reason }); n++; });
    if (n) { timeline(e, "Added " + n + " recommended item" + (n > 1 ? "s" : ""), S.user.name); if (e.status === "complete") { e.status = "in_progress"; e.next = nextAllowed(S.now); } }
    return n;
  }
  function dismissRec(eid, form) { const c = client(eng(eid).clientId); c.dismissed = (c.dismissed || []).concat([form]); }
  function setFact(cid, k, v) { const c = client(cid); c.profile = Object.assign({}, c.profile, { [k]: !!v }); }
  function clientAnswers(cid, ans) {
    const c = client(cid), e = engOf(cid), yes = [];
    Object.keys(ans).forEach((k) => { setFact(cid, k, ans[k]); if (ans[k]) yes.push(k); });
    let n = 0; yes.forEach((k) => (RULES[k] || []).forEach((form) => { if (!itemsOf(e.id).some((i) => i.form === form)) { S.items.push({ id: id("i"), engId: e.id, form, payer: null, state: "expected", source: "question", reason: "Client answered yes: " + FACTS.find((x) => x[0] === k)[1].toLowerCase(), isNew: true }); n++; } }));
    const m = { id: id("m"), engId: e.id, dir: "in", kind: "client", body: "(Upload page) Answered " + Object.keys(ans).length + " questions. Yes to: " + (yes.length ? yes.map((k) => FACTS.find((x) => x[0] === k)[1].toLowerCase()).join(", ") : "none"), channel: "portal", at: new Date(S.now), understood: "Questionnaire: " + n + " item" + (n === 1 ? "" : "s") + " added" }; S.msgs.push(m);
    e.lastIn = new Date(S.now); timeline(e, "Answered the questionnaire on the upload page: " + n + " item" + (n === 1 ? "" : "s") + " added", c.first); audit("questionnaire", c.first + " " + c.last + ": " + n + " items added", c.first);
    if (n && e.status === "complete") { e.status = "in_progress"; e.next = nextAllowed(S.now); }
    return n;
  }
  function takeover(eid, reason) { const e = eng(eid), c = client(e.clientId); e.takeover = { by: S.user.name, at: new Date(S.now), reason: reason || "" }; timeline(e, "Conversation taken over by " + S.user.name, S.user.name); audit("hound.takeover", c.last); hlog(e, "handoff", S.user.name + " took over the conversation", reason || "Staff control: the Hound keeps reading and tracking but sends nothing", "Rules"); }
  function handback(eid, note) { const e = eng(eid), c = client(e.clientId); e.takeover = null; if (note) remember(e, note, S.user.name); S.tasks.filter((t) => t.engId === e.id && t.kind === "question" && t.status === "open").forEach((t) => { t.status = "decided"; t.decision = "handled"; t.by = S.user.name; t.decidedAt = new Date(S.now); }); if (e.stuck === "question_waiting") unstick(e); e.step = 0; if (["in_progress"].includes(e.status)) e.next = nextAllowed(new Date(S.now.getTime() + HOUR)); timeline(e, "Handed back to the Hound", S.user.name); hlog(e, "decide", "Back on the Hound: resumes in about an hour", note ? "Staff note: " + note : "Staff handed the conversation back", "Rules"); }
  function approveMsg(mid, body) { const m = S.msgs.find((x) => x.id === mid), e = eng(m.engId); const errs = outputCheck(body || m.body, m.channel, { year: e.year }).filter((x) => !(x.startsWith("digit run") && (m.base || "").includes(x.split(" ").pop()))); if (errs.length) return errs.join(", "); const c = client(e.clientId);
    if (m.status !== "approval") return "This draft is no longer waiting";
    if (m.channel === "text" && c.textConsent !== "given") { m.status = "discarded"; m.note = "Client opted out of texts"; return "This client opted out of texts. The draft was discarded"; }
    if (["closed", "opted_out"].includes(e.status)) { m.status = "discarded"; m.note = "File is " + e.status.replace("_", " "); return "This file is " + e.status.replace("_", " ") + ". The draft was discarded"; }
    if (body) m.body = body; m.approvedBy = S.user.name;
    if (PROACTIVE.includes(m.tpl) && !allowedC(S.now, c)) { m.status = "approved"; m.sendAt = nextAllowedC(S.now, c); hlog(e, "message", S.user.name + " approved: " + (TPL_USE[m.tpl] || "").toLowerCase() + ". Held until sending hours", "", "Rules"); return null; }
    m.status = "delivered"; m.at = new Date(S.now); hlog(e, "message", S.user.name + " approved and sent: " + (TPL_USE[m.tpl] || "").toLowerCase(), "", "Rules"); return null; }
  function rejectMsg(mid) { const m = S.msgs.find((x) => x.id === mid); m.status = "discarded"; hlog(eng(m.engId), "message", S.user.name + " discarded a draft: " + (TPL_USE[m.tpl] || "").toLowerCase(), "", "Rules"); }
  function composeDone(mid, text, model, err) {
    const m = S.msgs.find((x) => x.id === mid); if (!m || m.status !== "writing") return; const e = eng(m.engId);
    if (text) { const errs = outputCheck(text, m.channel, { year: e.year, doc_year: m.ctx && m.ctx.doc_year }).filter((x) => !(x.startsWith("digit run") && (m.base || "").includes(x.split(" ").pop()))); if (m.channel === "text" && text.length > 320) errs.push("too long"); if ((m.base || "").includes(linkHost() + "/") && !text.includes((/\S*\/[cu]\/\S+/.exec(m.base.slice(m.base.indexOf(linkHost()))) || [linkHost()])[0].replace(/[.,;!?)]+$/, ""))) errs.push("dropped the link");
      if (errs.length) hlog(e, "guardrail", "Claude's draft failed the safety check (" + errs.join(", ") + "); the standard wording was used", "", "Rules"); else { m.body = text; m.ai = true; } }
    else if (err) hlog(e, "guardrail", "Claude was not available (" + err + "); the standard wording was used", "", "Rules");
    m.status = m.after || "delivered"; if (m.status === "approval") alertx(e, "low", "approval", "A message to " + client(e.clientId).first + " is waiting for approval.", "ap" + m.id);
  }
  function portalNone(iid) {
    const it = S.items.find((x) => x.id === iid), e = eng(it.engId), c = client(e.clientId);
    if (!OPEN.includes(it.state) || it.state === "says_none") return;
    const m = { id: id("m"), engId: e.id, dir: "in", kind: "client", body: "(Upload page) I don't have my " + FORMS[it.form].plain + (it.payer ? " from " + it.payer : ""), channel: "portal", at: new Date(S.now), intent: "says_none" }; S.msgs.push(m);
    it.state = "says_none"; e.lastIn = new Date(S.now); unstickOnInbound(e);
    addTask({ kind: "says_none", reason: "Client says none", engId: e.id, itemId: it.id, msgId: m.id }); timeline(e, "Client says they don't have: " + FORMS[it.form].plain + " (upload page)", c.first);
    if (!nextItem(e) && !itemsOf(e.id).some((i) => i.state === "in_review")) setStuck(e, "client_says_none");
  }
  /* T-119: what kind of line a client's number is, as the phone company reports it. A landline cannot get a text, so it can
     never be given consent. The answer belongs to the number it was asked about: a new number starts unknown again. */
  const LINES = ["mobile", "landline", "voip", "unknown"];
  function setLine(cid, kind) { const c = client(cid); if (!c || !c.mobile || !LINES.includes(kind)) return false; if (c.lineFor !== c.mobile) meter("lookup"); const was = isLandline(c); c.line = kind; c.lineFor = c.mobile; if (isLandline(c) && !was) { audit("client.landline", c.first + " " + c.last, "Rules"); if (c.textConsent === "given") { c.textConsent = "none"; c.consentLog.push({ at: new Date(S.now), what: "Texting stopped: this number is a landline", channel: "text" }); } } return true; }
  const isLandline = (c) => !!c && c.line === "landline" && !!c.mobile && c.lineFor === c.mobile;
  function giveConsent(cid, source) {
    const c = client(cid), e = engOf(cid); if (isLandline(c)) return;
    // A number someone called wrong stays off until the client confirms it on their own page, or staff correct it.
    if (c.mobileBad) { if (source === "page") c.mobileBad = false; else return; }
    c.textConsent = "given"; c.consentLog.push({ at: new Date(S.now), what: "Given (" + source + "), wording v1", channel: "text" });
    audit("consent.given", c.first + " " + c.last + " by " + source, c.first);
    if (e) { send(e, "M2", {}, "text"); timeline(e, "Text consent given (" + source + ")", c.first); if (!e.startedAt && ["awaiting_consent", "opted_out"].includes(e.status)) { e.status = "not_started"; e.stuck = null; }   // opted out before the firm ever started them: agreeing to texts does not start collecting
      else if (["awaiting_consent", "opted_out"].includes(e.status) || e.stuck === "no_consent" || e.stuck === "opted_out") { e.status = "in_progress"; e.stuck = null; e.lastIn = new Date(S.now); e.next = nextAllowed(new Date(S.now.getTime() + MIN));
      if (S.firm.checkinMode === "auto" && !e.checkin && !e.noQuestions && e.startedAt) questionsAfterOptIn(e, c, "Tallyhound"); } }
  }
  /* The questions, sent once by text after the client has turned texting on. Document requests wait up to two days for the answers.
     checkinMode "auto": this happens by itself right after opt-in. Otherwise only when staff send it (sendCheckin). Many firms cover the same ground on a call instead. */
  const CHECKIN_WAIT_DAYS = 2;
  // The firm can skip the questions for one client whose checklist is already complete. For every client, set checkinMode to "manual".
  function skipQuestions(eid, on) { const e = eng(eid); if (!e) return false; e.noQuestions = on !== false; if (e.noQuestions && e.checkin && e.checkin.afterOptIn && e.checkin.pending && !e.checkin.doneAt) { e.checkin = null; e.next = nextAllowed(new Date(S.now.getTime() + MIN)); } timeline(e, e.noQuestions ? "Questions skipped: the checklist is complete" : "Questions allowed again", S.user.name); audit("checkin.skip", client(e.clientId).last + ": " + (e.noQuestions ? "skip" : "allow")); return e.noQuestions; }
  function questionsAfterOptIn(e, c, who) {
    if (e.checkin || !access().ok || e.takeover) return false;
    if (c.textConsent !== "given" || !c.mobile || S.firm.senderStatus !== "approved") return false;
    e.checkin = { sentAt: new Date(S.now), reminded: true, afterOptIn: true, by: who };   // reminded: true means no reminder is ever sent. It is a one-time text
    if (allowedC(S.now, c)) send(e, "M28", {}, "text"); else e.checkin.pending = "text";
    e.next = nextAllowed(new Date(S.now.getTime() + CHECKIN_WAIT_DAYS * DAY));
    timeline(e, "Questions sent by text" + (who === "Tallyhound" ? " after opt-in" : ""), who); audit("checkin.sent", c.first + " " + c.last + " (after opt-in)", who);
    hlog(e, "message", "Sent " + c.first + " the questions, once", "Document requests wait up to " + CHECKIN_WAIT_DAYS + " days for the answers, then go out with the checklist on file", "Rules"); return true;
  }

  /* ---------- staff actions ---------- */
  /* T-66: undo for a document discarded by mistake. Only the discard itself is undone: the document goes back to waiting for a
     person, exactly as it was. Allowed for ten minutes, while Tallyhound certainly still holds the copy. */
  function undiscard(tid) {
    const t = S.tasks.find((x) => x.id === tid), d = t && t.docId ? S.docs.find((x) => x.id === t.docId) : null; if (!t || !d || t.decision !== "discard" || d.state !== "discarded") return "Nothing to undo";
    if (!may()) return "Not allowed"; if (S.now - new Date(t.decidedAt) > 10 * 60000 || !hasContent(d)) return "Too late to undo. Ask the client to send it again";
    d.state = t.was || "in_review"; d.reasons = (d.reasons || []).filter((r) => !/^Discarded by /.test(r)); t.status = "open"; t.decision = null; t.by = null; t.decidedAt = null;
    const e = eng(t.engId); if (e) timeline(e, "Discard undone", S.user.name); audit("review.undiscard", t.reason || ""); return null;
  }
  function decideTask(tid, decision, p) {
    const t = S.tasks.find((x) => x.id === tid); if (!t || t.status !== "open") return "Already decided";
    const e = eng(t.engId), c = e ? client(e.clientId) : null, d = t.docId ? S.docs.find((x) => x.id === t.docId) : null, it = t.itemId ? S.items.find((x) => x.id === t.itemId) : null;
    t.status = "decided"; t.decision = decision; t.by = S.user.name; t.decidedAt = new Date(S.now);
    audit("review." + decision, (c ? c.first + " " + c.last : "") + " " + (t.reason || ""));
    if (e && e.stuck === "review_waiting") unstick(e);
    if (t.kind === "document" && d) {
      if (decision === "accept" || decision === "correct") {
        if (decision === "correct" && p) { Object.assign(d, { form: p.form || d.form, year: +p.year || d.year, payer: p.payer || d.payer }); d.versions.push({ v: d.versions.length + 1, by: S.user.name, form: d.form, year: d.year, payer: d.payer }); }
        const want = (p && p.itemId) || (d.form === "OTHER" ? d.matchItem : null);
        let item = (want && itemsOf(e.id).find((i) => i.id === want && OPEN.includes(i.state))) || itemsOf(e.id).find((i) => i.form === d.form && OPEN.includes(i.state) && (d.form !== "OTHER" || !i.custom || itemsOf(e.id).filter((x) => x.custom && OPEN.includes(x.state)).length === 1));
        if (!item) { item = { id: id("i"), engId: e.id, form: d.form, payer: d.payer, state: "expected", source: "staff" }; S.items.push(item); }
        item.state = "received"; item.docId = d.id; if (!item.payer) item.payer = d.payer; d.itemId = item.id; d.state = "accepted"; d.reasons.push("Accepted by " + S.user.name + ".");
        timeline(e, "Accepted " + d.form + " in review", S.user.name); e.lastIn = new Date(S.now); if (e.status === "stuck") unstick(e); afterAccept(e, c);
      } else if (decision === "reask") {
        d.state = "rejected"; d.reasons.push("Re-asked by " + S.user.name + ": " + (p && p.reason));
        const code = { wrong_year: "M7", illegible: "M8", missing_page: "M9" }[p && p.reason] || "M8";
        const item = itemsOf(e.id).find((i) => i.form === d.form && OPEN.includes(i.state)) || { form: d.form, payer: d.payer };
        sendSoon(e, code, { item, doc_year: d.year }); timeline(e, "Re-asked: " + (p && p.reason), S.user.name);
      } else if (decision === "discard") { t.was = d.state; d.state = "discarded"; d.reasons.push("Discarded by " + S.user.name + ": " + ((p && p.reason) || "not needed")); timeline(e, "Document discarded", S.user.name); }
    }
    if (t.kind === "says_none" && it) {
      if (decision === "waive") { it.state = "waived"; it.waiveReason = p && WAIVE_REASONS[p.waiveReason] ? p.waiveReason : "not_this_year"; it.note = "Client does not have it"; timeline(e, "Waived " + FORMS[it.form].plain, S.user.name); if (e.stuck === "client_says_none") unstick(e); if (checkComplete(e)) finished(e); else if (!e.next) e.next = nextAllowed(S.now); }
      else { it.state = "requested"; if (e.stuck === "client_says_none") unstick(e); sendSoon(e, "M5", { item: it }); if (!(e.queue && e.queue.length)) e.next = nextAllowed(new Date(S.now.getTime() + 2 * DAY)); }
    }
    if (t.kind === "call") { timeline(e, "Called by " + S.user.name + (p && p.note ? ": " + p.note : ""), S.user.name); if (p && p.note) remember(e, p.note, S.user.name); if (e.stuck === "no_reply") { unstick(e); e.step = 0; e.next = nextAllowed(new Date(S.now.getTime() + DAY)); } hlog(e, "decide", "Call logged; the Hound resumes tomorrow", p && p.note ? p.note : "", "Rules"); }
    if (t.kind === "change_noted" && e) {
      const ch = t.change || {}, F = FORMS[ch.form];
      if (decision === "apply_change" && F) {
        if (ch.kind === "remove") { const tgt = (it && OPEN.includes(it.state) ? it : null) || itemsOf(e.id).find((i) => i.form === ch.form && OPEN.includes(i.state)); if (tgt) { tgt.state = "waived"; tgt.waiveReason = WAIVE_REASONS[ch.reason] ? ch.reason : "other"; tgt.note = WAIVE_REASONS[tgt.waiveReason] + " (the client said so)"; timeline(e, "Not needed this year: " + F.plain + " (" + CHANGE_WORDS[tgt.waiveReason] + ")", S.user.name); } }
        else if (!itemsOf(e.id).some((i) => i.form === ch.form && OPEN.includes(i.state))) { S.items.push({ id: id("i"), engId: e.id, form: ch.form, payer: null, state: "expected", source: "reply", isNew: true }); timeline(e, "Added item: " + F.plain + " (the client mentioned it)", S.user.name); if (e.status === "complete") { e.status = "in_progress"; e.completedAt = null; } }
        audit("checklist.change_from_reply", (c ? c.first + " " + c.last + ": " : "") + ch.kind + " " + F.plain);
        if (checkComplete(e)) finished(e); else if (e.status === "in_progress" && !e.next) e.next = nextAllowedC(S.now, c);
      } else if (decision !== "dismiss_change") { t.status = "open"; t.decision = null; t.by = null; t.decidedAt = null; return "Choose: apply the change, or dismiss it"; }
    }
    if (t.kind === "gone_quiet" && e) {
      if (decision === "call") { addTask({ kind: "call", reason: "Call the client", engId: e.id, script: t.script || callScript(e, c) }); timeline(e, "Call planned", S.user.name); }
      else if (decision === "restart") { e.status = "in_progress"; e.stuck = null; e.step = 0; e.next = nextAllowedC(S.now, c); timeline(e, "Fetching restarted", S.user.name); }
      else if (decision === "pause") { e.status = "in_progress"; pause(e.id); }
      else if (decision === "close") closeEng(e.id);
      else { t.status = "open"; t.decision = null; t.by = null; t.decidedAt = null; return "Choose: call, restart, pause or close"; }
    }
    if (t.kind === "question") {
      if (decision === "reply" && p && p.body) manual(e.id, p.body, true);
      if (e.stuck === "question_waiting") { unstick(e); e.next = nextAllowed(new Date(S.now.getTime() + HOUR)); }
      timeline(e, "Question handled", S.user.name);
    }
    return null;
  }
  function manual(eid, body, quiet) {
    if (!access().ok) return access().reason;
    const e = eng(eid), c = client(e.clientId), ch = channelFor(c, e) || "email";
    if (e.status === "opted_out" || c.textConsent === "withdrawn" && ch === "text") return "This client opted out of messages. Call them instead";
    if (ch === "email" && !(c.email && c.emailOk)) return "No working email or text number for this client";
    if (!String(body || "").trim()) return "The message is empty";
    const errs = outputCheck(body, ch, { year: e.year }).filter((x) => !x.startsWith("digit run"));
    if (errs.length) return errs.join(", ");
    S.msgs.push({ id: id("m"), engId: e.id, dir: "out", kind: "manual", body, channel: ch, at: new Date(S.now), status: "delivered", by: S.user.name });
    e.lastOut = new Date(S.now); audit("message.manual", "To " + c.first + " " + c.last[0] + ".");
    if (!quiet) { S.tasks.filter((t) => t.engId === e.id && t.kind === "question" && t.status === "open").forEach((t) => { t.status = "decided"; t.decision = "reply"; t.by = S.user.name; }); if (e.stuck === "question_waiting" || e.stuck === "no_reply") { unstick(e); e.next = nextAllowed(new Date(S.now.getTime() + DAY)); } }
    return null;
  }
  function setItem(iid, state, note, reason) {
    const it = S.items.find((x) => x.id === iid), e = eng(it.engId); it.state = state; if (note) it.note = note;
    if (state === "waived") it.waiveReason = WAIVE_REASONS[reason] ? reason : "other"; else delete it.waiveReason;
    // A person has settled this item directly, so an "I don't have it" waiting in the review queue for the same item is answered too.
    if (state !== "says_none") S.tasks.forEach((t) => { if (t.status === "open" && t.kind === "says_none" && t.itemId === it.id) { t.status = "decided"; t.decision = "settled"; t.by = S.user.name; t.decidedAt = new Date(S.now); if (e.stuck === "client_says_none") unstick(e); } });
    timeline(e, (state === "waived" ? "Waived " : state === "removed" ? "Removed " : state === "received" ? "Marked received: " : "Restored ") + (it.custom || FORMS[it.form].plain) + (note ? ": " + note : ""), S.user.name); audit("item." + state, client(e.clientId).last);
  }
  function addItem(eid, form, payer, custom) {
    const e = eng(eid); S.items.push({ id: id("i"), engId: eid, form, payer: payer || null, custom: custom || null, state: "expected", source: "staff" });
    timeline(e, "Added item: " + (custom || FORMS[form].plain), S.user.name);
    if (e.status === "complete") { e.status = "in_progress"; e.next = nextAllowed(S.now); }
  }
  function pause(eid) { const e = eng(eid); if (["complete", "closed", "paused", "not_started"].includes(e.status)) return; e.prior = e.status; e.priorStuck = e.stuck; e.status = "paused"; e.next = null; settleQuiet(e); timeline(e, "Paused", S.user.name); audit("outreach.pause", client(e.clientId).last); }
  function resume(eid) { const e = eng(eid); if (e.status !== "paused") return; e.status = e.prior === "stuck" ? "in_progress" : e.prior || "in_progress"; e.stuck = null; e.step = 0; e.next = nextAllowed(new Date(S.now.getTime() + MIN)); timeline(e, "Resumed", S.user.name); }
  function fileName(c, e, d) { const clean = (s) => String(s || "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, ""); return [clean(c.last), clean(c.first), e.year, d.form, clean(d.payer)].filter(Boolean).join("_") + ".pdf"; }
  function deliver(eid, by) {
    const e = eng(eid), c = client(e.clientId), docs = S.docs.filter((d) => d.engId === eid && d.state === "accepted" && hasContent(d)), who = by || S.user.name;
    const used = {}, nameOf = {}; docs.forEach((d) => { const base = fileName(c, e, d), k = base.toLowerCase(); used[k] = (used[k] || 0) + 1; nameOf[d.id] = used[k] === 1 ? base : base.replace(/\.pdf$/, "_" + used[k] + ".pdf"); });
    const files = docs.map((d) => nameOf[d.id]), missing = openItems(eid).map((i) => i.custom || FORMS[i.form].plain + (i.payer ? " (" + i.payer + ")" : ""));
    const manifest = ["item,file,received,channel"].concat(docs.map((d) => [d.form, nameOf[d.id], d.at.toISOString().slice(0, 16), d.channel].join(","))).concat(missing.map((m) => "MISSING," + m + ",,")).join("\n");
    docs.forEach((d) => { if (!d.deliveredAt) d.deliveredAt = new Date(S.now); });
    e.delivered = new Date(S.now); timeline(e, "Delivered " + files.length + " files to " + S.firm.delivery.folder + ". Tallyhound's copies are deleted " + (retain().afterDelivery ? "after " + retain().afterDelivery + " days" : "right away"), who); audit("export.deliver", c.last + ": " + files.length + " files", who);
    return { folder: S.firm.delivery.folder + "/" + e.year + "/" + c.last + ", " + c.first, files, missing, manifest };
  }
  /* Retention. Tallyhound is a pass-through, not a filing cabinet: the firm's storage holds the permanent copy.
     A document's picture, pages and everything read from it are deleted on a schedule. What stays is one line:
     which form, which year, which payer, when it arrived. That line keeps the checklist and next year's list working. */
  const RETAIN_DEFAULT = { afterDelivery: 7, rejected: 7, unmatched: 30, max: 400 }, RETAIN_LIMIT = { afterDelivery: [0, 365], rejected: [1, 90], unmatched: [1, 90], max: [30, 730] };
  const may = (lvl) => { const r = (S.user || {}).role; return lvl === "owner" ? r === "owner" : r !== "read_only"; };
  function retain() { const r = S.firm.retain = Object.assign({}, RETAIN_DEFAULT, S.firm.retain); return r; }
  function setRetain(k, v) { if (!may("owner") || !RETAIN_LIMIT[k]) return false; const L = RETAIN_LIMIT[k]; v = Math.round(+v); if (isNaN(v)) return false; retain()[k] = Math.min(L[1], Math.max(L[0], v)); audit("settings.retention", k + ": " + retain()[k] + " days"); return true; }
  const hasContent = (d) => !d.stripped && d.state !== "purged";
  // Keys of stored files whose bytes must now be deleted from object storage. The pipeline deletes them and clears the list.
  const forget = (d) => { if (d.fileKey) { (S.purgeFiles = S.purgeFiles || []).push(d.fileKey); d.fileKey = null; } };
  const masterFirst = () => { const v = S.firm.delivery || {}; return v.when === "arrival" && v.auto === "on" && !!v.provider && v.provider !== "Download"; };
  function strip(d, why) { if (!hasContent(d)) return false;
    // With real storage connected, a copy is never let go on schedule until the firm's own copy is confirmed in place.
    if (["delivered", "not needed"].includes(why) && S.firm.delivery && S.firm.delivery.physical && S.firm.delivery.provider !== "Download" && (d.hold === "storage" || (why === "delivered" && !(d.master && d.master.place === "final")))) return false; forget(d); d.image = null; d.pages = null; d.read = null; d.elements = []; d.versions = []; d.findings = []; d.recipientName = ""; d.fileKey = null; d.stripped = new Date(S.now); d.strippedWhy = why; return true; }
  /* T-115: once a month, one line in the audit trail that a firm can show an examiner: how many copies Tallyhound deleted on
     schedule last month, how many it holds now, and how old the oldest is. Written on the first sweep of each month, about the
     month before. Counts only. */
  const monthKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  function deletionEvidence() {
    const now = monthKey(S.now); if (S.firm.evidenceFor === now) return; const first = !S.firm.evidenceFor; S.firm.evidenceFor = now; if (first) return;   // nothing to report about a month before the firm began
    const prev = new Date(S.now.getFullYear(), S.now.getMonth() - 1, 1), pk = monthKey(prev), n = (S.firm.deletedBy || {})[pk] || 0, held = S.docs.filter(hasContent), oldest = held.length ? Math.floor(Math.max(...held.map((d) => (S.now - d.at) / DAY))) : 0;
    audit("retention.month", MONTHS[prev.getMonth()] + " " + prev.getFullYear() + ": " + n + " cop" + (n === 1 ? "y" : "ies") + " deleted on schedule. Held now: " + held.length + (held.length ? ", the oldest for " + oldest + " day" + (oldest === 1 ? "" : "s") : "") + ". Keep-for limits: " + retain().afterDelivery + " days after hand-off, " + retain().max + " at most", "Tallyhound");
    Object.keys(S.firm.deletedBy || {}).forEach((k) => { if (k < monthKey(new Date(S.now.getFullYear() - 2, S.now.getMonth(), 1))) delete S.firm.deletedBy[k]; });
  }
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function retentionSweep() {
    const r = retain(); let n = 0;
    S.docs.forEach((d) => { if (!hasContent(d)) return; const age = (S.now - d.at) / DAY;
      if (d.deliveredAt && (S.now - d.deliveredAt) / DAY >= r.afterDelivery) n += strip(d, "delivered") ? 1 : 0;
      else if (["rejected", "duplicate", "discarded"].includes(d.state) && age >= r.rejected) n += strip(d, "not needed") ? 1 : 0;
      else if (age >= r.max) n += strip(d, "limit") ? 1 : 0; });
    const old = S.tray.filter((y) => (S.now - y.at) / DAY >= r.unmatched);
    if (old.length) { old.forEach((y) => { const d = y.docId && S.docs.find((x) => x.id === y.docId); if (d) { d.state = "discarded"; n += strip(d, "unknown sender") ? 1 : 0; } }); S.tray = S.tray.filter((y) => !old.includes(y)); audit("retention.unmatched", old.length + " messages from unknown senders deleted", "Tallyhound"); }
    // files that arrived during a pause and were never claimed: the same outer limit applies
    if (S.held && S.held.length) { const gone = S.held.filter((h) => (S.now - new Date(h.at)) / DAY >= r.max); if (gone.length) { gone.forEach((h) => { if (h.fileKey) (S.purgeFiles = S.purgeFiles || []).push(h.fileKey); }); S.held = S.held.filter((h) => !gone.includes(h)); n += gone.length; } }
    if (n) { audit("retention.sweep", n + " document" + (n === 1 ? "" : "s") + " deleted from Tallyhound", "Tallyhound"); const mk = monthKey(S.now); S.firm.deletedBy = S.firm.deletedBy || {}; S.firm.deletedBy[mk] = (S.firm.deletedBy[mk] || 0) + n; }
    deletionEvidence();
    // deliver by itself when the firm asked for that and a real storage folder is connected
    if (S.firm.delivery && S.firm.delivery.auto === "on" && S.firm.delivery.provider && S.firm.delivery.provider !== "Download" && access().ok) S.engs.forEach((e) => { if ((["each", "arrival"].includes(S.firm.delivery.when) ? e.status !== "not_started" : ["complete", "closed"].includes(e.status)) && !e.purged && S.docs.some((d) => d.engId === e.id && d.state === "accepted" && !d.deliveredAt && hasContent(d))) deliver(e.id, "Tallyhound"); });
    return n;
  }
  // Staff can delete Tallyhound's copies for one client at any time. Collecting carries on.
  function deleteDocsNow(eid) { if (!may()) return 0; const e = eng(eid); if (!e) return 0; let n = 0; S.docs.forEach((d) => { if (d.engId === eid) n += strip(d, "staff") ? 1 : 0; }); if (n) { timeline(e, n + " document cop" + (n === 1 ? "y" : "ies") + " deleted from Tallyhound", S.user.name); audit("retention.manual", client(e.clientId).last + ": " + n + " documents"); } return n; }
  // What Tallyhound is holding right now, for the firm's own records and its written security plan.
  function dataMap() {
    const r = retain(), held = S.docs.filter(hasContent), del = S.docs.filter((d) => !hasContent(d)), due = held.filter((d) => d.deliveredAt).map((d) => d.deliveredAt.getTime() + r.afterDelivery * DAY).sort((a, b) => a - b)[0];
    return { clients: S.clients.length, docsHeld: held.length, docsDeleted: del.length, undelivered: held.filter((d) => d.state === "accepted" && !d.deliveredAt).length, oldestDays: held.length ? Math.floor(Math.max(...held.map((d) => (S.now - d.at) / DAY))) : 0, nextDeletion: due ? new Date(due) : null, messages: S.msgs.length, unknown: S.tray.length, retain: Object.assign({}, r), afterClose: S.firm.retention };
  }
  function closeEng(eid) { const e = eng(eid); settleQuiet(e); memoryWrite(e); e.status = "closed"; e.closedAt = new Date(S.now); e.purgeAfter = new Date(S.now.getTime() + S.firm.retention * DAY); e.next = null; timeline(e, "Closed. Documents purge after " + S.firm.retention + " days.", S.user.name); }
  function purge(eid, by) { const e = eng(eid), who = by || S.user.name; if (e && S.memory) S.memory = S.memory.filter((r) => r.clientId !== e.clientId); S.docs.filter((d) => d.engId === eid).forEach((d) => { forget(d); d.state = "purged"; d.image = null; d.pages = null; d.read = null; d.payer = ""; d.recipientName = ""; d.elements = []; d.versions = []; d.reasons = ["Deleted under the retention rule."]; d.findings = []; }); S.msgs.filter((m) => m.engId === eid).forEach((m) => { m.body = "(deleted)"; m.aiNote = null; m.understood = null; }); e.memory = []; e.purged = new Date(S.now); timeline(e, "Documents and message text deleted", who); audit("purge", client(e.clientId).last, who); }
  const STATE_TZ = { ET: "CT DE FL GA IN KY MA MD ME MI NC NH NJ NY OH PA RI SC VA VT WV DC", CT: "AL AR IA IL KS LA MN MO MS ND NE OK SD TN TX WI", MT: "CO ID MT NM UT WY", AZ: "AZ", PT: "CA NV OR WA", AKT: "AK", HT: "HI" };
  const ZONES = { ET: 1, CT: 0, MT: -1, AZ: -1, PT: -2, AKT: -3, HT: -4 }, ZNAME = { ET: "Eastern", CT: "Central", MT: "Mountain", AZ: "Arizona", PT: "Pacific", AKT: "Alaska", HT: "Hawaii" };
  /* Arizona and Hawaii keep standard time all year. While the rest of the country is on daylight time (second Sunday of March to
     the first Sunday of November) they sit one more hour behind it. */
  const NO_DST = { AZ: 1, HT: 1 };
  function usDst(d) { const y = d.getFullYear(), sunday = (m, n) => 1 + ((7 - new Date(y, m, 1).getDay()) % 7) + (n - 1) * 7; return d >= new Date(y, 2, sunday(2, 2), 2) && d < new Date(y, 10, sunday(10, 1), 2); }
  const zoneAt = (z, d) => ZONES[z] - (NO_DST[z] && usDst(d) ? 1 : 0);
  function zoneOf(v) { const t = String(v || "").trim().toUpperCase(); if (!t) return null; if (ZONES[t] !== undefined) return t; const byName = Object.keys(ZNAME).find((k) => t.startsWith(ZNAME[k].toUpperCase())); if (byName) return byName; return Object.keys(STATE_TZ).find((k) => STATE_TZ[k].split(" ").includes(t)) || null; }
  const firmZone = () => zoneOf(S.firm.tz) || "CT";
  /* T-47: with no state and no zone on file, the mobile number's area code is a fair guess at where the client lives. A guess
     only: a zone or state staff enter always wins, and a code that is not listed, or one that straddles two zones, means the
     firm's own time. People keep their numbers when they move, so the client page says when a zone is a guess. */
  const AREA_TZ = {
    ET: "201 202 203 207 212 215 216 220 223 227 229 231 234 239 240 248 252 260 267 269 272 276 283 301 302 304 305 313 315 317 321 324 326 329 330 332 336 339 347 351 352 363 380 386 401 404 407 410 412 413 419 423 434 440 443 445 463 470 472 475 478 484 502 508 513 516 517 518 540 551 561 567 570 571 574 582 585 586 603 606 607 609 610 614 616 617 624 631 640 645 646 656 667 678 680 681 689 703 704 706 716 717 718 724 727 728 729 732 734 740 743 754 757 762 765 770 772 774 781 786 802 803 804 810 812 813 814 821 826 828 835 838 839 843 845 848 854 856 857 859 860 862 863 864 865 878 904 908 910 912 914 917 919 929 930 934 937 941 943 947 948 954 959 973 978 980 984 989",
    CT: "205 210 214 217 218 219 224 225 228 235 251 254 256 262 270 274 281 309 312 314 316 318 319 320 325 327 331 334 337 346 353 361 364 405 409 414 417 430 432 447 464 469 479 501 504 507 512 515 531 534 539 557 563 572 573 580 601 608 612 615 618 629 630 636 641 651 659 660 662 682 708 712 713 715 726 730 731 737 763 769 773 779 806 815 816 817 830 832 847 861 870 872 901 903 913 918 920 931 936 938 940 945 952 956 972 979 985",
    MT: "303 307 385 406 435 505 575 719 720 801 915 970 983", AZ: "480 520 602 623 928",
    PT: "206 209 213 253 279 310 323 341 350 360 369 408 415 424 425 442 503 509 510 530 559 562 564 619 626 628 650 657 661 669 702 707 714 725 747 760 775 805 818 820 831 840 858 909 916 925 949 951 971",
    AKT: "907", HT: "808" };
  function areaZone(mobile) { const d = String(mobile || "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1"); if (d.length !== 10) return null; const a = d.slice(0, 3); return Object.keys(AREA_TZ).find((z) => AREA_TZ[z].split(" ").includes(a)) || null; }
  const zoneFor = (c) => (c && c.tz && ZONES[c.tz] !== undefined ? c.tz : c ? areaZone(c.mobile) : null);
  const tzOff = (c, d) => { const z = zoneFor(c); return z ? zoneAt(z, d || S.now) - zoneAt(firmZone(), d || S.now) : 0; };
  /* Sending hours are judged on the client's own clock. The engine clock is the firm's. */
  function allowedC(d, c) { return allowed(new Date(d.getTime() + tzOff(c, d) * HOUR)); }
  function nextAllowedC(d, c) { const o = tzOff(c, d) * HOUR; return new Date(nextAllowed(new Date(d.getTime() + o)).getTime() - o); }
  /* Reads real exports: quoted fields, commas inside quotes, semicolons or tabs, a byte order mark, blank lines, one Name column. */
  function parseCSV(text) {
    const src = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n"), firstLine = src.split("\n")[0] || "";
    const count = (ch) => firstLine.split(ch).length - 1, delim = count("\t") > count(",") && count("\t") >= count(";") ? "\t" : count(";") > count(",") ? ";" : ",";
    const rows = []; let row = [], cell = "", q = false;
    for (let k = 0; k < src.length; k++) {
      const ch = src[k];
      if (q) { if (ch === '"') { if (src[k + 1] === '"') { cell += '"'; k++; } else q = false; } else cell += ch; }
      else if (ch === '"' && cell.trim() === "") q = true;
      else if (ch === delim) { row.push(cell.trim()); cell = ""; }
      else if (ch === "\n") { row.push(cell.trim()); cell = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
      else cell += ch;
    }
    row.push(cell.trim()); if (row.some((x) => x !== "")) rows.push(row);
    const head = rows.shift() || [];
    /* Tax software exports carry far more than Tallyhound needs. Columns that hold an SSN, a date of birth, bank details,
       income or fees are marked sensitive: they are never offered for import and never leave the import screen. */
    const SENS = /\b(ssn|ss#|social|itin|tin|ein|fein|dob|birth|routing|bank|acct|account|password|pin|agi|income|refund|balance|fee|invoice|wage|dependent)\b/i, ssnLike = /^\d{3}-?\d{2}-?\d{4}$/, dateLike = /^(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-](19|20)\d\d$/;
    const sensitive = head.map((h, i) => { const hd = String(h).replace(/[_.]/g, " "); if (SENS.test(hd)) return true; const vals = rows.slice(0, 25).map((r) => r[i] || "").filter(Boolean); return vals.length >= 2 && vals.filter((v) => ssnLike.test(v.replace(/\s/g, ""))).length / vals.length > 0.6 && !/phone|mobile|cell|zip|postal|id|number|code|ref/i.test(hd) ? true : vals.length >= 2 && /birth|dob/i.test(hd) && vals.every((v) => dateLike.test(v)); });
    // Score each column for each field, then give every field its best column. A spouse's or preparer's details never win.
    const score = (h, f) => { const x = " " + String(h).toLowerCase().replace(/[_.\-\/]+/g, " ") + " "; if (/spouse|\bsp\b|dependent|\bdep\b|joint|secondary|partner/.test(x)) return 0;
      const tp = /taxpayer|\btp\b|primary|client/.test(x) ? 1 : 0;
      if (f === "first") return /first|given|\bfname\b/.test(x) ? 5 + tp : 0;
      if (f === "last") return /last|surname|family name|\blname\b/.test(x) ? 5 + tp : 0;
      if (f === "name") return /first|last|file|user|firm|company|business|preparer|staff|employer/.test(x) ? 0 : /^ (client |full |taxpayer |primary )?name $|^ client $|^ taxpayer $/.test(x) ? 5 : / name /.test(x) ? 2 : 0;
      if (f === "email") return /preparer|staff|firm/.test(x) ? 0 : /mail/.test(x) ? 5 + tp : 0;
      if (f === "mobile") return /fax|work|office|business|preparer|firm/.test(x) ? 0 : /mobile|cell|\btext\b|sms/.test(x) ? 8 + tp : /home/.test(x) ? 2 : /phone|\btel\b/.test(x) ? 4 + tp : 0;
      if (f === "preparer") return /prepar|staff|assigned|owner|partner in charge|\bpic\b/.test(x) && !/mail|phone|fee/.test(x) ? 5 : 0;
      if (f === "lang") return /lang/.test(x) ? 5 : 0;
      if (f === "tz") return /time zone|timezone/.test(x) ? 6 : /^ (res(ident)? |home |mailing )?state $|^ st $/.test(x) ? 5 : 0;
      if (f === "entity") return /business name|company|entity name|organi[sz]ation|trust name|\bdba\b|legal name/.test(x) && !/type|phone|mail/.test(x) ? 6 : 0;
      if (f === "rtype") return /return type|entity type|form type|tax form|return form|^ type $|filing type/.test(x) ? 6 : 0;
      if (f === "docs") return /document|\bforms?\b|checklist|\bneeds?\b|expected/.test(x) && !/fee|date|sent|received/.test(x) ? 5 : 0;
      if (f === "ref") return /client (id|no|number|code|#)|^ (id|client id|account id|cust(omer)? (id|no)|file (no|number)|client number) $/.test(x) ? 5 : 0;
      return 0; };
    const map = head.map(() => "");
    ["first", "last", "email", "mobile", "ref", "preparer", "lang", "tz", "docs", "entity", "rtype", "name"].forEach((f) => { let best = -1, bs = 0; head.forEach((h, i) => { if (sensitive[i] || map[i]) return; const sc = score(h, f); if (sc > bs) { bs = sc; best = i; } }); if (best >= 0 && !(f === "name" && map.includes("first") && map.includes("last"))) map[best] = f; });
    return { head, map, rows, delim, sensitive };
  }
  function importRows(parsed) {
    const sens = parsed.sensitive || [], map = parsed.map.map((m, i) => (sens[i] ? "" : m)), out = { ok: 0, updated: 0, rejects: [], skippedColumns: parsed.head.filter((h, i) => sens[i]) }, idx = (f) => map.indexOf(f);
    const nice = (v) => (v && v === v.toUpperCase() && /[A-Z]{2}/.test(v) ? v.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : v);
    const shown = (r) => map.map((m, i) => (m ? r[i] || "" : "")).filter(Boolean).join(", ");   // a rejected row is shown without its ignored columns
    parsed.rows.forEach((r, n) => {
      const clean = (v) => String(v || "").replace(/[<>]/g, "").replace(/^[=+\-@\t]+/, "").replace(/\s+/g, " ").trim().slice(0, 60);
      const g = (f) => (idx(f) >= 0 ? r[idx(f)] || "" : ""), nm = nice(clean(g("name")).replace(/\s*(&| and ).*$/i, "").replace(/\s+(jr|sr|ii|iii|iv)\.?(?=\s*,|\s*$)/i, "")), ref = clean(g("ref")).slice(0, 40), parts = nm.includes(",") ? nm.split(",").map((x) => x.trim()).reverse() : nm.split(" ");
      const first = nice(clean(g("first"))) || (nm ? parts.slice(0, -1).join(" ") || parts[0] : "") || clean(g("entity")).slice(0, 80), last = nice(clean(g("last"))) || (nm && parts.length > 1 ? parts[parts.length - 1] : ""), email = g("email").toLowerCase().trim(), entity = clean(g("entity")).slice(0, 80), rtype = returnType(g("rtype")) || (entity ? "1120S" : "");
      let mob = g("mobile").replace(/\D/g, ""); if (mob.length === 11 && mob[0] === "1") mob = mob.slice(1);
      let why = null;
      // The same client ID as an existing client means "update", so a fresh export can be imported again without duplicates.
      const same = ref && S.clients.find((c) => c.ref === ref);
      if (same) { let ch = 0; if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email !== same.email && !S.clients.some((c) => c !== same && c.email === email)) { same.email = email; same.emailOk = true; ch++; } if (mob.length === 10 && mob !== same.mobile && !S.clients.some((c) => c !== same && c.mobile === mob)) { same.mobile = mob; if (same.textConsent === "given") { same.textConsent = "none"; same.consentLog.push({ at: new Date(S.now), event: "Mobile number changed by import. Consent must be given again." }); } ch++; } if (ch) out.updated++; else out.same = (out.same || 0) + 1; return; }
      if (!first || (!last && !entity)) why = "Name missing"; else if (!email && !mob) why = "Needs an email or a mobile number"; else if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) why = "Email is not valid"; else if (mob && mob.length !== 10) why = "Mobile must have 10 digits";
      else { const dup = S.clients.find((c) => (email && c.email === email) || (mob && c.mobile === mob)); if (dup) why = dup.first.toLowerCase() === first.toLowerCase() && dup.last.toLowerCase() === last.toLowerCase() ? "Duplicate of an existing client" : ""; if (dup && !why) out.shared = (out.shared || 0) + 1; }   // a household can share a phone or an email: replies are matched to the right person by the name on the document
      if (why) { out.rejects.push({ row: n + 2, why, data: shown(r) }); return; }
      const c = { id: id("c"), ref: ref || "", first, last, email, mobile: mob, emailOk: true, lang: /es|span/i.test(g("lang")) ? "es" : "en", preparer: (S.users.find((u) => u.first.toLowerCase() === g("preparer").toLowerCase()) || S.users[1] || S.users[0]).id, textConsent: "none", consentLog: [], notes: "", tz: zoneOf(g("tz")) };
      S.clients.push(c); if (entity) c.entity = entity; const e = newEng(c.id, rtype), want = listForms(g("docs")), byType = RETURNS[e.type] && RETURNS[e.type].items; (want.length ? want : byType || (S.firm.defaultItems || ["W2", "1098"])).forEach((f) => S.items.push({ id: id("i"), engId: e.id, form: f, payer: null, state: "expected", source: want.length ? "import" : "template" })); if (want.length) out.withLists = (out.withLists || 0) + 1; out.ok++;
    });
    audit("import", out.ok + " clients imported, " + out.updated + " updated, " + out.rejects.length + " rejected" + (out.skippedColumns.length ? ". Never imported: " + out.skippedColumns.join(", ") : "")); return out;
  }
  // "W-2, 1099-INT; mortgage" in a spreadsheet cell becomes a checklist. Anything not recognised is left for a person to add.
  function listForms(text) { const got = []; String(text || "").split(/[,;|\/+\n]+/).forEach((t) => { const hit = FORMWORDS.find((w) => w[1].test(t)); if (hit && FORMS[hit[0]] && !got.includes(hit[0])) got.push(hit[0]); }); return got; }
  function newEng(cid, type) { const prev = S.engs.filter((x) => x.clientId === cid).slice(-1)[0]; const e = { id: id("e"), clientId: cid, year: S.firm.taxYear || 2026, type: RETURNS[type] ? type : (prev && RETURNS[prev.type] ? prev.type : "1040"), status: "not_started", stuck: null, confirmed: false, next: null, step: 0, qIdx: QUESTIONS.length, illeg: 0, timeline: [] }; S.engs.push(e); return e; }

  /* ---------- seed ---------- */
  function seed() {
    seq = 0;
    const now = new Date(2027, 0, 25, 10, 5, 0);
    S = {
      now, firm: { name: "Larkin & Poe CPAs", sender: "Larkin & Poe CPAs", phone: "(615) 555-0100", email: "docs@larkinpoe.example", tz: "Central", quietStart: 8, quietEnd: 20, newDayHour: 10, liveMin: 30, acceptAt: 0.9, qualityMin: 0.55, retention: 90, askQuestions: true, senderStatus: "approved", stopped: false, templates: { en: {}, es: {} }, delivery: { provider: "Google Drive", folder: "Client Tax Docs", auto: "off" }, plan: "Practice", included: 500 },
      users: [{ id: "u1", first: "Morgan", name: "Morgan Larkin", role: "owner", email: "morgan@larkinpoe.example" }, { id: "u2", first: "Alex", name: "Alex Reyes", role: "staff", email: "alex@larkinpoe.example" }, { id: "u3", first: "Mia", name: "Mia Tran", role: "staff", email: "mia@larkinpoe.example" }, { id: "u4", first: "Sam", name: "Sam Ortiz", role: "read_only", email: "sam@larkinpoe.example" }],
      clients: [], engs: [], items: [], msgs: [], docs: [], tasks: [], tray: [], audit: []
    };
    S.user = S.users[0];
    const names = [["Dana", "Okafor"], ["Luis", "Peña"], ["Wei", "Chen"], ["Ana", "Diaz"], ["Priya", "Nair"], ["Tom", "Becker"], ["Grace", "Kim"], ["Omar", "Haddad"], ["Ruth", "Alvarez"], ["Ben", "Carter"], ["Nora", "Lindqvist"], ["Jamal", "Brooks"], ["Elena", "Rossi"], ["Kofi", "Mensah"], ["Hana", "Sato"], ["Carlos", "Mejía"], ["Ivy", "Nguyen"], ["Peter", "Walsh"], ["Sofia", "Marin"], ["Raj", "Patel"], ["Lucy", "Evans"], ["Marco", "Silva"], ["Tess", "Hoffman"], ["Dev", "Shah"]];
    const payers = { W2: ["Acme Logistics", "Nashville Schools", "Riverbend Health", "Cumberland Foods"], "1099INT": ["First Farmers Bank", "Pinnacle Savings"], "1099DIV": ["Fidelity"], "1098": ["Regions Mortgage", "Truist Home Loans"], "1099NEC": ["Brightline Media"], "1095A": ["Health Marketplace"], "1098E": ["Nelnet"], "1099R": ["Vanguard"], SSA1099: ["Social Security Administration"], "1099CONS": ["Charles Schwab"] };
    const sets = [["W2", "W2", "1098", "1099INT", "1099DIV", "1095A"], ["W2", "1099INT", "1098E"], ["W2", "1098", "1099INT"], ["W2", "1099NEC", "1099INT"], ["SSA1099", "1099R", "1099INT", "1099CONS"], ["W2", "W2", "1098"]];
    const scen = ["hero", "progress", "stuck_q", "stuck_none", "complete", "complete", "progress", "awaiting", "not_started", "not_started_unconf", "complete", "paused", "progress", "stuck_noreply", "complete", "progress_es", "review", "complete", "not_started", "progress", "opted", "complete", "awaiting", "progress"];
    names.forEach((nm, n) => {
      const sc = scen[n], c = { id: id("c"), first: nm[0], last: nm[1], email: nm[0].toLowerCase() + "@example.com", mobile: "615555" + pad(n + 10) + pad(n + 31), emailOk: true, lang: sc === "progress_es" ? "es" : "en", preparer: n % 2 ? "u3" : "u2", textConsent: "given", consentLog: [{ at: new Date(now - 6 * DAY), what: "Given (page), wording v1", channel: "text" }], notes: "", spouse: n === 0 ? { first: "Sam", last: "Okafor" } : null };
      S.clients.push(c); const e = newEng(c.id); e.confirmed = true;
      const forms = sets[n % sets.length]; const used = {};
      forms.forEach((f) => { used[f] = (used[f] || 0); const p = (payers[f] || [null])[used[f] % (payers[f] || [null]).length]; used[f]++; S.items.push({ id: id("i"), engId: e.id, form: f, payer: p, state: "expected", source: "prior_year" }); });
      const its = itemsOf(e.id), t0 = new Date(now - 5 * DAY);
      const rec = (k) => its.slice(0, k).forEach((it, j) => { const d = { id: id("d"), engId: e.id, clientId: c.id, form: it.form, year: 2026, payer: it.payer, recipient: "self", qualityKind: "clear", quality: 0.92, conf: 0.97, modelConf: "high", channel: j % 3 === 2 ? "email" : "text", at: new Date(t0.getTime() + j * 5 * HOUR), state: "accepted", findings: [], reasons: ["Form name and year found on the page.", "Matches the checklist item for " + it.payer + "."], versions: [{ v: 1, by: "system", form: it.form, year: 2026, payer: it.payer }], itemId: it.id }; S.docs.push(d); it.state = "received"; it.docId = d.id; });
      const out = (tpl, it, ago) => S.msgs.push({ id: id("m"), engId: e.id, dir: "out", kind: "auto", tpl, body: fill(tpl, c, e, { item: it }), channel: "text", at: new Date(now - ago), status: "delivered" });
      const inn = (body, ago) => S.msgs.push({ id: id("m"), engId: e.id, dir: "in", kind: "client", body, channel: "text", at: new Date(now - ago) });
      e.startedAt = t0; e.timeline.push({ at: t0, text: "Outreach started", actor: "Alex Reyes" });
      if (sc === "hero" || sc.startsWith("progress") || sc === "review") {
        const k = sc === "hero" ? 2 : 1 + (n % 2); out("M2", null, 5 * DAY); out("M3", its[0], 5 * DAY - HOUR); rec(k); inn("[photo]", 4 * DAY); const nx = itemsOf(e.id).find((i) => i.state === "expected"); nx.state = "requested"; out("M4", nx, sc === "hero" ? 2 * DAY + 5 * MIN : DAY);
        e.status = "in_progress"; e.step = 1; e.lastOut = new Date(now - DAY); e.lastIn = new Date(now - 4 * DAY); e.next = sc === "hero" ? new Date(now.getTime() - MIN) : nextAllowed(new Date(now.getTime() + (n % 3) * DAY + 3 * HOUR));
        if (sc === "review") { const d = { id: id("d"), engId: e.id, clientId: c.id, form: "1099NEC", year: 2026, payer: "Rvr Cty Logistcs", recipient: "self", qualityKind: "clear", quality: 0.7, conf: 0.75, modelConf: "medium", channel: "text", at: new Date(now - 3 * HOUR), state: "in_review", findings: [], reasons: ["Payer name is hard to read."], versions: [{ v: 1, by: "system", form: "1099NEC", year: 2026, payer: "Rvr Cty Logistcs" }] }; S.docs.push(d); S.tasks.push({ id: id("t"), kind: "document", reason: "Low confidence", engId: e.id, docId: d.id, at: new Date(now - 3 * HOUR), status: "open" }); }
      } else if (sc === "stuck_q") { out("M3", its[0], 4 * DAY); rec(3); inn("is my HSA deductible?", 26 * HOUR); out("M14", null, 26 * HOUR - MIN); e.status = "stuck"; e.stuck = "question_waiting"; e.lastIn = new Date(now - 26 * HOUR); S.tasks.push({ id: id("t"), kind: "question", reason: "Question", engId: e.id, msgId: S.msgs[S.msgs.length - 2].id, at: new Date(now - 26 * HOUR), status: "open" }); }
      else if (sc === "stuck_none") { out("M3", its[0], 4 * DAY); rec(1); const it = itemsOf(e.id).find((i) => i.state === "expected"); it.state = "says_none"; inn("I don't have that one this year", 30 * HOUR); out("M19X", null, 30 * HOUR - MIN); itemsOf(e.id).filter((i) => i.state === "expected").forEach((i) => { i.state = "received"; }); e.status = "stuck"; e.stuck = "client_says_none"; e.lastIn = new Date(now - 30 * HOUR); S.tasks.push({ id: id("t"), kind: "says_none", reason: "Client says none", engId: e.id, itemId: it.id, at: new Date(now - 30 * HOUR), status: "open" }); }
      else if (sc === "stuck_noreply") { out("M3", its[0], 16 * DAY); out("M6", null, 2 * DAY); its[0].state = "requested"; e.status = "stuck"; e.stuck = "no_reply"; e.lastOut = new Date(now - 2 * DAY); }
      else if (sc === "complete") { out("M3", its[0], 5 * DAY); rec(its.length); out("M13", null, DAY + n * HOUR); e.status = "complete"; e.completedAt = new Date(now - DAY - n * HOUR); e.lastIn = e.completedAt; if (n % 3 === 1) e.delivered = new Date(now - 20 * HOUR); }
      else if (sc === "awaiting") { c.textConsent = "invited"; c.consentLog = []; e.status = "awaiting_consent"; e.invitedAt = new Date(now - 2 * DAY); S.msgs.push({ id: id("m"), engId: e.id, dir: "out", kind: "auto", tpl: "M1", body: fill("M1", c, e, {}), channel: "email", at: e.invitedAt, status: "delivered" }); e.next = new Date(e.invitedAt.getTime() + 3 * DAY); }
      else if (sc === "not_started" || sc === "not_started_unconf") { c.textConsent = "none"; c.consentLog = []; e.confirmed = sc === "not_started"; e.startedAt = null; e.timeline = []; }
      else if (sc === "paused") { out("M3", its[0], 4 * DAY); rec(1); e.status = "paused"; e.prior = "in_progress"; }
      else if (sc === "opted") { out("M3", its[0], 4 * DAY); rec(1); inn("STOP", 2 * DAY); c.textConsent = "withdrawn"; c.email = ""; c.consentLog.push({ at: new Date(now - 2 * DAY), what: "Withdrawn by STOP", channel: "text" }); e.status = "opted_out"; e.stuck = "opted_out"; }
    });
    const REV = { W2: "w2", "1098": "homeowner", "1099INT": "interest", "1099DIV": "investments", "1099CONS": "brokerage", "1099NEC": "selfEmp", "1095A": "market", "1098E": "studentLoan", "1099R": "retire", SSA1099: "ss" };
    S.clients.forEach((c) => { c.profile = {}; T_items(c).forEach((i) => { if (REV[i.form]) c.profile[REV[i.form]] = true; }); });
    const dana = S.clients[0]; Object.assign(dana.profile, { childcare: true, charity: true });
    const ben = S.clients.find((c) => c.last === "Carter"); if (ben) Object.assign(ben.profile, { newJob: true, hsa: true });
    S.firm.docCheck = true; S.firm.elemOff = {};
    S.firm.hound = { mode: "autopilot", aiLive: false, aiWrite: true, replyV2: "on", intensity: "steady", voice: "professional", tone: "warm", persona: "Tallyhound", emailAfter: 2, slaHours: 4, pauseDays: 3, callTask: true };
    S.alerts = []; S.hlog = [];
    T_eng(dana).memory = [{ at: new Date(now - 4 * DAY), text: "Sam handles the bank and brokerage paperwork", source: "Claude" }]; T_eng(dana).target = new Date(2027, 1, 12, 17); T_eng(dana).hours = [19, 20, 19, 18];
    const wei = S.clients.find((c) => c.last === "Chen"); if (wei) { T_eng(wei).memory = [{ at: new Date(now - 2 * DAY), text: "Prefers texts in the evening", source: "Claude" }]; T_eng(wei).hours = [19, 19, 20]; S.tasks.filter((t) => t.kind === "question").forEach((t) => { t.category = "tax_question"; t.reason = "Tax question"; t.summary = "Wei asked whether an HSA contribution is deductible."; t.suggest = "Hi Wei, good question. HSA contributions are something I'll go over with you when we review your return. For now, if you have your HSA statement (Form 5498-SA), please send a photo."; t.suggestBy = "Claude"; }); }
    const kofi = S.clients.find((c) => c.last === "Mensah"); if (kofi) S.tasks.push({ id: id("t"), kind: "call", reason: "Call the client", engId: T_eng(kofi).id, at: new Date(now - 2 * DAY), status: "open", script: "Hi Kofi, it's Mia at Larkin & Poe CPAs. We're still missing your W-2 from Acme Logistics for your return. Is there anything making it hard to get? You can text a photo to the same number we've been using." });
    S.engs.forEach((e) => { if (!e.memory) e.memory = []; });
    const ago = (h) => new Date(now - h * HOUR);
    [[wei, "high", "sla", "Wei Chen's tax question has waited over 4 hours for a person.", 22], [kofi, "medium", "call", "Kofi Mensah has not replied to 4 reminders. A call task with a script is ready.", 48], [S.clients.find((c) => c.last === "Evans"), "high", "optout", "Lucy Evans replied STOP with documents still missing and has no email on file.", 47]].forEach((a) => { if (a[0]) S.alerts.push({ id: id("a"), at: ago(a[4]), engId: T_eng(a[0]).id, level: a[1], kind: a[2], text: a[3], key: a[2] + T_eng(a[0]).id, read: false }); });
    [[dana, "read", "Dana sent an interest statement by text", "Form name and year found on the page. Every required part is present. Matches the checklist item.", "Claude", 96], [dana, "schedule", "Next follow-up for Dana: Mon 1/25 7 pm", "Dana usually replies around 7 pm, so it goes then.", "Rules", 50], [wei, "handoff", "Handed to Mia: tax question", "Tallyhound only handles document collection. A suggested reply is ready for staff to edit.", "Claude", 26], [kofi, "escalate", "Also sent by email, because texts went unanswered", "2 text reminders without a reply", "Rules", 120]].forEach((x) => { if (x[0]) S.hlog.push({ id: id("h"), at: ago(x[5]), engId: T_eng(x[0]).id, kind: x[1], text: x[2], why: x[3], model: x[4] }); });
    S.hlog.sort((a, b) => b.at - a.at);
    S.msgs.sort((a, b) => a.at - b.at);
    S.tray.push({ id: id("y"), docId: null, text: null, from: "(615) 555-0177", at: new Date(now - 2 * HOUR), channel: "text", spec: { form: "W2", year: 2026, payer: "Cumberland Foods" }, guess: "Number is one digit away from Ben Carter" });
    S.audit.push({ at: new Date(now - 5 * DAY), actor: "Alex Reyes", action: "outreach.start", detail: "20 clients" }, { at: new Date(now - 6 * DAY), actor: "Morgan Larkin", action: "settings.cadence", detail: "Reminder days 2, 5, 9, 14" }, { at: new Date(now - 7 * DAY), actor: "Alex Reyes", action: "import", detail: "24 clients imported, 0 rejected" });
    if (!Array.isArray(S.archive)) S.archive = [];
    retain();
    S.usage = {}; { const keep = S.now; S.msgs.forEach((m) => { S.now = m.at; if (m.channel !== "text") { if (m.dir === "out") meter("email"); return; } if (m.dir === "out" && m.status === "delivered") meter("segOut", segs(m.body)); else if (m.dir === "in" && !m.docId && !/^\[/.test(m.body)) meter("segIn", segs(m.body)); }); S.docs.forEach((d) => { S.now = d.at; meter("docRead"); if (d.channel === "text") meter("mmsIn"); }); S.now = keep; }
  }

  function T_eng(c) { return engOf(c.id); }
  function T_items(c) { const e = engOf(c.id); return e ? S.items.filter((i) => i.engId === e.id) : []; }
  seed();
  /* ---------- save, load, blank workspace (used by the app's storage and by the production adapter) ---------- */
  function dump() {
    const walk = (v) => { if (v instanceof Date) return { $d: v.toISOString() }; if (Array.isArray(v)) return v.map(walk); if (v && typeof v === "object") { const o = {}; for (const k in v) { if (k === "user" && v === S) continue; if (k === "hold" && v === S) continue; if (k.charAt(0) === "_") continue; if (k === "image" && typeof v[k] === "string" && v[k].indexOf("blob:") === 0) continue; o[k] = walk(v[k]); } return o; } return v; };
    return JSON.stringify({ v: 1, seq, userId: S.user ? S.user.id : null, state: walk(S) });
  }
  function load(json) {
    const o = typeof json === "string" ? JSON.parse(json) : json; if (!o || o.v !== 1 || !o.state) throw new Error("Not a Tallyhound workspace");
    const walk = (v) => { if (Array.isArray(v)) return v.map(walk); if (v && typeof v === "object") { if (typeof v.$d === "string" && Object.keys(v).length === 1) return new Date(v.$d); const r = {}; for (const k in v) r[k] = walk(v[k]); return r; } return v; };
    const N = walk(o.state);
    ["clients", "engs", "items", "msgs", "docs", "tasks", "users"].forEach((k) => { if (!Array.isArray(N[k])) throw new Error("Not a Tallyhound workspace: " + k + " is missing"); });
    if (!N.firm || typeof N.firm !== "object" || !N.users.length) throw new Error("Not a Tallyhound workspace: firm is missing");
    ["tray", "audit", "alerts", "hlog", "archive", "barks", "memory"].forEach((k) => { if (!Array.isArray(N[k])) N[k] = []; });
    if (!N.usage || typeof N.usage !== "object") N.usage = {};
    if (N.firm) N.firm.retain = Object.assign({}, RETAIN_DEFAULT, N.firm.retain);
    const HD = { mode: "copilot", aiLive: false, aiWrite: true, replyV2: "shadow", intensity: "steady", voice: "professional", tone: "warm", persona: "", emailAfter: 2, slaHours: 4, pauseDays: 3, callTask: true }; N.firm.hound = N.firm.hound || {}; Object.keys(HD).forEach((k) => { if (N.firm.hound[k] === undefined) N.firm.hound[k] = HD[k]; });
    N.firm.templates = N.firm.templates || {}; if (!N.firm.templates.en) N.firm.templates.en = {}; if (!N.firm.templates.es) N.firm.templates.es = {}; if (!(N.now instanceof Date)) N.now = new Date();
    S = N; seq = +o.seq || 0; S.hold = null; S.user = S.users.find((u) => u.id === o.userId) || S.users[0];
    S.msgs.forEach((m) => { if (m.status === "writing") m.status = m.after || "delivered"; });
    return S;
  }
  function blank(opt) {
    seed(); opt = opt || {};
    ["clients", "engs", "items", "msgs", "docs", "tasks", "tray", "audit", "alerts", "hlog", "archive", "barks", "memory"].forEach((k) => { S[k] = []; }); S.usage = {};
    S.firm.delivery = { provider: "Download", folder: "Client Tax Docs", auto: "off" }; S.firm.verified = opt.verified === false ? false : true; S.firm.retain = Object.assign({}, RETAIN_DEFAULT);
    seq = 0; S.now = opt.now || new Date(); S.firm.createdAt = new Date(S.now); S.firm.taxYear = opt.taxYear || S.firm.taxYear || 2026;
    if (opt.plan && PLANS.some((p) => p[0] === opt.plan)) { S.firm.plan = opt.plan; S.firm.billing = { state: "active", plan: opt.plan, since: new Date(S.now) }; } else { S.firm.plan = "Trial"; S.firm.billing = { state: "trial", plan: null, trialEnds: new Date(S.now.getTime() + TRIAL_DAYS * DAY) }; }
    Object.assign(S.firm, { name: opt.name || "New firm", sender: opt.sender || opt.name || "New firm", phone: opt.phone || "", email: opt.email || "", senderStatus: opt.senderStatus || (opt.plan ? "submitted" : "none"), stopped: false, templates: { en: {}, es: {} } });
    S.firm.hound.mode = opt.mode || "copilot"; S.firm.hound.replyV2 = opt.replyV2 === "on" ? "on" : "shadow";   // a real firm starts in shadow (docs/REBRAND.md): the new reply reading is recorded, not acted on, until an owner switches it on
    S.users = (opt.users && opt.users.length ? opt.users : [{ id: "u1", first: "Owner", name: "Owner", role: "owner", email: opt.email || "" }]); S.user = S.users[0];
    return S;
  }
  function setNow(d) { S.now = d; }
  function setUser(uid) { const u = S.users.find((x) => x.id === uid); if (u) S.user = u; return !!u; }
  /* ---------- the check-in: quick taps from the client, a proposed checklist for the firm ---------- */
  const CHECKQ = [
    ["w2", "A job with a W-2", "Un trabajo con W-2"], ["selfEmp", "Freelance or contract work", "Trabajo independiente o por contrato"], ["gig", "Payments through apps like PayPal or Venmo", "Pagos por aplicaciones como PayPal o Venmo"],
    ["interest", "Bank interest", "Intereses bancarios"], ["investments", "Dividends", "Dividendos"], ["brokerage", "Sold stocks, funds or crypto", "Vendió acciones, fondos o cripto"],
    ["retire", "Money out of a retirement account", "Retiros de una cuenta de jubilación"], ["ss", "Social Security", "Seguro Social"],
    ["homeowner", "A home with a mortgage", "Una casa con hipoteca"], ["rental", "A rental property", "Una propiedad de alquiler"], ["k1", "A share in a partnership or S corp", "Parte de una sociedad o S corp"],
    ["student", "College tuition", "Matrícula universitaria"], ["studentLoan", "Student loan payments", "Pagos de préstamos estudiantiles"], ["market", "Marketplace health insurance", "Seguro médico del mercado"],
    ["hsa", "A health savings account", "Una cuenta de ahorros de salud"], ["childcare", "Paid for childcare", "Pagó por cuidado de niños"], ["charity", "Gave to charity", "Donaciones a caridad"], ["estPay", "Made estimated tax payments", "Hizo pagos estimados de impuestos"],
    ["unemp", "Unemployment pay or a state tax refund", "Desempleo o un reembolso estatal"], ["misc", "Prizes, royalties or other 1099 income", "Premios, regalías u otros ingresos 1099"]
  ];
  FACTS.push(["unemp", "Got unemployment or a state refund"], ["misc", "Other 1099 income"]); RULES.unemp = ["1099G"]; RULES.misc = ["1099MISC"];
  /* Forms where a name makes the request clearer, and what to call that name when asking the client. */
  const PAYERQ = { W2: ["Employer", "Empleador"], "1099NEC": ["Who paid you", "Quién le pagó"], "1099K": ["App or platform", "Aplicación o plataforma"], "1099INT": ["Bank", "Banco"], "1099DIV": ["Fund or broker", "Fondo o corredor"], "1099CONS": ["Broker", "Corredor"], "1099R": ["Plan or company", "Plan o compañía"], "1098": ["Lender", "Prestamista"], K1: ["Partnership or company", "Sociedad o compañía"], "1098T": ["School", "Escuela"], "1098E": ["Loan servicer", "Administrador del préstamo"], CHILDCARE: ["Provider", "Proveedor"], "1099MISC": ["Who paid you", "Quién le pagó"] };
  const cleanName = (v) => String(v || "").replace(/[<>{}]/g, "").replace(/^[=+\-@\t]+/, "").replace(/\s+/g, " ").trim().slice(0, 60);
  const TOPICS = [["brokerage", /\b(sold|selling|cashed out)\b.{0,30}\b(stocks?|shares|funds?|crypto|bitcoin|investments?)\b/i, "selling investments"], ["selfEmp", /\b(started|opened|launched)\b.{0,20}\b(business|llc|company)\b|\bfreelanc|\bside (gig|job|hustle)\b|\bself[- ]employed\b|\b1099 work\b/i, "self-employed work"],
    ["newJob", /\b(new|second|another|changed|switched) jobs?\b|\bgot a job\b/i, "a new job"], ["homeowner", /\b(bought|purchased|closed on)\b.{0,20}\b(house|home|condo)\b|\brefinanc/i, "buying or refinancing a home"],
    ["childcare", /\bdaycare\b|\bchild ?care\b|\bnanny\b|\bhad a baby\b/i, "childcare costs"], ["rental", /\brent(ed|ing) out\b|\bairbnb\b|\brental (property|income)\b|\btenants?\b/i, "rental income"],
    ["student", /\btuition\b|\b(started|in|at) college\b/i, "college tuition"], ["retire", /\b(withdrew|took money|cashed out|rolled over|rollover)\b.{0,30}\b(401k|401\(k\)|ira|retirement|pension)\b|\bretired\b/i, "a retirement account"],
    ["market", /\bhealthcare\.gov\b|\bmarketplace (plan|insurance)\b|\bobamacare\b/i, "marketplace insurance"], ["k1", /\b(partnership|s[- ]corp)\b/i, "a partnership or S corp"],
    ["unemp", /\bunemployment\b|\blaid off\b|\blost my job\b/i, "unemployment"]];
  const liveItem = (i) => !["removed", "waived"].includes(i.state);
  function checkinPrefill(eid) {
    const e = eng(eid), c = client(e.clientId), items = itemsOf(eid).filter(liveItem), facts = {};
    CHECKQ.forEach((q) => { facts[q[0]] = !!((c.profile || {})[q[0]]) || (RULES[q[0]] || []).some((f) => items.some((i) => i.form === f)); });
    return { facts, w2: Math.max(1, items.filter((i) => i.form === "W2").length), last: items.filter((i) => i.form !== "PRIOR").map((i) => ({ form: i.form, payer: i.payer || "" })), returning: items.some((i) => i.source === "prior_year" || i.source === "last_season") };
  }
  function sendCheckin(eid) {
    if (S.firm.verified === false) return FIRMCHECK;
    const e = eng(eid), c = client(e.clientId);
    if (!access().ok) return access().reason;
    if (e.checkin && e.checkin.doneAt) return "This client already answered the questions";
    if (["in_progress", "stuck"].includes(e.status)) { if (e.checkin) return "The questions were already sent to this client"; if (c.textConsent !== "given") return "This client has not turned texting on yet"; return questionsAfterOptIn(e, c, S.user.name) ? null : "The questions could not be sent by text right now"; }
    if (e.status !== "not_started") return "Collecting has already started for this client";
    if (trialFull(e)) return trialFull(e);
    const ch = c.textConsent === "given" && c.mobile && S.firm.senderStatus === "approved" ? "text" : c.email && c.emailOk ? "email" : null;
    if (!ch) return "No working email or text number for this client";
    if (!allowedC(S.now, c)) { e.checkin = { sentAt: new Date(S.now), reminded: false, pending: ch }; timeline(e, "Check-in will go out when sending hours begin", S.user.name); audit("checkin.sent", c.first + " " + c.last + " (held until sending hours)"); return null; }
    e.checkin = { sentAt: new Date(S.now), reminded: false }; send(e, "M28", {}, ch);
    timeline(e, "Check-in sent by " + ch, S.user.name); audit("checkin.sent", c.first + " " + c.last); hlog(e, "message", "Check-in sent to " + c.first, "The answers decide which documents to ask for", "Rules"); return null;
  }
  function checkinPlan(eid, facts, counts, base, payers, why) {
    const e = eng(eid), items = itemsOf(eid).filter(liveItem), adds = [], drops = [], used = {}; payers = payers || {};
    const pay = (f) => { const L = [].concat(payers[f] || []), n = (used[f] = (used[f] || 0) + 1) - 1; return PAYERQ[f] ? cleanName(L[n]) || null : null; };
    CHECKQ.forEach((q) => { if (!facts[q[0]] || (base && base[q[0]])) return; (RULES[q[0]] || []).forEach((f) => { if (!items.some((i) => i.form === f) && !adds.some((a) => a.form === f)) adds.push({ form: f, payer: pay(f), reason: (why && why[q[0]]) || "Client ticked: " + q[1].toLowerCase() }); }); });
    const wantW2 = facts.w2 ? Math.min(6, Math.max(1, +((counts || {}).w2) || 1)) : 0, haveW2 = items.filter((i) => i.form === "W2").length + adds.filter((a) => a.form === "W2").length;
    for (let k = haveW2; k < wantW2; k++) adds.push({ form: "W2", payer: pay("W2"), reason: "Client says " + wantW2 + " employers" });
    items.forEach((i) => { if (!["expected", "requested"].includes(i.state) || i.source === "arrived") return; const keys = CHECKQ.map((q) => q[0]).filter((k) => (RULES[k] || []).includes(i.form)); if (keys.length && keys.every((k) => facts[k] === false)) drops.push(i.id); });
    return { adds, drops };
  }
  function checkinDone(cid, ans) {
    const c = client(cid), e = engOf(cid); if (!e) return null;
    if ((!e.checkin || !e.checkin.sentAt) && trialFull(e)) return null;   // answers nobody asked for cannot take a trial past its client limit
    const base = checkinPrefill(e.id).facts, facts = {}, why = {}; CHECKQ.forEach((q) => { facts[q[0]] = ans.same ? base[q[0]] : !!(ans.facts || {})[q[0]]; });
    const fromNote = [].concat(ans.topics || []).filter((k) => CHECKQ.some((q) => q[0] === k) && !facts[k]); fromNote.forEach((k) => { facts[k] = true; why[k] = "From the client's note, read by Claude"; });
    CHECKQ.forEach((q) => setFact(cid, q[0], facts[q[0]]));
    const customs = [].concat(ans.custom || []).map(cleanName).filter(Boolean).slice(0, 3);
    const plan = ans.same && !fromNote.length ? { adds: [], drops: [] } : checkinPlan(e.id, facts, ans.same ? null : ans.counts, base, ans.payers, why), note = String(ans.note || "").trim().slice(0, 300), yes = CHECKQ.filter((q) => facts[q[0]]).map((q) => q[1].toLowerCase());
    e.checkin = Object.assign({ sentAt: new Date(S.now) }, e.checkin, { doneAt: new Date(S.now), same: !!ans.same, adds: plan.adds, drops: plan.drops, customs, note, noteRead: !!(ans.topics || ans.custom), reviewedAt: null });
    S.msgs.push({ id: id("m"), engId: e.id, dir: "in", kind: "client", body: "(Check-in) " + (ans.same ? "Same as last year. " : "") + "Applies this year: " + (yes.join(", ") || "nothing ticked") + (note ? ". Note: " + note : ""), channel: "portal", at: new Date(S.now), understood: "Check-in: " + plan.adds.length + " to add, " + plan.drops.length + " may no longer apply" });
    e.lastIn = new Date(S.now); if (note) remember(e, note, c.first);
    timeline(e, "Check-in answered: " + plan.adds.length + " to add, " + plan.drops.length + " may no longer apply", c.first); audit("checkin.done", c.first + " " + c.last, c.first);
    hlog(e, "read", c.first + " finished the check-in", plan.adds.length + " document" + (plan.adds.length === 1 ? "" : "s") + " to add, " + plan.drops.length + " that may no longer apply" + (note ? ". Left a note" : ""), "Rules");
    send(e, "M29", {});
    const live = ["in_progress", "stuck"].includes(e.status), auto = S.firm.checkinAuto && !plan.drops.length && !note && !customs.length && (e.status === "not_started" || live), nothing = live && !plan.adds.length && !plan.drops.length && !note && !customs.length;
    if (auto || nothing) applyCheckin(e.id, { start: !live, by: "Tallyhound" });
    else { alertx(e, "low", "checkin", c.first + " " + c.last + (live ? " answered the questions. Review the changes to the checklist." : " finished the check-in. Review the checklist and start collecting."), "ck" + e.id); if (live) e.next = nextAllowed(new Date(S.now.getTime() + CHECKIN_WAIT_DAYS * DAY)); }
    return { adds: plan.adds.length + customs.length, drops: plan.drops.length, auto: !!auto };
  }
  /* The firm's decision on a check-in. opt.add and opt.drop narrow what is applied; left out, everything proposed is applied. */
  function applyCheckin(eid, opt) {
    const e = eng(eid), k = e.checkin; if (!k || !k.doneAt) return "No check-in answers to apply"; opt = opt || {};
    const who = opt.by || S.user.name; let added = 0, removed = 0;
    (k.adds || []).forEach((a, n) => { if (opt.add && !opt.add.includes(n)) return; S.items.push({ id: id("i"), engId: eid, form: a.form, payer: a.payer || null, state: "expected", source: "checkin", reason: a.reason }); added++; });
    [].concat(opt.custom === undefined ? k.customs || [] : opt.custom).map(cleanName).filter(Boolean).slice(0, 5).forEach((t) => { S.items.push({ id: id("i"), engId: eid, form: "OTHER", custom: t, payer: null, state: "expected", source: "checkin", reason: "Custom request from the check-in" }); added++; });
    (k.drops || []).forEach((iid) => { if (opt.drop && !opt.drop.includes(iid)) return; const it = S.items.find((x) => x.id === iid); if (it && ["expected", "requested"].includes(it.state)) { it.state = "removed"; it.note = "Client said in the check-in that this no longer applies"; removed++; } });
    k.reviewedAt = new Date(S.now); k.reviewedBy = who; e.confirmed = true;
    timeline(e, "Check-in applied: " + added + " added, " + removed + " removed. Checklist confirmed", who); audit("checkin.applied", client(e.clientId).last + ": +" + added + " -" + removed, who);
    let started = false, why = null; if (opt.start && e.status === "not_started") { why = start(eid); started = !why; }
    if (["in_progress", "stuck"].includes(e.status)) { e.next = nextAllowed(new Date(S.now.getTime() + MIN)); started = true; }   // already collecting: carry on with the corrected list
    return { added, removed, started, why };
  }
  function customSuggest(eid, text, add) { const e = eng(eid), t = cleanName(text); e.suggestCustom = (e.suggestCustom || []).filter((x) => x !== text); if (add && t) { S.items.push({ id: id("i"), engId: eid, form: "OTHER", custom: t, payer: null, state: "expected", source: "staff", reason: "Custom request added from something the client mentioned" }); timeline(e, "Added custom request: " + t, S.user.name); } return !!(add && t); }
  /* Mid-collection: the client mentions something that changes what is needed. Nothing is added without a person. */
  function noticeTopics(e, c, text, keys, other) {
    const f = c.profile || {}, fresh = (k) => !f[k] && (RULES[k] || []).some((form) => !itemsOf(e.id).some((i) => i.form === form && liveItem(i)));
    const hits = TOPICS.filter((t) => t[1].test(text) && fresh(t[0])), model = [].concat(keys || []).filter((k) => CHECKQ.some((q) => q[0] === k) && fresh(k) && !hits.some((t) => t[0] === k));
    model.forEach((k) => hits.push([k, null, CHECKQ.find((q) => q[0] === k)[1].toLowerCase(), true]));
    const odd = cleanName(other);
    if (odd && !(e.oddSeen || []).includes(odd.toLowerCase())) { e.oddSeen = (e.oddSeen || []).concat([odd.toLowerCase()]).slice(-10); e.suggestAt = new Date(S.now); e.suggestCustom = (e.suggestCustom || []).concat([odd]).slice(-5); hlog(e, "decide", "Noticed something unusual: " + odd, "Not one of the standard documents. Suggested as a custom request for a person to add or dismiss", "Claude"); alertx(e, "medium", "suggest", c.first + " " + c.last + " mentioned something that may need a document: " + odd + ". Add a custom request if it does.", "sgo" + e.id + odd.slice(0, 20)); }
    if (!hits.length) return odd ? 1 : 0;
    hits.forEach((t) => setFact(c.id, t[0], true)); e.suggestAt = new Date(S.now);
    const what = hits.map((t) => t[2]).join(" and ");
    hlog(e, "decide", "Noticed something new: " + what, "Suggested documents are waiting for a person to add or dismiss. Nothing was added on its own", hits.some((t) => t[3]) ? "Claude" : "Rules");
    alertx(e, "medium", "suggest", c.first + " " + c.last + " mentioned " + what + ". A suggested document is waiting on the checklist.", "sg" + e.id + hits.map((t) => t[0]).join(""));
    timeline(e, "Mentioned " + what + ": suggestion raised", c.first); return hits.length;
  }
  const topicsIn = (text) => TOPICS.filter((t) => t[1].test(String(text || ""))).map((t) => t[0]);
  function setCustomEs(iid, text) { const it = S.items.find((x) => x.id === iid); if (!it || !it.custom) return false; it.customEs = cleanName(text) || null; return !!it.customEs; }
  const needsSpanish = () => S.items.filter((i) => i.custom && !i.customEs && liveItem(i) && (client((eng(i.engId) || {}).clientId) || {}).lang === "es");
  /* ---------- seasons: what Tallyhound learned about a client carries into the next year ---------- */
  /* Smarter every season (TH-MEM, docs/REBRAND.md section 5). When a file finishes, Tallyhound writes one short outcome record per
     item: which form, from which payer, whose it was, whether it came in, how many asks it took and how long. Next season's
     checklist starts from that. It holds no amount, no identifier, no message and no image, and it goes when the client goes. */
  const SLOW_ITEM_ASKS = 3;
  function memoryWrite(e) {
    if (S.firm.memoryOff || !e) return 0; const c = client(e.clientId); if (!c) return 0; S.memory = S.memory || []; let n = 0;
    itemsOf(e.id).forEach((i) => {
      const outcome = i.state === "received" ? "received" : i.state === "waived" ? "waived" : i.state === "says_none" ? "said_none" : null; if (!outcome || i.form === "PRIOR") return;
      const d = i.docId ? S.docs.find((x) => x.id === i.docId) : null, firstAsk = S.msgs.filter((m) => m.engId === e.id && m.dir === "out" && m.itemId === i.id).map((m) => +new Date(m.at)).sort((x, y) => x - y)[0];
      const row = { clientId: c.id, year: e.year, form: i.form, payer: i.payer || null, custom: i.custom || null, ownerRole: i.ownerHint === "spouse" ? "spouse" : c.entity ? "business" : "primary", outcome, waiveReason: outcome === "waived" ? (WAIVE_REASONS[i.waiveReason] ? i.waiveReason : "other") : null, asks: askedCount(e, i), days: d && firstAsk ? Math.max(0, Math.round((+new Date(d.at) - firstAsk) / DAY)) : null, channel: d ? d.channel || null : null, at: new Date(S.now) };
      const k = S.memory.findIndex((r) => r.clientId === c.id && r.year === e.year && r.form === i.form && (r.payer || "") === (i.payer || "") && (r.custom || "") === (i.custom || ""));
      if (k >= 0) S.memory[k] = row; else S.memory.push(row); n++;
    });
    return n;
  }
  const memoryOf = (cid) => (S.firm.memoryOff ? [] : (S.memory || []).filter((r) => r.clientId === cid).sort((a, b) => b.year - a.year || (b.asks || 0) - (a.asks || 0)));
  function clearMemory(cid) { const c = client(cid); if (!c) return "Unknown client"; if (!may("owner")) return "Only an owner can clear a client's memory"; const n = (S.memory || []).filter((r) => r.clientId === cid).length; S.memory = (S.memory || []).filter((r) => r.clientId !== cid); audit("memory.cleared", c.first + " " + c.last + ": " + n + " records"); return null; }
  function setMemory(on) { if (!may("owner")) return "Only an owner can change this"; if (!!S.firm.memoryOff === !on) return null; S.firm.memoryOff = !on; audit("firm.memory", on ? "Season memory on" : "Season memory off: nothing new is written and next season's proposal does not use it"); return null; }
  /* What last season proposes for this one, waiting for a person: items left off because the client did not need them. Keep puts one
     back on the checklist; confirming leaves them off. Nothing is removed by this: they were never added. */
  function keepRemoved(eid, idx) {
    const e = eng(eid), L = e && e.lastSeason && e.lastSeason.removed; if (!e || !L || !L[idx]) return "Nothing to keep"; if (!may()) return "Not allowed";
    const r = L.splice(idx, 1)[0]; S.items.push({ id: id("i"), engId: e.id, form: r.form, payer: r.payer || null, custom: r.custom || null, state: "expected", source: "last_season", carryNote: "Kept from " + e.lastSeason.year });
    timeline(e, "Kept from last season: " + (r.custom || FORMS[r.form].plain), S.user.name); return null;
  }
  function confirmRemoved(eid) { const e = eng(eid); if (!e || !e.lastSeason) return "Nothing to confirm"; if (!may()) return "Not allowed"; e.lastSeason.confirmedAt = new Date(S.now); e.lastSeason.confirmedBy = S.user.name; timeline(e, "Confirmed what was left off from last season: " + ((e.lastSeason.removed || []).length || "nothing"), S.user.name); return null; }
  function rollForward(cid, year) {
    const c = client(cid), old = engOf(cid); if (!c || !old) return "No file for this client";
    if (!["complete", "closed"].includes(old.status)) return "Still collecting for " + old.year;
    if (old.year >= year) return "Already on " + old.year;
    const its = itemsOf(old.id), keep = its.filter((i) => i.state === "received" && i.form !== "PRIOR"), none = its.filter((i) => ["waived", "says_none"].includes(i.state));
    const nm = (i) => (i.custom || FORMS[i.form].plain) + (i.payer ? " from " + i.payer : "");
    memoryWrite(old); const mem = S.firm.memoryOff ? [] : (S.memory || []).filter((r) => r.clientId === cid && r.year === old.year);
    (S.archive = S.archive || []).push({ year: old.year, clientId: cid, status: old.status, startedAt: old.startedAt || null, completedAt: old.completedAt || null, items: its.map((i) => ({ form: i.form, payer: i.payer || null, custom: i.custom || null, state: i.state })), docs: S.docs.filter((d) => d.engId === old.id).map((d) => ({ form: d.form, payer: d.payer, state: d.state, at: d.at, channel: d.channel })), messages: S.msgs.filter((m) => m.engId === old.id).length, archivedAt: new Date(S.now) });
    const gone = (x) => x.engId !== old.id; S.items = S.items.filter(gone); S.docs = S.docs.filter(gone); S.msgs = S.msgs.filter(gone); S.tasks = S.tasks.filter(gone); S.alerts = S.alerts.filter(gone); S.hlog = S.hlog.filter(gone); S.engs = S.engs.filter((x) => x !== old);
    const e = newEng(cid); e.year = year; e.returning = true; e.memory = (old.memory || []).slice(-8); e.hours = (old.hours || []).slice(-12);
    e.lastSeason = { year: old.year, received: keep.length, none: none.map(nm), days: old.completedAt && old.startedAt ? Math.max(1, Math.round((old.completedAt - old.startedAt) / DAY)) : null };
    if (mem.length) {
      // TH-MEM-2 to 5: last season is the first source. What came in is asked for again, the slow ones first; what was not needed is
      // left off and listed for a person to confirm, with the reason.
      const got = mem.filter((r) => r.outcome === "received"), slow = (r) => (r.asks || 0) >= SLOW_ITEM_ASKS, es = (r) => { const was = keep.find((i) => i.form === r.form && (i.payer || "") === (r.payer || "") && (i.custom || "") === (r.custom || "")); return (was && was.customEs) || null; };
      got.filter(slow).concat(got.filter((r) => !slow(r))).forEach((r) => S.items.push(Object.assign({ id: id("i"), engId: e.id, form: r.form, payer: r.payer || null, custom: r.custom || null, customEs: es(r), state: "expected", source: "last_season", carryNote: slow(r) ? "Slow last year" : "From " + old.year }, r.ownerRole === "spouse" ? { ownerHint: "spouse" } : {})));
      e.lastSeason.removed = mem.filter((r) => r.outcome !== "received").map((r) => ({ form: r.form, payer: r.payer || null, custom: r.custom || null, reason: r.outcome === "said_none" ? "said_none" : r.waiveReason || "other", lasting: LASTING.includes(r.waiveReason) }));
      e.lastSeason.fromMemory = true;
    } else
    keep.forEach((i) => S.items.push({ id: id("i"), engId: e.id, form: i.form, payer: i.payer || null, custom: i.custom || null, customEs: i.customEs || null, state: "expected", source: "prior_year" }));
    timeline(e, "Started from " + old.year + ": " + keep.length + " documents expected again" + (none.length ? ", " + none.length + " not asked for because the client did not have them" : ""), "Tallyhound");
    return null;
  }
  function rollSeason(year) {
    year = +year; const cur = S.firm.taxYear || 2026; if (!(year > cur) || year > cur + 1) return { error: "The next season is " + (cur + 1) };
    S.firm.taxYear = year; let rolled = 0, left = 0, docs = 0; S.clients.slice().forEach((c) => { const r = rollForward(c.id, year); if (r) left++; else { rolled++; docs += itemsOf(engOf(c.id).id).length; } });
    audit("season.roll", "Tax year " + year + ": " + rolled + " clients carried forward, " + left + " left on " + cur); return { year, rolled, left, docs };
  }
  const history = (cid) => (S.archive || []).filter((a) => a.clientId === cid).sort((a, b) => b.year - a.year);
  /* Minutes from creating the firm to its first message going out. The "live in an hour" promise, measured. */
  function setupTime() { const first = S.msgs.filter((m) => m.dir === "out" && ["delivered", "approval", "approved"].includes(m.status)).map((m) => +m.at).sort((a, b) => a - b)[0]; return S.firm.createdAt && first ? Math.max(0, Math.round((first - S.firm.createdAt) / MIN)) : null; }
  /* ---------- the one job: checklist templates, three checks, pipeline ---------- */
  const CHECK_TPL_V2 = [
    { id: "t_scorp", name: "S corporation", note: "Books, bank, payroll, assets and loans", items: BOOKS },
    { id: "t_partner", name: "Partnership", note: "Books, bank, payroll, assets and loans", items: BOOKS },
    { id: "t_ccorp", name: "C corporation", note: "Books, bank, payroll, assets and loans", items: BOOKS },
    { id: "t_trust", name: "Trust or estate", note: "Interest, dividends, brokerage and K-1s", items: RETURNS["1041"].items },
    { id: "t_np", name: "Nonprofit", note: "Books, bank and payroll", items: RETURNS["990"].items }
  ];
  const CHECK_TPL = [
    { id: "t_w2", name: "Employee", note: "Wages only", items: ["W2", "PRIOR"] },
    { id: "t_home", name: "Homeowner", note: "Wages, mortgage and property tax", items: ["W2", "1098", "PTAX", "PRIOR"] },
    { id: "t_family", name: "Family", note: "Wages, home, childcare and giving", items: ["W2", "1098", "PTAX", "CHILDCARE", "CHARITY", "PRIOR"] },
    { id: "t_self", name: "Self-employed", note: "Contract income and estimated payments", items: ["1099NEC", "1099K", "ESTPAY", "1095A", "PRIOR"] },
    { id: "t_invest", name: "Investor", note: "Wages plus bank, dividend and brokerage forms", items: ["W2", "1099INT", "1099DIV", "1099CONS", "PRIOR"] },
    { id: "t_retire", name: "Retiree", note: "Social Security, pension and interest", items: ["SSA1099", "1099R", "1099INT", "1099DIV", "PRIOR"] },
    { id: "t_land", name: "Landlord", note: "Wages plus a rental property", items: ["W2", "RENTAL", "1098", "PTAX", "PRIOR"] },
    { id: "t_student", name: "Student", note: "Wages, tuition and student loan interest", items: ["W2", "1098T", "1098E"] }
  ];
  function templates() { if (!S.firm.checkTemplates) S.firm.checkTemplates = JSON.parse(JSON.stringify(CHECK_TPL));
    if (S.firm.tplV !== 2) { S.firm.tplV = 2; CHECK_TPL_V2.forEach((t) => { if (!S.firm.checkTemplates.some((x) => x.id === t.id)) S.firm.checkTemplates.push(JSON.parse(JSON.stringify(t))); }); }
    return S.firm.checkTemplates; }
  function saveTemplate(t) {
    const L = templates(), items = (t.items || []).filter((f) => FORMS[f] && f !== "OTHER"), name = String(t.name || "").trim().slice(0, 40);
    if (!name || !items.length) return null;
    let x = t.id ? L.find((y) => y.id === t.id) : null;
    if (x) { x.name = name; x.items = items; x.note = t.note || x.note || ""; } else { x = { id: id("t"), name, note: t.note || "", items }; L.push(x); }
    audit("template.save", name); return x;
  }
  function removeTemplate(tid) { const L = templates(), i = L.findIndex((y) => y.id === tid); if (i >= 0) { audit("template.remove", L[i].name); L.splice(i, 1); } }
  /* Adds what the template lists and the client does not have yet. Never removes anything. */
  function applyTemplate(eid, tid, opt) {
    const e = eng(eid), t = templates().find((y) => y.id === tid); if (!e || !t || ["closed", "opted_out"].includes(e.status)) return 0;
    if (opt && opt.skipComplete && e.status === "complete") return 0;
    const have = itemsOf(eid).filter((i) => !["removed"].includes(i.state)).map((i) => i.form); let n = 0;
    t.items.forEach((f) => { if (!have.includes(f)) { S.items.push({ id: id("i"), engId: eid, form: f, payer: null, state: "expected", source: "template", tpl: t.name }); n++; } });
    e.template = t.name;
    if (n) { timeline(e, "Checklist template applied: " + t.name + " (" + n + " added)", S.user.name); if (e.status === "complete") { e.status = "in_progress"; e.next = nextAllowed(S.now); } }
    if (opt && opt.confirm) e.confirmed = true;
    audit("template.apply", t.name + " to " + client(e.clientId).last); return n;
  }
  /* Items proposed from last year's return. Staff choose which to add; nothing already on the checklist is duplicated. */
  function addFromPrior(eid, list) {
    const e = eng(eid); if (!e) return 0; let n = 0;
    (list || []).forEach((x) => {
      const f = x && FORMS[x.form] && x.form !== "OTHER" ? x.form : null, payer = String((x && x.payer) || "").trim().slice(0, 60); if (!f) return;
      const same = itemsOf(eid).filter((i) => i.form === f && i.state !== "removed");
      if (same.some((i) => !payer || !i.payer || payerMatch(i.payer, payer))) { const blank = same.find((i) => !i.payer && payer); if (blank && !same.some((i) => i.payer && payerMatch(i.payer, payer))) blank.payer = payer; return; }
      S.items.push({ id: id("i"), engId: eid, form: f, payer: payer || null, state: "expected", source: "prior", why: String(x.why || "").slice(0, 140) }); n++;
    });
    e.priorRead = new Date(S.now); timeline(e, "Checklist built from last year's return: " + n + " added", S.user.name); audit("checklist.prior", client(e.clientId).last + ": " + n + " items");
    return n;
  }
  function addClient(r) {
    const head = ["first", "last", "email", "mobile", "lang", "preparer", "entity", "rtype"], before = S.clients.length;
    const out = importRows({ head, map: head, rows: [head.map((h) => String(r[h] || "").replace(/,/g, " ").trim())] });
    if (!out.ok) return { ok: false, why: out.rejects[0] ? out.rejects[0].why : "Could not add" };
    const c = S.clients[before], e = engOf(c.id);
    if (r.template) { S.items = S.items.filter((i) => i.engId !== e.id); applyTemplate(e.id, r.template); }
    return { ok: true, clientId: c.id, engId: e.id };
  }
  /* The three questions every document must pass. Used by the screen, the log and the client message. */
  function verdict(d) {
    const e = d.engId ? eng(d.engId) : null, c = d.clientId ? client(d.clientId) : null, F = FORMS[d.form] || FORMS.OTHER, r = (ok, why) => ({ ok, why });
    const clear = d.quality == null ? r(null, "Not checked yet") : d.quality >= S.firm.qualityMin ? r(true, "Every key box can be read") : r(false, "Parts of the page cannot be read");
    let doc;
    if (d.form === "OTHER") doc = r(false, "Not a form on any checklist");
    else if (d.state === "duplicate") doc = r(false, "Already have this one");
    else if (e && d.year && d.year !== expectYear(d.form, e)) doc = r(false, "It is for " + d.year + ", not " + expectYear(d.form, e));
    else if (!d.year && d.read) doc = r(null, "Tax year not found on the page");
    else if (clear.ok === false) doc = r(null, "Cannot tell until the page is readable");
    else if (d.conf != null && d.conf < S.firm.acceptAt) doc = r(null, "Not sure enough to file it without a look");
    else { const it = d.itemId ? S.items.find((i) => i.id === d.itemId) : null; doc = r(true, F.plain + (d.year ? " for " + d.year : "") + (it && it.isNew ? ", not on the checklist so it was added" : "")); }
    let info;
    const gaps = (d.elements || []).filter((x) => x.status === "missing" && x.required);
    if (d.recipient === "other") info = r(false, "The name matches nobody on this return");
    else if (gaps.length && S.firm.docCheck !== false) info = r(false, "Missing " + gaps.map((x) => x.label.charAt(0).toLowerCase() + x.label.slice(1)).join("; "));
    else if (clear.ok === false) info = r(null, "Cannot tell until the page is readable");
    else info = r(true, (c ? "Name matches" : "Name not checked") + ((d.elements || []).length ? ", every required part is present" : ""));
    const all = [doc, info, clear], pass = all.every((x) => x.ok === true), fail = all.some((x) => x.ok === false);
    return { doc, info, clear, pass, fail, label: pass ? "Passed all three checks" : fail ? "Failed a check" : "Needs a look" };
  }
  function pipeline() {
    const live = S.engs.filter((e) => e.status !== "closed"), n = (f) => live.filter(f).length;
    const toCheck = S.tasks.filter((t) => t.status === "open" && t.kind === "document").length + S.tray.length;
    return [
      { key: "clients", label: "Clients on file", n: live.length, hint: "Imported or added" },
      { key: "checklist", label: "Checklist set", n: n((e) => e.confirmed), hint: n((e) => !e.confirmed) + " still to confirm" },
      { key: "chasing", label: "Being chased", n: n((e) => ["in_progress", "awaiting_consent", "stuck"].includes(e.status)), hint: n((e) => e.status === "stuck") + " waiting on you" },
      { key: "check", label: "Documents to check", n: toCheck, hint: "Everything else was checked automatically" },
      { key: "complete", label: "Complete", n: n((e) => e.status === "complete"), hint: "Every document in and verified" }
    ];
  }

  /* The one file an action touched, found from its first argument (file, client, item or task id). */
  function touched(a) { if (typeof a !== "string") return null; let e = S.engs.find((x) => x.id === a || x.clientId === a); if (e) return e; const it = S.items.find((x) => x.id === a) || S.tasks.find((x) => x.id === a); return it && it.engId ? S.engs.find((x) => x.id === it.engId) || null : null; }
  function zoneFix(e) { if (!e.next) return; const c = client(e.clientId); if (c && tzOff(c, e.next) && !allowedC(e.next, c)) e.next = nextAllowedC(e.next, c); }
  function setZone(cid, z) { const c = client(cid); if (!c) return; c.tz = zoneOf(z); audit("client.zone", c.last + ": " + (c.tz ? ZNAME[c.tz] : "firm time")); const e = engOf(cid); if (e) zoneFix(e); }
  /* Keeps status and checklist in step after any staff or client action. */
  function settle(e) {
    if (!e || ["closed", "opted_out", "not_started", "awaiting_consent", "paused"].includes(e.status)) return;
    const open = openItems(e.id).length, any = itemsOf(e.id).some((i) => i.state !== "removed");
    if (e.status === "complete" && open) { e.status = "in_progress"; e.completedAt = null; e.step = 0; if (!e.next) e.next = nextAllowed(S.now); timeline(e, "Reopened: a document is outstanding again"); }
    else if (["in_progress", "stuck"].includes(e.status) && !open && any) { if (checkComplete(e)) finished(e); }
  }
  window.TH = { SEND_HOUR_MIN_REPLIES, bestHour, SLOW_ITEM_ASKS, memoryWrite, memoryOf, clearMemory, setMemory, keepRemoved, confirmRemoved, addTask, BARK_KINDS, BARK_BATCH_MIN, BARK_SETTLE_MIN, REVIEW_OVERDUE_HOURS, barkRoute, barkDue, barkHeld, barkRead, barkWords, setMyBarks, setBarkRules, setStaffHours, staffHours, V2, WAIVE_REASONS, LASTING, CHANGE_WORDS, LATER_MAX_DAYS, ALREADY_SENT_LOOKBACK_DAYS, replyV2, setSpouse, VOICES, VOICE_TPL, VOICE_FIXED, voiceFor, setVoice, setClientVoice, setSignOff, previewVoice, verified, CADENCE_PRESETS, gapsOf, cadenceFor, setIntensity, setClientIntensity, undiscard, setClosedDays, startMany, deletionEvidence, setCallOk, plans, quoteFor, areaZone, zoneFor, addContact, removeContact, planEnded, setLine, isLandline, RETURNS, returnType, registerSender, markHeadsUp, masterFirst, setVerified, recordConsent, listForms, FIRMCHECK, scrub, retain, setRetain, retentionSweep, deleteDocsNow, dataMap, strip, hasContent, RETAIN_DEFAULT, RETAIN_LIMIT, skipQuestions, CHECKIN_WAIT_DAYS, segs, meter, usage, canRead, pauseLeft, pauseUsed, trialRoom, TRIAL_CLIENTS, TRIAL_DOCS, PAUSE_MAX_DAYS, FAIR, RATES, inboundUnusable, PLANS, TRIAL_DAYS, billing, access, planFor, choosePlan, pauseSeason, resumeNow, staffDoc, inboundBundle, topicsIn, setCustomEs, needsSpanish, rollForward, rollSeason, history, setupTime, bestCustom, customSuggest, PAYERQ, CHECKQ, checkinPrefill, sendCheckin, checkinPlan, checkinDone, applyCheckin, setZone, zoneOf, tzOff, allowedC, ZONES, ZNAME, addFromPrior, templates, saveTemplate, removeTemplate, applyTemplate, addClient, verdict, pipeline, CHECK_TPL,
    dump, load, blank, setNow, setUser, linkFor, linkLive, LINK_DAYS, consentFromPage, declineTexts, stopEmail, unsubscribeLink, CONSENT_WORDING,
    get S() { return S; }, FORMS, TPL, TPL_USE, QUESTIONS, STUCK, DAY, HOUR, MIN,
    client, eng, engOf, itemsOf, openItems, progress, fill, outputCheck, channelFor, allowed, nextAllowed, live, nextItem,
    start, step, tick, advance, jumpToNext, inboundDoc, inboundText, giveConsent, decideTask, manual, setItem, addItem, pause, resume, deliver, closeEng, purge, parseCSV, importRows, audit, timeline, fileName,
    reset: seed, check, decide, portalNone, payerMatch, OPEN, ELEMENTS, MISSTXT, missText, releaseOf, FACTS, RULES, PORTALQ, recommend, addRecommended, dismissRec, setFact, clientAnswers, inboundEmail, KLABEL, expectYear, takeover, handback, approveMsg, rejectMsg, composeDone, hlog, alertx, bestHour, COMPLIANCE, SCOPE, classify, remember, schedule
  };
  ["decideTask", "setItem", "addItem", "addFromPrior", "staffDoc", "inboundBundle", "inboundUnusable", "customSuggest", "applyCheckin", "checkinDone", "applyTemplate", "addRecommended", "resume", "handback", "portalNone", "inboundDoc", "inboundText", "inboundEmail", "clientAnswers", "setFact"].forEach((k) => { const f = window.TH[k]; if (typeof f !== "function") return; window.TH[k] = function () { const before = S.engs.length, a0 = arguments[0], r = f.apply(null, arguments); const hit = touched(a0); if (hit && S.engs.length === before) { settle(hit); zoneFix(hit); } else { S.engs.forEach(settle); S.engs.forEach(zoneFix); } return r; }; });
  ["start", "giveConsent", "manual", "pause", "takeover"].forEach((k) => { const f = window.TH[k]; if (typeof f !== "function") return; window.TH[k] = function () { const a0 = arguments[0], r = f.apply(null, arguments), hit = touched(a0); if (hit) { settle(hit); zoneFix(hit); } return r; }; });
  ["advance", "tick", "jumpToNext", "approveMsg"].forEach((k) => { const f = window.TH[k]; if (typeof f !== "function") return; window.TH[k] = function () { const r = f.apply(null, arguments); S.engs.forEach(settle); S.engs.forEach(zoneFix); return r; }; });
})();
