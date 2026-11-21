package kr.inu.a1voice;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

/**
 * 위젯·빠른 설정 타일이 부르는 투명 화면 (v1.6).
 *
 * 화면 없이 백그라운드에서 startForegroundService 를 부르면 Android 12+ 에서
 * ForegroundServiceStartNotAllowedException 이 날 수 있다. 그래서 아주 잠깐
 * 투명한 Activity 를 띄운 뒤(사용자가 방금 누른 조작이라 허용되는 상태),
 * 그 안에서 OverlayService 를 시작/종료하고 곧바로 finish() 한다.
 * 앱 설정 화면(MainActivity)은 로그인·권한이 빠졌을 때만 연다.
 */
public class WidgetToggleActivity extends Activity {

    public static final String ACTION_WIDGET_TOGGLE = "kr.inu.a1voice.WIDGET_TOGGLE";
    public static final String ACTION_TILE_TOGGLE = "kr.inu.a1voice.TILE_TOGGLE";

    /** 시작/종료가 끝난 뒤 화면을 닫기까지의 여유(사용자에게는 보이지 않는다). */
    private static final long FINISH_DELAY_MS = 220;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean handled;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) {
            // 화면 회전 등으로 다시 만들어지면 아무 것도 하지 않고 닫는다.
            handled = true;
            finish();
        }
    }

    /**
     * 화면이 실제로 떠 있는(onResume) 뒤에 토글한다.
     * Android 12+ 는 "화면이 보이는 앱"만 포그라운드 서비스를 시작할 수 있으므로
     * onCreate 보다 onResume 쪽이 더 안전하다.
     */
    @Override
    protected void onResume() {
        super.onResume();
        if (!handled) {
            handleToggle();
        }
    }

    private void handleToggle() {
        if (handled) {
            return;
        }
        handled = true;

        // 1) 이미 떠 있으면 바로 끈다.
        if (FloatToggle.running()) {
            FloatToggle.turnOff(this);
            Toast.makeText(this, "A1 플로팅 꺼짐", Toast.LENGTH_SHORT).show();
            FloatToggle.requestTileRefresh(this);
            finishSoon();
            return;
        }

        // 2) 로그인·권한이 빠졌으면 앱 설정 화면으로 안내한다.
        String missing = FloatToggle.missing(this);
        if (!missing.isEmpty()) {
            Toast.makeText(this, missing, Toast.LENGTH_LONG).show();
            openMain();
            finishSoon();
            return;
        }

        // 3) 켠다. 여기서는 화면이 떠 있으므로 포그라운드 서비스 시작이 허용된다.
        if (FloatToggle.turnOn(this)) {
            Toast.makeText(this, "A1 플로팅 켜짐", Toast.LENGTH_SHORT).show();
        } else {
            Toast.makeText(this, "플로팅을 켜지 못했어요. 앱에서 다시 시도해 주세요.", Toast.LENGTH_LONG).show();
            openMain();
        }
        FloatToggle.requestTileRefresh(this);
        finishSoon();
    }

    private void openMain() {
        try {
            Intent i = new Intent(this, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(i);
        } catch (Exception ignored) {
        }
    }

    private void finishSoon() {
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                finish();
            }
        }, FINISH_DELAY_MS);
    }
}
