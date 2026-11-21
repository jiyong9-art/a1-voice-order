package kr.inu.a1voice;

import android.content.Context;
import android.content.Intent;
import android.media.AudioFormat;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * 말하는 도중의 실시간 자막 (v1.7).
 *
 * 폰의 음성인식(SpeechRecognizer, ko-KR)에 **마이크 대신 우리 녹음 조각을 파이프로 넘겨**
 * 부분 결과를 받는다(Android 13/API 33+ 의 EXTRA_AUDIO_SOURCE).
 * 그래서 음성인식이 마이크를 따로 잡지 않아, 본체 녹음(PcmRecorder)과 절대 부딪히지 않는다.
 *
 * 지원하지 않는 기기·음성인식 서비스에서는 조용히 포기한다(자막만 안 뜨고 녹음·변환은 그대로).
 * 말이 끝나면 이 자막은 닫히고, OpenAI(gpt-4o-transcribe)가 돌려준 정확한 글자가 입력칸에 들어간다.
 */
public final class LiveCaption {

    public interface Listener {
        /** 말하는 중의 부분 결과 */
        void onPartial(String text);

        /** 한 문장이 확정된 초안(앞에서 확정된 말 + 방금 문장) */
        void onDraft(String text);

        /** 이 기기에서는 실시간 자막을 쓸 수 없다 — 자막 창을 닫으라는 신호 */
        void onUnavailable();
    }

    private static final int RATE = PcmRecorder.SAMPLE_RATE;
    /** 자막용으로 모아 두는 소리 조각 수(0.1초 × 80 = 약 8초). 넘치면 버린다. */
    private static final int QUEUE_CHUNKS = 80;
    /** 문장이 끝나 자막 세션이 닫히면 다시 여는 횟수 상한 */
    private static final int MAX_SESSIONS = 30;

    private final Context ctx;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ArrayBlockingQueue<byte[]> queue = new ArrayBlockingQueue<byte[]>(QUEUE_CHUNKS);
    private final StringBuilder settled = new StringBuilder();

    private volatile OutputStream sink;
    private volatile boolean running;
    private SpeechRecognizer sr;
    private ParcelFileDescriptor pipeRead;
    private Thread pump;
    private int sessions;
    private long lastOpenMs;
    private boolean openScheduled;
    private boolean finished;

    public LiveCaption(Context ctx, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.listener = listener;
    }

    /** 실시간 자막을 시작할 수 있으면 true. (Android 13 미만이거나 음성인식이 없으면 false) */
    public boolean start() {
        if (Build.VERSION.SDK_INT < 33) {
            return false;
        }
        try {
            if (!SpeechRecognizer.isRecognitionAvailable(ctx)) {
                return false;
            }
        } catch (Throwable t) {
            return false;
        }
        running = true;
        lastOpenMs = SystemClock.elapsedRealtime();
        startPump();
        main.post(new Runnable() {
            @Override
            public void run() {
                openSession();
            }
        });
        return true;
    }

    /** 본체 녹음에서 나온 소리 조각을 자막으로 흘려보낸다(다른 스레드에서 불림). */
    public void feed(byte[] data, int length) {
        if (!running || finished || sink == null || length <= 0) {
            return;
        }
        try {
            if (!queue.offer(Arrays.copyOf(data, length))) {
                // 자막이 밀리면 오래된 조각을 버리고 최신 것만 남긴다.
                queue.poll();
                queue.offer(Arrays.copyOf(data, length));
            }
        } catch (Throwable ignored) {
        }
    }

