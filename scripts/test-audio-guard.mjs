#!/usr/bin/env node
/**
 * lib/audio-guard.ts 자체 시험 (v1.8).
 *   node --experimental-strip-types scripts/test-audio-guard.mjs
 *
 * 실제 마이크 없이 WAV 바이트를 만들어 무음 게이트·프롬프트 에코 필터만 검사한다.
 */
import { analyzeAudio, looksLikePromptEcho, silenceReason } from "../lib/audio-guard.ts";

const RATE = 16000;

function wav({ seconds, amplitude = 0, freq = 440, noise = 0 }) {
  const samples = Math.round(seconds * RATE);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    let v = Math.sin((2 * Math.PI * freq * i) / RATE) * amplitude;
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
check("3초 보통 크기 소리 → 통과", silenceReason(speechish), null);

const faint = analyzeAudio(wav({ seconds: 2, amplitude: 0.002 }));
console.log("아주 작은 소리 프로필:", faint);
check("아주 작은 소리(-54dB) → silent", silenceReason(faint), "silent");

const roomNoise = analyzeAudio(wav({ seconds: 2, noise: 0.0003 }));
console.log("방 소음 프로필:", roomNoise);
check("조용한 방 잡음 → silent", silenceReason(roomNoise), "silent");

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

check("'에이원코리아입니다' → 환각", looksLikePromptEcho("에이원코리아입니다", hints), true);
check("'유병헌 과장님' → 환각", looksLikePromptEcho("유병헌 과장님", hints), true);
check("'에이원코리아' → 환각", looksLikePromptEcho("에이원코리아", hints), true);
check("'문지용 사장님' → 환각", looksLikePromptEcho("문지용 사장님", hints), true);
check("'고객님 후유장해가 뭐죠?' → 실제 말", looksLikePromptEcho("고객님 후유장해가 뭐죠?", hints), false);
check(
  "'내일 오전까지 견적서 수정본 보내줘' → 실제 말",
  looksLikePromptEcho("내일 오전까지 견적서 수정본 보내줘", hints),
  false,
);
check(
  "'에이원코리아 담당자한테 연락해' → 실제 말",
  looksLikePromptEcho("에이원코리아 담당자한테 연락해", hints),
  false,
);
check("빈 문자열 → 통과", looksLikePromptEcho("", hints), false);
check(
  "힌트가 비어 있으면 막지 않는다",
  looksLikePromptEcho("에이원코리아입니다", []),
  true, // 관측된 환각 목록은 힌트와 무관하게 막는다
);

console.log(failed === 0 ? "\n전부 통과" : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
