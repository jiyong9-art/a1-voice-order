package kr.inu.a1voice;

import android.Manifest;
import android.app.Activity;
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
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

/** 앱 첫 화면: 권한 준비 · 서버 설정 · 플로팅 켜기/끄기. */
public class MainActivity extends Activity {

    private static final int REQ_MIC = 11;
    private static final int REQ_NOTI = 12;

    private TextView tvOverlay;
    private TextView btnOverlay;
    private TextView tvMic;
    private TextView btnMic;
    private TextView tvNoti;
    private TextView btnNoti;
    private TextView tvBattery;
    private TextView btnBattery;
    private EditText etName;
    private EditText etPass;
    private EditText etServer;
    private TextView tvSave;
    private TextView btnSave;
    private TextView btnToggle;
    private TextView tvToggleHint;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean autoStartTried = false;

    private final int okColor = Color.parseColor("#2E7D32");
    private final int warnColor = Color.parseColor("#C62828");

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
        etName = (EditText) findViewById(R.id.et_name);
        etPass = (EditText) findViewById(R.id.et_pass);
        etServer = (EditText) findViewById(R.id.et_server);
        tvSave = (TextView) findViewById(R.id.tv_save);
        btnSave = (TextView) findViewById(R.id.btn_save);
        btnToggle = (TextView) findViewById(R.id.btn_toggle);
        tvToggleHint = (TextView) findViewById(R.id.tv_toggle_hint);

        etName.setText(Prefs.get(this, Prefs.K_NAME, Prefs.DEFAULT_NAME));
        String savedPass = Prefs.get(this, Prefs.K_PASS, "");
        // 팀 비밀번호는 저장소에 넣지 않는다 — 첫 실행 때 한 번 입력하면 Prefs 에 저장된다.
        etPass.setText(savedPass);
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
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
        // 아이콘을 눌러 앱을 열었을 때 권한이 다 준비돼 있으면 바로 플로팅을 띄운다.
        if (!autoStartTried) {
            autoStartTried = true;
            if (!OverlayService.running
                    && Settings.canDrawOverlays(this)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                startFloating(false);
            }
        }
    }

    /* ------------------------------------------------------------------ */

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

        boolean on = OverlayService.running;
        btnToggle.setText(on ? "플로팅 끄기" : "플로팅 켜기");
        btnToggle.setBackgroundResource(on ? R.drawable.bg_btn_off : R.drawable.bg_btn_primary);
        tvToggleHint.setText(on
                ? "지금 A1 동그라미가 떠 있어요. 다른 앱을 열어도 위에 남습니다."
                : "켜 두면 다른 앱을 써도 A1이 화면 위에 떠 있어요.");
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

    private void saveSettings() {
        String name = etName.getText().toString().trim();
        String pass = etPass.getText().toString().trim();
        String server = Transcriber.normalizeBase(etServer.getText().toString());

        if (name.isEmpty()) {
            name = Prefs.DEFAULT_NAME;
            etName.setText(name);
        }
        Prefs.put(this, Prefs.K_NAME, name);
        Prefs.put(this, Prefs.K_PASS, pass);
        Prefs.put(this, Prefs.K_SERVER, server);
        Prefs.put(this, Prefs.K_COOKIE, "");
        etServer.setText(server);

        tvSave.setText("저장됨 · 서버 확인 중…");
        final String fName = name;
        final String fPass = pass;
        final String fServer = server;
        new Thread(new Runnable() {
            @Override
            public void run() {
                final String cookie = Transcriber.checkLogin(fServer, fName, fPass);
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        if (cookie != null && !cookie.isEmpty()) {
                            Prefs.put(MainActivity.this, Prefs.K_COOKIE, cookie);
                            tvSave.setText("저장됨 · 서버 연결 성공 ✓");
                            tvSave.setTextColor(okColor);
                        } else {
                            tvSave.setText("저장됨 · 서버 연결 실패 (비밀번호·주소 확인)");
                            tvSave.setTextColor(warnColor);
                        }
                    }
                });
            }
        }).start();
    }

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
        startFloating(true);
    }

    private void startFloating(final boolean showToast) {
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
}
