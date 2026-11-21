#!/usr/bin/env node
/**
 * lib/audio-guard.ts 자체 시험 (v1.8).
 *   node --experimental-strip-types scripts/test-audio-guard.mjs
 *
 * 실제 마이크 없이 WAV 바이트를 만들어 무음 게이트·프롬프트 에코 필터만 검사한다.
 */
import { analyzeAudio, looksLikeHallucination, silenceReason } from "../lib/audio-guard.ts";

const RATE = 16000;

/**
 * 시험용 WAV. amplitude>0 이면 '말소리처럼' 음절마다 크기가 오르내리게 만든다
 * (일정한 사인파는 실제 말소리가 아니라 잡음으로 판정된다 — v1.9).
 */
function wav({ seconds, amplitude = 0, freq = 440, noise = 0, flat = false }) {
  const samples = Math.round(seconds * RATE);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / RATE;
    // 실제 말소리처럼 음절마다 오르내리고, 단어 사이에 짧은 틈이 있다.
    const syllable = flat ? 1 : t % 1.3 < 0.18 ? 0.002 : 0.15 + 0.85 * Math.abs(Math.sin(2 * Math.PI * 3.4 * t));
    let v = Math.sin((2 * Math.PI * freq * i) / RATE) * amplitude * syllable;
    if (noise) {
      v += (Math.random() * 2 - 1) * noise;
    }
    v = Math.max(-1, Math.min(1, v));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return new Uint8Array(Buffer.concat([header, data]));
}

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (기대 ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}

/* --- 1) 무음 게이트 ------------------------------------------------- */
const oneSecSilence = analyzeAudio(wav({ seconds: 1 }));
console.log("1초 무음 프로필:", oneSecSilence);
check("1초 무음 → silent", silenceReason(oneSecSilence), "silent");
check("1초 무음 길이", oneSecSilence.durationSec, 1);
check("1초 무음 peak", oneSecSilence.peak, 0);

check("0.2초 무음 → too_short", silenceReason(analyzeAudio(wav({ seconds: 0.2 }))), "too_short");

const speechish = analyzeAudio(wav({ seconds: 3, amplitude: 0.25 }));
console.log("3초 소리 프로필:", speechish);
check("3초 보통 크기 말소리 → 통과", silenceReason(speechish), null);

// v1.9: 크기가 평평한 잡음(모터·바람)은 모델을 부르지 않는다 — 없던 문장을 만들어 내기 때문
const flatNoise = analyzeAudio(wav({ seconds: 3, amplitude: 0.05, flat: true }));
console.log("평평한 잡음 프로필:", flatNoise);
check("평평한 잡음(사인파) → silent", silenceReason(flatNoise), "silent");

const faint = analyzeAudio(wav({ seconds: 2, amplitude: 0.002 }));
console.log("아주 작은 소리 프로필:", faint);
check("아주 작은 소리(-54dB) → silent", silenceReason(faint), "silent");

const roomNoise = analyzeAudio(wav({ seconds: 2, noise: 0.0003 }));
console.log("방 소음 프로필:", roomNoise);
check("조용한 방 잡음 → silent", silenceReason(roomNoise), "silent");

// v1.9: 작은 목소리(peak -40 dBFS)는 버리지 않는다 — v1.8 은 peak 0.02 기준이라 버렸다.
const smallVoice = analyzeAudio(wav({ seconds: 2, amplitude: 0.01 }));
console.log("작은 목소리 프로필:", smallVoice);
check("작은 목소리(peak -40dB) → 통과", silenceReason(smallVoice), null);

const tinyVoice = analyzeAudio(wav({ seconds: 2, amplitude: 0.003 }));
console.log("아주 작은 목소리 프로필:", tinyVoice);
check("거의 들리지 않는 소리(peak -50dB) → silent", silenceReason(tinyVoice), "silent");

const digitalSilence = analyzeAudio(wav({ seconds: 2, amplitude: 0.0005 }));
console.log("디지털 무음 프로필:", digitalSilence);
check("디지털 무음(peak -66dB) → silent", silenceReason(digitalSilence), "silent");

check("WAV 가 아닌 파일 → 판단 보류", silenceReason(analyzeAudio(new Uint8Array([1, 2, 3]))), null);

// 무음 1초 + 말소리 2초 (앞뒤가 조용한 실제 녹음 모양)
const mixed = Buffer.concat([
  Buffer.from(wav({ seconds: 1 })),
  Buffer.from(wav({ seconds: 2, amplitude: 0.2 })),
]);
const mixedProfile = analyzeAudio(new Uint8Array(mixed.subarray(44).buffer.slice(0)));
console.log("참고: 조용한 구간 + 말소리 조각(조각만 따로 잰 값):", mixedProfile.format);

/* --- 2) 프롬프트 에코 필터 ------------------------------------------ */
const hints = [
  "에이원코리아",
  "A1",
  "에이원",
  "에이팩스미디어",
  "A1KOREA",
  "문지용",
  "이광훈",
  "송현준",
  "백남우",
  "김남국",
  "한원석",
  "차정호",
  "유병은",
  "보험",
  "설계사",
  "약관",
  "후유장해",
  "고객",
  "상담",
  "녹취",
  "업무오더",
  "유병헌",
];

