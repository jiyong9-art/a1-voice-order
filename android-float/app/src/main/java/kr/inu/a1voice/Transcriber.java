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
import java.util.Locale;

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
        /** v1.8: 서버가 '말소리 없음'으로 판단해 비운 결과 (오류가 아니다) */
        public final boolean silent;

        Out(boolean ok, String text, String error) {
            this(ok, text, error, false);
        }

        Out(boolean ok, String text, String error, boolean silent) {
            this.ok = ok;
            this.text = text;
            this.error = error;
            this.silent = silent;
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

    /* ------------------------------------------------------------------ */
    /* v1.9 — 긴 녹음 타임아웃                                            */
    /* ------------------------------------------------------------------ */

    /**
     * 서버와 연결(DNS·TCP·TLS)을 맺는 데 기다리는 시간.
     * 모바일망에서 핸드셰이크가 늦어도 20초면 충분하다(예전 15초).
     */
    private static final int CONNECT_MS = 20000;
    /**
     * 올린 오디오의 **변환 결과**를 기다리는 시간 (v1.9: 120초 → 180초).
     *
     * 15~30초짜리 녹음에서 "아예 인식 못 한다"는 제보가 있었는데, 업로드가 끝난 뒤
     * 서버가 모델을 돌리는 시간이 길어질 수 있어 넉넉히 잡는다. 서버 함수 한도는 120초이고
     * 짧은 녹음의 실제 왕복은 2초 안팎이라, 이 값은 '정상 요청을 끊지 않을 만큼'만 크면 된다.
     */
    private static final int UPLOAD_READ_MS = 180000;
    /** 로그인 응답을 기다리는 시간 */
    private static final int LOGIN_READ_MS = 60000;
    /** 연결이 끊겼을 때 한 번 더 보내기 전 쉬는 시간 */
    private static final long RETRY_DELAY_MS = 400;

    /** 마지막으로 연결을 미리 열어 둔 시각 — 너무 자주 다시 열지 않는다. */
    private static final java.util.concurrent.atomic.AtomicLong LAST_WARM_MS =
            new java.util.concurrent.atomic.AtomicLong(0L);

    /**
     * v1.8.3 — 녹음이 시작되면 서버와의 연결(DNS·TCP·TLS)을 미리 열어 둔다.
     *
     * 변환이 끝난 뒤에야 연결을 열면, 사용자는 말이 끝나고 **핸드셰이크까지** 기다려야 한다.
     * 모바일망에서 DNS+TLS 는 보통 200~600ms, 첫 요청에선 더 길다. 말하는 동안(수 초)에
     * 미리 열어 두면 그 시간이 통째로 사라진다. 실패해도 조용히 무시한다.
     *
     * 열어 둔 연결은 HttpURLConnection 의 keep-alive 풀에 남아 다음 POST 가 그대로 쓴다
     * (그래서 요청마다 disconnect() 로 끊지 않는다).
     */
    public static void warmUp(final String server) {
        final long now = System.currentTimeMillis();
        final long prev = LAST_WARM_MS.get();
        if (now - prev < 20000L) {
            return;     // 20초 안에 이미 열어 두었다
        }
        if (!LAST_WARM_MS.compareAndSet(prev, now)) {
            return;
        }
        final String base = normalizeBase(server);
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(base + "/").openConnection();
                    c.setRequestMethod("GET");
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(8000);
                    c.setRequestProperty("Accept-Encoding", "identity");
                    c.setUseCaches(false);
                    int code = c.getResponseCode();
                    InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                    if (in != null) {
                        byte[] b = new byte[4096];
                        while (in.read(b) > 0) {
                            // 끝까지 읽어야 연결이 풀에 반납된다
                        }
                        in.close();
                    }
                } catch (Throwable ignored) {
                    // 미리 열기 실패는 아무 문제도 아니다 — 그냥 변환 때 새로 연다
                }
                // disconnect() 는 부르지 않는다 — 연결을 풀에 남겨 다음 요청이 다시 쓴다
            }
        }, "a1-warmup");
        t.setDaemon(true);
        t.start();
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
                        // v1.8 서버 무음 게이트·프롬프트 에코 필터: 오류가 아니라 '말소리 없음'
                        if (o.optBoolean("silent", false)) {
                            return new Out(true, "", null, true);
                        }
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
                return new Out(false, null, friendlyServerError(msg));
            }
            return new Out(false, null, "변환에 실패했습니다. (서버 " + r.code + ")");
        } catch (java.net.SocketTimeoutException e) {
            // v1.9 — 긴 녹음에서 가장 많이 나던 오류. 원인을 알 수 있게 우리말로 알린다.
            return new Out(false, null,
                    "서버 응답이 늦어 변환을 마치지 못했어요. 잠시 뒤 다시 한 번 시도해 주세요.");
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

    /**
     * v1.9 — 서버·모델 쪽 오류 문구를 사용자가 바로 알아볼 수 있게 바꿔 준다.
     * 특히 OpenAI 잔액(크레딧)이 떨어지면 긴 영어 문장이 그대로 뜨던 것을 우리말로 모은다.
     */
    private static String friendlyServerError(String msg) {
        if (msg == null) {
            return null;
        }
        String low = msg.toLowerCase(Locale.US);
        if (low.contains("no credits remaining") || low.contains("insufficient_quota")
                || low.contains("exceeded your current quota") || low.contains("add credits")) {
            return "OpenAI 크레딧이 부족해 변환할 수 없어요. 관리자에게 알려 주세요.";
        }
        return msg;
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
            conn.setConnectTimeout(CONNECT_MS);
            conn.setReadTimeout(LOGIN_READ_MS);
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
            // v1.8.3 — 본문을 읽어 두어야 연결이 keep-alive 풀에 반납된다(다음 요청이 재사용).
            InputStream s = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (s != null) {
                try {
                    byte[] b = new byte[2048];
                    while (s.read(b) > 0) {
                        // 버린다
                    }
                    s.close();
                } catch (Exception ignored) {
                }
            }
            if (code < 200 || code >= 300) {
                return new LoginOut(null, code);
            }
            String setCookie = conn.getHeaderField("Set-Cookie");
            return new LoginOut(cookieValue(setCookie), code);
        } catch (Exception e) {
            return new LoginOut(null, 0);
        }
        // v1.8.3 — disconnect() 를 부르지 않는다(keep-alive 연결 재사용).
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

    /**
     * v1.9 — 오디오 업로드. **파일을 끝까지 다 보내기 전에** 연결이 끊긴 경우(모바일망 끊김·
     * 핸드셰이크 실패) 한 번만 다시 보낸다. 파일은 이미 기기에 있으니 부담이 없고,
     * 이미 다 올린 뒤의 지연(서버가 모델을 돌리는 중)은 다시 보내지 않는다 — 같은 녹음을
     * 두 번 결제·두 번 기다리게 되기 때문이다.
     */
    private static Resp postAudio(String urlStr, File audio, String cookie, String passcode) throws Exception {
        final boolean[] uploaded = new boolean[1];
        try {
            return postAudioOnce(urlStr, audio, cookie, passcode, uploaded);
        } catch (java.io.IOException e) {
            if (uploaded[0]) {
                throw e;    // 업로드는 끝났다 — 서버 응답 지연이므로 그대로 알린다
            }
            try {
                Thread.sleep(RETRY_DELAY_MS);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw e;
            }
            return postAudioOnce(urlStr, audio, cookie, passcode, new boolean[1]);
        }
    }

    private static Resp postAudioOnce(String urlStr, File audio, String cookie, String passcode,
                                      boolean[] uploaded) throws Exception {
        String boundary = "----A1Voice" + System.currentTimeMillis();
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(CONNECT_MS);
        conn.setReadTimeout(UPLOAD_READ_MS);
        conn.setDoOutput(true);
        String headText = "--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"audio\"; filename=\"" + audio.getName() + "\"\r\n"
                + "Content-Type: " + mimeFor(audio.getName()) + "\r\n\r\n";
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
        uploaded[0] = true;     // 파일을 끝까지 보냈다 — 여기서부터의 오류는 '응답 지연'이다

        int code = conn.getResponseCode();
        InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String body = stream == null ? "" : readAll(stream);
        return new Resp(code, body, cookieValue(conn.getHeaderField("Set-Cookie")));
        // v1.8.3 — disconnect() 를 부르지 않는다. 매 요청마다 끊으면 다음 변환이
        // DNS·TCP·TLS 핸드셰이크를 처음부터 다시 해야 해서(모바일망 200~600ms) 느려진다.
    }

    /**
     * 파일 확장자에 맞는 Content-Type (v1.7).
     * 두 번 톡톡 녹음이 .m4a 에서 .wav 로 바뀌어, 예전처럼 audio/mp4 로 고정하면 서버가 열지 못한다.
     */
    private static String mimeFor(String fileName) {
        String n = fileName == null ? "" : fileName.toLowerCase(Locale.US);
        if (n.endsWith(".wav")) {
            return "audio/wav";
        }
        if (n.endsWith(".mp3")) {
            return "audio/mpeg";
        }
        if (n.endsWith(".ogg")) {
            return "audio/ogg";
        }
        if (n.endsWith(".flac")) {
            return "audio/flac";
        }
        if (n.endsWith(".aac")) {
            return "audio/aac";
        }
        if (n.endsWith(".amr")) {
            return "audio/amr";
        }
        return "audio/mp4";
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
