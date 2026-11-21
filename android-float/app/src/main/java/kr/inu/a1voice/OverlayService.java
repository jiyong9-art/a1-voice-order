package kr.inu.a1voice;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.animation.ValueAnimator;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.media.MediaRecorder;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.LinearInterpolator;
import android.view.animation.DecelerateInterpolator;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;

/**
 * 화면 위에 뜨는 A1 동그라미 + 녹음 + 변환 팝업을 담당하는 포그라운드 서비스.
 *
 *  - 두 번 톡톡  : 음성을 글자로 변환(녹음 시작 / 녹음 중이면 종료)
 *  - 길게 꾹     : 음성 파일(.m4a) 저장 녹음 시작 (조용히: 동그라미가 작아지고 흰 점)
 *                  녹음 중 한 번 톡 → Recordings/A1녹음 에 저장
 *  - 한 번 탭    : 녹음 중이면 종료, 아니면 "두 번 톡톡" 안내
 *  - 4번 연타    : 플로팅 완전히 끄기(진행 중인 녹음·변환은 보내지 않고 폐기)
 *  - 길게 끌기   : 위치 이동(테두리에 붙음, 위치 저장)
 *
 * v1.5 반응 속도: 두 번 톡톡·길게 꾹이 감지되면 마이크를 여는 prepare/start 보다
 * 먼저 화면 표시와 15ms 진동을 처리한다.
 */
public class OverlayService extends Service {

    public static final String ACTION_START = "kr.inu.a1voice.START";
    public static final String ACTION_STOP = "kr.inu.a1voice.STOP";

    private static final String CHANNEL_ID = "a1voice_float";
    private static final int NOTI_ID = 101;

    /** 글자 변환(두 번 톡톡) 최대 길이 */
    private static final int MAX_MS = 120000;
    /** 녹음 파일 저장 최대 길이(회의·통화 대비 60분) */
    private static final int FILE_MAX_MS = 60 * 60 * 1000;
    private static final int MIN_MS = 700;

    /** 길게 꾹 누르기 판정 시간 */
    private static final long LONG_PRESS_MS = 550;
    /** 4번 연타 판정: 첫 탭부터 4번째 탭까지 이 시간 안 */
    private static final long QUAD_TAP_MS = 1100;

    private static final int MODE_IDLE = 0;
    private static final int MODE_DICTATE = 1;   // 두 번 톡톡 → 글자 변환
    private static final int MODE_FILE = 2;      // 길게 꾹 → 파일 저장

    /** 저장 폴더: 기기 공용 Recordings/A1녹음 */
    private static final String REC_DIR_NAME = "A1녹음";

    public static volatile boolean running = false;

    private WindowManager wm;
    private View bubbleRoot;
    private View bubbleCircle;
    private View bubbleRing;
    private View bubbleFrame;
    private TextView bubbleLogo;
    private View bubbleDot;
    private ValueAnimator pulse;
    private ValueAnimator scaleAnim;
    private TextView bubbleState;
    private WindowManager.LayoutParams bubbleParams;
    private GestureDetector detector;
    private boolean dragging;
    private int dragStartX;
    private int dragStartY;
    private float downRawX;
    private float downRawY;
    private int touchSlop;

    private MediaRecorder recorder;
    private File recFile;
    private boolean recording;
    private int mode = MODE_IDLE;
    private long recStartMs;
    private int recDurationSec;

    /** 길게 누르기 타이머가 이미 발동했는지(손을 떼도 단일 탭으로 치지 않게) */
    private boolean longPressFired;
    /** 4번 연타로 종료 중 — 이 뒤의 모든 동작은 무시한다. */
    private volatile boolean quitting;
    /** 변환 세대: 종료·새 녹음이 시작되면 올려서 이전 변환 결과를 버린다. */
    private int sessionGen;

