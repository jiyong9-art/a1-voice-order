/**
 * 무음·초단시간 오디오 게이트 (v1.8).
 *
 * Whisper 계열 모델은 소리가 거의 없는 파일을 받으면 prompt(회사 고유명사 힌트)에 적힌 말을
 * 그대로 뱉는 경우가 있다(예: "에이원코리아입니다", "유병헌 과장님").
 * 그래서 서버가 먼저 소리를 재 보고, 말소리가 없으면 모델을 부르지 않고 빈 결과를 돌려준다.
 *
 * - 앱(두 번 톡톡)은 16kHz 모노 16비트 WAV 로 올린다 → 여기서 길이·RMS·말소리 구간을 정확히 잰다.
 * - 그 밖의 형식(m4a·mp3 등)은 길이를 알 수 없으므로 이 게이트를 건너뛰고,
 *   변환 결과에 대한 프롬프트 에코 필터(looksLikePromptEcho)로 막는다.
 */

export type AudioProfile = {
  /** wav 로 읽었는지 (아니면 게이트를 건너뛴다) */
  format: "wav" | "unknown";
  durationSec: number;
  /** 전체 RMS (dBFS, 디지털 무음이면 -Infinity) */
  rmsDb: number;
  /** 최대 진폭 (0~1) */
  peak: number;
  /** 말소리 크기를 넘은 구간의 총 길이(초) */
  speechSeconds: number;
  /** 말소리 구간 비율 (0~1) */
  speechRatio: number;
};

export type SilenceReason = "too_short" | "silent";

/** 20ms 프레임 */
const FRAME_MS = 20;
/** 이 크기(-45 dBFS)를 넘는 20ms 프레임을 '말소리 구간'으로 본다. 조용한 방(–60 dBFS)은 걸러진다. */
const SPEECH_FRAME_DB = -45;
/** 이보다 짧으면 말이 시작되기 전에 손을 뗀 것으로 본다. */
const MIN_DURATION_SEC = 0.35;

function db(amplitude: number): number {
  if (!(amplitude > 0)) {
    return -Infinity;
  }
  return 20 * Math.log10(amplitude);
}

const EMPTY: AudioProfile = {
  format: "unknown",
  durationSec: 0,
  rmsDb: -Infinity,
  peak: 0,
  speechSeconds: 0,
  speechRatio: 0,
};

/**
 * WAV(RIFF) 바이트를 읽어 길이·크기를 잰다. PCM 8/16/24/32비트를 지원하고,
 * 읽을 수 없는 형식이면 format:"unknown" 만 돌려준다(예외를 던지지 않는다).
 */
