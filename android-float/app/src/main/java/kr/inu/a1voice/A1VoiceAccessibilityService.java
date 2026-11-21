package kr.inu.a1voice;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityManager;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayDeque;
import java.util.List;

/**
 * 입력칸 바로 넣기 서비스.
 *
 * 사용자가 설정(접근성)에서 직접 켰을 때만 동작한다. 하는 일은 하나뿐이다:
 * 변환된 글자를, 지금 화면에서 포커스된(또는 활성화된) 입력칸에 팝업 없이 넣는다.
 *  - 입력칸이 있으면: 클립보드 붙여넣기 / 글자 넣기(ACTION_SET_TEXT) 중 되는 방법으로 삽입
 *  - 입력칸이 없으면(웹뷰·게임·잠금 등): 아무 것도 하지 않고 false 를 돌려준다
 *    → 호출한 쪽(OverlayService)이 기존처럼 복사 + 확인 팝업을 띄운다.
 *
 * 화면의 다른 글자는 읽지도, 저장하지도, 보내지도 않는다.
 */
public class A1VoiceAccessibilityService extends AccessibilityService {

    private static final String OUR_PACKAGE = "kr.inu.a1voice";
    private static volatile A1VoiceAccessibilityService instance;

    /* ------------------------------------------------------------------ */
    /* 연결 상태                                                           */
    /* ------------------------------------------------------------------ */

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // 입력칸을 미리 붙들지 않는다 — 넣을 때 현재 화면에서 새로 찾는다.
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public boolean onUnbind(Intent intent) {
        instance = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    /** 접근성 서비스가 켜져 있는지 (설정 화면 표시 및 삽입 여부 판단용). */
    public static boolean isEnabled(Context c) {
        if (instance != null) {
            return true;
        }
        if (c == null) {
            return false;
        }
        try {
            AccessibilityManager am =
                    (AccessibilityManager) c.getSystemService(Context.ACCESSIBILITY_SERVICE);
            if (am != null && !am.isEnabled()) {
                return false;   // 접근성 자체가 꺼져 있으면 서비스도 돌지 않는다
            }
            if (am != null && am.isEnabled()) {
                List<AccessibilityServiceInfo> list =
                        am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
                if (list != null) {
                    for (AccessibilityServiceInfo info : list) {
                        if (info.getResolveInfo() == null || info.getResolveInfo().serviceInfo == null) {
                            continue;
                        }
                        String pkg = info.getResolveInfo().serviceInfo.packageName;
                        String name = info.getResolveInfo().serviceInfo.name;
                        if (OUR_PACKAGE.equals(pkg) && name != null
                                && name.endsWith("A1VoiceAccessibilityService")) {
                            return true;
                        }
                    }
                }
            }
            String enabled = Settings.Secure.getString(
                    c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            return enabled != null && enabled.toLowerCase().contains(OUR_PACKAGE + "/");
        } catch (Exception e) {
            return false;
        }
    }

    /* ------------------------------------------------------------------ */
    /* 삽입                                                                */
    /* ------------------------------------------------------------------ */

    /** 지금 화면 입력칸에 글자를 넣는다. 성공하면 true. (백그라운드 스레드에서 부르는 것을 권장) */
    public static boolean insertText(Context c, String text) {
        A1VoiceAccessibilityService svc = instance;
        if (svc == null || text == null || text.trim().isEmpty()) {
            return false;
        }
        try {
            return svc.insert(text);
        } catch (Exception e) {
            return false;
        }
    }

    private boolean insert(String text) {
        AccessibilityNodeInfo target = findField();
        if (target == null) {
            return false;
        }
        // v1.7: 네이트온 '메시지 보내기' 처럼 입력창이 비었을 때 보이는 힌트는 글자로 치지 않는다.
        final String before = enteredText(target);

        // 붙여넣기 경로를 위해 클립보드에도 넣어 둔다(실패해도 복사는 남는다).
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText("A1 음성", text));
            }
        } catch (Exception ignored) {
        }

        if (!target.isFocused()) {
            target.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            sleep(80);
        }

        boolean done;
        if (before.trim().isEmpty()) {
            // 빈 칸: 글자 넣기가 되면 그게 가장 깔끔하다(커서·기존 내용 손상 없음).
            done = setText(target, text);
            if (done && verify(text, 90)) {
                moveCursorToEnd();
                return true;
            }
            // 안 되면 붙여넣기.
            target.performAction(AccessibilityNodeInfo.ACTION_PASTE);
        } else {
            // 이미 글이 있으면 커서 자리에 이어 붙인다(내용을 지우지 않는다).
            target.performAction(AccessibilityNodeInfo.ACTION_PASTE);
            if (verify(text, 90)) {
                moveCursorToEnd();
                return true;
            }
            // 붙여넣기가 막힌 앱: 기존 글자 뒤에 붙여 넣는다.
            setText(target, before + text);
        }

