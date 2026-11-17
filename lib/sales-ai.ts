/**
 * 영업 오더 초안(SalesOrderDraft) 만들기 — /api/sales/voice 전용.
 *
 * - structureSalesOrder: 전사/붙여넣기 원문(+서류 사진 요약) → SalesOrderDraft
 * - readSalesDocument: 사업자등록증·차량등록증·신분증 사진 → 핵심 요약 + 고객 정보
 * - mockSalesDraft: MOCK_AI=1 에서 OpenAI 없이 동작하는 규칙 기반 초안
 *
 * 업로드된 파일은 이 모듈 안에서 메모리(Buffer/File)로만 다루며 디스크에 쓰지 않는다.
 */
import { appConfig } from "@/lib/env";
import { chatJson, mockAiEnabled, openai, parseJsonLoose } from "@/lib/ai";
import type { SalesBasis, SalesCustomer, SalesIntent, SalesOrderDraft } from "@/lib/types";
import { SALES_INTENTS, todayInSeoul } from "@/lib/types";
import { maskSensitiveText } from "@/lib/sales-privacy";

/* ------------------------------------------------------------------ */
/* 고정 사전                                                            */
/* ------------------------------------------------------------------ */

const INSURER_ALIASES: Array<[RegExp, string]> = [
  [/(삼성화재|삼성)/, "삼성화재"],
  [/(현대해상|현대)/, "현대해상"],
  [/(DB손해|DB|디비)/i, "DB손해보험"],
  [/(KB손해|KB|케이비)/i, "KB손해보험"],
  [/(메리츠)/, "메리츠화재"],
  [/(한화손해|한화)/, "한화손해보험"],
  [/(롯데손해|롯데)/, "롯데손해보험"],
  [/(흥국)/, "흥국화재"],
  [/(라이나|처브|CHUBB)/i, "라이나손해보험"],
];

const PRODUCT_RULES: Array<[RegExp, string]> = [
  [/(근재|근로자재해)/, "근재"],
  [/(적하|수출|수입|인보이스|컨테이너|선적)/, "적하"],
  [/(건설기계|지게차|굴삭기|굴착기|크레인|기중기|로더|포크레인|스키드로더)/, "건설기계"],
  [/(자동차|차량|승용|화물차|버스|이륜|오토바이)/, "자동차"],
  [/(화재|건물|창고|공장|시설)/, "화재"],
  [/(배상|영업배상|시설물|생산물|책임)/, "배상"],
];

const KIND_ALIASES: Array<[RegExp, string]> = [
  [/(굴삭기|굴착기|포크레인)/, "굴착기"],
  [/(지게차)/, "지게차"],
  [/(기중기|크레인)/, "기중기"],
  [/(스키드로더|로더)/, "스키드로더"],
  [/(덤프)/, "덤프트럭"],
  [/(고소작업차)/, "고소작업차"],
];

const CAR_NO_PATTERN = /\d{2,3}\s?[가-힣]\s?\d{4}/;

/* ------------------------------------------------------------------ */
/* 상품별·행동별 필수 산출기초 기준 (에이원코리아 접수 기준)             */
/*  - 프롬프트에 그대로 들어가고, 같은 표로 draft.missing 을 계산한다.   */
/* ------------------------------------------------------------------ */

export interface SalesRequirement {
  /** draft.missing 에 들어갈 항목명 — 기준에 적힌 이름 그대로 */
  label: string;
  /** 이 값을 어느 칸에 넣는지(프롬프트 안내) */
  slot: string;
  /** 이미 채워졌는지 판정 */
  test: (draft: SalesOrderDraft, text: string) => boolean;
}

const VEHICLE_REQUIREMENTS: SalesRequirement[] = [
  {
    label: "차량번호(차대번호)",
    slot: "basis.car_no (차대번호면 free_text)",
    test: (d, t) => Boolean(d.basis.car_no) || /차대번호/.test(t),
  },
  {
    label: "차종/톤수",
    slot: "basis.kind",
    test: (d, t) => Boolean(d.basis.kind) || /\d+(\.\d+)?\s*톤|차종|승합|화물|굴삭기|지게차|기중기/.test(t),
  },
  {
    label: "운전자범위·연령",
    slot: "basis.free_text",
    test: (_d, t) => /운전자|연령|만\s?\d{2}\s?세|한정|누구나|가족/.test(t),
  },
  {
    label: "대물한도",
    slot: "basis.free_text",
    test: (_d, t) => /대물/.test(t),
  },
  {
    label: "자차여부",
    slot: "basis.free_text",
    test: (_d, t) => /자차|자기차량/.test(t),
  },
];

