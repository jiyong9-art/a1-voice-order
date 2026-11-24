package kr.inu.a1voice;

import java.io.File;
import java.io.FileInputStream;
import java.io.RandomAccessFile;

/**
 * v1.8.3 속도 개선 근거 측정 — 안드로이드 없이 JVM 에서 도는 부분만 잰다.
 *
 *   javac -encoding UTF-8 -d test/out app/src/main/java/kr/inu/a1voice/WavFile.java test/TimingBench.java
 *   java -cp test/out kr.inu.a1voice.TimingBench
 *
 * 잰 것 (v1.8.2 에서 **메인 스레드**가 탭 순간에 하던 파일 작업):
 *  1) 임시 폴더 정리 — clearOldTemp(dir): listFiles + lastModified 전수 확인
 *  2) 녹음 시작 — 새 WAV 파일 만들기 + 헤더 44바이트 쓰기 (PcmRecorder.start 의 파일 부분)
 *  3) 녹음 끝 — setLength + 헤더 다시 쓰기 (PcmRecorder.closeFile)
 *  4) 업로드 본문 읽기 — 10초 WAV(320KB) 를 8KB 씩 읽어 소켓에 쓰는 비용
 *
 * 마이크(AudioRecord)를 여는 시간은 JVM 에서 잴 수 없다 — 앱에 계측 로그를 넣었다
 * (`adb logcat -s A1Voice` → "start: tap→mic ...ms"). 그 값이 기기에서의 실제 시작 지연이다.
 */
public class TimingBench {

    private static final int RUNS = 30;
    private static final int RATE = 16000;

    public static void main(String[] args) throws Exception {
        File dir = new File(System.getProperty("java.io.tmpdir"), "a1bench");
        if (!dir.exists()) {
            dir.mkdirs();
        }
        // clearOldTemp 가 매번 지우므로, 미리 40개(오래된) 파일을 만들어 둔다.
        for (int i = 0; i < 40; i++) {
            File f = new File(dir, "old_" + i + ".wav");
            RandomAccessFile r = new RandomAccessFile(f, "rw");
            r.setLength(1024);
            r.close();
            f.setLastModified(System.currentTimeMillis() - 2L * 60 * 60 * 1000);
        }

        long a = avg(new Runnable() {
            @Override
            public void run() {
                clearOldTemp(dir);
            }
        });

        long b = avg(new Runnable() {
            @Override
            public void run() {
                try {
                    File f = new File(dir, "new.wav");
                    RandomAccessFile raf = new RandomAccessFile(f, "rw");
                    raf.setLength(0);
                    WavFile.writeHeader(raf, RATE, 1, 16, 0);
                    raf.seek(WavFile.HEADER_BYTES);
                    raf.close();
                    f.delete();
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            }
        });

        // 10초 분량(320,000 바이트) 을 채운 파일로 마무리 비용을 잰다.
        final File big = new File(dir, "big.wav");
        RandomAccessFile raf = new RandomAccessFile(big, "rw");
        raf.setLength(WavFile.HEADER_BYTES);
        WavFile.writeHeader(raf, RATE, 1, 16, 0);
        raf.seek(WavFile.HEADER_BYTES);
        raf.write(new byte[320000]);
        raf.close();
        long c = avg(new Runnable() {
            @Override
            public void run() {
                try {
                    RandomAccessFile r = new RandomAccessFile(big, "rw");
                    r.setLength(WavFile.HEADER_BYTES + 320000);
                    WavFile.writeHeader(r, RATE, 1, 16, 320000);
                    r.close();
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            }
        });

        long d = avg(new Runnable() {
            @Override
            public void run() {
                try {
                    FileInputStream in = new FileInputStream(big);
                    byte[] buf = new byte[8192];
                    long n = 0;
                    int r;
                    while ((r = in.read(buf)) > 0) {
                        n += r;   // 소켓에 쓰는 대신 세기만 한다(순수 읽기 비용)
                    }
                    in.close();
                    if (n <= 0) {
                        throw new RuntimeException("empty");
                    }
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            }
        });

        System.out.println("측정 (" + RUNS + "회 평균, 이 서버 JVM):");
        System.out.println("  1) 임시 폴더 정리 clearOldTemp(40개)      : " + us(a));
        System.out.println("  2) 녹음 시작 파일 준비 + WAV 헤더          : " + us(b));
        System.out.println("  3) 녹음 끝 마무리(setLength+헤더, 10초분)  : " + us(c));
        System.out.println("  4) 10초 WAV 320KB 읽기(업로드 본문)        : " + us(d));
        System.out.println();
        System.out.println("  → v1.8.2 는 1~3 을 탭 순간 메인 스레드에서 했다(합계 " + us(a + b + c) + " + 마이크 열기).");
        System.out.println("     v1.8.3 은 같은 일을 백그라운드로 옮겨 화면이 먼저 그려진다.");

        big.delete();
        File[] left = dir.listFiles();
        if (left != null) {
            for (File f : left) {
                f.delete();
            }
        }
        dir.delete();
    }

    /** v1.8.2 OverlayService.clearOldTemp 와 같은 코드 */
    private static void clearOldTemp(File dir) {
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        long now = System.currentTimeMillis();
        for (File f : files) {
            if (f.isFile() && now - f.lastModified() > 60L * 60 * 1000) {
                f.delete();
            }
        }
    }

    private static long avg(Runnable r) {
        long total = 0;
        for (int i = 0; i < RUNS; i++) {
            long t = System.nanoTime();
            r.run();
            total += System.nanoTime() - t;
        }
        return total / RUNS / 1000;   // µs
    }

    private static String us(long micro) {
        return String.format("%.2f ms", micro / 1000.0);
    }
}
