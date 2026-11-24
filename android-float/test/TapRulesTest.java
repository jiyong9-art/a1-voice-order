package kr.inu.a1voice;

/**
 * v1.8.3 조작 규칙 시험 — 안드로이드 없이 JVM 에서 돈다.
 *
 *   javac -encoding UTF-8 -d test/out app/src/main/java/kr/inu/a1voice/TapRules.java test/TapRulesTest.java
 *   java -cp test/out TapRulesTest
 *
 * 확인하는 것:
 *  1) 대기 중 1번 탭 = 즉시 시작 (기다림 없음)
 *  2) 녹음 중 1번 탭 = 대기, 2번 탭(340ms 안) = 완료
 *  3) 340ms 를 넘긴 탭은 다시 '첫 탭'으로 본다
 *  4) 녹음 파일 저장 중 1번 탭 = 저장하고 끝
 *  5) 두 번째 탭이 와도 340ms 를 넘으면 완료되지 않는다(오발동 방지)
 */
public class TapRulesTest {

    private static int failed;

    public static void main(String[] args) {
        // 1) 대기 중 — 한 번 탭하면 기다리지 않고 바로 시작
        check("대기 중 1번 탭 → START",
                TapRules.onTap(false, false, 10000, 0, false), TapRules.START);

        // 2) 녹음 중 첫 탭 → WAIT (두 번째 탭을 기다린다)
        check("녹음 중 첫 탭 → WAIT",
                TapRules.onTap(true, false, 10000, 0, false), TapRules.WAIT);

        // 3) 녹음 중 340ms 안의 두 번째 탭 → FINISH
        check("녹음 중 두 번째 탭(150ms) → FINISH",
                TapRules.onTap(true, false, 10150, 10000, true), TapRules.FINISH);
        check("녹음 중 두 번째 탭(딱 340ms) → FINISH",
                TapRules.onTap(true, false, 10340, 10000, true), TapRules.FINISH);

        // 4) 340ms 를 넘으면 완료가 아니라 다시 첫 탭으로
        check("녹음 중 341ms 뒤 탭 → WAIT",
                TapRules.onTap(true, false, 10341, 10000, true), TapRules.WAIT);
        check("녹음 중 1초 뒤 탭 → WAIT",
                TapRules.onTap(true, false, 11000, 10000, true), TapRules.WAIT);

        // 5) pending 이 아닌(안내를 이미 접은) 상태에서는 두 번째 탭도 WAIT
        check("pending 없음 → WAIT",
                TapRules.onTap(true, false, 10150, 10000, false), TapRules.WAIT);

        // 6) 녹음 파일 저장 중 1번 탭 → STOP_FILE
        check("파일 저장 중 탭 → STOP_FILE",
                TapRules.onTap(true, true, 10000, 0, false), TapRules.STOP_FILE);

        // 7) 시각이 거꾸로 가도(0) 터지지 않는다
        check("lastTapMs 0 → WAIT",
                TapRules.onTap(true, false, 500, 0, true), TapRules.WAIT);

        // 8) 연속 조작 흐름: 시작 → 말 → 두 번 탭
        long t = 5000;
        check("흐름: 1번 탭 → START", TapRules.onTap(false, false, t, 0, false), TapRules.START);
        t += 4000;   // 4초 말하기
        check("흐름: 완료 1번째 탭 → WAIT", TapRules.onTap(true, false, t, 0, false), TapRules.WAIT);
        long last = t;
        t += 120;    // 빠르게 한 번 더
        check("흐름: 완료 2번째 탭 → FINISH",
                TapRules.onTap(true, false, t, last, true), TapRules.FINISH);

        System.out.println(failed == 0 ? "ALL PASS" : (failed + " FAILED"));
        if (failed > 0) {
            System.exit(1);
        }
    }

    private static void check(String name, int actual, int expected) {
        boolean ok = actual == expected;
        if (!ok) {
            failed++;
        }
        System.out.println((ok ? "PASS  " : "FAIL  ") + name
                + (ok ? "" : "  (got " + actual + ", want " + expected + ")"));
    }
}
