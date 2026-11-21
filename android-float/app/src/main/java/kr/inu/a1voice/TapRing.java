package kr.inu.a1voice;

/**
 * 최근 탭 시각을 굴리며 "4연타"를 판정한다 (v1.5).
 *
 * 두 번 톡톡(글자 변환)은 지연 없이 그대로 두고, 4번째 탭이 1.1초 안에 들어왔을 때만
 * 플로팅 끄기로 본다. 안드로이드에 의존하지 않으므로 JVM에서 그대로 시험할 수 있다.
 */
final class TapRing {

    private final long[] times;
    private final int need;
    private int count;

    TapRing() {
        this(4);
    }

    TapRing(int need) {
        this.need = need < 2 ? 2 : need;
        this.times = new long[this.need];
    }

    /**
     * 탭 하나를 기록한다.
     *
     * @param now      이번 탭 시각(ms, 단조 증가)
     * @param windowMs 첫 탭부터 마지막 탭까지 허용 시간
     * @return 창 안에서 need번째 탭이 모였으면 true (한 번 true면 기록을 비운다)
     */
    boolean add(long now, long windowMs) {
        System.arraycopy(times, 1, times, 0, need - 1);
        times[need - 1] = now;
        if (count < need) {
            count++;
        }
        if (count < need) {
            return false;
        }
        if (times[need - 1] - times[0] > windowMs) {
            return false;
        }
        clear();
        return true;
    }

    /** 길게 누르기·드래그처럼 탭으로 치면 안 되는 동작 뒤에 부른다. */
    void clear() {
        count = 0;
        java.util.Arrays.fill(times, 0L);
    }

    int count() {
        return count;
    }
}