const PROPERTY_REQUIREMENTS: SalesRequirement[] = [
  {
    label: "소재지",
    slot: "customer.address",
    test: (d, t) => Boolean(d.customer.address) || /소재지/.test(t),
  },
  {
    label: "업종",
    slot: "basis.free_text",
    test: (_d, t) => /업종|업태|제조|판매|물류|창고업|도소매|서비스업/.test(t),
  },
  {
    label: "건물구조(급수·판넬여부)",
    slot: "basis.structure (급수·판넬 여부는 free_text)",
    test: (d, t) => Boolean(d.basis.structure) || /판넬|급수|내화|철골|콘크리트|벽돌|목조|조립식/.test(t),
  },
  {
    label: "면적(평/㎡)",
    slot: "basis.free_text",
    test: (_d, t) => /\d+(\.\d+)?\s*(평|㎡|m2|m²|제곱미터)/.test(t),
  },
  {
    label: "가입금액(건물·집기·재고)",
    slot: "basis.amount_man (만원 단위 숫자)",
    test: (d, t) => Boolean(d.basis.amount_man) || /\d+\s*억|\d+\s*만\s*원|가입금액/.test(t),
  },
];

const LIABILITY_REQUIREMENTS: SalesRequirement[] = [
  {
    label: "업종/작업내용",
    slot: "basis.free_text",
    test: (_d, t) => /업종|작업|영업|시설|현장|공사|서비스/.test(t),
  },
  {
    label: "산출기초(연매출액/면적/공사금액/좌석수)",
    slot: "basis.free_text",
    test: (_d, t) => /매출|면적|평|㎡|공사금액|좌석/.test(t),
  },
  {
    label: "보상한도",
    slot: "basis.free_text",
    test: (_d, t) => /한도|대인|대물|\d+\s*억/.test(t),
  },
  {
    label: "자기부담금",
    slot: "basis.free_text",
    test: (_d, t) => /자기부담|자부담|면책/.test(t),
  },
];

const EMPLOYER_REQUIREMENTS: SalesRequirement[] = [
  {
    label: "업종/공사명",
    slot: "basis.free_text",
    test: (_d, t) => /업종|공사|현장|공정|공사명/.test(t),
  },
  {
    label: "연간임금총액(또는 공사금액)",
    slot: "basis.free_text",
    test: (_d, t) => /임금|급여|노무비|공사금액|총액/.test(t),
  },
  {
    label: "인원수",
    slot: "basis.free_text",
    test: (_d, t) => /\d+\s*명|인원/.test(t),
  },
  {
    label: "보상한도",
    slot: "basis.free_text",
    test: (_d, t) => /한도|보상/.test(t),
  },
];

const CARGO_REQUIREMENTS: SalesRequirement[] = [
  {
    label: "화물품목",
    slot: "basis.free_text",
    test: (_d, t) => /품목|화물|기계|부품|의류|식품|원자재|장비/.test(t),
  },
  {
    label: "출발지→도착지",
    slot: "basis.from / basis.to",
    test: (d, t) => Boolean(d.basis.from && d.basis.to) || /→|에서.*까지/.test(t),
  },
  {
    label: "운송수단",
    slot: "basis.free_text",
    test: (_d, t) => /선박|항공|트럭|해상|육상|컨테이너|운송수단/.test(t),
  },
  {
    label: "가입금액(통화/USD/KRW)",
    slot: "basis.usd (숫자만, 통화는 free_text)",
    test: (d, t) => Boolean(d.basis.usd) || /\d+\s*(USD|KRW|달러|원)/.test(t),
  },
  {
    label: "조건(CIF/FOB)",
    slot: "basis.free_text",
    test: (_d, t) => /CIF|FOB|CFR|EXW|DDP|FCA/i.test(t),
  },
];

const ETC_REQUIREMENTS: SalesRequirement[] = [
  {
    label: "산출기초",
    slot: "basis.free_text",
    test: (d) => Boolean(d.basis.free_text) || Boolean(d.basis.amount_man) || Boolean(d.basis.car_no),
  },
];

const ENDORSE_REQUIREMENTS: SalesRequirement[] = [
  {
    label: "대상증권",
    slot: "basis.free_text",
    test: (_d, t) => /증권|계약|기존|보험/.test(t),
  },
  {
    label: "변경일",
    slot: "start_date",
    test: (d, t) => Boolean(d.start_date) || /변경일|\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일/.test(t),
  },
  {
    label: "변경항목",
    slot: "basis.free_text",
    test: (_d, t) => /변경|추가|삭제|교체|정정|금액|기간|차량/.test(t),
  },
];

