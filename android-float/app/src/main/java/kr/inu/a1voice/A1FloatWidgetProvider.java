package kr.inu.a1voice;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.widget.RemoteViews;

/**
 * 홈 화면 1×1 위젯 (v1.6, v1.8 배지·상태 점).
 *
 * 반투명 둥근 배지 + 가운데 흰색 A1 — 플로팅 배지와 같은 모습.
 * 오른쪽 위 작은 점이 **초록이면 플로팅이 켜져 있고, 회색이면 꺼져 있다**(v1.8).
 * 한 번 탭하면 앱 설정 화면을 거치지 않고 플로팅을 바로 켜거나 끈다.
 * 실제 토글은 투명 화면(WidgetToggleActivity)이 처리한다(백그라운드 서비스 시작 제한 회피).
 */
public class A1FloatWidgetProvider extends AppWidgetProvider {

    /** 위젯 탭 → 투명 토글 화면. requestCode 를 고정해 매번 같은 PendingIntent 를 쓴다. */
    private static final int REQ_TOGGLE = 1001;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            appWidgetManager.updateAppWidget(id, buildViews(context));
        }
    }

    @Override
    public void onEnabled(Context context) {
        super.onEnabled(context);
    }

    /** 켜짐/꺼짐이 바뀌면 홈 화면 위젯의 상태 점을 다시 그린다. (서비스가 직접 부른다) */
    static void updateAll(Context context) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(context);
            ComponentName cn = new ComponentName(context, A1FloatWidgetProvider.class);
            int[] ids = m.getAppWidgetIds(cn);
            if (ids == null || ids.length == 0) {
                return;
            }
            RemoteViews rv = buildViews(context);
            for (int id : ids) {
                m.updateAppWidget(id, rv);
            }
        } catch (Exception ignored) {
        }
    }

    private static RemoteViews buildViews(Context context) {
        RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_a1_float);

        Intent i = new Intent(context, WidgetToggleActivity.class);
        i.setAction(WidgetToggleActivity.ACTION_WIDGET_TOGGLE);
        // 앱 메인 화면(작업) 위에 겹치지 않도록 별도 작업으로 띄운다.
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getActivity(context, REQ_TOGGLE, i, flags);
        rv.setOnClickPendingIntent(R.id.widget_root, pi);

        // v1.8 상태 점: 켜짐 = 초록, 꺼짐 = 회색
        boolean on = OverlayService.running;
        rv.setViewVisibility(R.id.widget_dot_on, on ? android.view.View.VISIBLE : android.view.View.GONE);
        rv.setViewVisibility(R.id.widget_dot_off, on ? android.view.View.GONE : android.view.View.VISIBLE);
        return rv;
    }
}
