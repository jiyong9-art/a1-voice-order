/**
 * 영업 오더(/api/sales/voice) 입구에서 쓰는 개인정보 가리기 도우미.
 *
 * - 주민등록번호 13자리: 앞 6자리 + 성별 1자리만 남기고 뒤 6자리는 별표 (예: 900101-1******)
 * - 카드번호 16자리: 가운데 8자리 별표 (예: 1234-****-****-5678)
 * - 사업자등록번호(3-2-5)와 휴대폰번호(3-4-4)는 업무에 필요하므로 건드리지 않는다.
 *
 * 모든 처리는 메모리에서만 하고 결과를 디스크에 남기지 않는다.
 */

export interface MaskResult {
  text: string;
  /** 가린 주민등록번호 개수 */
  rrn: number;
  /** 가린 카드번호 개수 */
  card: number;
  masked: boolean;
}

const CARD_PATTERN = /\b(\d{4})[-\s]?(\d{4})[-\s]?(\d{4})[-\s]?(\d{4})\b/g;
const RRN_WITH_SEP = /(\d{6})\s*[-–]\s*([1-8])\d{6}/g;
const RRN_PLAIN = /(?<!\d)(\d{6})([1-8])\d{6}(?!\d)/g;

export function maskSensitiveText(input: string): MaskResult {
  if (!input) return { text: "", rrn: 0, card: 0, masked: false };
  let rrn = 0;
  let card = 0;

  // 카드번호를 먼저 가려, 16자리 숫자가 주민번호로 잘못 인식되지 않게 한다.
  let text = input.replace(CARD_PATTERN, (_m, a: string, b: string, c: string, d: string) => {
    card += 1;
    return `${a}-****-****-${d}`;
  });

  text = text.replace(RRN_WITH_SEP, (_m, front: string, gender: string) => {
    rrn += 1;
    return `${front}-${gender}******`;
  });

  text = text.replace(RRN_PLAIN, (_m, front: string, gender: string) => {
    rrn += 1;
    return `${front}-${gender}******`;
  });

  return { text, rrn, card, masked: rrn > 0 || card > 0 };
}

/** 객체 안의 모든 문자열 값에 같은 마스킹을 적용한다(사업자번호는 10자리라 해당 없음). */
export function maskDeep<T>(value: T): { value: T; rrn: number; card: number } {
  let rrn = 0;
  let card = 0;
  const walk = (input: unknown): unknown => {
    if (typeof input === "string") {
      const masked = maskSensitiveText(input);
      rrn += masked.rrn;
      card += masked.card;
      return masked.text;
    }
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) out[k] = walk(v);
      return out;
    }
    return input;
  };
  return { value: walk(value) as T, rrn, card };
}

export function warningForMasking(rrn: number, card: number): string | null {
  const parts: string[] = [];
  if (rrn > 0) parts.push(`주민등록번호 ${rrn}건(뒷자리 7자리)`);
  if (card > 0) parts.push(`카드번호 ${card}건`);
  if (parts.length === 0) return null;
  return `${parts.join(", ")}이(가) 감지되어 가린 뒤 처리했습니다. 원문은 저장하지 않습니다.`;
}
