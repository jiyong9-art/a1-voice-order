"""에이원코리아(A1KOREA) 로고 원본에서 앱 아이콘과 UI 로고 파일을 만든다.

원본(사용자 제공):
  attachments/2026-11-17/1000179075-...jpg  정사각형 로고 (파란 A ONE 심볼 + A1 KOREA 워드마크)
  attachments/2026-11-17/1000179078-...jpg  가로형 로고 (심볼 + A1 KOREA + Insurance Consulting)

만드는 파일:
  public/icons/icon-192.png / icon-512.png / maskable-512.png / apple-touch-icon.png
  app/icon.png / app/apple-icon.png
  public/logo-a1-square.png  (로그인 화면용, 배경 투명)
  public/logo-a1-wide.png    (헤더용, 배경 투명)
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parents[1]
SQSRC = WORKSPACE / "attachments/2026-11-17/1000179075-05c54b033b3741cba94d7e13bd76a96b.jpg"
WIDESRC = WORKSPACE / "attachments/2026-11-17/1000179078-0fc9cd6225db41b38698c131f4d0d617.jpg"

# 원본에서 읽은 값 (픽셀 분석)
BLUE = (0, 58, 132)  # #003A84
SQ_BOX = (215, 90, 1068, 943)  # 파란 심볼 정사각형 (853x853)


def blue_on_transparent(img: Image.Image, ink_floor: float = 0.06) -> Image.Image:
    """흰 배경 위 파란 잉크를 배경 투명 PNG로 바꾼다 (단색 잉크 가정)."""
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    alpha = 1.0 - a.min(axis=2) / 255.0
    alpha = np.clip((alpha - ink_floor) / (1.0 - ink_floor), 0.0, 1.0)
    out = np.zeros((a.shape[0], a.shape[1], 4), dtype=np.uint8)
    out[:, :, 0], out[:, :, 1], out[:, :, 2] = BLUE
    out[:, :, 3] = np.round(alpha * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def trim(img: Image.Image, pad_ratio: float = 0.0) -> Image.Image:
    bbox = img.getbbox()
    if bbox is None:
        return img
    w, h = img.size
    pad = round(max(w, h) * pad_ratio)
    left = max(0, bbox[0] - pad)
    top = max(0, bbox[1] - pad)
    right = min(w, bbox[2] + pad)
    bottom = min(h, bbox[3] + pad)
    return img.crop((left, top, right, bottom))


def square_symbol() -> Image.Image:
    img = Image.open(SQSRC).convert("RGB")
    return img.crop(SQ_BOX)


def save_icon(master: Image.Image, size: int, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    master.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    print(f"  {path.relative_to(ROOT)}  {size}x{size}")


def main() -> None:
    sym = square_symbol()

    # 1) 아이콘: 파란 심볼 영역만 정확히 크롭해 정사각형으로
    save_icon(sym, 192, ROOT / "public/icons/icon-192.png")
    save_icon(sym, 512, ROOT / "public/icons/icon-512.png")
    save_icon(sym, 192, ROOT / "app/icon.png")
    save_icon(sym, 180, ROOT / "public/icons/apple-touch-icon.png")
    save_icon(sym, 180, ROOT / "app/apple-icon.png")

    # 브라우저 기본 요청(/favicon.ico) 대응 — 탭·북마크에도 브랜드 아이콘이 보이게
    sym.convert("RGBA").save(ROOT / "app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("  app/favicon.ico  16/32/48/64")

    # 2) maskable: 안전 영역(중앙 80%) 안에 심볼이 들어오도록, 흰 마크만 뽑아 같은 파란 배경에 축소 배치
    arr = np.asarray(sym).astype(np.float32)
    white_a = np.clip((arr[:, :, 0] - 12) / (255 - 12), 0, 1)  # 흰 잉크 비율(빨강 채널 기준)
    mark = Image.fromarray(np.round(white_a * 255).astype(np.uint8), "L")
    canvas = Image.new("RGB", (512, 512), BLUE)
    inner = round(512 * 0.78)
    canvas.paste(Image.new("RGB", (inner, inner), (255, 255, 255)),
                 ((512 - inner) // 2, (512 - inner) // 2),
                 mark.resize((inner, inner), Image.LANCZOS))
    canvas.save(ROOT / "public/icons/maskable-512.png", optimize=True)
    print(f"  public/icons/maskable-512.png  512x512 (maskable)")

    # 3) 로그인 화면용 정사각형 락업: 심볼은 불투명, 워드마크는 파란 잉크 → 투명 배경
    sq = Image.open(SQSRC).convert("RGB")
    w, h = sq.size
    x0, y0 = SQ_BOX[0] - 10, SQ_BOX[1] - 8
    x1, y1 = min(w, SQ_BOX[2] + 10), min(h, 1232)
    lockup = blue_on_transparent(sq.crop((x0, y0, x1, y1)))
    # 심볼 영역은 원본 그대로(흰 A 유지) 덮어쓰기
    lockup.paste(sq.crop(SQ_BOX), (SQ_BOX[0] - x0, SQ_BOX[1] - y0))
    lockup = trim(lockup, 0.012)
    lw = 900
    lockup = lockup.resize((lw, round(lockup.height * lw / lockup.width)), Image.LANCZOS)
    lockup.save(ROOT / "public/logo-a1-square.png", optimize=True)
    print(f"  public/logo-a1-square.png  {lockup.width}x{lockup.height} (transparent)")

    # 4) 헤더용 가로 락업
    wide = Image.open(WIDESRC).convert("RGB")
    ww, wh = wide.size
    wide_t = blue_on_transparent(wide)
    # 왼쪽 파란 심볼 블록은 원본 그대로(흰 선명도 유지). 텍스트 영역은 투명 키잉을 그대로 둔다.
    blue_mask = (np.asarray(wide).astype(int)[:, :, 2] > 60) & (np.asarray(wide).astype(int)[:, :, 0] < 100)
    cols = np.where(blue_mask.sum(axis=0) >= wh * 0.8)[0]
    rows = np.where(blue_mask.sum(axis=1) > 0)[0]
    if len(cols) and len(rows):
        mark_box = (max(0, int(cols.min()) - 1), max(0, int(rows.min()) - 1), int(cols.max()) + 2, int(rows.max()) + 2)
        wide_t.paste(wide.crop(mark_box), (mark_box[0], mark_box[1]))
        print(f"  wide symbol box {mark_box}")
    wide_t = trim(wide_t, 0.01)
    wide_t.save(ROOT / "public/logo-a1-wide.png", optimize=True)
    print(f"  public/logo-a1-wide.png  {wide_t.width}x{wide_t.height} (transparent)")


if __name__ == "__main__":
    main()
