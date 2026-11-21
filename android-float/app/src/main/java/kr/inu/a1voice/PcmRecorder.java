package kr.inu.a1voice;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;

import java.io.File;
import java.io.RandomAccessFile;

/**
 * 16kHz 모노 PCM 녹음기 (v1.7).
 *
 * 두 번 톡톡(글자 변환) 전용이다. 녹음 조각을 그대로 WAV 로 쌓으면서,
 * 같은 조각을 {@link ChunkListener} 로 넘겨 실시간 자막(SpeechRecognizer)에 흘려보낸다.
 * 마이크는 이 한 줄만 잡으므로 MediaRecorder 와 자막이 마이크를 다투는 일이 없다.
 *
 * 길게 꾹(녹음 파일 저장)은 예전처럼 MediaRecorder(.m4a)를 그대로 쓴다.
 */
public final class PcmRecorder {

    public interface ChunkListener {
        /** 소리 조각 하나(16비트 모노 PCM). 다른 스레드에서 불린다 — 오래 붙들지 말 것. */
        void onChunk(byte[] data, int length);
    }

    public static final int SAMPLE_RATE = 16000;
    private static final int CHANNELS = 1;
    private static final int BITS = 16;

    /** 0.1초어치(16kHz·16비트 모노 = 3200바이트)씩 읽는다. */
    private static final int CHUNK_BYTES = SAMPLE_RATE / 10 * 2;

    private AudioRecord record;
    private Thread thread;
    private volatile boolean running;
    private RandomAccessFile out;
    private long dataBytes;
    private ChunkListener listener;
    private String error;

    /** 녹음을 시작하고 WAV 파일을 만든다. 실패하면 false (사유는 {@link #lastError()}). */
    public boolean start(File target, ChunkListener l) {
        stop();
        listener = l;
        dataBytes = 0;
        error = null;
        try {
            int min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT);
            if (min <= 0) {
                min = CHUNK_BYTES;
            }
            int bufSize = Math.max(min, CHUNK_BYTES) * 4;
            AudioRecord.Builder builder = new AudioRecord.Builder()
                    .setAudioSource(MediaRecorder.AudioSource.MIC)
                    .setAudioFormat(new AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                            .build())
                    .setBufferSizeInBytes(bufSize);
            // v1.7 안전장치: 이 녹음은 '개인 정보가 담긴 입력'으로 표시해,
            // 자막(SpeechRecognizer)이 마이크를 가로채도 본체 녹음이 무음이 되지 않게 한다.
            if (Build.VERSION.SDK_INT >= 30) {
                try {
                    builder.setPrivacySensitive(true);
                } catch (Throwable ignored) {
                }
            }
            record = builder.build();
            if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                error = "마이크를 열지 못했습니다. 다른 앱이 마이크를 쓰고 있는지 확인해 주세요.";
                release();
                return false;
            }

            File dir = target.getParentFile();
            if (dir != null && !dir.exists()) {
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
            }
            out = new RandomAccessFile(target, "rw");
            out.setLength(0);
            WavFile.writeHeader(out, SAMPLE_RATE, CHANNELS, BITS, 0);
            out.seek(WavFile.HEADER_BYTES);

            record.startRecording();
            if (record.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                error = "마이크가 다른 앱에서 사용 중입니다.";
                closeFile();
                release();
                return false;
            }

            running = true;
            thread = new Thread(new Runnable() {
                @Override
                public void run() {
                    loop();
                }
            }, "a1-pcm");
            thread.start();
            return true;
        } catch (Exception e) {
            error = readable(e);
            closeFile();
            release();
            return false;
        }
    }

    private void loop() {
        byte[] buf = new byte[CHUNK_BYTES];
        while (running) {
            int n;
            try {
                n = record == null ? -1 : record.read(buf, 0, buf.length);
            } catch (Exception e) {
                break;
            }
            if (n <= 0) {
                if (n == AudioRecord.ERROR_INVALID_OPERATION || n == AudioRecord.ERROR_BAD_VALUE) {
                    break;
                }
                continue;
            }
            boolean written = false;
            synchronized (this) {
                if (out != null) {
                    try {
                        out.write(buf, 0, n);
                        dataBytes += n;
                        written = true;
                    } catch (Exception e) {
                        break;
                    }
                }
            }
            if (written && listener != null) {
                try {
                    listener.onChunk(buf, n);
                } catch (Exception ignored) {
                    // 자막 쪽 문제로 본체 녹음이 멈추면 안 된다.
                }
            }
        }
    }

    /** 녹음을 끝내고 WAV 헤더에 실제 길이를 채워 넣는다. */
    public void stop() {
        running = false;
        AudioRecord r = record;
        record = null;
        if (r != null) {
            try {
                r.stop();
            } catch (Exception ignored) {
            }
        }
        Thread t = thread;
        thread = null;
        if (t != null && t != Thread.currentThread()) {
            try {
                t.join(800);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        if (r != null) {
            try {
                r.release();
            } catch (Exception ignored) {
            }
        }
        closeFile();
        listener = null;
    }

    /** 지금까지 쌓인 소리 길이(초). */
    public double seconds() {
        long bytes;
        synchronized (this) {
            bytes = dataBytes;
        }
        return WavFile.seconds(bytes, SAMPLE_RATE, CHANNELS, BITS);
    }

    public String lastError() {
        return error;
    }

    private void closeFile() {
        synchronized (this) {
            if (out == null) {
                return;
            }
            try {
                out.setLength(WavFile.HEADER_BYTES + dataBytes);
                WavFile.writeHeader(out, SAMPLE_RATE, CHANNELS, BITS, dataBytes);
            } catch (Exception ignored) {
            }
            try {
                out.close();
            } catch (Exception ignored) {
            }
            out = null;
        }
    }

    private void release() {
        if (record != null) {
            try {
                record.release();
            } catch (Exception ignored) {
            }
            record = null;
        }
    }

    private static String readable(Exception e) {
        String m = e.getMessage();
        return m == null || m.isEmpty() ? e.getClass().getSimpleName() : m;
    }
}
