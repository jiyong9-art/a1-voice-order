package kr.inu.a1voice;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * 변환 기록 — **이 기기 안에만** 저장한다.
 *
 * 대표님 지시: "저장은 각 기기에서 저장을 하도록 해줘. 남의 것까지 듣고 싶지 않다."
 * 그래서 서버·클라우드로는 아무것도 보내지 않고, 앱 전용 저장소(filesDir/transcripts.json)
 * 한 곳에만 남긴다. 앱을 지우면 기록도 같이 사라진다.
 */
public final class History {

    /** 폰에 있던 녹음 파일을 열어 변환한 기록. */
    public static final String SRC_FILE = "file";
    /** 플로팅 동그라미로 그때그때 말해 변환한 기록. */
    public static final String SRC_FLOAT = "float";

    private static final String FILE_NAME = "transcripts.json";
    /** 기록이 무한정 쌓여 저장 공간을 먹지 않도록 최근 것만 남긴다. */
    private static final int MAX_RECORDS = 300;

    public static final class Rec {
        public long id;
        public String title;
        public String source;
        public long created;
        public int durationSec;
        public int parts;
        public String text;

        public boolean isFile() {
            return SRC_FILE.equals(source);
        }
    }

    private History() {
    }

    private static File store(Context c) {
        return new File(c.getFilesDir(), FILE_NAME);
    }

    public static synchronized List<Rec> list(Context c) {
        List<Rec> out = new ArrayList<Rec>();
        File f = store(c);
        if (!f.exists()) {
            return out;
        }
        try {
            String raw = readAll(f);
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) {
                    continue;
                }
                Rec r = new Rec();
                r.id = o.optLong("id", 0);
                r.title = o.optString("title", "");
                r.source = o.optString("source", SRC_FILE);
                r.created = o.optLong("created", 0);
                r.durationSec = o.optInt("durationSec", 0);
                r.parts = o.optInt("parts", 1);
                r.text = o.optString("text", "");
                out.add(r);
            }
        } catch (Exception ignored) {
            // 파일이 깨졌으면 빈 기록으로 본다(앱은 계속 쓸 수 있게).
        }
        Collections.sort(out, new Comparator<Rec>() {
            @Override
            public int compare(Rec a, Rec b) {
                return Long.compare(b.created, a.created);
            }
        });
        return out;
    }

    public static synchronized int count(Context c) {
        return list(c).size();
    }

    /** 새 기록을 맨 위에 남기고, 그 id 를 돌려준다. */
    public static synchronized long add(Context c, String title, String source,
                                        int durationSec, int parts, String text) {
        List<Rec> all = list(c);
        Rec r = new Rec();
        r.id = System.currentTimeMillis();
        for (Rec other : all) {
            if (other.id >= r.id) {
                r.id = other.id + 1;
            }
        }
        r.title = title == null || title.trim().isEmpty() ? "녹음" : title.trim();
        r.source = SRC_FLOAT.equals(source) ? SRC_FLOAT : SRC_FILE;
        r.created = System.currentTimeMillis();
        r.durationSec = Math.max(0, durationSec);
        r.parts = Math.max(1, parts);
        r.text = text == null ? "" : text;
        all.add(0, r);
        while (all.size() > MAX_RECORDS) {
            all.remove(all.size() - 1);
        }
        save(c, all);
        return r.id;
    }

    public static synchronized void delete(Context c, long id) {
        List<Rec> all = list(c);
        for (int i = all.size() - 1; i >= 0; i--) {
            if (all.get(i).id == id) {
                all.remove(i);
            }
        }
        save(c, all);
    }

    public static synchronized void clear(Context c) {
        File f = store(c);
        if (f.exists()) {
            f.delete();
        }
    }

    private static void save(Context c, List<Rec> all) {
        File f = store(c);
        File tmp = new File(c.getFilesDir(), FILE_NAME + ".tmp");
        try {
            JSONArray arr = new JSONArray();
            for (Rec r : all) {
                JSONObject o = new JSONObject();
                o.put("id", r.id);
                o.put("title", r.title);
                o.put("source", r.source);
                o.put("created", r.created);
                o.put("durationSec", r.durationSec);
                o.put("parts", r.parts);
                o.put("text", r.text);
                arr.put(o);
            }
            FileOutputStream out = new FileOutputStream(tmp);
            out.write(arr.toString().getBytes(StandardCharsets.UTF_8));
            out.flush();
            out.close();
            if (f.exists() && !f.delete()) {
                // 지우지 못해도 아래 rename 이 덮어쓴다.
            }
            if (!tmp.renameTo(f)) {
                // rename 이 막히는 경우를 대비해 직접 쓰기.
                FileOutputStream direct = new FileOutputStream(f);
                direct.write(arr.toString().getBytes(StandardCharsets.UTF_8));
                direct.flush();
                direct.close();
                tmp.delete();
            }
        } catch (Exception ignored) {
            // 저장에 실패해도 화면의 결과는 그대로 보여 준다.
        }
    }

    private static String readAll(File f) throws Exception {
        FileInputStream in = new FileInputStream(f);
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            bos.write(buf, 0, n);
        }
        in.close();
        return new String(bos.toByteArray(), StandardCharsets.UTF_8);
    }

    /* ---------------------------------------------------------------- */
    /* 화면 표시용 도우미                                                  */
    /* ---------------------------------------------------------------- */

    public static String durationText(int seconds) {
        if (seconds <= 0) {
            return "길이 모름";
        }
        int h = seconds / 3600;
        int m = (seconds % 3600) / 60;
        int s = seconds % 60;
        if (h > 0) {
            return h + "시간 " + m + "분";
        }
        if (m > 0) {
            return m + "분 " + s + "초";
        }
        return s + "초";
    }

    public static String dateText(long epochMs) {
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.setTimeInMillis(epochMs);
        int mo = c.get(java.util.Calendar.MONTH) + 1;
        int d = c.get(java.util.Calendar.DAY_OF_MONTH);
        int hh = c.get(java.util.Calendar.HOUR_OF_DAY);
        int mm = c.get(java.util.Calendar.MINUTE);
        return String.format("%d월 %d일 %02d:%02d", mo, d, hh, mm);
    }

    public static String sizeText(long bytes) {
        if (bytes <= 0) {
            return "0MB";
        }
        double mb = bytes / (1024.0 * 1024.0);
        if (mb < 1.0) {
            return String.format("%.0fKB", bytes / 1024.0);
        }
        return String.format("%.1fMB", mb);
    }
}
