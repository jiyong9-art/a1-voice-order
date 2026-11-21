package kr.inu.a1voice;

import android.content.Context;
import android.content.SharedPreferences;

/** 앱 설정 저장소(이름 · 팀 비밀번호 · 서버 주소 · 로그인 쿠키 · 버블 위치). */
public final class Prefs {

    public static final String DEFAULT_SERVER = "https://a1-voice-order.vercel.app";
    /** 이름 기본값은 비워 둔다 — 저장된 값이 있을 때만 채운다. */
    public static final String DEFAULT_NAME = "";

    public static final String K_NAME = "name";
    public static final String K_PASS = "pass";
    public static final String K_SERVER = "server";
    public static final String K_COOKIE = "cookie";
    public static final String K_X = "bubble_x";
    public static final String K_Y = "bubble_y";
    /** v1.8 플로팅 위치 고정(이동 잠금) */
    public static final String K_LOCK = "bubble_lock";

    private Prefs() {
    }

    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences("a1voice", Context.MODE_PRIVATE);
    }

    public static String get(Context c, String key, String def) {
        return sp(c).getString(key, def);
    }

    public static void put(Context c, String key, String value) {
        sp(c).edit().putString(key, value).apply();
    }

    public static int getInt(Context c, String key, int def) {
        return sp(c).getInt(key, def);
    }

    public static void putInt(Context c, String key, int value) {
        sp(c).edit().putInt(key, value).apply();
    }

    public static long getLong(Context c, String key, long def) {
        return sp(c).getLong(key, def);
    }

    public static void putLong(Context c, String key, long value) {
        sp(c).edit().putLong(key, value).apply();
    }

    public static boolean getBool(Context c, String key, boolean def) {
        return sp(c).getBoolean(key, def);
    }

    public static void putBool(Context c, String key, boolean value) {
        sp(c).edit().putBoolean(key, value).apply();
    }
}
