package kr.inu.a1voice;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.graphics.Color;
import android.os.Bundle;
import android.text.method.ScrollingMovementMethod;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * 변환 기록 보기 (v1.3) — 이 기기 안에 저장된 글만 보여 준다.
 * 열어서 확인 · 복사 · 삭제. 서버에는 아무것도 없다.
 */
public class HistoryActivity extends Activity {

    private ListView list;
    private TextView tvEmpty;
    private TextView tvCount;
    private final List<History.Rec> items = new ArrayList<History.Rec>();
    private Adapter adapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_history);

        list = (ListView) findViewById(R.id.list);
        tvEmpty = (TextView) findViewById(R.id.tv_empty);
        tvCount = (TextView) findViewById(R.id.tv_count);

        adapter = new Adapter();
        list.setAdapter(adapter);

        findViewById(R.id.btn_close).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        findViewById(R.id.btn_clear).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                confirmClear();
            }
        });

        list.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                open(items.get(position));
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        reload();
    }

    private void reload() {
        items.clear();
        items.addAll(History.list(this));
        if (adapter != null) {
            adapter.notifyDataSetChanged();
        }
        tvCount.setText("기록 " + items.size() + "건 · 최근 순");
        tvEmpty.setVisibility(items.isEmpty() ? View.VISIBLE : View.GONE);
        list.setVisibility(items.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private void open(final History.Rec r) {
        TextView tv = new TextView(this);
        tv.setText(r.text);
        tv.setTextSize(16);
        tv.setTextColor(Color.parseColor("#15263B"));
        tv.setLineSpacing(dp(4), 1f);
        tv.setMovementMethod(new ScrollingMovementMethod());
        tv.setPadding(dp(20), dp(16), dp(20), dp(8));
        tv.setTextIsSelectable(true);

        String head = History.dateText(r.created) + " · "
                + (r.isFile() ? History.durationText(r.durationSec) : "플로팅 " + History.durationText(r.durationSec))
                + (r.parts > 1 ? " · " + r.parts + "구간" : "")
                + " · " + r.text.length() + "자";

        final AlertDialog dlg = new AlertDialog.Builder(this)
                .setTitle(truncate(r.title, 34))
                .setView(tv)
                .setMessage(head)
                .setPositiveButton("닫기", null)
                .setNeutralButton("복사", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        copy(r.text);
                        Toast.makeText(HistoryActivity.this, "복사했어요", Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton("삭제", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        confirmDelete(r);
                    }
                })
                .create();
        dlg.show();
    }

    private void confirmDelete(final History.Rec r) {
        new AlertDialog.Builder(this)
                .setTitle("이 기록을 지울까요?")
                .setMessage("이 기기에서만 지워집니다. 되돌릴 수 없어요.")
                .setNegativeButton("취소", null)
                .setPositiveButton("지우기", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        History.delete(HistoryActivity.this, r.id);
                        reload();
                    }
                })
                .show();
    }

    private void confirmClear() {
        if (items.isEmpty()) {
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("기록을 모두 지울까요?")
                .setMessage("이 기기에 저장된 변환 기록 " + items.size() + "건을 모두 지웁니다. 되돌릴 수 없어요.")
                .setNegativeButton("취소", null)
                .setPositiveButton("모두 지우기", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        History.clear(HistoryActivity.this);
                        reload();
                    }
                })
                .show();
    }

    private void copy(String text) {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText("A1 음성", text == null ? "" : text));
            }
        } catch (Exception ignored) {
        }
    }

    private static String truncate(String s, int max) {
        if (s == null) {
            return "";
        }
        return s.length() <= max ? s : s.substring(0, max - 1) + "…";
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    private final class Adapter extends BaseAdapter {
        @Override
        public int getCount() {
            return items.size();
        }

        @Override
        public Object getItem(int position) {
            return items.get(position);
        }

        @Override
        public long getItemId(int position) {
            return items.get(position).id;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            View v = convertView;
            if (v == null) {
                v = LayoutInflater.from(HistoryActivity.this)
                        .inflate(R.layout.row_history, parent, false);
            }
            History.Rec r = items.get(position);
            ((TextView) v.findViewById(R.id.row_title)).setText(truncate(r.title, 40));
            TextView badge = (TextView) v.findViewById(R.id.row_badge);
            badge.setText(r.isFile() ? (r.parts > 1 ? r.parts + "구간" : "파일") : "플로팅");
            badge.setTextColor(Color.parseColor(r.isFile() ? "#2F6FB2" : "#8A6D1F"));
            String sub = History.dateText(r.created) + " · ";
            if (r.durationSec > 0) {
                sub += History.durationText(r.durationSec) + " · ";
            }
            sub += r.text.length() + "자";
            ((TextView) v.findViewById(R.id.row_sub)).setText(sub);
            String preview = r.text.replace('\n', ' ');
            ((TextView) v.findViewById(R.id.row_preview)).setText(truncate(preview, 120));
            return v;
        }
    }
}
