package kr.inu.a1voice;

import java.io.IOException;
import java.io.RandomAccessFile;

/**
 * 16비트 모노 PCM 을 표준 WAV(RIFF) 로 감싼다. (v1.7 — 외부 라이브러리 없이)
 *
 * 두 번 톡톡(글자 변환) 녹음은 v1.6까지 MediaRecorder(AAC .m4a)를 썼지만,
 * v1.7부터는 같은 소리를 AudioRecord(PCM) 한 줄로 받아
 *   - 그대로 WAV 로 저장해 Whisper 에 보내고
 *   - 같은 조각을 실시간 자막(SpeechRecognizer)에 흘려보낸다.
 * 이렇게 하면 마이크를 두 앱이 나눠 쓰는 충돌이 아예 생기지 않는다.
 */
public final class WavFile {

    /** RIFF 헤더 길이 (WAV 표준 44바이트) */
    public static final int HEADER_BYTES = 44;

    private WavFile() {
    }

    /**
     * 헤더 44바이트를 써 넣는다(파일 맨 앞으로 이동해 덮어쓴다).
     *
     * @param dataBytes 실제 소리 데이터 길이(헤더 제외)
     */
    public static void writeHeader(RandomAccessFile raf, int sampleRate, int channels,
                                   int bitsPerSample, long dataBytes) throws IOException {
        int blockAlign = channels * bitsPerSample / 8;
        long byteRate = (long) sampleRate * blockAlign;
        byte[] h = new byte[HEADER_BYTES];
        putAscii(h, 0, "RIFF");
        putIntLE(h, 4, 36 + dataBytes);
        putAscii(h, 8, "WAVE");
        putAscii(h, 12, "fmt ");
        putIntLE(h, 16, 16);              // fmt 청크 크기
        putShortLE(h, 20, 1);             // PCM
        putShortLE(h, 22, channels);
        putIntLE(h, 24, sampleRate);
        putIntLE(h, 28, byteRate);
        putShortLE(h, 32, blockAlign);
        putShortLE(h, 34, bitsPerSample);
        putAscii(h, 36, "data");
        putIntLE(h, 40, dataBytes);
        raf.seek(0);
        raf.write(h);
    }

    /** 파일 전체에서 헤더를 뺀 소리 데이터 길이. */
    public static long dataBytes(long fileLength) {
        long n = fileLength - HEADER_BYTES;
        return n < 0 ? 0 : n;
    }

    /** 소리 데이터 길이로 재생 시간(초)을 구한다. */
    public static double seconds(long dataBytes, int sampleRate, int channels, int bitsPerSample) {
        long bytesPerSec = (long) sampleRate * channels * bitsPerSample / 8;
        if (bytesPerSec <= 0) {
            return 0;
        }
        return (double) dataBytes / bytesPerSec;
    }

    private static void putAscii(byte[] b, int off, String s) {
        for (int i = 0; i < 4 && i < s.length(); i++) {
            b[off + i] = (byte) s.charAt(i);
        }
    }

    private static void putIntLE(byte[] b, int off, long v) {
        b[off] = (byte) (v & 0xFF);
        b[off + 1] = (byte) ((v >> 8) & 0xFF);
        b[off + 2] = (byte) ((v >> 16) & 0xFF);
        b[off + 3] = (byte) ((v >> 24) & 0xFF);
    }

    private static void putShortLE(byte[] b, int off, int v) {
        b[off] = (byte) (v & 0xFF);
        b[off + 1] = (byte) ((v >> 8) & 0xFF);
    }
}