    /** 최근 탭 4개의 시각(4번 연타 판정) */
    private final TapRing tapRing = new TapRing();

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private View popupRoot;
    private WindowManager.LayoutParams popupParams;
    private TextView popupTitle;
    private TextView popupMsg;
    private TextView popupPrimary;
    private TextView popupSecondary;
    private EditText popupEdit;
    private ProgressBar popupProgress;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!recording) {
                return;
            }
            if (mode == MODE_DICTATE) {
                long s = (SystemClock.elapsedRealtime() - recStartMs) / 1000;
                setTimerText(s);
            }
            ui.postDelayed(this, 250);
        }
    };

    private final Runnable maxStop = new Runnable() {
        @Override
        public void run() {
            if (!recording) {
                return;
            }
            if (mode == MODE_FILE) {
                stopFileRecording();
            } else {
                stopDictation();
            }
        }
    };

    private final Runnable hideState = new Runnable() {
        @Override
        public void run() {
            if (!recording) {
                bubbleState.setVisibility(View.GONE);
            }
        }
    };

    /** 길게 꾹 누르기 감지 */
    private final Runnable longPress = new Runnable() {
        @Override
        public void run() {
            if (quitting || dragging || longPressFired || mode != MODE_IDLE) {
                return;
            }
            longPressFired = true;
            tapRing.clear(); // 길게 누른 뒤의 잔여 탭으로 4연타가 오인되지 않게
            onLongPressStart();
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        startForegroundNotice();
        if (!Settings.canDrawOverlays(this)) {
            running = false;
            stopSelf();
            return;
        }
        // 로그인 확인(세션 쿠키) 전에는 동그라미를 띄우지 않는다.
        String cookie = Prefs.get(this, Prefs.K_COOKIE, "");
        if (cookie == null || cookie.trim().isEmpty()) {
            running = false;
            Toast.makeText(this, "A1 음성: 먼저 앱에서 로그인해 주세요.", Toast.LENGTH_LONG).show();
            stopSelf();
            return;
        }
        running = true;
        wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        touchSlop = dp(10);
        detector = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onDown(MotionEvent e) {
                return true;
            }

            @Override
            public boolean onSingleTapConfirmed(MotionEvent e) {
                onSingleTap();
                return true;
            }

            @Override
            public boolean onDoubleTap(MotionEvent e) {
                onDoubleTapAction();
                return true;
            }
        });
        showBubble();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            discardRecording();
            stopSelf();
            return START_NOT_STICKY;
        }
        // 시스템이 임의로 되살리면 마이크 포그라운드를 다시 열 수 없으므로 스스로 종료한다.
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        ui.removeCallbacksAndMessages(null);
        stopPulse();
        discardRecording();
        removePopup();
        if (bubbleRoot != null && wm != null) {
            try {
                wm.removeView(bubbleRoot);
            } catch (Exception ignored) {
            }
            bubbleRoot = null;
        }
        io.shutdownNow();
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */
    /* 알림 + 포그라운드                                                     */
    /* ------------------------------------------------------------------ */

    private void startForegroundNotice() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "A1 음성 플로팅", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setDescription("A1 동그라미가 떠 있는 동안 표시됩니다.");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, piFlags);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        b.setContentTitle("A1 음성 준비됨")
                .setContentText("두 번 톡톡 = 말한 것을 글로 · 길게 꾹 = 녹음 파일로 저장")
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setContentIntent(pi)
                .setOngoing(true);

        if (Build.VERSION.SDK_INT >= 30) {
            try {
                startForeground(NOTI_ID, b.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            } catch (Exception e) {
                startForeground(NOTI_ID, b.build());
            }
        } else {
            startForeground(NOTI_ID, b.build());
        }
    }

    /* ------------------------------------------------------------------ */
    /* 버블                                                               */
    /* ------------------------------------------------------------------ */

    private void showBubble() {
        if (bubbleRoot != null) {
            return;
        }
        bubbleRoot = LayoutInflater.from(this).inflate(R.layout.overlay_bubble, null);
        bubbleFrame = bubbleRoot.findViewById(R.id.bubble_frame);
        bubbleCircle = bubbleRoot.findViewById(R.id.bubble_circle);
        bubbleRing = bubbleRoot.findViewById(R.id.bubble_ring);
        bubbleLogo = (TextView) bubbleRoot.findViewById(R.id.bubble_logo);
        bubbleDot = bubbleRoot.findViewById(R.id.bubble_dot);
        bubbleState = (TextView) bubbleRoot.findViewById(R.id.bubble_state);

        int type = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        bubbleParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        bubbleParams.gravity = Gravity.TOP | Gravity.START;
        bubbleParams.x = Prefs.getInt(this, Prefs.K_X, screenW() - dp(78));
        bubbleParams.y = Prefs.getInt(this, Prefs.K_Y, (int) (screenH() * 0.60));

        clampBubble();
        try {
            wm.addView(bubbleRoot, bubbleParams);
        } catch (Exception e) {
            bubbleRoot = null;
            return;
        }
        bubbleRoot.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                if (quitting) {
                    return true;
                }
                // 4연타 판정은 제스처 해석보다 먼저 해서, 종료 뒤에 다른 동작이 겹치지 않게 한다.
                if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                    if (noteTapDown()) {
                        return true;
                    }
                }
                detector.onTouchEvent(event);
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        dragging = false;
                        longPressFired = false;
                        dragStartX = bubbleParams.x;
                        dragStartY = bubbleParams.y;
                        downRawX = event.getRawX();
                        downRawY = event.getRawY();
                        ui.removeCallbacks(longPress);
                        if (mode == MODE_IDLE) {
                            ui.postDelayed(longPress, LONG_PRESS_MS);
                        }
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - downRawX;
                        float dy = event.getRawY() - downRawY;
                        if (!dragging && (Math.abs(dx) > touchSlop || Math.abs(dy) > touchSlop)) {
                            dragging = true;
                            // 드래그로 위치를 옮길 때 길게 누르기 녹음이 오작동하지 않게 취소
                            ui.removeCallbacks(longPress);
                            // 드래그는 탭이 아니므로 4연타 판정에서도 뺀다
                            tapRing.clear();
                        }
                        if (dragging) {
                            bubbleParams.x = dragStartX + (int) dx;
                            bubbleParams.y = dragStartY + (int) dy;
                            clampBubble();
                            try {
                                wm.updateViewLayout(bubbleRoot, bubbleParams);
                            } catch (Exception ignored) {
                            }
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        ui.removeCallbacks(longPress);
                        if (dragging) {
                            dragging = false;
                            snapToEdge();
                            Prefs.putInt(OverlayService.this, Prefs.K_X, bubbleParams.x);
                            Prefs.putInt(OverlayService.this, Prefs.K_Y, bubbleParams.y);
                        }
                        return true;
                    default:
                        return false;
                }
            }
        });
    }

    private void clampBubble() {
        int w = bubbleRoot == null ? dp(62) : Math.max(bubbleRoot.getWidth(), dp(62));
        int maxX = Math.max(0, screenW() - w - dp(6));
        int maxY = Math.max(0, screenH() - w - dp(6));
        bubbleParams.x = Math.max(dp(4), Math.min(bubbleParams.x, maxX));
        bubbleParams.y = Math.max(0, Math.min(bubbleParams.y, maxY));
    }

    private void snapToEdge() {
        int w = bubbleRoot == null ? dp(62) : Math.max(bubbleRoot.getWidth(), dp(62));
        int center = bubbleParams.x + w / 2;
        bubbleParams.x = center < screenW() / 2 ? dp(6) : screenW() - w - dp(6);
        clampBubble();
        try {
            wm.updateViewLayout(bubbleRoot, bubbleParams);
        } catch (Exception ignored) {
        }
    }

    /**
     * 탭 시각을 기록하고 4연타(첫 탭~4번째 탭 1.1초 이내)인지 본다.
     * 4연타면 그 자리에서 플로팅을 끄고 true.
     */
    private boolean noteTapDown() {
        if (tapRing.add(SystemClock.elapsedRealtime(), QUAD_TAP_MS)) {
            quitFloating();
            return true;
        }
        return false;
    }

    /** 4번 연타: 진행 중인 녹음·변환은 보내지 않고 버린 뒤 플로팅을 완전히 끈다. */
    private void quitFloating() {
        if (quitting) {
            return;
        }
        quitting = true;
        sessionGen++;
        ui.removeCallbacksAndMessages(null);
        discardRecording();
        removePopup();
        Toast.makeText(this, "플로팅 종료됨", Toast.LENGTH_SHORT).show();
        stopSelf();
    }

    /** 녹음 중이면 파일만 지우고(전송·저장 안 함) 조용히 정리한다. */
    private void discardRecording() {
        recording = false;
        mode = MODE_IDLE;
        ui.removeCallbacks(tick);
        ui.removeCallbacks(maxStop);
        if (recorder != null) {
            try {
                recorder.stop();
            } catch (Exception ignored) {
            }
            cleanupRecorder();
        }
        if (recFile != null) {
            try {
                recFile.delete();
            } catch (Exception ignored) {
            }
        }
    }

    private void onSingleTap() {
        if (quitting) {
            return;
        }
        if (mode == MODE_FILE) {
            stopFileRecording();
            return;
        }
        if (mode == MODE_DICTATE) {
            stopDictation();
            return;
        }
        showState("두 번 톡톡!", 1200);
        vibrate(12);
    }

    private void onDoubleTapAction() {
        if (quitting) {
            return;
        }
        if (mode == MODE_FILE) {
            stopFileRecording();
            return;
        }
        if (mode == MODE_DICTATE) {
            stopDictation();
            return;
        }
        beginDictation();
    }

    private void onLongPressStart() {
        beginFileRecording();
    }

    private void showState(String text, long hideAfterMs) {
        if (bubbleState == null) {
            return;
        }
        bubbleState.setText(text);
        bubbleState.setVisibility(View.VISIBLE);
        ui.removeCallbacks(hideState);
        if (hideAfterMs > 0) {
            ui.postDelayed(hideState, hideAfterMs);
        }
    }

    /** 녹음 중 타이머: 은은한 하늘색 점 + 시간 (빨간색 표시 없음) */
    private void setTimerText(long seconds) {
        if (bubbleState == null) {
            return;
        }
        String time = String.format("%d:%02d", seconds / 60, seconds % 60);
        SpannableString ss = new SpannableString("● " + time);
        ss.setSpan(new ForegroundColorSpan(Color.parseColor("#7FD4FF")),
                0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        bubbleState.setText(ss);
        bubbleState.setVisibility(View.VISIBLE);
    }

    /* ------------------------------------------------------------------ */
    /* 버블 모양: A1 로고 ↔ 작아진 원 + 흰 점                                */
    /* ------------------------------------------------------------------ */

    /**
     * 0 = 대기(A1), 1 = 글자 변환(살짝 커지고 하늘색 링), 2 = 녹음 파일 저장(작아지고 흰 점).
     * 색은 다크네이비 + 흰색만 쓴다(빨간색 금지 — 밖에서 티 나지 않게).
     */
    private void applyModeVisual(int m) {
        if (bubbleFrame == null || bubbleLogo == null || bubbleDot == null) {
            return;
        }
        if (m == MODE_FILE) {
            stopPulse();
            bubbleLogo.setVisibility(View.GONE);
            bubbleDot.setVisibility(View.VISIBLE);
            bubbleDot.setAlpha(1f);
            animateScale(0.66f);
        } else if (m == MODE_DICTATE) {
            bubbleLogo.setVisibility(View.VISIBLE);
            bubbleLogo.setAlpha(1f);
            bubbleDot.setVisibility(View.GONE);
            animateScale(1.06f);
            startPulse();
        } else {
            stopPulse();
            bubbleLogo.setVisibility(View.VISIBLE);
            bubbleLogo.setAlpha(1f);
            bubbleDot.setVisibility(View.GONE);
            animateScale(1f);
        }
    }

    private void animateScale(float target) {
        if (bubbleFrame == null) {
            return;
        }
        if (scaleAnim != null) {
            try {
                scaleAnim.cancel();
            } catch (Exception ignored) {
            }
            scaleAnim = null;
        }
        float from = bubbleFrame.getScaleX();
        if (Math.abs(from - target) < 0.01f) {
            bubbleFrame.setScaleX(target);
            bubbleFrame.setScaleY(target);
            return;
        }
        scaleAnim = ValueAnimator.ofFloat(from, target);
        scaleAnim.setDuration(110);
        scaleAnim.setInterpolator(new DecelerateInterpolator());
        scaleAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                if (bubbleFrame == null) {
                    return;
                }
                float s = (Float) a.getAnimatedValue();
                bubbleFrame.setScaleX(s);
                bubbleFrame.setScaleY(s);
            }
        });
        scaleAnim.start();
    }

    /** 글자 변환 중에만 동그라미 바깥으로 은은한 하늘색 테두리 빛이 돈다. */
    private void startPulse() {
        if (bubbleRing == null) {
            return;
        }
        stopPulse();
        bubbleRing.setVisibility(View.VISIBLE);
        bubbleRing.setScaleX(1f);
        bubbleRing.setScaleY(1f);
        bubbleRing.setAlpha(0.9f);
        pulse = ValueAnimator.ofFloat(0f, 1f);
        pulse.setDuration(1500);
        pulse.setRepeatCount(ValueAnimator.INFINITE);
        pulse.setInterpolator(new LinearInterpolator());
        pulse.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                if (bubbleRing == null) {
                    return;
                }
                float t = (Float) a.getAnimatedValue();
                float scale = 1f + 0.24f * t;
                bubbleRing.setScaleX(scale);
                bubbleRing.setScaleY(scale);
                bubbleRing.setAlpha(0.9f * (1f - t));
            }
        });
        pulse.start();
    }

    private void stopPulse() {
        if (pulse != null) {
            try {
                pulse.cancel();
            } catch (Exception ignored) {
            }
            pulse = null;
        }
        if (bubbleRing != null) {
            bubbleRing.setVisibility(View.GONE);
        }
    }

    /**
     * 접근성이 켜져 있을 때: 팝업 없이 지금 입력칸에 바로 넣는다.
     * 입력칸을 못 찾으면 기존처럼 복사 + 확인 팝업으로 넘어간다.
     */
    private void insertDirect(final String text) {
        // 이전에 떠 있던 결과 팝업이 있으면 정리하고 동그라미만 남긴다.
        if (popupRoot != null) {
            removePopup();
            if (bubbleRoot != null) {
                bubbleRoot.setVisibility(View.VISIBLE);
            }
        }
        final Context app = getApplicationContext();
        io.execute(new Runnable() {
            @Override
            public void run() {
                final boolean done = A1VoiceAccessibilityService.insertText(app, text);
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        if (done) {
                            if (recFile != null) {
                                recFile.delete();
                            }
                            showState("입력했어요 ✓", 1800);
                            Toast.makeText(OverlayService.this, "입력했어요", Toast.LENGTH_SHORT).show();
                        } else {
                            setResult(text);
                        }
                    }
                });
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* 글자 변환 녹음 (두 번 톡톡)                                            */
    /* ------------------------------------------------------------------ */

    /** 두 번 톡톡: 화면 표시·진동을 먼저 하고 마이크를 연다(체감 반응 속도). */
    private void beginDictation() {
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            showMessage("마이크 권한 필요", "A1 음성 앱을 열어 마이크를 허용해 주세요.");
            return;
        }
        vibrate(15);
        applyModeVisual(MODE_DICTATE);
        if (!startRecording(false)) {
            applyModeVisual(MODE_IDLE);
            bubbleState.setVisibility(View.GONE);
        }
    }

    private boolean startRecording(boolean fileMode) {
        try {
            File dir = new File(getCacheDir(), "rec");
            if (!dir.exists()) {
                dir.mkdirs();
            }
            clearOldTemp(dir);
            sessionGen++;
            recFile = new File(dir, (fileMode ? "a1_rec_" : "a1_dictate_") + System.currentTimeMillis() + ".m4a");

            recorder = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioChannels(1);
            if (fileMode) {
                // 나중에 다시 듣는 파일이므로 16kHz 대신 44.1kHz 96kbps
                recorder.setAudioSamplingRate(44100);
                recorder.setAudioEncodingBitRate(96000);
            } else {
                recorder.setAudioSamplingRate(16000);
                recorder.setAudioEncodingBitRate(64000);
            }
            recorder.setOutputFile(recFile.getAbsolutePath());
            recorder.prepare();
            recorder.start();

            mode = fileMode ? MODE_FILE : MODE_DICTATE;
            recording = true;
            recStartMs = SystemClock.elapsedRealtime();
            if (!fileMode) {
                setTimerText(0);
            }
            ui.post(tick);
            ui.removeCallbacks(maxStop);
            ui.postDelayed(maxStop, fileMode ? FILE_MAX_MS : MAX_MS);
            return true;
        } catch (Exception e) {
            cleanupRecorder();
            recording = false;
            mode = MODE_IDLE;
            if (recFile != null) {
                recFile.delete();
            }
            showMessage("녹음 시작 실패", readable(e));
            return false;
        }
    }

    private void stopDictation() {
        if (mode != MODE_DICTATE) {
            return;
        }
        recording = false;
        mode = MODE_IDLE;
        ui.removeCallbacks(tick);
        ui.removeCallbacks(maxStop);
        long dur = SystemClock.elapsedRealtime() - recStartMs;
        try {
            recorder.stop();
        } catch (Exception ignored) {
            // 너무 짧으면 stop() 이 예외를 던진다.
        }
        cleanupRecorder();
        applyModeVisual(MODE_IDLE);
        vibrate(25);

        if (dur < MIN_MS || recFile == null || !recFile.exists() || recFile.length() < 2000) {
            bubbleState.setVisibility(View.GONE);
            if (recFile != null) {
                recFile.delete();
            }
            showMessage("녹음이 너무 짧아요", "A1을 두 번 톡톡 누른 뒤 또박또박 말씀해 주세요.");
            return;
        }
        bubbleState.setText("변환 준비…");
        recDurationSec = (int) (dur / 1000);
        transcribe(recFile);
    }

    /* ------------------------------------------------------------------ */
    /* 녹음 파일 저장 (길게 꾹)                                              */
    /* ------------------------------------------------------------------ */

    private void beginFileRecording() {
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            showMessage("마이크 권한 필요", "A1 음성 앱을 열어 마이크를 허용해 주세요.");
            return;
        }
        // 화면 표시와 짧은 진동을 먼저 — 마이크를 여는 동안 반 박자 늦는 느낌을 없앤다.
        vibrate(15);
        applyModeVisual(MODE_FILE);
        if (!startRecording(true)) {
            applyModeVisual(MODE_IDLE);
        }
    }

    /** 녹음 파일 저장 종료: Recordings/A1녹음 에 .m4a 로 저장하고 원래 A1 로고로 돌아온다. */
    private void stopFileRecording() {
        if (mode != MODE_FILE) {
            return;
        }
        recording = false;
        mode = MODE_IDLE;
        ui.removeCallbacks(tick);
        ui.removeCallbacks(maxStop);
        long dur = SystemClock.elapsedRealtime() - recStartMs;
        boolean stopped = true;
        try {
            recorder.stop();
        } catch (Exception e) {
            stopped = false;
        }
        cleanupRecorder();
        applyModeVisual(MODE_IDLE);
        vibrate(25);

        final File src = recFile;
        recFile = null;
        if (!stopped || dur < MIN_MS || src == null || !src.exists() || src.length() < 2000) {
            if (src != null) {
                src.delete();
            }
            Toast.makeText(this, stopped ? "녹음이 너무 짧아요" : "녹음 저장 실패",
                    Toast.LENGTH_SHORT).show();
            return;
        }
        io.execute(new Runnable() {
            @Override
            public void run() {
                final String where = saveToRecordings(src);
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        if (quitting) {
                            return;
                        }
                        Toast.makeText(OverlayService.this,
                                where == null ? "녹음 저장 실패" : "녹음 저장됨",
                                Toast.LENGTH_SHORT).show();
                    }
                });
            }
        });
    }

    /**
     * 기기 공용 폴더 Recordings/A1녹음 에 A1_YYYYMMDD_HHMMSS.m4a 로 저장한다.
     * Android 10+ 는 MediaStore(RELATIVE_PATH) — 저장소 권한 없이 바로 보인다.
     * Android 9 이하는 공용 폴더 직접 쓰기, 그것도 안 되면 앱 외부 폴더로 폴백.
     *
     * @return 보여 줄 경로(실패 시 null)
     */
    private String saveToRecordings(File src) {
        String name = "A1_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date()) + ".m4a";
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Audio.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Audio.Media.MIME_TYPE, "audio/mp4");
                v.put(MediaStore.Audio.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_RECORDINGS + "/" + REC_DIR_NAME);
                v.put(MediaStore.Audio.Media.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(
                        MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (uri == null) {
                    throw new IOException("MediaStore insert 실패");
                }
                OutputStream os = getContentResolver().openOutputStream(uri);
                if (os == null) {
                    throw new IOException("MediaStore 출력 실패");
                }
                try {
                    copy(src, os);
                } finally {
                    try {
                        os.close();
                    } catch (Exception ignored) {
                    }
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.Audio.Media.IS_PENDING, 0);
                getContentResolver().update(uri, done, null, null);
                src.delete();
                return Environment.DIRECTORY_RECORDINGS + "/" + REC_DIR_NAME + "/" + name;
            }
        } catch (Exception ignored) {
            // 아래 공용 폴더 직접 쓰기로 폴백
        }
        // Android 9 이하(또는 MediaStore 실패): 공용 Recordings 폴더에 직접 쓴다.
        try {
            File dir = new File(Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_RECORDINGS), REC_DIR_NAME);
            if (!dir.exists() && !dir.mkdirs()) {
                throw new IOException("폴더를 만들 수 없음");
            }
            File out = new File(dir, name);
            FileOutputStream os = new FileOutputStream(out);
            try {
                copy(src, os);
            } finally {
                try {
                    os.close();
                } catch (Exception ignored) {
                }
            }
            MediaScannerConnection.scanFile(this, new String[]{out.getAbsolutePath()},
                    new String[]{"audio/mp4"}, null);
            src.delete();
            return Environment.DIRECTORY_RECORDINGS + "/" + REC_DIR_NAME + "/" + name;
        } catch (Exception ignored) {
        }
        // 마지막 폴백: 앱 전용 외부 폴더(권한 없이 항상 가능)
        try {
            File dir = new File(getExternalFilesDir(Environment.DIRECTORY_MUSIC), REC_DIR_NAME);
            if (dir == null || (!dir.exists() && !dir.mkdirs())) {
                return null;
            }
            File out = new File(dir, name);
            FileOutputStream os = new FileOutputStream(out);
            try {
                copy(src, os);
            } finally {
                try {
                    os.close();
                } catch (Exception ignored) {
                }
            }
            src.delete();
            return out.getAbsolutePath();
        } catch (Exception e) {
            return null;
        }
    }

    private static void copy(File src, OutputStream os) throws IOException {
        FileInputStream in = new FileInputStream(src);
        try {
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                os.write(buf, 0, n);
            }
            os.flush();
        } finally {
            try {
                in.close();
            } catch (Exception ignored) {
            }
        }
    }

    /** 1시간 넘게 남은 임시 녹음만 정리한다(방금 만든 파일은 건드리지 않는다). */
    private void clearOldTemp(File dir) {
        try {
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
        } catch (Exception ignored) {
        }
    }

    private void cleanupRecorder() {
        if (recorder != null) {
            try {
                recorder.reset();
            } catch (Exception ignored) {
            }
            try {
                recorder.release();
            } catch (Exception ignored) {
            }
            recorder = null;
        }
    }

    /* ------------------------------------------------------------------ */
    /* 변환                                                               */
    /* ------------------------------------------------------------------ */

    private void transcribe(final File file) {
        final int gen = sessionGen;
        // 접근성이 켜져 있으면 결과 팝업 없이 입력칸에 바로 넣는다.
        final boolean direct = A1VoiceAccessibilityService.isEnabled(this);
        if (direct) {
            if (bubbleState != null) {
                bubbleState.setText("변환 중…");
                bubbleState.setVisibility(View.VISIBLE);
            }
        } else {
            setBusy();
        }
        final String name = Prefs.get(this, Prefs.K_NAME, Prefs.DEFAULT_NAME);
        final String pass = Prefs.get(this, Prefs.K_PASS, "");
        final String server = Prefs.get(this, Prefs.K_SERVER, Prefs.DEFAULT_SERVER);
        final Context app = getApplicationContext();
        io.execute(new Runnable() {
            @Override
            public void run() {
                // 4연타로 종료됐거나 새 녹음이 시작됐으면 서버로 보내지 않는다.
                if (gen != sessionGen || quitting) {
                    file.delete();
                    return;
                }
                final Transcriber.Out out = Transcriber.transcribe(app, file, name, pass, server);
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        if (gen != sessionGen || quitting) {
                            file.delete();
                            return;
                        }
                        if (out.ok) {
                            // 말한 내용은 이 기기 기록에도 남긴다(서버에는 안 남는다).
                            History.add(app, "플로팅 녹음", History.SRC_FLOAT, recDurationSec, 1, out.text);
                            copyToClipboard(out.text);
                            if (direct) {
                                insertDirect(out.text);
                            } else {
                                setResult(out.text);
                            }
                        } else {
                            setError(out.error);
                        }
                    }
                });
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* 팝업                                                               */
    /* ------------------------------------------------------------------ */

    private void openPopupShell() {
        removePopup();
        popupRoot = LayoutInflater.from(this).inflate(R.layout.overlay_popup, null);
        popupTitle = (TextView) popupRoot.findViewById(R.id.popup_title);
        popupMsg = (TextView) popupRoot.findViewById(R.id.popup_msg);
        popupEdit = (EditText) popupRoot.findViewById(R.id.popup_text);
        popupProgress = (ProgressBar) popupRoot.findViewById(R.id.popup_progress);
        popupPrimary = (TextView) popupRoot.findViewById(R.id.popup_primary);
        popupSecondary = (TextView) popupRoot.findViewById(R.id.popup_secondary);

        popupRoot.findViewById(R.id.popup_close).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                closePopup();
            }
        });
        popupSecondary.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                closePopup();
            }
        });
        popupEdit.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                focusForTyping();
            }
        });

        popupParams = new WindowManager.LayoutParams();
        popupParams.type = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        popupParams.format = PixelFormat.TRANSLUCENT;
        popupParams.width = screenW() - dp(28);
        popupParams.height = WindowManager.LayoutParams.WRAP_CONTENT;
        popupParams.gravity = Gravity.CENTER;
        popupParams.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH;
        popupParams.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;

        popupRoot.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                if (event.getAction() == MotionEvent.ACTION_OUTSIDE) {
                    closePopup();
                    return true;
                }
                return false;
            }
        });

        try {
            wm.addView(popupRoot, popupParams);
        } catch (Exception e) {
            popupRoot = null;
            return;
        }
        if (bubbleRoot != null) {
            bubbleRoot.setVisibility(View.GONE);
        }
    }

    private void setPopupFocusable(boolean focusable) {
        if (popupParams == null || popupRoot == null) {
            return;
        }
        int base = WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH;
        popupParams.flags = focusable ? base : (base | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
        try {
            wm.updateViewLayout(popupRoot, popupParams);
        } catch (Exception ignored) {
        }
    }

    private void focusForTyping() {
        if (popupRoot == null || popupEdit == null) {
            return;
        }
        setPopupFocusable(true);
        popupEdit.setFocusableInTouchMode(true);
        popupEdit.requestFocus();
        try {
            popupEdit.setSelection(popupEdit.getText().length());
        } catch (Exception ignored) {
        }
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                if (imm != null && popupEdit != null) {
                    imm.showSoftInput(popupEdit, InputMethodManager.SHOW_IMPLICIT);
                }
            }
        }, 150);
    }

    private void setBusy() {
        if (popupRoot == null) {
            openPopupShell();
        }
        if (popupRoot == null) {
            return;
        }
        popupTitle.setText("A1 음성");
        popupMsg.setText("음성을 글로 바꾸고 있어요…");
        popupProgress.setVisibility(View.VISIBLE);
        popupEdit.setVisibility(View.GONE);
        popupPrimary.setVisibility(View.GONE);
        popupSecondary.setVisibility(View.GONE);
        popupRoot.findViewById(R.id.popup_buttons).setVisibility(View.GONE);
        if (bubbleState != null) {
            bubbleState.setText("변환 중…");
            bubbleState.setVisibility(View.VISIBLE);
        }
    }

    private void setResult(final String text) {
        if (popupRoot == null) {
            openPopupShell();
        }
        if (popupRoot == null) {
            return;
        }
        popupTitle.setText("A1 음성 변환");
        popupMsg.setText("클립보드에 복사했어요 · 글자를 고쳐서 다시 복사할 수 있어요");
        popupProgress.setVisibility(View.GONE);
        popupEdit.setVisibility(View.VISIBLE);
        popupEdit.setText(text);
        popupRoot.findViewById(R.id.popup_buttons).setVisibility(View.VISIBLE);
        popupSecondary.setVisibility(View.VISIBLE);
        popupPrimary.setVisibility(View.VISIBLE);
        popupSecondary.setText("닫기");
        popupPrimary.setText("복사");
        popupPrimary.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String t = popupEdit.getText().toString().trim();
                copyToClipboard(t);
                popupMsg.setText("클립보드에 복사했어요 ✓");
            }
        });
        if (bubbleState != null) {
            bubbleState.setVisibility(View.GONE);
        }
    }

    private void setError(String message) {
        if (popupRoot == null) {
            openPopupShell();
        }
        if (popupRoot == null) {
            return;
        }
        popupTitle.setText("변환 실패");
        popupMsg.setText(message == null || message.isEmpty() ? "다시 시도해 주세요." : message);
        popupProgress.setVisibility(View.GONE);
        popupEdit.setVisibility(View.GONE);
        popupRoot.findViewById(R.id.popup_buttons).setVisibility(View.VISIBLE);
        popupSecondary.setVisibility(View.VISIBLE);
        popupPrimary.setVisibility(View.VISIBLE);
        popupSecondary.setText("닫기");
        popupPrimary.setText("다시 시도");
        popupPrimary.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (recFile != null && recFile.exists()) {
                    transcribe(recFile);
                } else {
                    closePopup();
                }
            }
        });
        if (bubbleState != null) {
            bubbleState.setVisibility(View.GONE);
        }
    }

    private void showMessage(String title, String message) {
        if (quitting) {
            return;
        }
        if (popupRoot == null) {
            openPopupShell();
        }
        if (popupRoot == null) {
            return;
        }
        popupTitle.setText(title);
        popupMsg.setText(message);
        popupProgress.setVisibility(View.GONE);
        popupEdit.setVisibility(View.GONE);
        popupRoot.findViewById(R.id.popup_buttons).setVisibility(View.VISIBLE);
        popupSecondary.setVisibility(View.GONE);
        popupPrimary.setVisibility(View.VISIBLE);
        popupPrimary.setText("확인");
        popupPrimary.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                closePopup();
            }
        });
    }

    private void closePopup() {
        if (popupEdit != null) {
            try {
                InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                if (imm != null) {
                    imm.hideSoftInputFromWindow(popupEdit.getWindowToken(), 0);
                }
            } catch (Exception ignored) {
            }
        }
        removePopup();
        if (bubbleRoot != null) {
            bubbleRoot.setVisibility(View.VISIBLE);
        }
        if (bubbleState != null) {
            bubbleState.setVisibility(View.GONE);
        }
        if (recFile != null) {
            recFile.delete();
        }
    }

    private void removePopup() {
        if (popupRoot != null && wm != null) {
            try {
                wm.removeView(popupRoot);
            } catch (Exception ignored) {
            }
        }
        popupRoot = null;
        popupParams = null;
    }

    /* ------------------------------------------------------------------ */
    /* 도구                                                               */
    /* ------------------------------------------------------------------ */

    private void copyToClipboard(String text) {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText("A1 음성", text == null ? "" : text));
            }
        } catch (Exception ignored) {
        }
    }

    private void vibrate(int ms) {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) {
                return;
            }
            if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(ms);
            }
        } catch (Exception ignored) {
        }
    }

    private String readable(Exception e) {
        String m = e.getMessage();
        return m == null || m.isEmpty() ? e.getClass().getSimpleName() : m;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    private int screenW() {
        DisplayMetrics m = new DisplayMetrics();
        try {
            wm.getDefaultDisplay().getMetrics(m);
        } catch (Exception ignored) {
        }
        return m.widthPixels > 0 ? m.widthPixels : 1080;
    }

    private int screenH() {
        DisplayMetrics m = new DisplayMetrics();
        try {
            wm.getDefaultDisplay().getMetrics(m);
        } catch (Exception ignored) {
        }
        return m.heightPixels > 0 ? m.heightPixels : 1920;
    }
}