const CANCEL_REQUIREMENTS: SalesRequirement[] = [
  {
    label: "대상증권",
    slot: "basis.free_text",
    test: (_d, t) => /증권|계약|기존|보험/.test(t),
  },
  {
    label: "해지일",
    slot: "end_date",
    test: (d, t) => Boolean(d.end_date) || /해지일|\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일/.test(t),
  },
  {
    label: "사유",
    slot: "basis.free_text",
    test: (_d, t) => /사유|매각|폐업|이전|중도|양도|휴업/.test(t),
  },
];

const ACCIDENT_REQUIREMENTS: SalesRequirement[] = [
  { label: "사고일시", slot: "basis.accident_date", test: (d) => Boolean(d.basis.accident_date) },
  { label: "사고장소", slot: "basis.accident_place", test: (d) => Boolean(d.basis.accident_place) },
  { label: "사고경위", slot: "basis.accident_desc", test: (d) => Boolean(d.basis.accident_desc) },
  {
    label: "피해대상",
    slot: "basis.free_text",
    test: (_d, t) => /피해|대물|대인|차량|사람|부상|파손|사망/.test(t),
  },
];

interface RequirementGroup {
  title: string;
  match: RegExp;
  items: SalesRequirement[];
}

const PRODUCT_GROUPS: RequirementGroup[] = [
  { title: "자동차/건설기계", match: /자동차|건설기계|차량|중장비|지게차|굴착기|기중기/, items: VEHICLE_REQUIREMENTS },
  { title: "화재/재산종합", match: /화재|재산종합|재물|종합/, items: PROPERTY_REQUIREMENTS },
  { title: "배상책임", match: /배상|책임/, items: LIABILITY_REQUIREMENTS },
  { title: "근재", match: /근재|근로자재해/, items: EMPLOYER_REQUIREMENTS },
  { title: "적하/운송", match: /적하|운송|해상|화물/, items: CARGO_REQUIREMENTS },
];

function productGroup(product: string): RequirementGroup | null {
  const value = product.trim();
  if (!value) return null;
  return PRODUCT_GROUPS.find((g) => g.match.test(value)) ?? null;
}

function productRequirements(product: string): SalesRequirement[] {
  return productGroup(product)?.items ?? ETC_REQUIREMENTS;
}

/** 기준 표를 프롬프트에 그대로 넣을 문장으로 만든다. */
function requirementPrompt(): string {
  const groups: RequirementGroup[] = [
    ...PRODUCT_GROUPS,
    { title: "배서", match: /^$/, items: ENDORSE_REQUIREMENTS },
    { title: "해지", match: /^$/, items: CANCEL_REQUIREMENTS },
    { title: "사고접수", match: /^$/, items: ACCIDENT_REQUIREMENTS },
  ];
  return groups.map((g) => `- ${g.title}: ${g.items.map((i) => i.label).join(", ")}`).join("\n");
}

