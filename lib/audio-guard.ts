/**
 * 무음·초단시간 오디오 게이트 + 환각(빈칸) 필터 (v1.9).
 *
 * Whisper 계열 모델은 소리가 거의 없거나 잡음뿐인 파일을 받으면
 *  - prompt 에 적힌 말을 그대로 읽거나("에이원코리아입니다", 고유명사 목록 전체),
 *  - 학습 때 본 자막 문구를 뱉는다("This is a clean audio.", "Thank you.", "MBC 뉴스").
 * 그래서 두 단계로 막는다.
 *
 *  1) 소리를 먼저 재 본다 — 말소리가 없으면 모델을 부르지 않는다(analyzeAudio/silenceReason).
 *  2) 모델이 돌려준 글이 환각이면 빈 결과로 버린다(looksLikeHallucination).
 *
 * v1.9 조정: v1.8 의 기준(-45 dBFS, peak 0.02)이 작은 목소리를 '무음'으로 잘라
 * 인식률이 떨어졌으므로 에너지 기준을 -52 dBFS / peak 0.004 로 완화하고,
 * 그 대신 글 단계의 환각 차단을 넓혔다(영어 문구·목록 에코·프롬프트 문장 에코).
 *
 * - 앱(두 번 톡톡)은 16kHz 모노 16비트 WAV 로 올린다 → 길이·RMS·말소리 구간을 정확히 잰다.
 * - 그 밖의 형식(m4a·mp3 등)은 길이를 알 수 없으므로 1)을 건너뛰고 2)로만 막는다.
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
/**
 * 이 크기(-52 dBFS)를 넘는 20ms 프레임을 '말소리 구간'으로 본다.
 * v1.8 은 -45 dBFS 였는데, 폰을 멀리 두고 작게 말하면 말소리 구간이 0 에 가깝게 잡혀
 * 멀쩡한 녹음이 '무음'으로 버려졌다. 조용한 방(-58 dBFS 이하)은 여전히 걸러진다.
 */
