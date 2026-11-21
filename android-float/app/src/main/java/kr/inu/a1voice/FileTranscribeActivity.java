package kr.inu.a1voice;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 폰에 있는 녹음 파일을 열어 글로 바꾸는 화면 (v1.3).
 *
 * - 파일(.m4a .mp3 .wav .ogg .aac .flac .amr) 또는 폴더를 골라 연다.
 * - 15분 이하·20MB 이하이면 그대로 변환하고, 넘으면 15분 단위로 자동 분할해 순서대로 변환한다.
 * - 결과는 서버에 남기지 않고 **이 기기 기록**(History)에만 저장한다.
 */
public class FileTranscribeActivity extends Activity {

    public static final String EXTRA_MODE = "mode";
    public static final String MODE_FILE = "file";
    public static final String MODE_FOLDER = "folder";

    private static final int REQ_PICK_FILE = 41;
    private static final int REQ_PICK_FOLDER = 42;
    /** 이 크기 이하면 나누지 않고 한 번에 보낸다. */
    private static final long DIRECT_MAX_BYTES = 20L * 1024 * 1024;

    private TextView tvFile;
    private TextView tvMeta;
    private TextView tvState;
    private ProgressBar pb;
    private View cardResult;
    private EditText etResult;
    private TextView tvSaved;
    private TextView btnCopy;
    private TextView btnHistory;
    private TextView btnAgain;
    private TextView btnDone;
    private TextView btnClose;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean canceled;
    private volatile boolean jobRunning;
    private String mode = MODE_FILE;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_file_transcribe);

        tvFile = (TextView) findViewById(R.id.tv_file);
        tvMeta = (TextView) findViewById(R.id.tv_meta);
        tvState = (TextView) findViewById(R.id.tv_state);
        pb = (ProgressBar) findViewById(R.id.pb);
        cardResult = findViewById(R.id.card_result);
        etResult = (EditText) findViewById(R.id.et_result);
        tvSaved = (TextView) findViewById(R.id.tv_saved);
        btnCopy = (TextView) findViewById(R.id.btn_copy);
        btnHistory = (TextView) findViewById(R.id.btn_history);
        btnAgain = (TextView) findViewById(R.id.btn_again);
        btnDone = (TextView) findViewById(R.id.btn_done);
        btnClose = (TextView) findViewById(R.id.btn_close);

        mode = getIntent() == null ? MODE_FILE : getIntent().getStringExtra(EXTRA_MODE);
        if (mode == null) {
            mode = MODE_FILE;
        }

        btnCopy.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String t = etResult.getText().toString();
                if (t.trim().isEmpty()) {
                    return;
                }
                copy(t);
                Toast.makeText(FileTranscribeActivity.this, "전체 복사했어요", Toast.LENGTH_SHORT).show();
            }
        });
        btnHistory.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(FileTranscribeActivity.this, HistoryActivity.class));
            }
        });
        btnAgain.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (jobRunning) {
                    Toast.makeText(FileTranscribeActivity.this, "변환 중이에요. 끝나면 다시 열 수 있어요.", Toast.LENGTH_SHORT).show();
                    return;
                }
                pick();
            }
        });
        btnDone.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        btnClose.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        tvSaved.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(FileTranscribeActivity.this, HistoryActivity.class));
            }
        });

        if (savedInstanceState == null) {
            pick();
        }
    }

    @Override
    protected void onDestroy() {
        canceled = true;
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */
    /* 파일 · 폴더 고르기                                                   */
    /* ------------------------------------------------------------------ */

    private void pick() {
        if (MODE_FOLDER.equals(mode)) {
            openFolderPicker();
        } else {
            openFilePicker();
        }
    }

    private void openFilePicker() {
        setState("파일을 고르는 중…", -1);
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "audio/*", "application/ogg", "audio/ogg", "video/mp4",
                "application/octet-stream"
        });
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(i, REQ_PICK_FILE);
        } catch (Exception e) {
            Toast.makeText(this, "파일 선택 화면을 열지 못했어요. 폴더로 열어 보세요.", Toast.LENGTH_LONG).show();
            openFolderPicker();
        }
    }

    private void openFolderPicker() {
        setState("폴더를 고르는 중…", -1);
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(i, REQ_PICK_FOLDER);
        } catch (Exception e) {
            Toast.makeText(this, "폴더 선택 화면을 열지 못했어요.", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            if (!jobRunning) {
                finish();
            }
            return;
        }
        Uri uri = data.getData();
        try {
            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
        }
        if (requestCode == REQ_PICK_FOLDER) {
            showFolderFiles(uri);
            return;
        }
        startJob(uri, nameOf(uri));
    }

    /** 폴더 안의 음성 파일을 골라 연다. */
    private void showFolderFiles(final Uri treeUri) {
        final List<Uri> files = new ArrayList<Uri>();
        final List<String> labels = new ArrayList<String>();
        for (Uri u : audioChildren(treeUri)) {
            String n = nameOf(u);
            long size = sizeOf(u, 0);
            files.add(u);
            labels.add(n + "   (" + History.sizeText(size) + ")");
        }
        if (files.isEmpty()) {
            new AlertDialog.Builder(this)
                    .setTitle("음성 파일이 없어요")
                    .setMessage("이 폴더에서 m4a·mp3·wav 같은 녹음 파일을 찾지 못했어요. 다른 폴더를 골라 주세요.")
                    .setPositiveButton("다시 고르기", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            openFolderPicker();
                        }
                    })
                    .setNegativeButton("닫기", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            finish();
                        }
                    })
                    .show();
            return;
        }
        ArrayAdapter<String> ad = new ArrayAdapter<String>(this,
                android.R.layout.simple_list_item_1, labels);
        final AlertDialog dlg = new AlertDialog.Builder(this)
                .setTitle("녹음 파일 고르기 (" + files.size() + "개)")
                .setAdapter(ad, null)
                .setNegativeButton("닫기", null)
                .create();
        dlg.show();
        dlg.getListView().setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                dlg.dismiss();
                Uri u = files.get(position);
                startJob(u, nameOf(u));
            }
        });
    }

    private List<Uri> audioChildren(Uri treeUri) {
        List<Uri> out = new ArrayList<Uri>();
        Cursor c = null;
        try {
            String rootId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, rootId);
            c = getContentResolver().query(children, new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null);
            while (c != null && c.moveToNext()) {
                String docId = c.getString(0);
                String name = c.getString(1);
                String mime = c.getString(2);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    continue;
                }
                if (!isAudio(name, mime)) {
                    continue;
                }
                out.add(DocumentsContract.buildDocumentUriUsingTree(treeUri, docId));
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) {
                c.close();
            }
        }
        return out;
    }

    private static boolean isAudio(String name, String mime) {
        if (mime != null && mime.toLowerCase(Locale.US).startsWith("audio/")) {
            return true;
        }
        if (mime != null && mime.toLowerCase(Locale.US).contains("ogg")) {
            return true;
        }
        String n = name == null ? "" : name.toLowerCase(Locale.US);
        return n.endsWith(".m4a") || n.endsWith(".mp3") || n.endsWith(".wav")
                || n.endsWith(".ogg") || n.endsWith(".aac") || n.endsWith(".flac")
                || n.endsWith(".amr") || n.endsWith(".mp4") || n.endsWith(".3gp")
                || n.endsWith(".m4b") || n.endsWith(".opus") || n.endsWith(".wma");
    }

    private String nameOf(Uri uri) {
        Cursor c = null;
        try {
            c = getContentResolver().query(uri,
                    new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                if (n != null && !n.trim().isEmpty()) {
                    return n.trim();
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) {
                c.close();
            }
        }
        String last = uri.getLastPathSegment();
        return last == null ? "녹음 파일" : last;
    }

    private long sizeOf(Uri uri, long def) {
        Cursor c = null;
        try {
            c = getContentResolver().query(uri,
                    new String[]{OpenableColumns.SIZE}, null, null, null);
            if (c != null && c.moveToFirst() && !c.isNull(0)) {
                return c.getLong(0);
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) {
                c.close();
            }
        }
        return def;
    }

    private String mimeOf(Uri uri) {
        try {
            return getContentResolver().getType(uri);
        } catch (Exception e) {
            return null;
        }
    }

    /* ------------------------------------------------------------------ */
    /* 변환 작업                                                            */
    /* ------------------------------------------------------------------ */

    private void startJob(final Uri uri, final String name) {
        if (jobRunning) {
            return;
        }
        final String cookie = Prefs.get(this, Prefs.K_COOKIE, "");
        final String pass = Prefs.get(this, Prefs.K_PASS, "");
        if ((cookie == null || cookie.trim().isEmpty()) && (pass == null || pass.trim().isEmpty())) {
            showError("먼저 앱 첫 화면에서 이름과 팀 비밀번호를 넣고 [저장]을 눌러 주세요.");
            return;
        }
        jobRunning = true;
        canceled = false;
        cardResult.setVisibility(View.GONE);
        etResult.setText("");
        tvFile.setText(name);
        tvMeta.setText("");
        btnAgain.setBackgroundResource(R.drawable.bg_btn_off);
        tvState.setTextColor(android.graphics.Color.parseColor("#2F6FB2"));
        setState("준비 중…", 0);

        final String loginName = Prefs.get(this, Prefs.K_NAME, Prefs.DEFAULT_NAME);
        final String server = Prefs.get(this, Prefs.K_SERVER, Prefs.DEFAULT_SERVER);
        new Thread(new Runnable() {
            @Override
            public void run() {
                runJob(uri, name, loginName, pass, server);
            }
        }, "a1-file-transcribe").start();
    }

    private void runJob(Uri uri, String name, String loginName, String pass, String server) {
        File jobDir = new File(getCacheDir(), "job_" + System.currentTimeMillis());
        long durSec = 0;
        int parts = 1;
        try {
            if (!jobDir.exists() && !jobDir.mkdirs()) {
                throw new JobError("임시 폴더를 만들지 못했어요. 저장 공간을 확인해 주세요.");
            }
            long size = sizeOf(uri, 0);
            durSec = AudioChunker.durationSec(this, uri);
            final long knownDur = durSec;

            ui.post(new Runnable() {
                @Override
                public void run() {
                    tvMeta.setText(metaText(knownDur, -1));
                }
            });
            if (canceled) {
                throw new JobError("취소되었습니다.");
            }

            String text;
            boolean direct = size <= DIRECT_MAX_BYTES
                    && (durSec <= 0 || durSec <= AudioChunker.CHUNK_SECONDS);
            if (direct) {
                setState("소리를 글로 바꾸는 중…", -1);
                File tmp = new File(jobDir, "whole" + extOf(name, mimeOf(uri)));
                copyToFile(uri, tmp);
                uiFinalMeta(durSec, tmp.length());
                Transcriber.Out out = Transcriber.transcribe(this, tmp, loginName, pass, server);
                tmp.delete();
                if (canceled) {
                    throw new JobError("취소되었습니다.");
                }
                if (!out.ok) {
                    throw new JobError(out.error);
                }
                text = out.text.trim();
                parts = 1;
            } else {
                setState("15분 단위로 나누는 중…", 0);
                List<File> chunks = AudioChunker.split(this, uri, jobDir, (int) durSec,
                        new AudioChunker.Listener() {
                            @Override
                            public void onSplitProgress(final int percent) {
                                setState("15분 단위로 나누는 중…", percent);
                            }
                        });
                if (canceled) {
                    throw new JobError("취소되었습니다.");
                }
                parts = chunks.size();
                final int total = parts;
                final long d = durSec;
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        tvMeta.setText(metaText(d, total));
                        pb.setIndeterminate(false);
                        pb.setProgress(0);
                    }
                });
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < total; i++) {
                    if (canceled) {
                        throw new JobError("취소되었습니다.");
                    }
                    final int idx = i + 1;
                    setState(idx + "/" + total + " 구간 변환 중…", (int) ((long) i * 100 / total));
                    Transcriber.Out out = Transcriber.transcribe(this, chunks.get(i),
                            loginName, pass, server);
                    chunks.get(i).delete();
                    if (!out.ok) {
                        throw new JobError(idx + "/" + total + " 구간에서 멈췄어요: " + out.error);
                    }
                    if (sb.length() > 0) {
                        sb.append("\n");
                    }
                    sb.append(out.text.trim());
                }
                text = sb.toString().trim();
            }

            if (text.isEmpty()) {
                throw new JobError("음성을 인식하지 못했어요. 소리가 잘 들리는 파일인지 확인해 주세요.");
            }
            final String finalText = text;
            final long finalDur = durSec;
            final int finalParts = parts;
            History.add(this, name, History.SRC_FILE, (int) durSec, parts, text);

            ui.post(new Runnable() {
                @Override
                public void run() {
                    jobRunning = false;
                    pb.setIndeterminate(false);
                    pb.setProgress(100);
                    pb.setVisibility(View.GONE);
                    setState("변환 완료 · " + finalText.length() + "자 · 이 기기에 저장했어요", -1);
                    tvMeta.setText(metaText(finalDur, finalParts));
                    etResult.setText(finalText);
                    cardResult.setVisibility(View.VISIBLE);
                    tvSaved.setText("이 기기에만 저장됨 · " + History.dateText(System.currentTimeMillis()));
                    btnAgain.setBackgroundResource(R.drawable.bg_btn_primary);
                }
            });
        } catch (JobError e) {
            final String msg = e.getMessage();
            ui.post(new Runnable() {
                @Override
                public void run() {
                    jobRunning = false;
                    showError(msg);
                }
            });
        } catch (Exception e) {
            final String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            ui.post(new Runnable() {
                @Override
                public void run() {
                    jobRunning = false;
                    showError("변환하지 못했어요: " + msg);
                }
            });
        } finally {
            AudioChunker.deleteDir(jobDir);
        }
    }

    private void uiFinalMeta(final long durSec, final long bytes) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                tvMeta.setText(metaText(durSec, -1) + " · " + History.sizeText(bytes));
            }
        });
    }

    private String metaText(long durSec, int parts) {
        StringBuilder sb = new StringBuilder();
        if (durSec > 0) {
            sb.append("길이 ").append(History.durationText((int) durSec));
        } else {
            sb.append("길이 확인 중");
        }
        if (parts > 1) {
            sb.append(" · ").append(parts).append("구간으로 나눠 변환");
        }
        return sb.toString();
    }

    private void setState(final String text, final int percent) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                tvState.setText(text);
                if (percent < 0) {
                    pb.setIndeterminate(true);
                    pb.setVisibility(View.VISIBLE);
                } else {
                    pb.setIndeterminate(false);
                    pb.setVisibility(View.VISIBLE);
                    pb.setProgress(Math.max(0, Math.min(100, percent)));
                }
            }
        });
    }

    private void showError(String message) {
        cardResult.setVisibility(View.GONE);
        pb.setVisibility(View.GONE);
        tvState.setText(message == null ? "변환하지 못했어요." : message);
        tvState.setTextColor(android.graphics.Color.parseColor("#C62828"));
        Toast.makeText(this, message == null ? "변환하지 못했어요." : message, Toast.LENGTH_LONG).show();
    }

    private void copy(String text) {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText("A1 음성", text));
            }
        } catch (Exception ignored) {
        }
    }

    /* ------------------------------------------------------------------ */
    /* 임시 파일                                                            */
    /* ------------------------------------------------------------------ */

    private void copyToFile(Uri uri, File out) throws Exception {
        InputStream in = null;
        FileOutputStream os = null;
        try {
            in = getContentResolver().openInputStream(uri);
            if (in == null) {
                throw new JobError("파일을 열 수 없어요. 다시 골라 주세요.");
            }
            os = new FileOutputStream(out);
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                os.write(buf, 0, n);
                if (canceled) {
                    throw new JobError("취소되었습니다.");
                }
            }
            os.flush();
        } finally {
            try {
                if (in != null) {
                    in.close();
                }
            } catch (Exception ignored) {
            }
            try {
                if (os != null) {
                    os.close();
                }
            } catch (Exception ignored) {
            }
        }
    }

    private static String extOf(String name, String mime) {
        String n = name == null ? "" : name;
        int dot = n.lastIndexOf('.');
        if (dot >= 0 && dot < n.length() - 1) {
            String e = n.substring(dot + 1).toLowerCase(Locale.US);
            if (e.length() >= 2 && e.length() <= 5) {
                return "." + e;
            }
        }
        String m = mime == null ? "" : mime.toLowerCase(Locale.US);
        if (m.contains("mpeg")) {
            return ".mp3";
        }
        if (m.contains("wav")) {
            return ".wav";
        }
        if (m.contains("ogg")) {
            return ".ogg";
        }
        if (m.contains("flac")) {
            return ".flac";
        }
        if (m.contains("amr")) {
            return ".amr";
        }
        if (m.contains("aac")) {
            return ".aac";
        }
        if (m.contains("3gpp")) {
            return ".3gp";
        }
        return ".m4a";
    }

    /** 사용자에게 보여 줄 오류(그대로 토스트에 쓴다). */
    private static final class JobError extends Exception {
        JobError(String msg) {
            super(msg);
        }
    }
}
