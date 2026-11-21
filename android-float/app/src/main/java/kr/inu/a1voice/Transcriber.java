package kr.inu.a1voice;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * a1-voice-order 서버의 Whisper 변환 API 호출기.
 *
 * 1) /api/auth/login 으로 로그인 쿠키(in u_session)를 받아 7일간 재사용
 * 2) /api/transcribe 로 음성을 올려 {ok, text} 를 받는다 (가림 처리 없이 그대로 전사)
 * 3) 서버에 /api/transcribe 가 없으면 /api/sales/voice(x-a1-passcode) 로 대신 시도
 */
public final class Transcriber {

    public static final class Out {
        public final boolean ok;
        public final String text;
        public final String error;

        Out(boolean ok, String text, String error) {
            this.ok = ok;
            this.text = text;
            this.error = error;
        }
    }

    /** 로그인 시도 결과: 성공(쿠키) · 비밀번호 틀림(401) · 서버 연결 실패(0) 를 구분한다. */
    public static final class LoginOut {
        public final String cookie;
        public final int code;

        LoginOut(String cookie, int code) {
            this.cookie = cookie;
            this.code = code;
        }

        public boolean ok() {
            return cookie != null && !cookie.trim().isEmpty();
        }

        /** 네트워크에 아예 못 닿았는지 (비밀번호 문제와 구분). */
        public boolean offline() {
            return code == 0;
        }
    }

    private static final class Resp {
        final int code;
        final String body;
        final String cookie;

        Resp(int code, String body, String cookie) {
            this.code = code;
            this.body = body;
            this.cookie = cookie;
        }
    }

    private Transcriber() {
    }

    public static String normalizeBase(String server) {
        String base = server == null ? "" : server.trim();
        if (base.isEmpty()) {
            base = Prefs.DEFAULT_SERVER;
        }
        if (!base.startsWith("http://") && !base.startsWith("https://")) {
            base = "https://" + base;
        }
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base;
    }