const SPEECH_FRAME_DB = -52;
/** 이보다 짧으면 말이 시작되기 전에 손을 뗀 것으로 본다. */
const MIN_DURATION_SEC = 0.35;
/** 최고 진폭이 이보다 작으면(-48 dBFS) 마이크가 막혔거나 음소거된 것으로 본다. (v1.8: 0.02 = -34 dBFS) */
const DIGITAL_SILENCE_PEAK = 0.004;
/** 전체 RMS 가 이보다 작으면(-58 dBFS) 어떤 목소리로도 볼 수 없다. */
const SILENCE_RMS_DB = -58;
/** 말소리 구간이 이보다 짧으면서 전체도 조용하면(-52 dBFS) 무음. */
const MIN_SPEECH_SEC = 0.15;
const QUIET_RMS_DB = -52;

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
  if (profile.peak < DIGITAL_SILENCE_PEAK) {
    return "silent";
  }
  // 어떤 목소리로도 볼 수 없을 만큼 조용함
  if (profile.rmsDb < SILENCE_RMS_DB) {
    return "silent";
  }
  // 말소리로 볼 만한 구간이 거의 없고 전체도 아주 조용하면 무음 (작은 목소리는 통과)
  if (profile.speechSeconds < MIN_SPEECH_SEC && profile.rmsDb < QUIET_RMS_DB) {
    return "silent";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 환각(빈칸) 필터                                                      */
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
 * 업무에서 흔히 쓰는 보통명사. 목록 에코를 셀 때는 세지 않는다.
 * (실제 발화에도 늘 나오므로, 이것까지 '힌트를 읽었다'로 보면 진짜 말을 지운다.)
 */
const GENERIC_HINTS = new Set([
  "보험",
  "설계사",
  "약관",
  "고객",
  "상담",
  "녹취",
  "업무오더",
  "계약",
  "견적",
  "배서",
  "특약",
  "대인",
  "대물",
  "자차",
]);

/**
 * 실제로 관측된 빈칸 환각 (2026-11-21~22 대표님 보고).
 * COMPANY_VOCABULARY 환경변수가 바뀌어도 이 문장들은 절대 결과로 나가지 않게 한다.
 */
const OBSERVED_HALLUCINATIONS = [
  "에이원코리아입니다",
  "유병헌과장님",
  "유병헌과장",
  "thisisacleanaudio",
  "thankyou",
];

/**
 * Whisper 계열이 조용한 파일·잡음에서 뱉는 것으로 알려진 문구.
 * (정규화: 공백·문장부호 제거, 소문자)
 */
const KNOWN_PHRASES = [
  "thisisacleanaudio",
  "thisisacleanrecording",
  "thisisacleansound",
  "thisisaclean",
  "cleanaudio",
  "silentaudio",
  "thankyou",
  "thankyouforwatching",
  "thanksforwatching",
  "thankyouforlistening",
  "thanksforlistening",
  "pleasesubscribe",
  "pleaselikeandsubscribe",
  "구독과좋아요",
  "좋아요와구독",
  "구독부탁드립니다",
  "mbc뉴스",
  "kbs뉴스",
  "sbs뉴스",
  "ytn뉴스",
  "다음영상에서만나요",
  "다음시간에만나요",
  "시청해주셔서감사합니다",
  "자막제공",
];

const HANGUL = /[\uAC00-\uD7A3\u1100-\u11FF\u3131-\u318E]/;

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

function hintSetFrom(hints: string[]): Set<string> {
  const set = new Set<string>();
  for (const hint of hints) {
    for (const part of hint.split(/[,·/]/)) {
      const n = normalize(part);
      if (n) {
        set.add(n);
      }
    }
  }
  return set;
}

/** 글자에 남는 것이 하나도 없으면(문장부호·기호만) 말한 내용이 아니다. */
function hasContent(flat: string): boolean {
  return /[0-9a-z\uAC00-\uD7A3]/.test(flat);
}

/** 알려진 자막·환각 문구와 같은(또는 그 문구로 시작하는) 글인지. */
function matchesKnownPhrase(flat: string): boolean {
  for (const phrase of KNOWN_PHRASES) {
    if (flat === phrase) {
      return true;
    }
    if (phrase.length >= 8 && flat.includes(phrase)) {
      return true;
    }
    if (flat.startsWith(phrase) && flat.length <= phrase.length + 6) {
      return true;
    }
  }
  return false;
}

/**
 * 한글이 하나도 없는 짧은 영어 문자열은 환각으로 본다.
 * (한국어로 고정해 변환하므로, 업무 대화에서 영어 문장만 나오는 일은 없다.
 *  숫자·A1 처럼 업무에 실제로 쓰는 표기는 남긴다.)
 */
function isEnglishOnlyArtifact(raw: string): boolean {
  if (HANGUL.test(raw)) {
    return false;
  }
  if (/[0-9]/.test(raw)) {
    return false;
  }
  if (/A1/i.test(raw)) {
    return false;
  }
  return raw.replace(/[^A-Za-z]/g, "").length >= 4;
}

/** 모델에 준 프롬프트 문장 자체를 읽어 버린 경우. */
function isPromptTextEcho(flat: string, promptText?: string): boolean {
  if (!promptText) {
    return false;
  }
  const p = normalize(promptText);
  if (p.length < 12 || flat.length < 12) {
    return false;
  }
  if (flat.includes(p) || p.includes(flat)) {
    return true;
  }
  const head = p.slice(0, Math.min(18, p.length));
  return flat.startsWith(head);
}

/** 힌트(고유명사·직원 이름)를 여러 개 나열한 '목록 에코'인지. */
function isHintListEcho(flat: string, hintSet: Set<string>): boolean {
  const found: string[] = [];
  for (const hint of hintSet) {
    if (hint.length >= 2 && !GENERIC_HINTS.has(hint) && flat.includes(hint)) {
      found.push(hint);
    }
  }
  if (found.length < 2) {
    return false;
  }
  let rest = flat;
  for (const hint of found.sort((a, b) => b.length - a.length)) {
    rest = rest.split(hint).join("");
  }
  // 이름만 줄줄이 (\"에이원코리아 A1 에이원 문지용 …\")
  if (rest.length <= 3) {
    return true;
  }
  const ratio = rest.length / flat.length;
  if (found.length >= 3 && ratio < 0.2) {
    return true;
  }
  return found.length >= 5 && ratio < 0.5;
}

/**
 * 변환 결과가 '말한 내용'이 아니라 환각이면 true.
 *
 * 판단 규칙:
 *  1) 빈 글/문장부호뿐 → 버린다.
 *  2) 관측된 환각·알려진 자막 문구(\"This is a clean audio.\", \"Thank you.\", \"MBC 뉴스\") → 버린다.
 *  3) 한글 없는 짧은 영어 문자열 → 버린다.
 *  4) 프롬프트 문장을 그대로 읽은 경우 → 버린다.
 *  5) 고유명사 힌트를 여러 개 나열한 경우(목록 에코) → 버린다.
 *  6) 어절 1~3개가 모두 힌트뿐인 짧은 출력(\"에이원코리아입니다\", \"문지용 사장님\") → 버린다.
 *
 * 실제 발화(\"고객님 후유장해가 뭐죠?\", \"이광훈 송현준한테 보내\")는 지우지 않는다.
 */
export function looksLikeHallucination(text: string, hints: string[], promptText?: string): boolean {
  const raw = (text ?? "").trim();
  if (!raw) {
    return false;
  }
  const flat = normalize(raw);
  if (!flat || !hasContent(flat)) {
    return true;
  }
  if (OBSERVED_HALLUCINATIONS.some((h) => flat === normalize(h))) {
    return true;
  }
  if (matchesKnownPhrase(flat)) {
    return true;
  }
  if (isEnglishOnlyArtifact(raw)) {
    return true;
  }
  if (isPromptTextEcho(flat, promptText)) {
    return true;
  }

  const hintSet = hintSetFrom(hints);
  if (hintSet.size === 0) {
    return false;
  }
  if (isHintListEcho(flat, hintSet)) {
    return true;
  }

  // 길게 말한 내용을 함부로 지우지 않는다.
  if (flat.length > 40) {
    return false;
  }

  for (const hint of hintSet) {
    if (GENERIC_HINTS.has(hint)) {
      continue;
    }
    if (hint.length >= 3 && flat.includes(hint) && flat.length <= hint.length + 6) {
      // \"에이원코리아입니다\" 처럼 힌트 + 조사 정도만 붙은 경우
      const rest = flat.split(hint).join("");
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
    if (GENERIC_HINTS.has(c) || GENERIC_HINTS.has(token)) {
      return false; // 보통명사가 섞이면 실제 말일 수 있다
    }
    if (hintSet.has(c) || hintSet.has(token)) {
      matched++;
      continue;
    }
    return false;
  }
  return matched > 0;
}

/** 이전 이름(다른 코드·시험이 부르던 것) — 같은 판단을 한다. */
export function looksLikePromptEcho(text: string, hints: string[], promptText?: string): boolean {
  return looksLikeHallucination(text, hints, promptText);
}
