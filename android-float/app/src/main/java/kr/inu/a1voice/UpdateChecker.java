package kr.inu.a1voice;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * 새 버전 확인 (v1.3부터, v1.4도 같은 방식).
 *
 * 앱을 열 때 한 번, 서버(`https://a1kr.com/app/version.json`)에 지금 깔린 버전보다
 * 높은 versionCode 가 있는지 조용히 물어본다. 있으면 화면에
 * "New version vX available" / [Update] 를 띄우고, 누르면 "Updating..." 과 함께
 * 새 APK 주소를 브라우저로 연다.
 *
 * 서버 형식: {"versionCode":5,"versionName":"1.4","url":"https://a1kr.com/app/a1-voice.apk"}
 */
public final class UpdateChecker {

    public static final String VERSION_URL = "https://a1kr.com/app/version.json";
    public static final String DEFAULT_APK_URL = "https://a1kr.com/app/a1-voice.apk";

    public interface Listener {
        /** 새 버전이 있을 때만 부른다(메인 스레드). */
        void onNewVersion(int versionCode, String versionName, String apkUrl);

        /** 확인은 됐는데 이미 최신일 때(메인 스레드). 직접 확인을 눌렀을 때만 안내에 쓴다. */
        void onUpToDate();
    }

    private UpdateChecker() {
    }

    public static int installedCode(Context c) {
        try {
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= 28) {
                return (int) pi.getLongVersionCode();
            }
            return pi.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    public static String installedName(Context c) {
        try {
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return pi.versionName == null ? "" : pi.versionName;
        } catch (Exception e) {
            return "";
        }
    }

    /** 백그라운드로 확인하고, 새 버전이 있으면 메인 스레드에서 알려 준다. 실패는 조용히 넘긴다. */
    public static void check(final Context ctx, final Listener listener) {
        final Context app = ctx.getApplicationContext();
        final Handler ui = new Handler(Looper.getMainLooper());
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    URL url = new URL(VERSION_URL);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(5000);
                    conn.setReadTimeout(8000);
                    conn.setRequestProperty("Accept", "application/json");
                    conn.setUseCaches(false);
                    int code = conn.getResponseCode();
                    if (code < 200 || code >= 300) {
                        return;
                    }
                    InputStream in = conn.getInputStream();
                    BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = r.readLine()) != null) {
                        sb.append(line);
                    }
                    r.close();
                    JSONObject o = new JSONObject(sb.toString());
                    final int remoteCode = o.optInt("versionCode", 0);
                    final String remoteName = o.optString("versionName", "");
                    String apk = o.optString("url", DEFAULT_APK_URL);
                    if (apk == null || apk.trim().isEmpty()) {
                        apk = DEFAULT_APK_URL;
                    }
                    final String apkUrl = apk.trim();
                    if (remoteCode > installedCode(app) && remoteCode > 0) {
                        ui.post(new Runnable() {
                            @Override
                            public void run() {
                                listener.onNewVersion(remoteCode, remoteName, apkUrl);
                            }
                        });
                    } else {
                        ui.post(new Runnable() {
                            @Override
                            public void run() {
                                listener.onUpToDate();
                            }
                        });
                    }
                } catch (Exception ignored) {
                    // 인터넷이 없거나 서버가 조용하면 그냥 넘어간다(앱은 그대로 쓴다).
                } finally {
                    if (conn != null) {
                        conn.disconnect();
                    }
                }
            }
        }, "a1-version-check").start();
    }
}