    /** 자막을 끝낸다. (말이 끝나 한 번 톡 누른 순간) */
    public void stop() {
        running = false;
        Thread p = pump;
        pump = null;
        if (p != null && p != Thread.currentThread()) {
            try {
                p.interrupt();
                p.join(300);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        queue.clear();
        main.post(new Runnable() {
            @Override
            public void run() {
                closeSession();
            }
        });
    }

    /* ------------------------------------------------------------------ */

    private void startPump() {
        pump = new Thread(new Runnable() {
            @Override
            public void run() {
                while (running) {
                    byte[] chunk;
                    try {
                        chunk = queue.poll(150, TimeUnit.MILLISECONDS);
                    } catch (InterruptedException e) {
                        break;
                    }
                    if (chunk == null) {
                        continue;
                    }
                    OutputStream s = sink;
                    if (s == null) {
                        continue;   // 자막 세션이 없는 동안의 조각은 버린다
                    }
                    try {
                        s.write(chunk);
                    } catch (Exception e) {
                        // 자막 세션이 닫혔다 — 소리는 본체 녹음에 그대로 남아 있다.
                        sink = null;
                    }
                }
            }
        }, "a1-caption");
        pump.start();
    }

    /** 음성인식 세션을 (다시) 연다. 반드시 메인 스레드에서. */
    private void openSession() {
        if (!running || finished) {
            return;
        }
        if (sessions >= MAX_SESSIONS) {
            giveUp();
            return;
        }
        sessions++;
        lastOpenMs = SystemClock.elapsedRealtime();
        closeSession();
        try {
            ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
            pipeRead = pipe[0];
            sink = new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]);

            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR");
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.getPackageName());
            // 마이크 대신 이 파이프에서 소리를 읽는다 (API 33+)
            i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, pipeRead);
            i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING,
                    AudioFormat.ENCODING_PCM_16BIT);
            i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, RATE);
            i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1);
            i.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, true);

            sr = SpeechRecognizer.createSpeechRecognizer(ctx);
            sr.setRecognitionListener(recognitionListener);
            sr.startListening(i);
        } catch (Throwable t) {
            giveUp();
        }
    }

    private void closeSession() {
        if (sr != null) {
            try {
                sr.cancel();
            } catch (Throwable ignored) {
            }
            try {
                sr.destroy();
            } catch (Throwable ignored) {
            }
            sr = null;
        }
        OutputStream s = sink;
        sink = null;
        if (s != null) {
            try {
                s.close();
            } catch (Throwable ignored) {
            }
        }
        if (pipeRead != null) {
            try {
                pipeRead.close();
            } catch (Throwable ignored) {
            }
            pipeRead = null;
        }
    }

    private void giveUp() {
        if (finished) {
            return;
        }
        finished = true;
        running = false;
        main.post(new Runnable() {
            @Override
            public void run() {
                closeSession();
                if (listener != null) {
                    listener.onUnavailable();
                }
            }
        });
    }

    /** 문장 경계에서 세션을 새로 열어 계속 듣는다. */
    private void reopen() {
        if (!running || finished || openScheduled) {
            return;
        }
        long since = SystemClock.elapsedRealtime() - lastOpenMs;
        long wait = since < 700 ? (700 - since) : 60;
        openScheduled = true;
        main.postDelayed(new Runnable() {
            @Override
            public void run() {
                openScheduled = false;
                openSession();
            }
        }, wait);
    }

    private static String first(ArrayList<String> list) {
        if (list == null || list.isEmpty()) {
            return "";
        }
        String s = list.get(0);
        return s == null ? "" : s.trim();
    }

    private String withSettled(String part) {
        String head = settled.toString().trim();
        String tail = part == null ? "" : part.trim();
        if (head.isEmpty()) {
            return tail;
        }
        if (tail.isEmpty()) {
            return head;
        }
        return head + " " + tail;
    }

    private final RecognitionListener recognitionListener = new RecognitionListener() {
        @Override
        public void onReadyForSpeech(Bundle params) {
        }

        @Override
        public void onBeginningOfSpeech() {
        }

        @Override
        public void onRmsChanged(float rmsdB) {
        }

        @Override
        public void onBufferReceived(byte[] buffer) {
        }

        @Override
        public void onEndOfSpeech() {
        }

        @Override
        public void onError(int error) {
            if (error == SpeechRecognizer.ERROR_NO_MATCH
                    || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                reopen();
                return;
            }
            giveUp();
        }

        @Override
        public void onResults(Bundle results) {
            String text = first(results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION));
            if (!text.isEmpty()) {
                if (settled.length() > 0) {
                    settled.append(' ');
                }
                settled.append(text);
                final String draft = settled.toString();
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        if (listener != null) {
                            listener.onDraft(draft);
                        }
                    }
                });
            }
            reopen();
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            String text = first(partialResults.getStringArrayList(
                    SpeechRecognizer.RESULTS_RECOGNITION));
            if (text.isEmpty()) {
                return;
            }
            final String shown = withSettled(text);
            main.post(new Runnable() {
                @Override
                public void run() {
                    if (listener != null) {
                        listener.onPartial(shown);
                    }
                }
            });
        }

        @Override
        public void onEvent(int eventType, Bundle params) {
        }
    };
}
