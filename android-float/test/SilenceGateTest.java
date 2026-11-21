package kr.inu.a1voice;

/**
 * 무음 게이트 자체 시험 (v1.8) — 안드로이드 없이 JVM 에서 돈다.
 *
 *   javac -encoding UTF-8 -d test/out app/src/main/java/kr/inu/a1voice/SilenceGate.java test/SilenceGateTest.java
 *   java -cp test/out SilenceGateTest
 *
 * 실제 마이크 없이 PCM 바이트를 만들어 '무음 / 조용한 방 잡음 / 말소리' 만 검사한다.
 */
public class SilenceGateTest {

    private static final int RATE = 16000;
    private static int failed;

    public static void main(String[] args) {
        // 1) 완전 무음 1초
        SilenceGate silence = new SilenceGate();
        feed(silence, silencePcm(1.0));
        check("1초 완전 무음 → 말소리 없음", silence.heardSpeech(), false);
        check("1초 완전 무음 peak 0", silence.peak() == 0f, true);

        // 2) 아주 짧은 무음 0.1초
        SilenceGate tiny = new SilenceGate();
        feed(tiny, silencePcm(0.1));
        check("0.1초 무음 → 말소리 없음", tiny.heardSpeech(), false);

        // 3) 조용한 방 잡음 2초 (±30, 약 -62dB)
        SilenceGate noise = new SilenceGate();
        feed(noise, noisePcm(2.0, 30));
        check("방 잡음 2초 → 말소리 없음", noise.heardSpeech(), false);

        // 4) 보통 크기 소리 2초 (사인파 0.2)
        SilenceGate speech = new SilenceGate();
        feed(speech, tonePcm(2.0, 0.2));
        check("보통 크기 소리 2초 → 말소리 있음", speech.heardSpeech(), true);
        check("보통 크기 rmsDb 가 -20 근처", Math.abs(speech.rmsDb() - (-18.0)) < 4.0, true);

        // 5) 아주 작은 소리 2초 (0.002)
        SilenceGate faint = new SilenceGate();
        feed(faint, tonePcm(2.0, 0.002));
        check("아주 작은 소리 2초 → 말소리 없음", faint.heardSpeech(), false);

        // 6) 앞 3초 무음 + 뒤 1초 말소리 (실제로 말이 늦게 시작한 경우)
        SilenceGate mixed = new SilenceGate();
        feed(mixed, silencePcm(3.0));
        feed(mixed, tonePcm(1.0, 0.15));
        check("3초 무음 + 1초 말소리 → 말소리 있음", mixed.heardSpeech(), true);
        check("말소리 시간 약 1초", Math.abs(mixed.speechSeconds() - 1.0) < 0.2, true);

        // 7) reset 후에는 다시 무음
        speech.reset();
        check("reset 후 → 말소리 없음", speech.heardSpeech(), false);

        System.out.println(failed == 0 ? "전부 통과" : failed + "건 실패");
        if (failed > 0) {
            System.exit(1);
        }
    }

    private static void feed(SilenceGate gate, byte[] pcm) {
        // 실제 녹음기처럼 0.1초(3200바이트)씩 넣는다.
        int chunk = RATE / 10 * 2;
        for (int i = 0; i < pcm.length; i += chunk) {
            int n = Math.min(chunk, pcm.length - i);
            byte[] part = new byte[n];
            System.arraycopy(pcm, i, part, 0, n);
            gate.addPcm16(part, n);
        }
    }

    private static byte[] silencePcm(double seconds) {
        return new byte[(int) Math.round(seconds * RATE) * 2];
    }

    private static byte[] tonePcm(double seconds, double amplitude) {
        int samples = (int) Math.round(seconds * RATE);
        byte[] out = new byte[samples * 2];
        for (int i = 0; i < samples; i++) {
            double v = Math.sin(2 * Math.PI * 440 * i / RATE) * amplitude;
            short s = (short) Math.round(v * 32767);
            out[i * 2] = (byte) (s & 0xFF);
            out[i * 2 + 1] = (byte) ((s >> 8) & 0xFF);
        }
        return out;
    }

    private static byte[] noisePcm(double seconds, int maxAbs) {
        int samples = (int) Math.round(seconds * RATE);
        byte[] out = new byte[samples * 2];
        java.util.Random r = new java.util.Random(42);
        for (int i = 0; i < samples; i++) {
            short s = (short) (r.nextInt(maxAbs * 2 + 1) - maxAbs);
            out[i * 2] = (byte) (s & 0xFF);
            out[i * 2 + 1] = (byte) ((s >> 8) & 0xFF);
        }
        return out;
    }

    private static void check(String name, boolean actual, boolean expected) {
        boolean ok = actual == expected;
        System.out.println((ok ? "OK   " : "FAIL ") + name + ": " + actual
                + (ok ? "" : " (기대 " + expected + ")"));
        if (!ok) {
            failed++;
        }
    }
}