check("'에이원코리아입니다' → 환각", looksLikeHallucination("에이원코리아입니다", hints), true);
check("'유병헌 과장님' → 환각", looksLikeHallucination("유병헌 과장님", hints), true);
check("'에이원코리아' → 환각", looksLikeHallucination("에이원코리아", hints), true);
check("'문지용 사장님' → 환각", looksLikeHallucination("문지용 사장님", hints), true);
check("'고객님 후유장해가 뭐죠?' → 실제 말", looksLikeHallucination("고객님 후유장해가 뭐죠?", hints), false);
check(
  "'내일 오전까지 견적서 수정본 보내줘' → 실제 말",
  looksLikeHallucination("내일 오전까지 견적서 수정본 보내줘", hints),
  false,
);
check(
  "'에이원코리아 담당자한테 연락해' → 실제 말",
  looksLikeHallucination("에이원코리아 담당자한테 연락해", hints),
  false,
);
check("빈 문자열 → 통과", looksLikeHallucination("", hints), false);
check(
  "힌트가 비어 있으면 막지 않는다",
  looksLikeHallucination("에이원코리아입니다", []),
  true, // 관측된 환각 목록은 힌트와 무관하게 막는다
);


/* --- 3) v1.9: 영어 환각·목록 에코·프롬프트 에코 -------------------- */
const PROMPT =
  "에이원코리아 사내 업무 대화입니다. 보험 상담과 견적, 계약, 배서, 사고 접수 이야기를 하던 중이었고, " +
  "문지용, 이광훈, 송현준, 백남우, 김남국, 한원석, 차정호, 유병은 같은 직원 이름과 " +
  "에이원코리아, 에이팩스미디어, 후유장해, 기계가액, 배서, 특약, 대인, 대물, 자차 같은 보험 용어가 나옵니다.";

const ECHOED_LIST =
  "에이원코리아, A1, 에이원, 에이팩스미디어, A1KOREA, 문지용, 이광훈, 송현준, 백남우, 김남국, 한원석, 차정호, 유병은, " +
  "보험, 설계사, 약관, 후유장해, 고객, 상담, 녹취, 업무오더";

check("고유명사 목록 전체를 읽음 → 환각", looksLikeHallucination(ECHOED_LIST, hints, PROMPT), true);
check("히트 10개만 읽음 → 환각", looksLikeHallucination("문지용, 이광훈, 송현준, 백남우, 김남국, 한원석", hints, PROMPT), true);
check("'This is a clean audio.' → 환각", looksLikeHallucination("This is a clean audio.", hints, PROMPT), true);
check("'Thank you.' → 환각", looksLikeHallucination("Thank you.", hints, PROMPT), true);
check("'Thanks for watching!' → 환각", looksLikeHallucination("Thanks for watching!", hints, PROMPT), true);
check("'MBC 뉴스입니다' → 환각", looksLikeHallucination("MBC 뉴스입니다", hints, PROMPT), true);
check("'구독과 좋아요 부탁드립니다' → 환각", looksLikeHallucination("구독과 좋아요 부탁드립니다", hints, PROMPT), true);
check("문장부호만('...') → 환각", looksLikeHallucination("...", hints, PROMPT), true);
check("영어만 있는 문장 → 환각", looksLikeHallucination("Send me the file", hints, PROMPT), true);
check("'OK' → 통과", looksLikeHallucination("OK", hints, PROMPT), false);
check("'A1' 한 단어 → 환각(업무 내용 없음)", looksLikeHallucination("A1", hints, PROMPT), true);
check("프롬프트 문장 자체 → 환각", looksLikeHallucination(PROMPT, hints, PROMPT), true);
check("프롬프트 앞부분만 → 환각", looksLikeHallucination("에이원코리아 사내 업무 대화입니다", hints, PROMPT), true);
check("'보험 상담 문의' → 실제 말", looksLikeHallucination("보험 상담 문의", hints, PROMPT), false);
check("'이광훈 송현준 김남국한테 다 보내' → 실제 말", looksLikeHallucination("이광훈 송현준 김남국한테 다 보내", hints, PROMPT), false);
check(
  "'에이원코리아 김남국 과장님 보험 견적서 전달해 주세요' → 실제 말",
  looksLikeHallucination("에이원코리아 김남국 과장님 보험 견적서 전달해 주세요", hints, PROMPT),
  false,
);
check("'네 알겠습니다 감사합니다' → 실제 말", looksLikeHallucination("네 알겠습니다 감사합니다", hints, PROMPT), false);
check("'한결로지스 찾아줘' → 실제 말", looksLikeHallucination("한결로지스 찾아줘", hints, PROMPT), false);
check(
  "'전동지게차 견적 부탁드립니다' → 실제 말",
  looksLikeHallucination("전동지게차 견적 부탁드립니다", hints, PROMPT),
  false,
);
check(
  "'후유장해 특약이랑 대인 대물 한도 확인해 주세요' → 실제 말",
  looksLikeHallucination("후유장해 특약이랑 대인 대물 한도 확인해 주세요", hints, PROMPT),
  false,
);

console.log(failed === 0 ? "\n전부 통과" : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
