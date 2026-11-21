package kr.inu.a1voice;

/**
 * v1.5 의 "4번 연타 = 플로팅 끄기" 판정을 JVM에서 확인하는 시험.
 * TapRing 은 안드로이드에 의존하지 않으므로 기기 없이 그대로 돌려 볼 수 있다.
 *
 * 실행:
 *   javac -encoding UTF-8 -source 8 -target 8 -d test/out \
 *         app/src/main/java/kr/inu/a1voice/TapRing.java test/TapRingTest.java
 *   java -cp test/out TapRingTest
 */
public class TapRingTest {
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
        final long W = 1100L;

        // 1) 빠르게 4번(0/150/300/450ms) → 4번째에서 성립
        TapRing t = new TapRing();
        check("tap1", t.add(0, W), false);
        check("tap2", t.add(150, W), false);
        check("tap3", t.add(300, W), false);
        check("tap4", t.add(450, W), true);
        // 성립 뒤에는 기록이 비워져 바로 다음 탭부터 다시 센다
        check("after fire tap1", t.add(600, W), false);
        check("after fire tap2", t.add(700, W), false);

        // 2) 두 번 톡톡(500ms 안)만으로는 절대 성립하지 않는다 — 글자 변환은 그대로 동작
        t = new TapRing();
        check("double 1", t.add(0, W), false);
        check("double 2", t.add(120, W), false);
        check("double 3 (late)", t.add(900, W), false);
        check("double 4 (late)", t.add(1600, W), false);

        // 3) 4번이지만 창을 넘김(0/400/800/1200ms) → 성립 안 함
        t = new TapRing();
        t.add(0, W);
        t.add(400, W);
        t.add(800, W);
        check("slow 4th tap", t.add(1200, W), false);

        // 4) 3번만 누르면 성립 안 함
        t = new TapRing();
        t.add(0, W);
        t.add(100, W);
        check("only 3 taps", t.add(200, W), false);

        // 5) 정확히 경계(1100ms)는 창 안으로 본다
        t = new TapRing();
        t.add(0, W);
        t.add(300, W);
        t.add(700, W);
        check("exact window", t.add(1100, W), true);

        // 6) 길게 누른 뒤(탭 2번 + clear) 잔여 탭으로 오발동하지 않는다
        t = new TapRing();
        t.add(0, W);
        t.add(100, W);
        t.clear();
        check("after clear 1", t.add(200, W), false);
        check("after clear 2", t.add(300, W), false);
        check("after clear 3", t.add(400, W), false);
        check("after clear 4", t.add(500, W), true); // clear 뒤 새 4연타는 정상 동작

        // 7) 두 번 톡톡(글자 변환)이 2번째 탭에서 즉시 성립하는지: 4연타 판정은 2번째에서 false
        t = new TapRing();
        check("dictate start tap1", t.add(0, W), false);
        check("dictate start tap2", t.add(90, W), false);

        System.out.println(fails == 0 ? "ALL PASS" : fails + " FAILURES");
        if (fails != 0) {
            System.exit(1);
        }
    }
}
