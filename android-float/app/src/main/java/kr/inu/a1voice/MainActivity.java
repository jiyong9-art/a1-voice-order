package kr.inu.a1voice;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 앱 첫 화면: 로그인 · 권한 준비 · 서버 설정 · 플로팅 켜기/끄기.
 *
 * v1.2 부터는 서버 로그인(200 OK + 세션 쿠키)이 확인된 뒤에만 플로팅이 켜진다.
 */
public class MainActivity extends Activity {

    private static final int REQ_MIC = 11;
    private static final int REQ_NOTI = 12;
    /** Android 9 이하에서 Recordings 폴더에 녹음 파일을 쓰기 위한 저장소 권한 */
    private static final int REQ_STORAGE = 13;

    private TextView tvOverlay;
    private TextView btnOverlay;
    private TextView tvMic;
    private TextView btnMic;
    private TextView tvNoti;
    private TextView btnNoti;
    private TextView tvBattery;
    private TextView btnBattery;
    private TextView tvAccess;
    private TextView btnAccess;
    private TextView tvLock;
    private TextView btnLock;
    private EditText etName;
    private EditText etPass;
    private EditText etServer;
    private TextView tvSave;
    private TextView btnSave;
    private TextView btnToggle;
    private TextView tvToggleHint;
    private TextView tvHistory;
    private TextView btnHistory;
    private TextView btnPickFile;
    private TextView btnPickFolder;
    private TextView tvVersion;

    /** 버전 확인은 앱을 열었을 때 3시간에 한 번만 한다(계속 뜨면 성가시니까). */
    private static final long VERSION_CHECK_GAP_MS = 3L * 60 * 60 * 1000;
    private static final String K_LAST_VERSION_CHECK = "last_version_check";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean autoStartTried = false;
    private boolean silentLoginTried = false;
    private boolean loginBusy = false;

    private final int okColor = Color.parseColor("#2E7D32");
    private final int warnColor = Color.parseColor("#C62828");
    private final int infoColor = Color.parseColor("#2F6FB2");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        tvOverlay = (TextView) findViewById(R.id.tv_overlay);
        btnOverlay = (TextView) findViewById(R.id.btn_overlay);
        tvMic = (TextView) findViewById(R.id.tv_mic);
        btnMic = (TextView) findViewById(R.id.btn_mic);
        tvNoti = (TextView) findViewById(R.id.tv_noti);
        btnNoti = (TextView) findViewById(R.id.btn_noti);
        tvBattery = (TextView) findViewById(R.id.tv_battery);
        btnBattery = (TextView) findViewById(R.id.btn_battery);
        tvAccess = (TextView) findViewById(R.id.tv_access);
        btnAccess = (TextView) findViewById(R.id.btn_access);
        tvLock = (TextView) findViewById(R.id.tv_lock);
        btnLock = (TextView) findViewById(R.id.btn_lock);
        etName = (EditText) findViewById(R.id.et_name);
        etPass = (EditText) findViewById(R.id.et_pass);
        etServer = (EditText) findViewById(R.id.et_server);
        tvSave = (TextView) findViewById(R.id.tv_save);
        btnSave = (TextView) findViewById(R.id.btn_save);
        btnToggle = (TextView) findViewById(R.id.btn_toggle);
        tvToggleHint = (TextView) findViewById(R.id.tv_toggle_hint);
        tvHistory = (TextView) findViewById(R.id.tv_history);
        btnHistory = (TextView) findViewById(R.id.btn_history);
        btnPickFile = (TextView) findViewById(R.id.btn_pick_file);
        btnPickFolder = (TextView) findViewById(R.id.btn_pick_folder);
        tvVersion = (TextView) findViewById(R.id.tv_version);

        // 이름·비밀번호는 기본값 없이 빈칸 — 저장된 값이 있을 때만 채운다.
        etName.setText(Prefs.get(this, Prefs.K_NAME, ""));
        etPass.setText(Prefs.get(this, Prefs.K_PASS, ""));
        etServer.setText(Prefs.get(this, Prefs.K_SERVER, Prefs.DEFAULT_SERVER));