/** 각 항목을 어느 칸에 넣는지 안내(중복 제거). */
function slotPrompt(): string {
  const seen = new Map<string, string>();
  for (const item of [
    ...VEHICLE_REQUIREMENTS,
    ...PROPERTY_REQUIREMENTS,
    ...LIABILITY_REQUIREMENTS,
    ...EMPLOYER_REQUIREMENTS,
    ...CARGO_REQUIREMENTS,
    ...ETC_REQUIREMENTS,
    ...ENDORSE_REQUIREMENTS,
    ...CANCEL_REQUIREMENTS,
    ...ACCIDENT_REQUIREMENTS,
  ]) {
    if (!seen.has(item.label)) seen.set(item.label, item.slot);
  }
  return Array.from(seen.entries())
    .map(([label, slot]) => `· ${label} → ${slot}`)
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* 기본값·정규화                                                        */
/* ------------------------------------------------------------------ */

export function emptySalesCustomer(): SalesCustomer {
  return { name: "", biz_no: "", phone: "", address: "", ceo_name: "", doc_type: "" };
}

export function emptySalesBasis(): SalesBasis {
  return {
    car_no: "",
    kind: "",
    amount_man: "",
    structure: "",
    usd: "",
    from: "",
    to: "",
    accident_date: "",
    accident_place: "",
    accident_desc: "",
    free_text: "",
  };
}

export function emptySalesDraft(): SalesOrderDraft {
  return {
    intent: "견적",
    customer: emptySalesCustomer(),
    product: "",
    insurer: "",
    gu: "",
    obj: "",
    start_date: "",
    end_date: "",
    short_term: false,
    basis: emptySalesBasis(),
    memo: "",
    missing: [],
  };
}

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeDateValue(value: unknown): string {
  const v = str(value);
  const m = v.match(/(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/);
  if (!m) return "";
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function cleanIntent(value: unknown): SalesIntent {
  const v = str(value);
  if ((SALES_INTENTS as readonly string[]).includes(v)) return v as SalesIntent;
  // 모델이 비슷한 말을 돌려준 경우
  if (/견적|quote|자료/.test(v)) return "견적";
  if (/계약|가입|신규|갱신|renew/.test(v)) return "계약";
  if (/배서|변경|endorse/.test(v)) return "배서";
  if (/해지|cancel/.test(v)) return "해지";
  if (/사고|claim/.test(v)) return "사고접수";
  return "견적";
}

function normalizeCustomer(raw: unknown, fallbackDocType = ""): SalesCustomer {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    name: str(o.name),
    biz_no: str(o.biz_no),
    phone: str(o.phone),
    address: str(o.address),
    ceo_name: str(o.ceo_name),
    doc_type: str(o.doc_type) || fallbackDocType,
  };
}

function normalizeBasis(raw: unknown): SalesBasis {
  const o = (raw ?? {}) as Record<string, unknown>;
  const base = emptySalesBasis();
  const keys = Object.keys(base) as Array<keyof SalesBasis>;
  for (const key of keys) {
    if (key === "accident_date") base[key] = normalizeDateValue(o[key]);
    else base[key] = str(o[key]);
  }
  return base;
}

export function normalizeSalesDraft(raw: unknown, docType = ""): SalesOrderDraft {
  const o = (raw ?? {}) as Record<string, unknown>;
  const draft = emptySalesDraft();
  draft.intent = cleanIntent(o.intent);
  draft.customer = normalizeCustomer(o.customer, docType);
  draft.product = str(o.product);
  draft.insurer = str(o.insurer);
  draft.gu = str(o.gu);
  draft.obj = str(o.obj);
  draft.start_date = normalizeDateValue(o.start_date);
  draft.end_date = normalizeDateValue(o.end_date);
  draft.short_term = o.short_term === true || str(o.short_term) === "true";
  draft.basis = normalizeBasis(o.basis);
  draft.memo = str(o.memo);
  const missing = Array.isArray(o.missing) ? o.missing.map((v) => str(v)).filter(Boolean) : [];
  draft.missing = missing.length > 0 ? Array.from(new Set(missing)) : computeMissing(draft);
  return draft;
}

/* ------------------------------------------------------------------ */
/* 빠진 필수 항목 계산                                                  */
/* ------------------------------------------------------------------ */

export function computeMissing(draft: SalesOrderDraft): string[] {
  const text = requirementHaystack(draft);
  const missing: string[] = [];
  const add = (items: SalesRequirement[]) => {
    for (const item of items) {
      if (!item.test(draft, text) && !missing.includes(item.label)) missing.push(item.label);
    }
  };

  if (!draft.customer.name) missing.push("고객명");

  if (draft.intent === "사고접수") {
    add(ACCIDENT_REQUIREMENTS);
    return missing;
  }

  if (!draft.product) missing.push("상품");

  if (draft.intent === "배서") {
    add(ENDORSE_REQUIREMENTS);
    return missing;
  }

  if (draft.intent === "해지") {
    add(CANCEL_REQUIREMENTS);
    return missing;
  }

  // 견적·계약(신규/갱신)
  if (!draft.start_date || !draft.end_date) missing.push("보험기간");
  if (!draft.obj) missing.push("목적물");
  if (draft.product) add(productRequirements(draft.product));
  return missing;
}

/** 기준 항목이 이미 채워졌는지 판정할 때 보는 텍스트 모음 */
function requirementHaystack(draft: SalesOrderDraft): string {
  const b = draft.basis;
  return [
    draft.obj,
    draft.customer.address,
    b.car_no,
    b.kind,
    b.amount_man,
    b.structure,
    b.usd,
    b.from,
    b.to,
    b.accident_date,
    b.accident_place,
    b.accident_desc,
    b.free_text,
  ]
    .filter(Boolean)
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* 모의(MOCK_AI=1) 규칙 기반 초안                                       */
/* ------------------------------------------------------------------ */

function addYear(date: string): string {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  return `${Number(y) + 1}-${m}-${d}`;
}

function shiftDays(days: number): string {
  const [y, m, d] = todayInSeoul().split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function parseKoreanDates(text: string): string[] {  const found: string[] = [];
  // 2026-12-01 · 2026.12.1 · 2026년 12월 1일
  const full = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?/g;
  for (const m of text.matchAll(full)) {
    found.push(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  }
  if (found.length > 0) return found;
  // 12월 1일 (연도 없음 → 올해)
  const year = todayInSeoul().slice(0, 4);
  const short = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
  for (const m of text.matchAll(short)) {
    found.push(`${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`);
  }
  return found;
}

function parseAmountMan(text: string): string {
  const eok = text.match(/(\d+(?:\.\d+)?)\s*억/);
  if (eok) return String(Math.round(Number(eok[1]) * 10000));
  const man = text.match(/(\d+(?:\.\d+)?)\s*만\s*원?/);
  if (man) return String(Math.round(Number(man[1])));
  return "";
}

export function mockSalesDraft(input: { transcript: string; docSummary?: string }): SalesOrderDraft {
  const text = `${input.transcript ?? ""}\n${input.docSummary ?? ""}`.trim();
  const draft = emptySalesDraft();
  const customer = draft.customer;

  // intent
  if (/사고|접수/.test(text)) draft.intent = "사고접수";
  else if (/해지|매각|폐업|중단/.test(text)) draft.intent = "해지";
  else if (/배서|변경|추가|빼|늘려|줄여|교체|정정/.test(text)) draft.intent = "배서";
  else if (/견적|자료|비교|알아봐|금액/.test(text)) draft.intent = "견적";
  else if (/계약|가입|신규|갱신|만기|연장/.test(text)) draft.intent = "계약";
  else draft.intent = "견적";

  // gu
  if (draft.intent === "계약") {
    draft.gu = /갱신|만기|연장/.test(text) ? "갱신" : "신규";
  } else if (draft.intent === "배서") draft.gu = "배서";
  else if (draft.intent === "해지") draft.gu = "해지";
  else if (draft.intent === "사고접수") draft.gu = "사고";
  else draft.gu = "신규";

  // product / insurer
  for (const [re, name] of PRODUCT_RULES) {
    if (re.test(text)) {
      draft.product = name;
      break;
    }
  }
  const insurers: string[] = [];
  for (const [re, name] of INSURER_ALIASES) {
    if (re.test(text) && !insurers.includes(name)) insurers.push(name);
  }
  draft.insurer = insurers.join(",");

  // 목적물·산출기초
  const carNo = text.match(CAR_NO_PATTERN);
  if (carNo) {
    draft.basis.car_no = carNo[0].replace(/\s+/g, "");
    draft.obj = draft.basis.car_no;
  }
  for (const [re, name] of KIND_ALIASES) {
    if (re.test(text)) {
      draft.basis.kind = name;
      draft.obj = draft.obj || `${name} 1대`;
      break;
    }
  }
  const amount = parseAmountMan(text);
  if (amount) draft.basis.amount_man = amount;

  const structure = text.match(/(철골조|철근콘크리트|벽돌조|블록조|목조|조립식)/);
  if (structure) draft.basis.structure = structure[1];

  const usd = text.match(/(?:인보이스|수출|수입)[^0-9]{0,10}([\d,]{3,})/);
  if (usd) draft.basis.usd = usd[1].replace(/,/g, "");
  const ports = text.match(/(부산|인천|광양|울산|평택|LA|로스앤젤레스|상하이|칭다오|호치민)\s*(?:에서|→)\s*([가-힣A-Za-z]{2,10})\s*(?:까지|로)?/);
  if (ports) {
    draft.basis.from = ports[1];
    draft.basis.to = ports[2];
  }

  // 고객
  const bizNo = text.match(/\d{3}-\d{2}-\d{5}/);
  if (bizNo) customer.biz_no = bizNo[0];
  const phone = text.match(/01\d[-\s]?\d{3,4}[-\s]?\d{4}/);
  if (phone) customer.phone = phone[0].replace(/\s/g, "");
  const ceo = text.match(/대표\s*(?:는|은)?\s*([가-힣]{2,4})/);
  if (ceo) customer.ceo_name = ceo[1];
  const named = text.match(/(?:고객|거래처|회사)(?:은|는|이)?\s*([가-힣A-Za-z0-9()]{2,20})/);
  if (named) customer.name = named[1];
  const address = text.match(/([가-힣]{2,}(?:시|도)\s[가-힣]{1,}(?:구|군|시)\s[^\s,.]{0,20})/);
  if (address) customer.address = address[1].trim();

  // 기간
  const dates = parseKoreanDates(text);
  if (dates[0]) draft.start_date = dates[0];
  if (dates[1]) draft.end_date = dates[1];
  if (draft.start_date && !draft.end_date) draft.end_date = addYear(draft.start_date);
  draft.short_term = /단기|한\s*달|3\s*개월|6\s*개월|몇\s*달/.test(text);

  // 사고
  if (draft.intent === "사고접수") {
    if (/그제/.test(text)) draft.basis.accident_date = shiftDays(-2);
    else if (/어제/.test(text)) draft.basis.accident_date = shiftDays(-1);
    else draft.basis.accident_date = dates[0] ?? todayInSeoul();
    const place = text.match(/([가-힣]{2,})\s*(창고|공장|현장|주차장|도로|사거리|공사장|물류센터)/);
    if (place) draft.basis.accident_place = `${place[1]} ${place[2]}`;
    draft.basis.accident_desc = input.transcript.slice(0, 200);
  }

  if (!draft.basis.free_text) draft.basis.free_text = "";
  draft.customer = customer;
  draft.memo = `(모의 초안) ${input.transcript.slice(0, 160)}`.trim();
  draft.missing = computeMissing(draft);
  return draft;
}

/* ------------------------------------------------------------------ */
/* 서류 사진 읽기 (OpenAI Vision)                                       */
/* ------------------------------------------------------------------ */

const DOC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["doc_type", "summary", "customer"],
  properties: {
    doc_type: { type: "string", description: "사업자등록증 | 차량등록증 | 신분증 | 기타 중 하나" },
    summary: { type: "string", description: "서류에서 읽은 핵심 내용 2~4문장(개인정보 뒷자리는 가림)" },
    customer: {
      type: "object",
      additionalProperties: false,
      required: ["name", "biz_no", "phone", "address", "ceo_name"],
      properties: {
        name: { type: "string" },
        biz_no: { type: "string", description: "사업자등록번호 000-00-00000 형식" },
        phone: { type: "string" },
        address: { type: "string" },
        ceo_name: { type: "string" },
      },
    },
  },
} as const;

const DOC_PROMPT = [
  "너는 보험 영업 서류를 읽는 비서다. 사진 속 서류(사업자등록증·차량등록증·신분증 등)에서 영업 오더에 필요한 값만 뽑는다.",
  "",
  "규칙:",
  "1. doc_type은 '사업자등록증' | '차량등록증' | '신분증' | '기타' 중 하나.",
  "2. customer.name은 상호(법인명) 또는 성명, ceo_name은 대표자 성명, biz_no는 사업자등록번호, address는 사업장 주소, phone은 전화번호.",
  "3. **주민등록번호는 절대 13자리를 그대로 쓰지 않는다.** 앞 6자리와 성별 1자리만 남기고 나머지는 ****** 로 가린다(예: 900101-1******). 생년월일만 확인되면 '900101'처럼 6자리만 쓴다.",
  "4. 사진에서 확인되지 않은 값은 빈 문자열로 둔다. 추측해서 채우지 않는다.",
  "5. summary에는 서류 종류와 확인된 핵심 값(상호·대표·주소·차량번호 등)을 2~4문장으로 요약한다. 주민번호 뒷자리는 쓰지 않는다.",
].join("\n");

export interface SalesDocumentResult {
  doc_type: string;
  summary: string;
  customer: SalesCustomer;
  mocked?: boolean;
}

export async function readSalesDocument(file: File): Promise<SalesDocumentResult> {
  const mime = file.type || "image/jpeg";
  if (!/^image\//.test(mime)) {
    throw new Error("이미지 파일만 올릴 수 있습니다 (JPG·PNG·WEBP).");
  }

  if (mockAiEnabled()) {
    const summary =
      "(모의 판독) 사업자등록증: 상호 다온기계, 대표 김다온, 사업자등록번호 123-45-67890, 주소 인천광역시 서구 북항로 100.";
    return {
      doc_type: "사업자등록증",
      summary,
      customer: {
        name: "다온기계",
        biz_no: "123-45-67890",
        phone: "",
        address: "인천광역시 서구 북항로 100",
        ceo_name: "김다온",
        doc_type: "사업자등록증",
      },
      mocked: true,
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
  const c = appConfig();

  const response = await openai().chat.completions.create({
    model: c.chatModel,
    temperature: 0.1,
    messages: [
      { role: "system", content: DOC_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "이 서류 사진에서 영업 오더에 필요한 값을 뽑아 JSON으로 정리해 주세요." },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "sales_document", strict: true, schema: DOC_SCHEMA },
    } as unknown as { type: "json_object" },
  });

  const content = response.choices?.[0]?.message?.content ?? "";
  const parsed = parseJsonLoose(content) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("서류 사진을 읽지 못했습니다.");
  }

  // 모델이 실수로 주민번호를 그대로 썼을 경우를 대비해 결과에도 한 번 더 마스킹한다.
  const docType = str(parsed.doc_type) || "기타";
  return {
    doc_type: docType,
    summary: maskSensitiveText(str(parsed.summary)).text,
    customer: normalizeCustomer(parsed.customer, docType),
  };
}

/* ------------------------------------------------------------------ */
/* 원문 → 영업 오더 초안 (구조화)                                        */
/* ------------------------------------------------------------------ */

const SALES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "customer",
    "product",
    "insurer",
    "gu",
    "obj",
    "start_date",
    "end_date",
    "short_term",
    "basis",
    "memo",
  ],
  properties: {
    intent: {
      type: "string",
      enum: [...SALES_INTENTS],
      description: "견적 | 계약 | 배서 | 해지 | 사고접수",
    },
    customer: {
      type: "object",
      additionalProperties: false,
      required: ["name", "biz_no", "phone", "address", "ceo_name", "doc_type"],
      properties: {
        name: { type: "string", description: "고객 상호 또는 성명. 모르면 빈 문자열" },
        biz_no: { type: "string", description: "사업자등록번호 000-00-00000, 없으면 빈 문자열" },
        phone: { type: "string" },
        address: { type: "string" },
        ceo_name: { type: "string" },
        doc_type: { type: "string", description: "사업자등록증 | 차량등록증 | 신분증 | 빈 문자열" },
      },
    },
    product: {
      type: "string",
      description: "보험 상품명: 자동차 | 화재 | 배상 | 건설기계 | 근재 | 적하 | 기타 | 빈 문자열",
    },
    insurer: {
      type: "string",
      description: "보험사명(여러 곳이면 쉼표로). 예: 삼성화재, 현대해상, DB손해보험",
    },
    gu: { type: "string", description: "구분: 신규 | 갱신 | 배서 | 해지 | 사고 | 빈 문자열" },
    obj: { type: "string", description: "목적물/차량번호/현장. 예: 지게차 1대, 12가3456, 김포 창고 300평" },
    start_date: { type: "string", description: "보험 시작일 YYYY-MM-DD, 없으면 빈 문자열" },
    end_date: { type: "string", description: "보험 종료일 YYYY-MM-DD, 없으면 빈 문자열" },
    short_term: { type: "boolean", description: "1년 미만 단기 계약이면 true" },
    basis: {
      type: "object",
      additionalProperties: false,
      required: [
        "car_no",
        "kind",
        "amount_man",
        "structure",
        "usd",
        "from",
        "to",
        "accident_date",
        "accident_place",
        "accident_desc",
        "free_text",
      ],
      properties: {
        car_no: { type: "string", description: "건설기계 등록번호. 예: 004가1234" },
        kind: { type: "string", description: "기종. 예: 지게차, 굴착기, 기중기" },
        amount_man: { type: "string", description: "가입금액(만원 단위 숫자만). 5억이면 50000" },
        structure: { type: "string", description: "건물 구조. 예: 철골조, 철근콘크리트" },
        usd: { type: "string", description: "적하 인보이스 금액(USD 숫자만)" },
        from: { type: "string", description: "적하 출발지" },
        to: { type: "string", description: "적하 도착지" },
        accident_date: { type: "string", description: "사고일시 YYYY-MM-DD" },
        accident_place: { type: "string" },
        accident_desc: { type: "string" },
        free_text: {
          type: "string",
          description:
            "전용 칸이 없는 산출기초를 '항목: 값' 형태로 한 줄씩. 예: 운전자범위·연령: 만26세 이상 누구나 / 대물한도: 1억 / 자차: 미가입",
        },
      },
    },
    memo: { type: "string", description: "담당자가 알아야 할 보충 메모(원문 요약)" },
  },
} as const;

function salesSystemPrompt(customers: Array<{ id?: string; name?: string; bizNo?: string }>): string {
  const list = customers
    .filter((c) => c && (c.name || c.bizNo))
    .slice(0, 200)
    .map((c) => [c.id ?? "", c.name ?? "", c.bizNo ?? ""].join(" | "))
    .join("\n");

  return [
    "너는 에이원코리아(A1)의 보험 영업 오더 정리 비서다.",
    "영업 담당자가 말하거나 붙여넣은 내용(문자·카톡), 또는 서류 사진에서 읽은 내용을 받아 영업 오더 초안으로 정리한다.",
    "",
    "[필수 산출기초 기준 — 상품별·행동별] 아래는 에이원코리아 접수 기준이다. 오더를 접수하려면 이 항목들이 모두 있어야 한다.",
    requirementPrompt(),
    "",
    "[칸 배치] 전용 칸이 있는 항목은 그 칸에 넣고, 전용 칸이 없는 항목은 basis.free_text에 '항목: 값' 형태로 한 줄씩 적는다.",
    slotPrompt(),
    "",
    "[missing] 원문(또는 서류 사진)에서 확인되지 않은 항목만 위 기준의 항목명 **그대로** missing 배열에 적는다. 확인된 항목은 넣지 않는다. 추측해서 채우지 않는다.",
    "",
    "[의도(intent) 분류]",
    "- 견적: 견적서·자료 요청, 금액 비교, '알아봐 달라'",
    "- 계약: 신규 가입·갱신·만기 연장 요청",
    "- 배서: 가입 후 내용 변경(추가·삭제·금액 변경·기간 변경·차량 교체)",
    "- 해지: 중도 해지, 매각·폐업으로 인한 해지",
    "- 사고접수: 사고 발생·접수 요청",
    "",
    "[상품(product)] 다음 중 하나로 맞춘다: 자동차, 화재, 배상, 건설기계, 근재, 적하, 기타.",
    "- 영업배상·시설물·생산물배상 → 배상 / 지게차·굴삭기·크레인 등 중장비 → 건설기계",
    "- 근로자재해 → 근재 / 수출입 화물·인보이스 → 적하 / 건물·창고·공장 → 화재 / 승용·화물차 → 자동차",
    "",
    "[보험사(insurer)] 자유 텍스트. 표준 표기: 삼성화재, 현대해상, DB손해보험, KB손해보험, 메리츠화재, 한화손해보험, 롯데손해보험, 흥국화재, 라이나손해보험(처브/CHUBB는 라이나).",
    "",
    "[구분(gu)] 신규 | 갱신 | 배서 | 해지 | 사고 | 빈 문자열.",
    "",
    "[기간] 오늘은 " + todayInSeoul() + " (Asia/Seoul)이다. '다음 달 1일', '1년', '6개월' 같은 표현을 실제 날짜 YYYY-MM-DD로 계산한다. 종료일이 없고 '1년'이면 시작일 1년 뒤 같은 날짜. 1년 미만이면 short_term=true.",
    "",
    "[산출기초(basis) 공통] 숫자는 단위를 바꿔 적는다: 가입금액은 만원 단위(5억 → 50000), 적하는 USD 숫자만. 주소는 customer.address, 목적물·차량번호·현장은 obj.",
    "",
    "[개인정보]",
    "- 주민등록번호는 절대 13자리로 적지 않는다. 앞 6자리와 성별 1자리만 남기고 뒤는 ******로 가린다(예: 900101-1******).",
    "- 확인되지 않은 값은 빈 문자열로 둔다. 추측해서 채우지 않는다.",
    "",
    "[고객명부] 이미 저장된 고객 목록(id | 상호 | 사업자번호). 발음이 비슷하거나 사업자번호가 같으면 이 이름·번호로 맞춘다:",
    list || "(없음)",
  ].join("\n");
}

export async function structureSalesOrder(input: {
  transcript: string;
  customers?: Array<{ id?: string; name?: string; bizNo?: string }>;
  docSummary?: string;
  docType?: string;
}): Promise<SalesOrderDraft> {
  const transcript = (input.transcript ?? "").trim();
  if (mockAiEnabled()) {
    return mockSalesDraft({ transcript, docSummary: input.docSummary });
  }

  const userParts = [`오늘: ${todayInSeoul()}`];
  if (input.docSummary) userParts.push(`[서류 사진에서 읽은 내용]\n${input.docSummary}`);
  userParts.push(`[음성 전사/입력 원문]\n${transcript || "(없음)"}`);

  const parsed = await chatJson(
    salesSystemPrompt(input.customers ?? []),
    userParts.join("\n\n"),
    "sales_order_draft",
    SALES_SCHEMA as unknown as Record<string, unknown>,
  );

  const draft = normalizeSalesDraft(parsed, input.docType ?? "");
  draft.missing = computeMissing(draft);
  return draft;
}
