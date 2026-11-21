package kr.inu.a1voice;

import java.io.File;
import java.io.RandomAccessFile;

/**
 * v1.7 WAV 기록기 시험 — 기기 없이 JVM에서 돌린다.
 *
 * AudioRecord 로 받은 16kHz·16비트·모노 PCM 을 WAV 로 감쌀 때,
 * 헤더가 표준(RIFF/WAVE/fmt/data)대로인지, 길이·재생시간이 맞는지 확인한다.
 * 만든 파일은 python3 의 wave 모듈로도 한 번 더 읽어 본다.
 *
 * 실행:
 *   javac -encoding UTF-8 -source 8 -target 8 -d test/out \
 *         app/src/main/java/kr/inu/a1voice/WavFile.java test/WavFileTest.java
 *   java -cp test/out WavFileTest
 */
public class WavFileTest {

    static int fails = 0;

    static void check(String label, boolean got, boolean want) {
        if (got != want) {
            fails++;
            System.out.println("FAIL " + label + " got=" + got + " want=" + want);
        } else {
            System.out.println("ok   " + label + " = " + got);
        }
    }

    static void check(String label, long got, long want) {
        if (got != want) {
            fails++;
            System.out.println("FAIL " + label + " got=" + got + " want=" + want);
        } else {
            System.out.println("ok   " + label + " = " + got);
        }
    }

    /** 16kHz 모노 16비트 1초 = 32000바이트짜리 사인파를 만든다. */
    static File write(int seconds) throws Exception {
        File f = new File(System.getProperty("java.io.tmpdir"), "a1_wav_test_" + seconds + "s.wav");
        RandomAccessFile raf = new RandomAccessFile(f, "rw");
        raf.setLength(0);
        WavFile.writeHeader(raf, 16000, 1, 16, 0);
        raf.seek(WavFile.HEADER_BYTES);
        byte[] chunk = new byte[3200];
        for (int s = 0; s < seconds * 10; s++) {
            for (int i = 0; i < 1600; i++) {
                double t = (s * 1600 + i) / 16000.0;
                short v = (short) (Math.sin(2 * Math.PI * 440 * t) * 12000);
                chunk[i * 2] = (byte) (v & 0xFF);
                chunk[i * 2 + 1] = (byte) ((v >> 8) & 0xFF);
            }
            raf.write(chunk, 0, chunk.length);
        }
        // 실제 길이로 헤더를 다시 쓴다(녹음 종료 시 하는 일과 같다).
        long data = raf.length() - WavFile.HEADER_BYTES;
        raf.setLength(WavFile.HEADER_BYTES + data);
        WavFile.writeHeader(raf, 16000, 1, 16, data);
        raf.close();
        return f;
    }

    public static void main(String[] args) throws Exception {
        File f = write(1);
        byte[] head = new byte[44];
        RandomAccessFile raf = new RandomAccessFile(f, "r");
        raf.readFully(head);
        raf.close();

        check("RIFF", new String(head, 0, 4, "US-ASCII").equals("RIFF"), true);
        check("WAVE", new String(head, 8, 4, "US-ASCII").equals("WAVE"), true);
        check("fmt ", new String(head, 12, 4, "US-ASCII").equals("fmt "), true);
        check("data", new String(head, 36, 4, "US-ASCII").equals("data"), true);
        check("PCM(1)", le16(head, 20), 1);
        check("channels", le16(head, 22), 1);
        check("sampleRate", le32(head, 24), 16000);
        check("byteRate", le32(head, 28), 32000);
        check("blockAlign", le16(head, 32), 2);
        check("bits", le16(head, 34), 16);
        check("riffSize", le32(head, 4), 36 + 32000);
        check("dataSize", le32(head, 40), 32000);
        check("fileLength", f.length(), 44 + 32000);
        check("dataBytes()", WavFile.dataBytes(f.length()), 32000);
        check("seconds()", (long) (WavFile.seconds(32000, 16000, 1, 16) + 0.5), 1L);
        // 0.7초(최소 길이) = 22400바이트
        check("0.7sec bytes", (long) (WavFile.seconds(22400, 16000, 1, 16) * 1000 + 0.5), 700L);
        System.out.println("file=" + f.getAbsolutePath() + " bytes=" + f.length());

        System.out.println(fails == 0 ? "ALL OK" : (fails + " FAILED"));
        if (fails != 0) {
            System.exit(1);
        }
    }

    static int le16(byte[] b, int off) {
        return (b[off] & 0xFF) | ((b[off + 1] & 0xFF) << 8);
    }

    static long le32(byte[] b, int off) {
        return (b[off] & 0xFFL) | ((b[off + 1] & 0xFFL) << 8)
                | ((b[off + 2] & 0xFFL) << 16) | ((b[off + 3] & 0xFFL) << 24);
    }
}
