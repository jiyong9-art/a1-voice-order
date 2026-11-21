package kr.inu.a1voice;

import android.content.Context;
import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;

/**
 * 긴 녹음 파일을 **15분 단위** 조각으로 나눈다 (v1.4).
 *
 * 폰에 있는 통화 녹음·회의 녹음은 30분~2시간짜리가 많아 한 번에 올리면 크기 제한에 걸린다.
 * 그래서 두 길로 나눈다.
 *
 * 1) **빠른 길(무손실)** — m4a·aac·mp4·3gp 처럼 MP4 컨테이너에 그대로 담을 수 있는
 *    (AAC·AMR) 트랙은 `MediaExtractor` → `MediaMuxer` 로 샘플만 **복사**한다. 소리를
 *    풀었다가 다시 압축하지 않으므로 1시간 녹음도 1~2초에 끝나고 음질도 원본 그대로다.
 *    조각 경계는 15분 또는 18MB 중 먼저 닿는 쪽.
 * 2) **다시 담는 길(폴백)** — 복사를 거부하는 형식(mp3·wav·ogg·flac·amr 등)은 안드로이드
 *    기본 디코더로 소리를 풀어 **16kHz 모노 AAC(m4a)** 로 다시 담으면서 15분마다 끊는다.
 *
 * 조각은 순서대로 변환되어 하나의 글로 이어 붙는다.
 * 외부 라이브러리 없이 MediaExtractor + MediaCodec + MediaMuxer 만 쓴다.
 */
public final class AudioChunker {

    public static final int CHUNK_SECONDS = 15 * 60;
    private static final int OUT_RATE = 16000;
    private static final int OUT_BITRATE = 64000;
    /** 빠른 길에서 조각 하나의 크기 상한(18MB) — 서버 한도 24MB 아래로 넉넉히 둔다. */
    private static final long FAST_CHUNK_MAX_BYTES = 18L * 1024 * 1024;
    /** 이보다 큰 조각이 나오면 빠른 길을 포기하고 다시 담는 길로 넘긴다. */
    private static final long FAST_PART_HARD_MAX_BYTES = 22L * 1024 * 1024;

    public interface Listener {
        /** 나누는 진행률 0~100 (-1 이면 알 수 없음). */
        void onSplitProgress(int percent);
    }

    private AudioChunker() {
    }