        if (verify(text, 140)) {
            moveCursorToEnd();
            return true;
        }
        sleep(180);
        if (verify(text, 0)) {
            moveCursorToEnd();
            return true;
        }
        return false;
    }

    private static boolean setText(AccessibilityNodeInfo node, String value) {
        Bundle b = new Bundle();
        b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value);
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b);
    }

    private void moveCursorToEnd() {
        try {
            AccessibilityNodeInfo n = findField();
            if (n == null || n.getText() == null) {
                return;
            }
            int len = n.getText().length();
            Bundle b = new Bundle();
            b.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, len);
            b.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, len);
            n.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, b);
        } catch (Exception ignored) {
        }
    }

    /** 글자가 실제로 들어갔는지 새로 읽어 확인한다. */
    private boolean verify(String expected, long waitMs) {
        if (waitMs > 0) {
            sleep(waitMs);
        }
        AccessibilityNodeInfo f = findField();
        if (f == null) {
            return false;
        }
        String now = enteredText(f);
        if (now.isEmpty()) {
            return false;
        }
        String want = tail(expected, 16);
        return !want.isEmpty() && now.contains(want);
    }

    private static String tail(String s, int n) {
        if (s == null) {
            return "";
        }
        String t = s.trim();
        if (t.length() <= n) {
            return t;
        }
        return t.substring(t.length() - n);
    }

    /* ------------------------------------------------------------------ */
    /* 입력칸 찾기                                                          */
    /* ------------------------------------------------------------------ */

    private AccessibilityNodeInfo findField() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return null;
        }
        try {
            AccessibilityNodeInfo focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (isTextField(focused)) {
                return focused;
            }
        } catch (Exception ignored) {
        }
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<AccessibilityNodeInfo>();
        queue.add(root);
        AccessibilityNodeInfo first = null;
        int guard = 0;
        while (!queue.isEmpty() && guard++ < 500) {
            AccessibilityNodeInfo n = queue.poll();
            if (n == null) {
                continue;
            }
            if (isTextField(n)) {
                if (n.isFocused()) {
                    return n;
                }
                if (first == null && n.isVisibleToUser()) {
                    first = n;
                }
            }
            int count = n.getChildCount();
            for (int i = 0; i < count; i++) {
                AccessibilityNodeInfo child = n.getChild(i);
                if (child != null) {
                    queue.add(child);
                }
            }
        }
        return first;
    }

    private static boolean isTextField(AccessibilityNodeInfo n) {
        if (n == null || !n.isEnabled()) {
            return false;
        }
        CharSequence pkg = n.getPackageName();
        if (pkg != null && OUR_PACKAGE.contentEquals(pkg)) {
            return false;   // 우리 앱의 창(결과 팝업 등)에는 넣지 않는다
        }
        try {
            if (n.isEditable()) {
                return true;
            }
        } catch (Exception ignored) {
        }
        CharSequence cls = n.getClassName();
        String c = cls == null ? "" : cls.toString();
        return c.endsWith("EditText") || c.endsWith("AutoCompleteTextView");
    }

    private static String textOf(AccessibilityNodeInfo n) {
        if (n == null) {
            return "";
        }
        CharSequence cs = n.getText();
        return cs == null ? "" : cs.toString();
    }

    /**
     * 입력칸에 실제로 들어 있는 글자. 힌트(예: 네이트온 '메시지 보내기', 'Aa')는
     * 빈 칸과 같게 취급한다 — 그래야 힌트 뒤에 글자가 붙는 일이 없다.
     */
    private static String enteredText(AccessibilityNodeInfo n) {
        if (n == null) {
            return "";
        }
        String text = textOf(n);
        if (text.trim().isEmpty()) {
            return "";
        }
        if (isHint(n)) {
            return "";
        }
        return text;
    }

    /** 이 글자가 힌트인지: 시스템 플래그(API 26+) + 대표 힌트 문자열 둘 다 본다. */
    private static boolean isHint(AccessibilityNodeInfo n) {
        if (n == null) {
            return false;
        }
        try {
            if (n.isShowingHintText()) {
                return true;
            }
        } catch (Exception ignored) {
        }
        try {
            CharSequence hint = n.getHintText();
            CharSequence text = n.getText();
            if (hint != null && text != null
                    && hint.toString().trim().equalsIgnoreCase(text.toString().trim())) {
                return true;
            }
        } catch (Exception ignored) {
        }
        String t = textOf(n).trim();
        if (t.isEmpty() || t.length() > 40) {
            return false;
        }
        for (String h : HINT_WORDS) {
            if (t.equalsIgnoreCase(h)) {
                return true;
            }
        }
        return false;
    }

    /** isShowingHintText 를 안 주는 앱을 위한 대표 힌트 문자열 (네이트온·카톡·문자 등) */
    private static final String[] HINT_WORDS = {
            "메시지 보내기", "메시지를 보내기", "메시지를 입력하세요", "메시지를 입력해 주세요",
            "메시지를 입력해주세요", "메시지 입력", "메세지 보내기", "메세지를 입력하세요",
            "메시지 보내기…", "메시지를 입력…", "대화를 입력하세요", "내용을 입력하세요",
            "텍스트를 입력하세요", "여기에 입력하세요", "여기에 메시지를 입력하세요",
            "Type a message", "Type a message…", "Send a message", "Enter message",
            "Message", "Message…", "Aa"
    };

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }
}
