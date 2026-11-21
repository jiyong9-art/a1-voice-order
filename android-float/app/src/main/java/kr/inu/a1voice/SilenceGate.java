package kr.inu.a1voice;

/**
 * v1.8 무음 게이트 — 녹음에 말소리가 있었는지 잰다.
 *
 * 말을 하지 않았는데 서버(Whisper)로 보내면, 모델이 고유명사 힌트를 그대로 읽어
 * "에이원코리아입니다" 같은 엉뚱한 문장을 만든다. 그래서 보내기 전에 여기서 먼저 막는다.
 *
 * 안드로이드에 의존하지 않으므로 JVM에서 그대로 시험할 수 있다(test/SilenceGateTest.java).
 * 입력은 두 번 톡톡 녹음과 같은 16kHz 모노 16비트 리틀엔디안 PCM 이다.
 */
final class SilenceGate {

    /** RMS 가 이 값을 넘는 0.1초 조각을 '말소리'로 본다 (-45 dBFS). */
    static final double SPEECH_RMS = 0.0056;
    /** 최고 음량이 이보다 작으면 사실상 디지털 무음. */
    static final float MIN_PEAK = 0.02f;
    /** 말소리 조각이 이만큼(0.2초)도 없으면 무음으로 본다. */
    static final int MIN_SPEECH_CHUNKS = 2;
    /** 한 조각의 길이(초) — PcmRecorder 가 0.1초씩 읽는다. */
    static final double CHUNK_SEC = 0.1;

    private double sq;
    private long samples;
    private float peak;
    private int speechChunks;
    private int chunks;

    void reset() {
        sq = 0;
        samples = 0;
        peak = 0f;
        speechChunks = 0;
        chunks = 0;
    }

    /** 16비트 모노 PCM 조각을 반영한다. */
    synchronized void addPcm16(byte[] buf, int length) {
        if (buf == null || length <= 1) {
            return;
        }
        double chunkSq = 0;
        int n = 0;
        float chunkPeak = 0f;
        for (int i = 0; i + 1 < length; i += 2) {
            int v = (short) (((buf[i + 1] & 0xFF) << 8) | (buf[i] & 0xFF));
            float f = v / 32768f;
            chunkSq += (double) f * f;
            if (Math.abs(f) > chunkPeak) {
                chunkPeak = Math.abs(f);
            }
            n++;
        }
        if (n == 0) {
            return;
        }
        sq += chunkSq;
        samples += n;
        if (chunkPeak > peak) {
            peak = chunkPeak;
        }
        chunks++;
        if (Math.sqrt(chunkSq / n) > SPEECH_RMS) {
            speechChunks++;
        }
    }

    /**
     * 이 녹음에 말소리가 있었는지.
     *  - 최고 음량이 사실상 0 이면 무음
     *  - 말소리 크기를 넘은 조각이 0.2초 미만이고 전체도 아주 조용하면 무음
     */
    synchronized boolean heardSpeech() {
        if (samples == 0) {
            return false;
        }
        if (peak < MIN_PEAK) {
            return false;
        }
        double rms = Math.sqrt(sq / samples);
        return speechChunks >= MIN_SPEECH_CHUNKS || rms >= SPEECH_RMS;
    }

    /** 말소리로 본 시간(초). */
    synchronized double speechSeconds() {
        return speechChunks * CHUNK_SEC;
    }

    /** 전체 RMS (dBFS). 디지털 무음이면 -Infinity. */
    synchronized double rmsDb() {
        if (samples == 0 || sq <= 0) {
            return Double.NEGATIVE_INFINITY;
        }
        return 20 * Math.log10(Math.sqrt(sq / samples));
    }

    synchronized float peak() {
        return peak;
    }

    synchronized int chunks() {
        return chunks;
    }
}
