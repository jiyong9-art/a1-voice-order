package kr.inu.a1voice;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.service.quicksettings.TileService;

/**
 * 홈 화면 위젯(A1FloatWidgetProvider)과 상단 빠른 설정 타일(A1QuickTileService)이
 * 같이 쓰는 "플로팅 켜기/끄기" 공통 처리 (v1.6).
 *
 *  - 켤 준비(로그인 쿠키 + 다른 앱 위에 표시 + 마이크)가 됐는지 본다.
 *  - 실제 켜기/끄기는 투명 화면(WidgetToggleActivity) 안에서 한다.
 *    Android 12+ 는 백그라운드에서 포그라운드 서비스를 시작하지 못하므로,
 *    화면(Activity)이 떠 있는 동안 시작해야 Samsung One UI(Android 14~16)에서도
 *    ForegroundServiceStartNotAllowedException 이 나지 않는다.
 */
final class FloatToggle {

    private FloatToggle() {
    }

    /** 지금 플로팅(A1 동그라미)이 떠 있는지. 서비스와 같은 프로세스라 static 값을 그대로 읽는다. */
    static boolean running() {
        return OverlayService.running;
    }

    /** 켜는 데 필요한 것이 모두 준비됐는지. */
    static boolean ready(Context c) {
        return missing(c).isEmpty();
    }

    /** 빠진 것이 있으면 그 안내 문구, 다 준비됐으면 빈 문자열. */
    static String missing(Context c) {
        String cookie = Prefs.get(c, Prefs.K_COOKIE, "");
        if (cookie == null || cookie.trim().isEmpty()) {
            return "A1 음성 앱에서 먼저 로그인해 주세요.";
        }
        if (!Settings.canDrawOverlays(c)) {
            return "설정에서 '다른 앱 위에 표시'를 허용해야 플로팅이 떠요.";
        }
        if (Build.VERSION.SDK_INT >= 23
                && c.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            return "A1 음성 앱에서 마이크를 허용해 주세요.";
        }
        return "";
    }

    /** 화면(Activity)이 떠 있는 동안 부른다. 성공하면 true. */
    static boolean turnOn(Context c) {
        OverlayService.lastError = "";
        Intent i = new Intent(c, OverlayService.class);
        i.setAction(OverlayService.ACTION_START);
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                c.startForegroundService(i);
            } else {
                c.startService(i);
            }
            return true;
        } catch (Exception e) {
            // ForegroundServiceStartNotAllowedException 등 — 부르는 쪽이 안내를 띄운다.
            return false;
        }
    }

    static void turnOff(Context c) {
        try {
            c.stopService(new Intent(c, OverlayService.class));
        } catch (Exception ignored) {
        }
    }

    /** 다음에 상단바를 열 때 타일 상태가 바로 맞도록 갱신을 요청한다(타일이 없으면 조용히 무시). */
    static void requestTileRefresh(Context c) {
        try {
            TileService.requestListeningState(c, new ComponentName(c, A1QuickTileService.class));
        } catch (Exception ignored) {
        }
    }
}