export function analyzeAudio(bytes: Uint8Array): AudioProfile {
  try {
    if (bytes.length < 44) {
      return { ...EMPTY };
    }
    const ascii = (at: number, len: number) => {
      let s = "";
      for (let i = 0; i < len; i++) {
        s += String.fromCharCode(bytes[at + i]);
      }
      return s;
    };
    if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
      return { ...EMPTY };
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let channels = 0;
    let sampleRate = 0;
    let bits = 0;
    let audioFormat = 0;
    let dataAt = -1;
    let dataLen = 0;

    let at = 12;
    while (at + 8 <= bytes.length) {
      const id = ascii(at, 4);
      const size = view.getUint32(at + 4, true);
      const body = at + 8;
      if (id === "fmt " && body + 16 <= bytes.length) {
        audioFormat = view.getUint16(body, true);
        channels = view.getUint16(body + 2, true);
        sampleRate = view.getUint32(body + 4, true);
        bits = view.getUint16(body + 14, true);
        // WAVE_FORMAT_EXTENSIBLE(0xFFFE) 도 PCM 으로 취급한다.
        if (audioFormat === 0xfffe) {
          audioFormat = 1;
        }
      } else if (id === "data") {
        dataAt = body;
        dataLen = Math.min(size, bytes.length - body);
        break;
      }
      at = body + size + (size % 2);
      if (size <= 0) {
        break;
      }
    }

    if (dataAt < 0 || channels <= 0 || sampleRate <= 0 || bits <= 0) {
      return { ...EMPTY };
    }
    const bytesPerSample = bits / 8;
    const blockAlign = bytesPerSample * channels;
    if (!Number.isFinite(blockAlign) || blockAlign <= 0) {
      return { ...EMPTY };
    }

    const totalSamples = Math.floor(dataLen / blockAlign);
    if (totalSamples <= 0) {
      return { ...EMPTY };
    }
    const durationSec = totalSamples / sampleRate;

    const readSample = (offset: number): number => {
      // 첫 채널만 본다(앱은 모노로 올린다). 채널이 여럿이면 최대 진폭을 쓰기 위해 아래에서 평균을 낸다.
      if (bits === 16) {
        return view.getInt16(offset, true) / 32768;
      }
      if (bits === 8) {
        return (view.getUint8(offset) - 128) / 128;
      }
      if (bits === 24) {
        const b0 = view.getUint8(offset);
        const b1 = view.getUint8(offset + 1);
        const b2 = view.getUint8(offset + 2);
        let v = (b2 << 16) | (b1 << 8) | b0;
        if (v & 0x800000) {
          v -= 0x1000000;
        }
        return v / 8388608;
      }
      if (bits === 32) {
        return view.getInt32(offset, true) / 2147483648;
      }
      return 0;
    };

    const framesPerBlock = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
    let totalSq = 0;
    let peak = 0;
    let blockSq = 0;
    let blockCount = 0;
    let speechFrames = 0;
    let blockTotal = 0;

    for (let s = 0; s < totalSamples; s++) {
      const base = dataAt + s * blockAlign;
      // 여러 채널이면 가장 큰 진폭을 그 샘플의 값으로 본다.
      let v = 0;
      for (let c = 0; c < channels; c++) {
        const sample = readSample(base + c * bytesPerSample);
        if (Math.abs(sample) > Math.abs(v)) {
          v = sample;
        }
      }
      totalSq += v * v;
      blockSq += v * v;
      blockTotal++;
      if (Math.abs(v) > peak) {
        peak = Math.abs(v);
      }
      if (blockTotal >= framesPerBlock) {
        const frameRms = Math.sqrt(blockSq / blockTotal);
        if (db(frameRms) > SPEECH_FRAME_DB) {
          speechFrames++;
        }
        blockSq = 0;
        blockTotal = 0;
      }
    }
    if (blockTotal > 0) {
      const frameRms = Math.sqrt(blockSq / blockTotal);
      if (db(frameRms) > SPEECH_FRAME_DB) {
        speechFrames++;
      }
    }

    const totalBlocks = Math.ceil(totalSamples / framesPerBlock);
    const speechRatio = totalBlocks > 0 ? speechFrames / totalBlocks : 0;
    const speechSeconds = durationSec * speechRatio;
    const rmsDb = db(Math.sqrt(totalSq / totalSamples));

    return {
      format: "wav",
      durationSec: Number(durationSec.toFixed(2)),
      rmsDb: Number.isFinite(rmsDb) ? Number(rmsDb.toFixed(1)) : -Infinity,
      peak: Number(peak.toFixed(4)),
      speechSeconds: Number(speechSeconds.toFixed(2)),
      speechRatio: Number(speechRatio.toFixed(3)),
    };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * 이 오디오를 모델에 보내지 않아야 하면 사유를, 말이 들리는 것 같으면 null 을 돌려준다.
 * (WAV 가 아니면 판단하지 않는다 — 알 수 없는데 막으면 진짜 녹음을 잃는다.)
 */
export function silenceReason(profile: AudioProfile): SilenceReason | null {
  if (profile.format !== "wav" || !(profile.durationSec > 0)) {
    return null;
  }
  if (profile.durationSec < MIN_DURATION_SEC) {
    return "too_short";
  }
  // 사실상 디지털 무음 (마이크가 막혔거나 음소거)
  if (profile.peak < 0.02) {
    return "silent";
  }
  // 말소리로 볼 만한 구간이 0.2초도 없고 전체도 아주 조용하면 무음
  if (profile.speechSeconds < 0.2 && profile.rmsDb < -45) {
    return "silent";
  }
  if (profile.rmsDb < -55) {
    return "silent";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 프롬프트 에코(빈칸 환각) 필터                                          */
/* ------------------------------------------------------------------ */

/** 조사·호칭처럼 뜻이 없는 꼬리는 떼고 비교한다. */
const TAIL_SUFFIXES = [
  "입니다",
  "이에요",
  "예요",
  "이죠",
  "이야",
  "이고",
  "이며",
  "에서",
  "에게",
  "께서",
  "까지",
  "부터",
  "하고",
  "님",
  "씨",
];

/** 직함만 있는 말은 무시한다. */
const GENERIC_TITLES = new Set([
  "과장",
  "부장",
  "대리",
  "팀장",
  "사장",
  "대표",
  "선생",
  "실장",
  "이사",
  "본부장",
]);

/**
 * 실제로 관측된 빈칸 환각 문장 (2026-11-21 대표님 보고).
 * COMPANY_VOCABULARY 환경변수가 바뀌어도 이 문장들은 절대 결과로 나가지 않게 한다.
 */
const OBSERVED_HALLUCINATIONS = ["에이원코리아입니다", "유병헌과장님", "유병헌과장"];

function core(token: string): string {
  let s = token;
  for (const suffix of TAIL_SUFFIXES) {
    if (s.length > suffix.length && s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  return s;
}

function normalize(text: string): string {
  return text.replace(/[\s.,!?~…"'“”‘’()\[\]\-·:;]/g, "").toLowerCase();
}

/**
 * 변환 결과가 '말한 내용'이 아니라 프롬프트(고유명사 힌트)를 그대로 읽은 것이면 true.
 *
 * 판단 규칙(짧은 출력에만 적용한다):
 *  1) 관측된 환각 문장과 같으면 에코.
 *  2) 어절이 1~3개이고, 모든 어절의 핵심 말이 힌트 목록(회사 고유명사·직원 이름)에 있으면 에코.
 *     ("에이원코리아입니다" → 에이원코리아 + 입니다 → 에코)
 *  3) 정규화한 문장이 힌트 문장에 통째로 들어 있으면 에코.
 */
export function looksLikePromptEcho(text: string, hints: string[]): boolean {
  const raw = (text ?? "").trim();
  if (!raw) {
    return false;
  }
  const flat = normalize(raw);
  if (!flat) {
    return false;
  }
  if (OBSERVED_HALLUCINATIONS.some((h) => flat === normalize(h))) {
    return true;
  }
  // 길게 말한 내용을 함부로 지우지 않는다.
  if (flat.length > 40) {
    return false;
  }

  const hintSet = new Set<string>();
  for (const hint of hints) {
    for (const part of hint.split(/[,·/]/)) {
      const n = normalize(part);
      if (n) {
        hintSet.add(n);
      }
    }
  }
  if (hintSet.size === 0) {
    return false;
  }

  for (const hint of hintSet) {
    if (hint.length >= 3 && flat.includes(hint) && flat.length <= hint.length + 6) {
      // "에이원코리아입니다" 처럼 힌트 + 조사 정도만 붙은 경우
      const rest = flat.replace(hint, "");
      if (rest.length <= 5) {
        return true;
      }
    }
  }

  const tokens = raw.split(/\s+/).map((t) => normalize(t)).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) {
    return false;
  }
  let matched = 0;
  for (const token of tokens) {
    const c = core(token);
    if (!c) {
      continue;
    }
    if (GENERIC_TITLES.has(c) || GENERIC_TITLES.has(token)) {
      continue; // 직함은 세지 않는다
    }
    if (hintSet.has(c) || hintSet.has(token)) {
      matched++;
      continue;
    }
    return false;
  }
  return matched > 0;
}