        btnOverlay.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openOverlaySettings();
            }
        });
        btnMic.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                askMic();
            }
        });
        btnNoti.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                askNoti();
            }
        });
        btnBattery.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openBatterySettings();
            }
        });
        btnAccess.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openAccessibilitySettings();
            }
        });
        btnLock.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                togglePositionLock();
            }
        });
        btnSave.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                saveSettings();
            }
        });
        btnToggle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                toggleFloating();
            }
        });

        btnPickFile.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openFileTranscribe(FileTranscribeActivity.MODE_FILE);
            }
        });
        btnPickFolder.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openFileTranscribe(FileTranscribeActivity.MODE_FOLDER);
            }
        });
        btnHistory.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(MainActivity.this, HistoryActivity.class));
            }
        });
        tvVersion.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                checkUpdate(true);
            }
        });
    }

    private void openFileTranscribe(String mode) {
        String cookie = Prefs.get(this, Prefs.K_COOKIE, "");
        String pass = Prefs.get(this, Prefs.K_PASS, "");
        if ((cookie == null || cookie.trim().isEmpty()) && (pass == null || pass.trim().isEmpty())) {
            Toast.makeText(this, "먼저 이름과 팀 비밀번호를 넣고 [저장]을 눌러 주세요.", Toast.LENGTH_LONG).show();
            if (etName != null) {
                etName.requestFocus();
            }
            return;
        }
        Intent i = new Intent(this, FileTranscribeActivity.class);
        i.putExtra(FileTranscribeActivity.EXTRA_MODE, mode);
        startActivity(i);
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
        checkUpdate(false);
        // 쿠키가 없고 저장된 이름·비번이 있으면 조용히 한 번 로그인해 본다.
        if (!silentLoginTried) {
            silentLoginTried = true;
            String name = Prefs.get(this, Prefs.K_NAME, "");
            String pass = Prefs.get(this, Prefs.K_PASS, "");
            if (!isLoggedIn() && !name.trim().isEmpty() && !pass.trim().isEmpty()) {
                startLogin(name, pass, Prefs.get(this, Prefs.K_SERVER, Prefs.DEFAULT_SERVER), false, false);
            }
        }
        // 아이콘을 눌러 앱을 열었을 때, 로그인·권한이 다 준비돼 있으면 바로 플로팅을 띄운다.
        if (!autoStartTried) {
            autoStartTried = true;
            if (!OverlayService.running
                    && isLoggedIn()
                    && Settings.canDrawOverlays(this)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                startFloating(false);
            }
        }
    }

    /* ------------------------------------------------------------------ */

    private boolean isLoggedIn() {
        String cookie = Prefs.get(this, Prefs.K_COOKIE, "");
        return cookie != null && !cookie.trim().isEmpty();
    }

    private void refresh() {
        boolean overlay = Settings.canDrawOverlays(this);
        tvOverlay.setText(overlay ? "허용됨" : "허용 필요");
        tvOverlay.setTextColor(overlay ? okColor : warnColor);
        btnOverlay.setText(overlay ? "설정" : "허용");
        btnOverlay.setBackgroundResource(overlay ? R.drawable.bg_btn_small_on : R.drawable.bg_btn_small);

        boolean mic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        tvMic.setText(mic ? "허용됨" : "허용 필요");
        tvMic.setTextColor(mic ? okColor : warnColor);
        btnMic.setText(mic ? "설정" : "허용");
        btnMic.setBackgroundResource(mic ? R.drawable.bg_btn_small_on : R.drawable.bg_btn_small);

        boolean noti = Build.VERSION.SDK_INT < 33
                || checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED;
        tvNoti.setText(noti ? "허용됨" : "허용 권장");
        tvNoti.setTextColor(noti ? okColor : warnColor);
        btnNoti.setText(noti ? "설정" : "허용");
        btnNoti.setBackgroundResource(noti ? R.drawable.bg_btn_small_on : R.drawable.bg_btn_small);

        boolean noOpt = false;
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            noOpt = pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
        } catch (Exception ignored) {
        }
        tvBattery.setText(noOpt ? "제외됨" : "권장 (삼성 배터리 절약에서 살아남기)");
        tvBattery.setTextColor(noOpt ? okColor : Color.parseColor("#8A6D1F"));

        boolean access = A1VoiceAccessibilityService.isEnabled(this);
        tvAccess.setText(access
                ? "켜짐 · 변환되면 입력칸에 바로 들어가요"
                : "꺼짐 · 켜면 카톡 입력칸에 바로 (안 켜면 복사 창)");
        tvAccess.setTextColor(access ? okColor : Color.parseColor("#8A6D1F"));
        btnAccess.setText(access ? "설정" : "설정 열기");
        btnAccess.setBackgroundResource(access ? R.drawable.bg_btn_small_on : R.drawable.bg_btn_small);

        boolean lock = Prefs.getBool(this, Prefs.K_LOCK, false);
        tvLock.setText(lock
                ? "고정됨 · 끌어도 배지가 움직이지 않아요"
                : "이동 가능 · 끌어서 위치를 옮길 수 있어요");
        tvLock.setTextColor(lock ? okColor : Color.parseColor("#6B7A8C"));
        btnLock.setText(lock ? "풀기" : "고정");
        btnLock.setBackgroundResource(lock ? R.drawable.bg_btn_small_on : R.drawable.bg_btn_small);

        boolean loggedIn = isLoggedIn();
        boolean on = OverlayService.running;
        if (loginBusy) {
            btnToggle.setText("로그인 확인 중…");
            btnToggle.setBackgroundResource(R.drawable.bg_btn_off);
        } else if (on) {
            btnToggle.setText("플로팅 끄기");
            btnToggle.setBackgroundResource(R.drawable.bg_btn_off);
        } else if (loggedIn) {
            btnToggle.setText("플로팅 켜기");
            btnToggle.setBackgroundResource(R.drawable.bg_btn_primary);
        } else {
            btnToggle.setText("🔒 로그인 후 플로팅 켜기");
            btnToggle.setBackgroundResource(R.drawable.bg_btn_off);
        }

        if (on) {
            tvToggleHint.setText("지금 A1 배지가 떠 있어요. 두 번 톡톡 = 글로 · 길게 꾹 = 끄기 · 알림의 [녹음] = 녹음 파일");
        } else if (!loggedIn) {
            tvToggleHint.setText("이름과 팀 비밀번호를 넣고 [저장]을 누르면 서버 로그인을 확인한 뒤 켜집니다.");
        } else {
            tvToggleHint.setText("켜 두면 다른 앱을 써도 A1이 화면 위에 떠 있어요.");
        }

        int hist = History.count(this);
        tvHistory.setText("변환 기록 " + hist + "건 · 이 기기에만 저장");
        tvVersion.setText("A1 음성 v" + UpdateChecker.installedName(this) + " · 새 버전 확인");
    }

    /* ------------------------------------------------------------------ */
    /* 권한 · 설정 열기                                                     */
    /* ------------------------------------------------------------------ */

    /** v1.8 플로팅 위치 고정 켜기/끄기 — 켜면 배지를 끌어도 움직이지 않는다. */
    private void togglePositionLock() {
        boolean next = !Prefs.getBool(this, Prefs.K_LOCK, false);
        Prefs.putBool(this, Prefs.K_LOCK, next);
        Toast.makeText(this,
                next ? "플로팅 위치를 고정했어요. 앱에서 언제든 풀 수 있어요."
                        : "위치 고정을 풀었어요. 배지를 끌어서 옮길 수 있어요.",
                Toast.LENGTH_SHORT).show();
        refresh();
    }

    private void openOverlaySettings() {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getPackageName()));
            startActivity(i);
        } catch (Exception e) {
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION));
            } catch (Exception ignored) {
                Toast.makeText(this, "설정에서 '다른 앱 위에 표시'를 직접 허용해 주세요.", Toast.LENGTH_LONG).show();
            }
        }
    }

    private void openAccessibilitySettings() {
        if (A1VoiceAccessibilityService.isEnabled(this)) {
            Toast.makeText(this, "이미 켜져 있어요. 말이 끝나면 입력칸에 바로 들어갑니다.", Toast.LENGTH_SHORT).show();
        } else {
            Toast.makeText(this, "목록에서 'A1 음성 입력칸 넣기'를 찾아 켜 주세요.", Toast.LENGTH_LONG).show();
        }
        try {
            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
        } catch (Exception e) {
            try {
                startActivity(new Intent(Settings.ACTION_SETTINGS));
            } catch (Exception ignored) {
            }
        }
    }

    private void askMic() {
        if (Build.VERSION.SDK_INT < 23) {
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "마이크가 이미 허용돼 있어요.", Toast.LENGTH_SHORT).show();
            return;
        }
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
    }

    /** Android 9 이하만: 녹음 파일을 공용 Recordings 폴더에 저장하려면 저장소 권한이 필요하다. */
    private void askStorageLegacy() {
        if (Build.VERSION.SDK_INT >= 29 || Build.VERSION.SDK_INT < 23) {
            return;
        }
        if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
    }

    private void askNoti() {
        if (Build.VERSION.SDK_INT < 33) {
            Toast.makeText(this, "이 안드로이드 버전은 알림이 자동 허용됩니다.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "알림이 이미 허용돼 있어요.", Toast.LENGTH_SHORT).show();
            return;
        }
        requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTI);
    }

    private void openBatterySettings() {
        Toast.makeText(this, "A1 음성을 찾아 '제한 없음'으로 바꿔 주세요.", Toast.LENGTH_LONG).show();
        try {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        } catch (Exception e) {
            try {
                startActivity(new Intent(Settings.ACTION_SETTINGS));
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        refresh();
    }

    /* ------------------------------------------------------------------ */
    /* 로그인 저장                                                          */
    /* ------------------------------------------------------------------ */

    private void saveSettings() {
        String name = etName.getText().toString().trim();
        String pass = etPass.getText().toString().trim();
        String server = Transcriber.normalizeBase(etServer.getText().toString());

        if (name.isEmpty()) {
            tvSave.setText("이름을 넣어 주세요");
            tvSave.setTextColor(warnColor);
            etName.requestFocus();
            return;
        }

        Prefs.put(this, Prefs.K_NAME, name);
        Prefs.put(this, Prefs.K_PASS, pass);
        Prefs.put(this, Prefs.K_SERVER, server);
        etServer.setText(server);

        tvSave.setText("저장됨 · 서버 확인 중…");
        tvSave.setTextColor(infoColor);
        startLogin(name, pass, server, true, false);
    }

    /** 서버에 로그인해 세션 쿠키를 받는다. 성공하면 쿠키 저장 + 화면 갱신. */
    private void startLogin(final String name, final String pass, final String server,
                            final boolean fromSave, final boolean thenStart) {
        if (loginBusy) {
            return;
        }
        loginBusy = true;
        if (!fromSave) {
            tvSave.setTextColor(infoColor);
        }
        if (thenStart) {
            tvToggleHint.setText("서버에 로그인 확인 중…");
        }
        refresh();
        final String base = Transcriber.normalizeBase(server);
        new Thread(new Runnable() {
            @Override
            public void run() {
                final Transcriber.LoginOut r = Transcriber.checkLoginDetailed(base, name, pass);
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        loginBusy = false;
                        if (r.ok()) {
                            Prefs.put(MainActivity.this, Prefs.K_COOKIE, r.cookie);
                            tvSave.setText("로그인 확인 ✓ 플로팅을 켤 수 있어요");
                            tvSave.setTextColor(okColor);
                        } else if (r.offline()) {
                            // 서버에 못 닿은 것뿐이면, 이미 확인된 기기(쿠키 있음)는 그대로 쓴다.
                            if (isLoggedIn()) {
                                tvSave.setText("서버 연결 실패 · 저장된 로그인으로 계속");
                                tvSave.setTextColor(Color.parseColor("#8A6D1F"));
                            } else {
                                tvSave.setText("서버에 연결하지 못했어요 (잠시 후 다시)");
                                tvSave.setTextColor(warnColor);
                            }
                        } else {
                            Prefs.put(MainActivity.this, Prefs.K_COOKIE, "");
                            tvSave.setText("로그인 실패 · 이름·비밀번호를 확인하세요");
                            tvSave.setTextColor(warnColor);
                        }
                        refresh();
                        if (thenStart) {
                            if (isLoggedIn()) {
                                startFloating(true);
                            } else {
                                Toast.makeText(MainActivity.this,
                                        r.offline()
                                                ? "서버에 연결하지 못했어요. 인터넷을 확인한 뒤 다시 시도해 주세요."
                                                : "로그인 확인에 실패했어요. 이름과 팀 비밀번호를 확인해 주세요.",
                                        Toast.LENGTH_LONG).show();
                            }
                        }
                    }
                });
            }
        }).start();
    }

    /* ------------------------------------------------------------------ */
    /* 플로팅 켜기/끄기                                                     */
    /* ------------------------------------------------------------------ */

    private void toggleFloating() {
        if (OverlayService.running) {
            Intent i = new Intent(this, OverlayService.class);
            i.setAction(OverlayService.ACTION_STOP);
            startService(i);
            ui.postDelayed(new Runnable() {
                @Override
                public void run() {
                    refresh();
                }
            }, 400);
            return;
        }
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "먼저 '다른 앱 위에 표시'를 허용해 주세요.", Toast.LENGTH_LONG).show();
            openOverlaySettings();
            return;
        }
        if (Build.VERSION.SDK_INT >= 23
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "먼저 마이크를 허용해 주세요.", Toast.LENGTH_LONG).show();
            askMic();
            return;
        }
        if (loginBusy) {
            Toast.makeText(this, "로그인 확인 중이에요. 잠시만요.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (isLoggedIn()) {
            startFloating(true);
            return;
        }

        // 로그인 확인 전에는 켜지지 않는다.
        String name = etName.getText().toString().trim();
        String pass = etPass.getText().toString().trim();
        if (name.isEmpty()) {
            Toast.makeText(this, "이름을 넣어 주세요.", Toast.LENGTH_LONG).show();
            etName.requestFocus();
            return;
        }
        if (pass.isEmpty()) {
            Toast.makeText(this, "팀 비밀번호를 넣어 주세요.", Toast.LENGTH_LONG).show();
            etPass.requestFocus();
            return;
        }
        String server = Transcriber.normalizeBase(etServer.getText().toString());
        Prefs.put(this, Prefs.K_NAME, name);
        Prefs.put(this, Prefs.K_PASS, pass);
        Prefs.put(this, Prefs.K_SERVER, server);
        startLogin(name, pass, server, true, true);
    }

    private void startFloating(final boolean showToast) {
        askStorageLegacy();
        if (!isLoggedIn()) {
            Toast.makeText(this, "로그인 확인 후에 플로팅을 켤 수 있어요.", Toast.LENGTH_LONG).show();
            refresh();
            return;
        }
        Intent i = new Intent(this, OverlayService.class);
        i.setAction(OverlayService.ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) {
            startForegroundService(i);
        } else {
            startService(i);
        }
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                refresh();
                if (showToast) {
                    Toast.makeText(MainActivity.this, "A1 동그라미를 띄웠어요. 홈으로 나가도 계속 떠 있습니다.", Toast.LENGTH_LONG).show();
                }
            }
        }, 700);
    }

    /* ------------------------------------------------------------------ */
    /* 새 버전 확인 (Update / Updating...)                                  */
    /* ------------------------------------------------------------------ */

    /** manual=true 면 이미 최신일 때도 "최신 버전"을 알려 준다. */
    private void checkUpdate(final boolean manual) {
        long last = Prefs.getLong(this, K_LAST_VERSION_CHECK, 0L);
        long now = System.currentTimeMillis();
        if (!manual && now - last < VERSION_CHECK_GAP_MS) {
            return;
        }
        if (manual) {
            Toast.makeText(this, "새 버전을 확인하는 중…", Toast.LENGTH_SHORT).show();
        }
        Prefs.putLong(this, K_LAST_VERSION_CHECK, now);
        final boolean showLatest = manual;
        UpdateChecker.check(this, new UpdateChecker.Listener() {
            @Override
            public void onNewVersion(int versionCode, String versionName, String apkUrl) {
                showUpdateDialog(versionName, apkUrl);
            }

            @Override
            public void onUpToDate() {
                if (showLatest) {
                    Toast.makeText(MainActivity.this,
                            "Latest version v" + UpdateChecker.installedName(MainActivity.this),
                            Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    /** "New version vX available" → [Update] 누르면 "Updating..." 으로 바뀌고 새 APK 로 넘어간다. */
    private void showUpdateDialog(String versionName, final String apkUrl) {
        if (isFinishing()) {
            return;
        }
        final View v = LayoutInflater.from(this).inflate(R.layout.dlg_update, null);
        final TextView title = (TextView) v.findViewById(R.id.dlg_title);
        final TextView msg = (TextView) v.findViewById(R.id.dlg_msg);
        final View buttons = v.findViewById(R.id.dlg_buttons);
        final View pb = v.findViewById(R.id.dlg_pb);
        final TextView update = (TextView) v.findViewById(R.id.dlg_update);
        TextView later = (TextView) v.findViewById(R.id.dlg_later);

        String latest = versionName == null || versionName.trim().isEmpty() ? "" : versionName.trim();
        title.setText(latest.isEmpty() ? "New version available" : "New version v" + latest + " available");
        msg.setText("지금 v" + UpdateChecker.installedName(this)
                + " 를 쓰고 있어요. 지금 업데이트하면 바로 새 기능을 쓸 수 있습니다.");

        final AlertDialog dlg = new AlertDialog.Builder(this)
                .setView(v)
                .setCancelable(true)
                .create();
        later.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View x) {
                dlg.dismiss();
            }
        });
        update.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View x) {
                title.setText("Updating...");
                msg.setText("새 버전을 내려받아 설치합니다. 안내가 뜨면 [설치]를 눌러 주세요.");
                buttons.setVisibility(View.GONE);
                pb.setVisibility(View.VISIBLE);
                openApk(apkUrl);
                ui.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        dlg.dismiss();
                    }
                }, 2600);
            }
        });
        dlg.show();
    }

    private void openApk(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "브라우저를 열지 못했어요: " + url, Toast.LENGTH_LONG).show();
        }
    }
}
