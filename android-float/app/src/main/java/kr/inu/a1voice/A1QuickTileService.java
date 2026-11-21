package kr.inu.a1voice;

import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import android.widget.Toast;

/**
 * 상단 빠른 설정 타일 "A1 음성" (v1.6).
 *
 * 타일을 누르면 위젯과 똑같이 플로팅을 즉시 켜거나 끄고,
 * 타일 상태(STATE_ACTIVE / STATE_INACTIVE)를 서비스 상태와 맞춘다.
 *
 * 켤 때는 타일(백그라운드)에서 직접 startForegroundService 를 부르지 않고
 * startActivityAndCollapse(투명 화면) 로 처리한다 — Android 12+ 의
 * 백그라운드 포그라운드 서비스 제한(ForegroundServiceStartNotAllowedException) 회피.
 * 끄기(stopService)는 제한이 없어 타일에서 바로 한다.
 */
public class A1QuickTileService extends TileService {

    private static final int REQ_ACTIVITY = 1002;
    private static final long STATE_REFRESH_MS = 600;

    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    public void onStartListening() {
        super.onStartListening();
        render();
    }

    @Override
    public void onTileAdded() {
        super.onTileAdded();
        render();
    }

    @Override
    public void onClick() {
        super.onClick();

        if (FloatToggle.running()) {
            FloatToggle.turnOff(this);
            toast("A1 플로팅 꺼짐");
            renderLater();
            return;
        }

        boolean ready = FloatToggle.ready(this);
        Intent i;
        if (ready) {
            i = new Intent(this, WidgetToggleActivity.class).setAction(WidgetToggleActivity.ACTION_TILE_TOGGLE);
        } else {
            i = new Intent(this, MainActivity.class);
            toast(FloatToggle.missing(this));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startCollapse(i);
        renderLater();
    }

    /**
     * 상단바를 접으면서 화면을 띄운다.
     * API 34+ 는 PendingIntent 판만 허용하므로 버전에 따라 나눠 부른다.
     */
    private void startCollapse(Intent i) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getActivity(this, REQ_ACTIVITY, i, flags);
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startActivityAndCollapse(pi);
            } else {
                startActivityAndCollapse(i);
            }
        } catch (Exception e) {
            try {
                startActivity(i);
            } catch (Exception ignored) {
            }
        }
    }

    private void render() {
        Tile tile = getQsTile();
        if (tile == null) {
            return;
        }
        boolean on = FloatToggle.running();
        tile.setState(on ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        if (Build.VERSION.SDK_INT >= 29) {
            tile.setSubtitle(on ? "켜짐" : "꺼짐");
        }
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                tile.setIcon(Icon.createWithResource(this, R.drawable.ic_tile_a1));
            } catch (Exception ignored) {
            }
        }
        try {
            tile.updateTile();
        } catch (Exception ignored) {
        }
    }

    /** 시작/종료가 반영된 뒤 타일 상태를 다시 맞춘다. */
    private void renderLater() {
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                render();
            }
        }, STATE_REFRESH_MS);
    }

    private void toast(String text) {
        if (text == null || text.trim().isEmpty()) {
            return;
        }
        try {
            Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
        } catch (Exception ignored) {
        }
    }
}
