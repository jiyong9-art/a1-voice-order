package kr.inu.a1voice;

/**
 * v1.8.3 조작 규칙 — 플로팅 배지를 눌렀을 때 무엇을 할지 정한다.
 *
 *  - 대기 중 <b>1번 탭</b>  → 즉시 녹음 시작 (더블 탭을 기다리지 않는다)
 *  - 녹음 중 <b>2번 탭</b>  → 녹음 완료(변환·전송)
 *  - 녹음 중 1번 탭         → {@link #WAIT} (두 번째 탭을 잠깐 기다린다)
 *  - 녹음 파일 저장 중 1번 탭 → 저장하고 끝
 *
 * 순수 계산만 담아 JVM 에서 검증한다 — {@code test/TapRulesTest.java}.
 */
public final class TapRules {

    /** 대기 중 → 녹음 시작 */
    public static final int START = 1;
    /** 녹음 중 두 번째 탭 → 녹음 완료(변환·전송) */
    public static final int FINISH = 2;
    /** 녹음 중 첫 탭 → 두 번째 탭을 기다린다 */
    public static final int WAIT = 3;
    /** 녹음 파일 저장 중 탭 → 저장하고 끝 */
    public static final int STOP_FILE = 4;

    /** 두 번째 탭으로 인정하는 시간 창 (v1.8.3) */
    public static final long DOUBLE_MS = 340;

    private TapRules() {
    }

    /**
     * @param recording 녹음 중인지(녹음 파일 저장 포함)
     * @param fileMode  녹음 파일 저장 모드인지
     * @param nowMs     이번 탭이 끝난 시각(elapsedRealtime)
     * @param lastTapMs 직전 탭 시각(없으면 0)
     * @param pending   직전 탭을 '완료 대기'로 받아 두었는지
     */
    public static int onTap(boolean recording, boolean fileMode, long nowMs, long lastTapMs, boolean pending) {
        if (!recording) {
            return START;
        }
        if (fileMode) {
            return STOP_FILE;
        }
        if (pending && lastTapMs > 0 && nowMs >= lastTapMs && nowMs - lastTapMs <= DOUBLE_MS) {
            return FINISH;
        }
        return WAIT;
    }
}
