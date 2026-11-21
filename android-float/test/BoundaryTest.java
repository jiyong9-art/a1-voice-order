package kr.inu.a1voice;

/**
 * 빠른 분할(v1.4)의 조각 경계 규칙을 JVM에서 확인하는 시험.
 * 안드로이드 기기 없이 AudioChunker.needsNewPart() 만 호출한다(android.jar 스텁 사용).
 *
 * 실행:
 *   javac -source 8 -target 8 -bootclasspath $SDK/platforms/android-34/android.jar \
 *         -d test/out app/src/main/java/kr/inu/a1voice/AudioChunker.java test/BoundaryTest.java
 *   java -cp test/out:$SDK/platforms/android-34/android.jar BoundaryTest
 */
public class BoundaryTest {
    static int fails = 0;

    static void check(String label, boolean got, boolean want) {
        if (got != want) {
            fails++;
            System.out.println("FAIL " + label + " got=" + got + " want=" + want);
        } else {
            System.out.println("ok   " + label + " = " + got);
        }
    }

    public static void main(String[] args) {
        long MB = 1024L * 1024L;

        // 15분 경계: 14분 59.9초는 같은 조각, 15분 0초는 새 조각
        check("14m59.9s", AudioChunker.needsNewPart(899900000L, 0L, 5 * MB, 400), false);
        check("15m00.0s", AudioChunker.needsNewPart(900000000L, 0L, 5 * MB, 400), true);
        check("2nd part 14m59s", AudioChunker.needsNewPart(1799000000L, 900000000L, 5 * MB, 400), false);
        check("2nd part 15m00s", AudioChunker.needsNewPart(1800000000L, 900000000L, 5 * MB, 400), true);

        // 18MB 상한: 17.9MB는 같은 조각, 18MB에서 다음 샘플이 넘치면 새 조각
        check("17.9MB", AudioChunker.needsNewPart(10000000L, 0L, (long) (17.9 * MB), 1024), false);
        check("18MB exact fit", AudioChunker.needsNewPart(10000000L, 0L, 18 * MB, 0), false);
        check("18MB + 1 byte", AudioChunker.needsNewPart(10000000L, 0L, 18 * MB, 1), true);

        // 1시간 → 4조각, 2시간 → 8조각
        System.out.println("chunkCount(3600)=" + AudioChunker.chunkCount(3600)
                + " chunkCount(7200)=" + AudioChunker.chunkCount(7200));
        if (AudioChunker.chunkCount(3600) != 4 || AudioChunker.chunkCount(7200) != 8) {
            fails++;
        }

        // 1시간 AAC(44.1kHz, 1024샘플/프레임, ~400B/샘플)를 실제 규칙으로 훑어 조각 수를 센다
        long frameUs = 1024L * 1000000L / 44100L;
        long pts = 0L;
        long partStart = 0L;
        long bytes = 0L;
        int parts = 0;
        boolean first = true;
        while (pts < 3600L * 1000000L) {
            if (first || AudioChunker.needsNewPart(pts, partStart, bytes, 400)) {
                parts++;
                partStart = pts;
                bytes = 0L;
                first = false;
            }
            bytes += 400;
            pts += frameUs;
        }
        System.out.println("1h @128kbps simulated parts=" + parts + " lastPartBytes=" + bytes);
        if (parts != 4) {
            fails++;
            System.out.println("FAIL expected 4 parts for 1 hour");
        }

        // 큰 비트레이트(320kbps, 1000B/샘플)면 18MB 상한에 먼저 닿아 조각이 더 잘게 나뉜다
        pts = 0L;
        partStart = 0L;
        bytes = 0L;
        parts = 0;
        first = true;
        long lastBytes = 0L;
        while (pts < 3600L * 1000000L) {
            if (first || AudioChunker.needsNewPart(pts, partStart, bytes, 1000)) {
                if (!first) {
                    lastBytes = Math.max(lastBytes, bytes);
                }
                parts++;
                partStart = pts;
                bytes = 0L;
                first = false;
            }
            bytes += 1000;
            pts += frameUs;
        }
        lastBytes = Math.max(lastBytes, bytes);
        System.out.println("1h @320kbps simulated parts=" + parts + " maxPartBytes=" + lastBytes
                + " (" + (lastBytes / MB) + "MB)");
        if (lastBytes > 18L * MB) {
            fails++;
            System.out.println("FAIL part above 18MB");
        }
        if (parts < 4) {
            fails++;
            System.out.println("FAIL too few parts at high bitrate");
        }

        System.out.println(fails == 0 ? "ALL PASS" : fails + " FAILURES");
        if (fails != 0) {
            System.exit(1);
        }
    }
}