    /** 파일 길이(초). 알 수 없으면 0. */
    public static int durationSec(Context ctx, Uri uri) {
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(ctx, uri);
            String d = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (d == null) {
                return 0;
            }
            long ms = Long.parseLong(d.trim());
            return (int) ((ms + 999) / 1000);
        } catch (Exception e) {
            return 0;
        } finally {
            try {
                r.release();
            } catch (Exception ignored) {
            }
        }
    }

    /** 작업 폴더를 통째로 지운다 (조각 파일은 변환이 끝나면 남길 이유가 없다). */
    public static void deleteDir(File dir) {
        if (dir == null) {
            return;
        }
        File[] files = dir.listFiles();
        if (files != null) {
            for (File f : files) {
                if (f.isDirectory()) {
                    deleteDir(f);
                } else {
                    f.delete();
                }
            }
        }
        dir.delete();
    }

    public static int chunkCount(int durationSec) {
        if (durationSec <= 0) {
            return 1;
        }
        return Math.max(1, (durationSec + CHUNK_SECONDS - 1) / CHUNK_SECONDS);
    }

    /**
     * 파일을 15분 단위 m4a 조각으로 나눠 outDir 안에 만든다.
     *
     * 먼저 원본 그대로 복사하는 빠른 길을 시도하고, 그 길을 쓸 수 없으면 다시 담는 길로 간다.
     *
     * @return 만들어진 조각 파일 목록 (순서대로). 하나도 못 만들면 빈 목록.
     */
    public static List<File> split(Context ctx, Uri uri, File outDir, int knownDurationSec,
                                   Listener listener) throws Exception {
        if (outDir == null) {
            throw new Exception("임시 폴더를 만들지 못했습니다.");
        }
        if (!outDir.exists() && !outDir.mkdirs()) {
            throw new Exception("임시 폴더를 만들지 못했습니다.");
        }
        List<File> fast = tryFastCopy(ctx, uri, outDir, listener);
        if (fast != null && !fast.isEmpty()) {
            return fast;
        }
        return splitByReencode(ctx, uri, outDir, knownDurationSec, listener);
    }

    /* ------------------------------------------------------------------ */
    /* 1) 빠른 길 — 원본 샘플 그대로 복사 (무손실)                          */
    /* ------------------------------------------------------------------ */

    /**
     * MediaExtractor 로 원본 샘플을 읽어 MediaMuxer 에 그대로 써 넣는다. 디코딩·인코딩이 없다.
     *
     * @return 조각 목록. 이 길을 쓸 수 없으면(코덱·컨테이너가 다르거나 복사가 거부되면) null.
     */
    private static List<File> tryFastCopy(Context ctx, Uri uri, File outDir, Listener listener) {
        List<File> parts = new ArrayList<File>();
        MediaExtractor ex = new MediaExtractor();
        MediaMuxer muxer = null;
        File cur = null;
        boolean started = false;
        ParcelFileDescriptor pfd = null;
        try {
            pfd = ctx.getContentResolver().openFileDescriptor(uri, "r");
            if (pfd == null) {
                return null;
            }
            ex.setDataSource(pfd.getFileDescriptor());

            int track = -1;
            MediaFormat fmt = null;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat f = ex.getTrackFormat(i);
                String m = f.getString(MediaFormat.KEY_MIME);
                if (m != null && m.startsWith("audio/")) {
                    track = i;
                    fmt = f;
                    break;
                }
            }
            if (track < 0 || fmt == null) {
                return null;
            }
            String mime = fmt.getString(MediaFormat.KEY_MIME);
            // MP4 컨테이너가 그대로 받아 주는 오디오 코덱만 복사한다(AAC·AMR).
            boolean copyable = "audio/mp4a-latm".equals(mime)
                    || "audio/3gpp".equals(mime)
                    || "audio/amr-wb".equals(mime);
            if (!copyable) {
                return null;
            }

            long totalUs = fmt.containsKey(MediaFormat.KEY_DURATION)
                    ? fmt.getLong(MediaFormat.KEY_DURATION) : 0L;
            ex.selectTrack(track);

            ByteBuffer buf = ByteBuffer.allocateDirect(512 * 1024);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            long partStartUs = 0L;
            long partBytes = 0L;
            long lastPts = 0L;
            int index = 0;

            while (true) {
                buf.clear();
                int size = ex.readSampleData(buf, 0);
                if (size < 0) {
                    break;
                }
                long pts = ex.getSampleTime();
                if (pts < 0) {
                    pts = 0;
                }
                if (muxer == null || needsNewPart(pts, partStartUs, partBytes, size)) {
                    if (muxer != null) {
                        closePart(muxer, started, cur, parts);
                        muxer = null;
                        cur = null;
                        started = false;
                    }
                    index++;
                    cur = new File(outDir, String.format("part_%02d.m4a", index));
                    muxer = new MediaMuxer(cur.getAbsolutePath(),
                            MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
                    muxer.addTrack(fmt);
                    muxer.start();
                    started = true;
                    partStartUs = pts;
                    partBytes = 0L;
                }
                buf.position(0);
                info.set(0, size, pts - partStartUs, ex.getSampleFlags());
                muxer.writeSampleData(0, buf, info);
                partBytes += size;
                lastPts = pts;
                ex.advance();
                if (listener != null && totalUs > 0) {
                    int pct = (int) (pts * 100 / totalUs);
                    listener.onSplitProgress(Math.max(0, Math.min(99, pct)));
                }
            }

            if (muxer != null) {
                closePart(muxer, started, cur, parts);
                muxer = null;
                cur = null;
            }
            if (parts.isEmpty()) {
                return null;
            }
            // 끝까지 읽지 못하고 앞부분만 복사된 경우도 다시 담는 길로 넘긴다.
            if (totalUs > 0 && lastPts * 10 < totalUs * 9) {
                for (File p : parts) {
                    p.delete();
                }
                return null;
            }
            // 조각이 서버 한도에 너무 가까우면 이 길을 포기하고 다시 담는 길로 넘긴다.
            for (File f : parts) {
                if (f.length() > FAST_PART_HARD_MAX_BYTES) {
                    for (File p : parts) {
                        p.delete();
                    }
                    return null;
                }
            }
            return parts;
        } catch (Throwable t) {
            // 복사를 거부하는 형식·코덱 → 아래(다시 담는 길)로 넘긴다.
            for (File p : parts) {
                if (p != null) {
                    p.delete();
                }
            }
            if (cur != null) {
                cur.delete();
            }
            return null;
        } finally {
            if (muxer != null) {
                try {
                    muxer.release();
                } catch (Exception ignored) {
                }
            }
            try {
                ex.release();
            } catch (Exception ignored) {
            }
            try {
                if (pfd != null) {
                    pfd.close();
                }
            } catch (Exception ignored) {
            }
        }
    }

    /**
     * 새 조각을 시작해야 하는가 — 15분을 넘었거나, 다음 샘플까지 넣으면 18MB를 넘길 때 (v1.4).
     * 빠른 길(복사)의 조각 경계 규칙이다.
     */
    static boolean needsNewPart(long pts, long partStartUs, long partBytes, int sampleSize) {
        return (pts - partStartUs) >= (long) CHUNK_SECONDS * 1000000L
                || partBytes + sampleSize > FAST_CHUNK_MAX_BYTES;
    }

    /** 한 조각을 닫아 목록에 넣는다(쓸 만한 크기일 때만). */
    private static void closePart(MediaMuxer muxer, boolean started, File file, List<File> parts) {
        try {
            if (started) {
                muxer.stop();
            }
        } catch (Exception ignored) {
        }
        try {
            muxer.release();
        } catch (Exception ignored) {
        }
        if (file != null && file.exists() && file.length() > 1024) {
            parts.add(file);
        } else if (file != null) {
            file.delete();
        }
    }

    /* ------------------------------------------------------------------ */
    /* 2) 다시 담는 길 — 디코딩 → 16kHz 모노 → AAC 인코딩                   */
    /* ------------------------------------------------------------------ */

    private static List<File> splitByReencode(Context ctx, Uri uri, File outDir, int knownDurationSec,
                                              Listener listener) throws Exception {
        if (outDir == null) {
            throw new Exception("임시 폴더를 만들지 못했습니다.");
        }
        if (!outDir.exists() && !outDir.mkdirs()) {
            throw new Exception("임시 폴더를 만들지 못했습니다.");
        }
        List<File> parts = new ArrayList<File>();
        long totalUs = (long) Math.max(0, knownDurationSec) * 1000000L;

        ParcelFileDescriptor pfd = ctx.getContentResolver().openFileDescriptor(uri, "r");
        if (pfd == null) {
            throw new Exception("파일을 열 수 없습니다. 다시 골라 주세요.");
        }
        MediaExtractor ex = new MediaExtractor();
        MediaCodec dec = null;
        try {
            ex.setDataSource(pfd.getFileDescriptor());

            int track = -1;
            MediaFormat inFormat = null;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat f = ex.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    track = i;
                    inFormat = f;
                    break;
                }
            }
            if (track < 0 || inFormat == null) {
                throw new Exception("이 파일에서 소리를 찾지 못했습니다. 음성 파일이 맞는지 확인해 주세요.");
            }
            if (totalUs <= 0 && inFormat.containsKey(MediaFormat.KEY_DURATION)) {
                totalUs = inFormat.getLong(MediaFormat.KEY_DURATION);
            }
            ex.selectTrack(track);

            String mime = inFormat.getString(MediaFormat.KEY_MIME);
            dec = MediaCodec.createDecoderByType(mime);
            dec.configure(inFormat, null, null, 0);
            dec.start();

            PartWriter writer = new PartWriter(outDir, parts);
            int srcRate = inFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)
                    ? inFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 44100;
            int srcCh = inFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)
                    ? inFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 1;
            int pcmEncoding = AudioFormat.ENCODING_PCM_16BIT;
            Resampler resampler = new Resampler(srcRate);

            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inputDone = false;
            boolean outputDone = false;
            long stuckSince = System.currentTimeMillis();

            while (!outputDone) {
                if (!inputDone) {
                    int idx = dec.dequeueInputBuffer(10000);
                    if (idx >= 0) {
                        ByteBuffer buf = dec.getInputBuffer(idx);
                        int size = buf == null ? -1 : ex.readSampleData(buf, 0);
                        if (size < 0) {
                            dec.queueInputBuffer(idx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            long pts = ex.getSampleTime();
                            dec.queueInputBuffer(idx, 0, size, pts < 0 ? 0 : pts, 0);
                            ex.advance();
                        }
                    }
                }

                int oi = dec.dequeueOutputBuffer(info, 10000);
                if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat of = dec.getOutputFormat();
                    if (of.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                        srcRate = of.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    }
                    if (of.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                        srcCh = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    }
                    if (of.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                        pcmEncoding = of.getInteger(MediaFormat.KEY_PCM_ENCODING);
                    }
                    resampler = new Resampler(srcRate);
                    stuckSince = System.currentTimeMillis();
                } else if (oi >= 0) {
                    if (info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                        ByteBuffer ob = dec.getOutputBuffer(oi);
                        if (ob != null) {
                            short[] mono = toMono(ob, info.offset, info.size, srcCh, pcmEncoding);
                            if (mono != null && mono.length > 0) {
                                short[] outPcm = resampler.process(mono, mono.length);
                                if (outPcm.length > 0) {
                                    writer.write(outPcm, outPcm.length);
                                }
                            }
                        }
                    }
                    dec.releaseOutputBuffer(oi, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        outputDone = true;
                    }
                    stuckSince = System.currentTimeMillis();
                    if (listener != null && totalUs > 0) {
                        int pct = (int) (info.presentationTimeUs * 100 / totalUs);
                        listener.onSplitProgress(Math.max(0, Math.min(100, pct)));
                    }
                } else if (oi == MediaCodec.INFO_TRY_AGAIN_LATER) {
                    // 디코더가 잠시 놀고 있으면 계속 돈다. 20초 넘게 아무 진전이 없으면 멈춘 것으로 본다.
                    if (System.currentTimeMillis() - stuckSince > 20000) {
                        break;
                    }
                }
            }

            writer.finish();
            if (parts.isEmpty()) {
                throw new Exception("이 형식의 소리를 풀지 못했습니다. (m4a·mp3·wav 로 다시 시도해 주세요)");
            }
            return parts;
        } finally {
            if (dec != null) {
                try {
                    dec.stop();
                } catch (Exception ignored) {
                }
                try {
                    dec.release();
                } catch (Exception ignored) {
                }
            }
            try {
                ex.release();
            } catch (Exception ignored) {
            }
            try {
                pfd.close();
            } catch (Exception ignored) {
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* PCM 변환                                                            */
    /* ------------------------------------------------------------------ */

    /** 디코더 출력(16bit/float/8bit, 여러 채널)을 16bit 모노 배열로 만든다. */
    private static short[] toMono(ByteBuffer buf, int offset, int size, int channels, int encoding) {
        int ch = Math.max(1, channels);
        ByteBuffer b = buf.duplicate();
        b.order(ByteOrder.LITTLE_ENDIAN);
        b.position(offset);
        b.limit(offset + size);
        try {
            if (encoding == AudioFormat.ENCODING_PCM_FLOAT) {
                int frames = size / (4 * ch);
                if (frames <= 0) {
                    return new short[0];
                }
                short[] out = new short[frames];
                for (int i = 0; i < frames; i++) {
                    float sum = 0f;
                    for (int c = 0; c < ch; c++) {
                        sum += b.getFloat();
                    }
                    float v = sum / ch;
                    int s = Math.round(v * 32767f);
                    out[i] = (short) Math.max(-32768, Math.min(32767, s));
                }
                return out;
            }
            if (encoding == AudioFormat.ENCODING_PCM_8BIT) {
                int frames = size / ch;
                if (frames <= 0) {
                    return new short[0];
                }
                short[] out = new short[frames];
                for (int i = 0; i < frames; i++) {
                    int sum = 0;
                    for (int c = 0; c < ch; c++) {
                        sum += (b.get() & 0xff) - 128;
                    }
                    out[i] = (short) ((sum / ch) << 8);
                }
                return out;
            }
            // 기본: 16bit little endian
            int frames = size / (2 * ch);
            if (frames <= 0) {
                return new short[0];
            }
            short[] out = new short[frames];
            for (int i = 0; i < frames; i++) {
                int sum = 0;
                for (int c = 0; c < ch; c++) {
                    sum += b.getShort();
                }
                out[i] = (short) (sum / ch);
            }
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    /** 선형 보간으로 원본 샘플레이트 → 16kHz. 조각 경계에서도 계속 이어지도록 위치를 넘겨받는다. */
    private static final class Resampler {
        private final double ratio;
        private double pos;

        Resampler(int srcRate) {
            ratio = (srcRate > 0 ? (double) srcRate : 44100d) / OUT_RATE;
            pos = 0d;
        }

        short[] process(short[] in, int n) {
            if (n <= 0) {
                return new short[0];
            }
            if (Math.abs(ratio - 1d) < 0.0001d) {
                short[] same = new short[n];
                System.arraycopy(in, 0, same, 0, n);
                return same;
            }
            int cap = (int) Math.ceil(n / ratio) + 4;
            short[] out = new short[cap];
            int k = 0;
            while (pos + 1 < n && k < cap) {
                int i = (int) pos;
                double frac = pos - i;
                double a = in[i];
                double bb = in[i + 1];
                int v = (int) Math.round(a + (bb - a) * frac);
                out[k++] = (short) Math.max(-32768, Math.min(32767, v));
                pos += ratio;
            }
            pos -= n;
            if (pos < 0) {
                pos = 0;
            }
            if (k == 0) {
                return new short[0];
            }
            short[] exact = new short[k];
            System.arraycopy(out, 0, exact, 0, k);
            return exact;
        }
    }

    /* ------------------------------------------------------------------ */
    /* 15분 단위 m4a 조각 쓰기                                              */
    /* ------------------------------------------------------------------ */

    private static final class PartWriter {
        private final File dir;
        private final List<File> parts;
        private final long chunkSamples = (long) CHUNK_SECONDS * OUT_RATE;

        private MediaCodec enc;
        private MediaMuxer muxer;
        private File curFile;
        private int track = -1;
        private boolean muxStarted;
        private long fedSamples;
        private int index;

        PartWriter(File dir, List<File> parts) {
            this.dir = dir;
            this.parts = parts;
        }

        void write(short[] pcm, int len) throws Exception {
            int off = 0;
            while (off < len) {
                if (enc == null) {
                    open();
                }
                int room = (int) Math.min((long) (len - off), chunkSamples - fedSamples);
                if (room <= 0) {
                    close();
                    continue;
                }
                feed(pcm, off, room);
                off += room;
                fedSamples += room;
                if (fedSamples >= chunkSamples) {
                    close();
                }
            }
        }

        void finish() throws Exception {
            if (enc != null) {
                close();
            }
        }

        private void open() throws Exception {
            index++;
            curFile = new File(dir, String.format("part_%02d.m4a", index));
            MediaFormat f = MediaFormat.createAudioFormat("audio/mp4a-latm", OUT_RATE, 1);
            f.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            f.setInteger(MediaFormat.KEY_BIT_RATE, OUT_BITRATE);
            f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 65536);
            enc = MediaCodec.createEncoderByType("audio/mp4a-latm");
            enc.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            enc.start();
            muxer = new MediaMuxer(curFile.getAbsolutePath(),
                    MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            track = -1;
            muxStarted = false;
            fedSamples = 0;
        }

        private void feed(short[] pcm, int off, int len) throws Exception {
            int done = 0;
            int idle = 0;
            while (done < len) {
                int idx = enc.dequeueInputBuffer(10000);
                if (idx < 0) {
                    drain();
                    idle++;
                    if (idle > 200) {
                        throw new Exception("오디오를 다시 담는 중에 멈췄습니다. 파일을 나눠서 시도해 주세요.");
                    }
                    continue;
                }
                idle = 0;
                ByteBuffer buf = enc.getInputBuffer(idx);
                if (buf == null) {
                    continue;
                }
                buf.clear();
                int n = Math.min(len - done, buf.capacity() / 2);
                if (n <= 0) {
                    n = Math.min(len - done, 1024);
                }
                buf.asShortBuffer().put(pcm, off + done, n);
                long pts = (long) (fedSamples + done) * 1000000L / OUT_RATE;
                enc.queueInputBuffer(idx, 0, n * 2, pts, 0);
                done += n;
                drain();
            }
        }

        private void drain() {
            if (enc == null) {
                return;
            }
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            while (true) {
                int oi;
                try {
                    oi = enc.dequeueOutputBuffer(info, 0);
                } catch (Exception e) {
                    return;
                }
                if (oi == MediaCodec.INFO_TRY_AGAIN_LATER) {
                    return;
                }
                if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    try {
                        track = muxer.addTrack(enc.getOutputFormat());
                        muxer.start();
                        muxStarted = true;
                    } catch (Exception ignored) {
                    }
                    continue;
                }
                if (oi < 0) {
                    continue;
                }
                try {
                    if (info.size > 0
                            && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0
                            && muxStarted && track >= 0) {
                        ByteBuffer ob = enc.getOutputBuffer(oi);
                        if (ob != null) {
                            muxer.writeSampleData(track, ob, info);
                        }
                    }
                } catch (Exception ignored) {
                }
                try {
                    enc.releaseOutputBuffer(oi, false);
                } catch (Exception ignored) {
                }
            }
        }

        private void close() throws Exception {
            if (enc == null) {
                return;
            }
            MediaCodec codec = enc;
            MediaMuxer mx = muxer;
            boolean started = muxStarted;
            int tr = track;
            try {
                int idx;
                int idle = 0;
                while ((idx = codec.dequeueInputBuffer(10000)) < 0) {
                    drain();
                    idle++;
                    if (idle > 300) {
                        break;
                    }
                }
                if (idx >= 0) {
                    long pts = (long) fedSamples * 1000000L / OUT_RATE;
                    codec.queueInputBuffer(idx, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                }
                MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                boolean eos = false;
                long deadline = System.currentTimeMillis() + 20000;
                while (!eos && System.currentTimeMillis() < deadline) {
                    int oi = codec.dequeueOutputBuffer(info, 10000);
                    if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        try {
                            tr = mx.addTrack(codec.getOutputFormat());
                            mx.start();
                            started = true;
                        } catch (Exception ignored) {
                        }
                    } else if (oi >= 0) {
                        try {
                            if (info.size > 0
                                    && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0
                                    && started && tr >= 0) {
                                ByteBuffer ob = codec.getOutputBuffer(oi);
                                if (ob != null) {
                                    mx.writeSampleData(tr, ob, info);
                                }
                            }
                        } catch (Exception ignored) {
                        }
                        codec.releaseOutputBuffer(oi, false);
                        if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                            eos = true;
                        }
                    } else if (oi == MediaCodec.INFO_TRY_AGAIN_LATER) {
                        // 마지막 출력을 기다린다.
                    }
                }
            } catch (Exception ignored) {
            } finally {
                try {
                    codec.stop();
                } catch (Exception ignored) {
                }
                try {
                    codec.release();
                } catch (Exception ignored) {
                }
                try {
                    if (started) {
                        mx.stop();
                    }
                } catch (Exception ignored) {
                }
                try {
                    mx.release();
                } catch (Exception ignored) {
                }
                enc = null;
                muxer = null;
                muxStarted = false;
                track = -1;
            }
            if (curFile != null && curFile.exists() && curFile.length() > 1024) {
                parts.add(curFile);
            } else if (curFile != null) {
                curFile.delete();
            }
        }
    }
}