    public static Out transcribe(Context ctx, File audio, String name, String passcode, String server) {
        String base = normalizeBase(server);
        if (audio == null || !audio.exists() || audio.length() == 0) {
            return new Out(false, null, "녹음 파일이 없습니다. 다시 녹음해 주세요.");
        }
        String cookie = Prefs.get(ctx, Prefs.K_COOKIE, "");
        try {
            Resp r = postAudio(base + "/api/transcribe", audio, cookie, null);

            if (r.code == 401) {
                String fresh = login(base, name, passcode).cookie;
                if (fresh == null || fresh.isEmpty()) {
                    return new Out(false, null, "서버 로그인에 실패했습니다. 팀 비밀번호를 확인해 주세요.");
                }
                Prefs.put(ctx, Prefs.K_COOKIE, fresh);
                cookie = fresh;
                r = postAudio(base + "/api/transcribe", audio, cookie, null);
            }

            if (r.code == 404) {
                Resp alt = postAudio(base + "/api/sales/voice", audio, null, passcode);
                if (alt.code >= 200 && alt.code < 300) {
                    JSONObject o = new JSONObject(alt.body);
                    String t = o.optString("transcript", "").trim();
                    if (!t.isEmpty()) {
                        return new Out(true, t, null);
                    }
                    return new Out(false, null, o.optString("error", "음성을 인식하지 못했습니다."));
                }
                return new Out(false, null, "변환 주소를 찾지 못했습니다. 설정의 서버 주소를 확인해 주세요.");
            }

            if (r.code >= 200 && r.code < 300) {
                JSONObject o = new JSONObject(r.body);
                if (o.optBoolean("ok", false)) {
                    String t = o.optString("text", "").trim();
                    if (t.isEmpty()) {
                        return new Out(false, null, "음성을 인식하지 못했습니다. 다시 말씀해 주세요.");
                    }
                    return new Out(true, t, null);
                }
                return applyCodeFallback(audio, base, passcode, o.optString("error", ""));
            }

            if (r.code == 401 || r.code == 403) {
                return new Out(false, null, "권한이 없습니다. 팀 비밀번호를 확인해 주세요.");
            }
            if (r.code == 413) {
                return new Out(false, null, "녹음이 너무 깁니다. 짧게 나눠서 말씀해 주세요.");
            }
            if (r.code == 429) {
                return new Out(false, null, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
            }
            String msg = errorFrom(r.body);
            if (msg != null && !msg.isEmpty()) {
                return new Out(false, null, msg);
            }
            return new Out(false, null, "변환에 실패했습니다. (서버 " + r.code + ")");
        } catch (Exception e) {
            String m = e.getMessage();
            if (m == null) {
                m = e.getClass().getSimpleName();
            }
            return new Out(false, null, "네트워크 오류: " + m);
        }
    }

    private static Out applyCodeFallback(File audio, String base, String passcode, String message) {
        try {
            Resp alt = postAudio(base + "/api/sales/voice", audio, null, passcode);
            if (alt.code >= 200 && alt.code < 300) {
                JSONObject o = new JSONObject(alt.body);
                String t = o.optString("transcript", "").trim();
                if (!t.isEmpty()) {
                    return new Out(true, t, null);
                }
            }
        } catch (Exception ignored) {
            // 아래에서 원래 오류를 그대로 돌려준다.
        }
        return new Out(false, null, message == null || message.isEmpty() ? "음성을 인식하지 못했습니다." : message);
    }

    private static String errorFrom(String body) {
        if (body == null || body.isEmpty()) {
            return null;
        }
        try {
            JSONObject o = new JSONObject(body);
            return o.optString("error", null);
        } catch (Exception e) {
            return null;
        }
    }

    /** 로그인만 시험해 본다(설정 화면의 '연결 확인'). 성공하면 쿠키 값을 돌려준다. */
    public static String checkLogin(String server, String name, String passcode) {
        return login(normalizeBase(server), name, passcode).cookie;
    }

    /** 로그인 결과를 자세히(성공/비번 틀림/연결 실패) 돌려준다. */
    public static LoginOut checkLoginDetailed(String server, String name, String passcode) {
        return login(normalizeBase(server), name, passcode);
    }

    /* ---------------------------------------------------------------- */
    /* 로그인                                                             */
    /* ---------------------------------------------------------------- */

    private static LoginOut login(String base, String name, String passcode) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(base + "/api/auth/login");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("Accept", "application/json");

            JSONObject body = new JSONObject();
            body.put("name", name == null ? "" : name.trim());
            body.put("passcode", passcode == null ? "" : passcode.trim());

            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            OutputStream os = conn.getOutputStream();
            os.write(bytes);
            os.flush();
            os.close();

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                return new LoginOut(null, code);
            }
            String setCookie = conn.getHeaderField("Set-Cookie");
            return new LoginOut(cookieValue(setCookie), code);
        } catch (Exception e) {
            return new LoginOut(null, 0);
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static String cookieValue(String setCookie) {
        if (setCookie == null) {
            return null;
        }
        String key = "inu_session=";
        int i = setCookie.indexOf(key);
        if (i < 0) {
            return null;
        }
        String rest = setCookie.substring(i + key.length());
        int semi = rest.indexOf(';');
        if (semi >= 0) {
            rest = rest.substring(0, semi);
        }
        return rest.trim();
    }

    /* ---------------------------------------------------------------- */
    /* 오디오 업로드                                                       */
    /* ---------------------------------------------------------------- */

    private static Resp postAudio(String urlStr, File audio, String cookie, String passcode) throws Exception {
        String boundary = "----A1Voice" + System.currentTimeMillis();
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(120000);
            conn.setDoOutput(true);
            String headText = "--" + boundary + "\r\n"
                    + "Content-Disposition: form-data; name=\"audio\"; filename=\"" + audio.getName() + "\"\r\n"
                    + "Content-Type: audio/mp4\r\n\r\n";
            byte[] headBytes = headText.getBytes(StandardCharsets.UTF_8);
            byte[] tailBytes = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(headBytes.length + (int) audio.length() + tailBytes.length);
            conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            conn.setRequestProperty("Accept", "application/json");
            if (cookie != null && !cookie.isEmpty()) {
                conn.setRequestProperty("Cookie", "inu_session=" + cookie);
            }
            if (passcode != null && !passcode.isEmpty()) {
                conn.setRequestProperty("x-a1-passcode", passcode);
            }

            OutputStream os = conn.getOutputStream();
            os.write(headBytes);

            FileInputStream in = new FileInputStream(audio);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                os.write(buf, 0, n);
            }
            in.close();

            os.write(tailBytes);
            os.flush();
            os.close();

            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String body = stream == null ? "" : readAll(stream);
            return new Resp(code, body, cookieValue(conn.getHeaderField("Set-Cookie")));
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static String readAll(InputStream in) throws Exception {
        BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line);
        }
        reader.close();
        return sb.toString();
    }

    /** 디버그용: 남은 임시 파일 정리 */
    public static void cleanup(File dir) {
        if (dir == null || !dir.isDirectory()) {
            return;
        }
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        for (File f : files) {
            if (f.isFile()) {
                f.delete();
            }
        }
    }
}
