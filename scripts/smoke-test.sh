#!/usr/bin/env bash
# 로컬 스모크 테스트: 모의 AI + 시트/메일 미설정 상태에서 전체 플로우를 확인합니다.
#   A) ADMIN_PASSCODE 설정 상태  — 직원 추가·삭제는 관리자 비밀번호만 통과
#   B) ADMIN_PASSCODE 미설정 상태 — APP_PASSCODE로 대신(안전한 fallback)
set -u
PORT_A="${PORT_A:-3100}"
PORT_B="${PORT_B:-3101}"
PORT="$PORT_A"
BASE="http://127.0.0.1:${PORT}"
JAR="$(mktemp)"
LOG="$(mktemp)"
FAIL=0
NODE_BIN="$(command -v node)"

export APP_PASSCODE="a1-test-2026"
export MOCK_AI="true"
export TEAM_MEMBERS="문지용,이광훈,송현준,백남우,김남국,한원석,차정호,유병은"
unset OPENAI_API_KEY GOOGLE_SERVICE_ACCOUNT_JSON GOOGLE_SPREADSHEET_ID GOOGLE_APPS_SCRIPT_URL GOOGLE_APPS_SCRIPT_SECRET RESEND_API_KEY SMTP_HOST
unset APP_SESSION_SECRET

SERVER_PID=""
# 포트를 지정해 서버를 띄웁니다. (.next 잠금을 남기지 않도록 next CLI를 node로 직접 실행)
start_server() {
  PORT="$1"
  BASE="http://127.0.0.1:${PORT}"
  NODE_OPTIONS=--max-old-space-size=1500 "$NODE_BIN" node_modules/next/dist/bin/next start -p "$PORT" >"$LOG" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 60); do
    if curl -fsS "$BASE/login" -o /dev/null 2>/dev/null; then return 0; fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
    sleep 1
  done
  echo "!! 서버가 뜨지 않았습니다 — $LOG"; tail -20 "$LOG"; exit 1
}
stop_server() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null
    for _ in $(seq 1 30); do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.5
    done
    kill -9 "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
    SERVER_PID=""
  fi
  # 포트가 실제로 닫혔는지 확인 (닫힐 때까지 최대 10초)
  for _ in $(seq 1 20); do
    curl -fsS "$BASE/login" -o /dev/null 2>/dev/null || break
    sleep 0.5
  done
}
trap 'stop_server' EXIT

# 기대한 HTTP 코드와 다르면 FAIL을 올립니다.
check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  OK   $label -> $actual"
  else
    echo "  FAIL $label -> $actual (기대 $expected)"
    FAIL=$((FAIL + 1))
  fi
}
body() { # POST/DELETE 후 응답 본문 일부를 출력합니다.
  local method="$1" path="$2" data="$3"; shift 3
  curl -s -X "$method" "$BASE$path" -H 'Content-Type: application/json' -d "$data" "$@"
}

echo "============================================================"
echo " A) ADMIN_PASSCODE 설정 상태"
echo "============================================================"
export ADMIN_PASSCODE="a1-admin-2026"
start_server "$PORT_A"

echo "== 1) 로그인 페이지"
check "GET /login" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/login")"

echo "== 2) 잘못된 비밀번호"
check "POST login(wrong)" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d '{"name":"문지용","passcode":"nope"}')"

echo "== 3) 정상 로그인"
curl -s -c "$JAR" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"name":"문지용","passcode":"a1-test-2026"}' >/dev/null

echo "== 4) 로그인 후 메인 페이지"
check "GET /" 200 "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/")"
check "GET / (no cookie)" 307 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")"
check "GET /manifest.json" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/manifest.json")"
check "GET /icons/icon-192.png" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/icons/icon-192.png")"

echo "== 4-b) 화면 문구 (내 기기 저장 · 메일 안내 제거)"
HTML="$(curl -s -b "$JAR" "$BASE/")"
echo "$HTML" | grep -q "드라이브 정리" && echo "  OK   헤더 문구 '내 기기 · 드라이브 정리'" || { echo "  FAIL 헤더 문구 미반영"; FAIL=$((FAIL+1)); }
if echo "$HTML" | grep -q "담당자에게 알림"; then echo "  FAIL 메일 안내 문구가 남아 있음"; FAIL=$((FAIL+1)); else echo "  OK   메일 안내 문구 없음"; fi
# 문의: 내 기기 저장함 화면 코드가 실제 번들에 포함됐는지 (문구는 클라이언트 번들에만 존재)
JS="$(echo "$HTML" | grep -o '/_next/static/chunks/[^"]*\.js' | sort -u | head -40)"
HIT=0
for chunk in $JS; do
  if curl -s "$BASE$chunk" | grep -q "내 기기 저장함"; then HIT=1; break; fi
done
if [ "$HIT" = "1" ]; then echo "  OK   '내 기기 저장함' UI가 번들에 포함됨"; else echo "  FAIL '내 기기 저장함' UI 번들에서 못 찾음"; FAIL=$((FAIL+1)); fi

echo "== 5) 인증 없이 API 호출"
check "POST /api/structure (no cookie)" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/structure" \
  -H 'Content-Type: application/json' -d '{"mode":"order","transcript":"테스트"}')"

echo "== 5-b) 직원 관리 API — 관리자 비밀번호 전용"
check "GET /api/members" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/members")"
check "POST /api/members (no auth)" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/members" \
  -H 'Content-Type: application/json' -d '{"name":"테스트직원"}')"
check "POST /api/members (wrong passcode)" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/members" \
  -H 'Content-Type: application/json' -d '{"name":"테스트직원","adminPasscode":"nope"}')"
check "POST /api/members (팀 비밀번호만)" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/members" \
  -H 'Content-Type: application/json' -d '{"name":"테스트직원","passcode":"a1-test-2026"}')"
check "POST /api/members (세션 쿠키만)" 401 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$BASE/api/members" \
  -H 'Content-Type: application/json' -d '{"name":"세션직원"}')"

echo -n "  POST /api/members (관리자 비밀번호) -> "
body POST /api/members '{"name":"테스트직원","adminPasscode":"a1-admin-2026"}'; echo
curl -s "$BASE/api/members" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  members ->', d.get('members'), '| persistent =', d.get('persistent'), '| adminConfigured =', d.get('adminConfigured'))"

check "DELETE /api/members (팀 비밀번호만)" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/members" \
  -H 'Content-Type: application/json' -d '{"name":"테스트직원","passcode":"a1-test-2026"}')"
echo -n "  DELETE /api/members (관리자 비밀번호) -> "
body DELETE /api/members '{"name":"테스트직원","adminPasscode":"a1-admin-2026"}'; echo
echo -n "  POST /api/members (세션 + 관리자 비밀번호) -> "
body POST /api/members '{"name":"세션직원","adminPasscode":"a1-admin-2026"}' -b "$JAR"; echo
echo -n "  DELETE /api/members (세션 + 관리자 비밀번호) -> "
body DELETE /api/members '{"name":"세션직원","adminPasscode":"a1-admin-2026"}' -b "$JAR"; echo
check "POST /api/members (비밀번호 확인만)" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/members" \
  -H 'Content-Type: application/json' -d '{"adminPasscode":"a1-admin-2026"}')"

echo "== 6) 음성 오더 구조화 (모의)"
curl -s -b "$JAR" -X POST "$BASE/api/structure" -H 'Content-Type: application/json' \
  -d '{"mode":"order","transcript":"문지용 사장님 내일 오전까지 에이원코리아 견적서 수정본 보내줘"}'; echo

echo "== 7) 통화 요약 구조화 (모의)"
curl -s -b "$JAR" -X POST "$BASE/api/structure" -H 'Content-Type: application/json' \
  -d '{"mode":"call_summary","transcript":"안녕하세요 다음 주 화요일 두시 상담 가능할까요"}'; echo

echo "== 8) 음성 변환 업로드 (모의)"
COOKIE=$(python3 -c "import sys;[print(l.split(chr(9))[-1].strip()) for l in open(sys.argv[1]) if 'inu_session' in l][0]" "$JAR")
python3 - "$BASE" "$COOKIE" <<'PY'
import sys, io, wave, uuid, urllib.request
base, cookie = sys.argv[1], sys.argv[2]
buf = io.BytesIO()
with wave.open(buf, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(b"\x00\x00" * 16000)
boundary = "----inu" + uuid.uuid4().hex
parts = []
parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"mode\"\r\n\r\norder\r\n".encode())
parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"t.wav\"\r\nContent-Type: audio/wav\r\n\r\n".encode())
parts.append(buf.getvalue())
parts.append(f"\r\n--{boundary}--\r\n".encode())
req = urllib.request.Request(base + "/api/transcribe", data=b"".join(parts), method="POST")
req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
req.add_header("Cookie", f"inu_session={cookie}")
with urllib.request.urlopen(req) as res:
    print("  POST /api/transcribe ->", res.status, res.read().decode()[:200])
PY

echo "== 8-b) 영업 AI 통합 API (/api/sales/voice)"
python3 - "$BASE" "$COOKIE" <<'PY'
import sys, json, uuid, urllib.request, urllib.error, base64

base, cookie = sys.argv[1], sys.argv[2]
fails = 0
GH = "https://jiyong9-art.github.io"
LOCAL = "http://localhost:5173"

def check(label, ok, detail=""):
    global fails
    if ok:
        print(f"  OK   {label}" + (f" -> {detail}" if detail else ""))
    else:
        print(f"  FAIL {label}" + (f" -> {detail}" if detail else ""))
        fails += 1

def call(path, method="POST", data=None, headers=None):
    req = urllib.request.Request(base + path, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, {k.lower(): v for k, v in res.headers.items()}, res.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()

def as_json(body):
    try:
        return json.loads(body.decode())
    except Exception:
        return {}

def post_json(payload, extra=None, auth=True):
    headers = {"Content-Type": "application/json", "Origin": GH}
    if auth:
        headers["x-a1-passcode"] = "a1-test-2026"
    headers.update(extra or {})
    return call("/api/sales/voice", "POST", json.dumps(payload).encode(), headers)

def multipart(fields, files):
    boundary = "----a1" + uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    for k, (fname, ctype, content) in files.items():
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fname}\"\r\nContent-Type: {ctype}\r\n\r\n".encode()
            + content
            + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"

# 1) CORS preflight ----------------------------------------------------
status, headers, _ = call(
    "/api/sales/voice",
    "OPTIONS",
    headers={
        "Origin": GH,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-a1-passcode",
    },
)
check("OPTIONS 프리플라이트 (GitHub Pages)", status == 204, str(status))
check("CORS Allow-Origin (GitHub Pages)", headers.get("access-control-allow-origin") == GH, headers.get("access-control-allow-origin", "없음"))
allow_methods = headers.get("access-control-allow-methods", "")
check("CORS Allow-Methods: POST, OPTIONS", "POST" in allow_methods and "OPTIONS" in allow_methods, allow_methods or "없음")
allow_headers = headers.get("access-control-allow-headers", "").lower()
check("CORS Allow-Headers: Content-Type, x-a1-passcode", "content-type" in allow_headers and "x-a1-passcode" in allow_headers, allow_headers or "없음")

status, headers, _ = call("/api/sales/voice", "OPTIONS", headers={"Origin": LOCAL, "Access-Control-Request-Method": "POST"})
check("OPTIONS 프리플라이트 (localhost:5173)", status == 204 and headers.get("access-control-allow-origin") == LOCAL, f"{status} / {headers.get('access-control-allow-origin', '없음')}")

status, headers, _ = call("/api/sales/voice", "OPTIONS", headers={"Origin": "https://evil.example.com", "Access-Control-Request-Method": "POST"})
check("OPTIONS (허용 외 출처 거부)", status == 403, str(status))

# 2) 인증 ----------------------------------------------------------------
status, _, _ = post_json({"text": "삼성화재 지게차 견적"}, auth=False)
check("POST /api/sales/voice (무인증)", status == 401, str(status))
status, _, _ = post_json({"text": "삼성화재 지게차 견적"}, {"x-a1-passcode": "nope"})
check("POST (틀린 패스코드)", status == 401, str(status))
status, headers, body = post_json({"text": "삼성화재 지게차 견적"}, extra=None)
check("POST (x-a1-passcode)", status == 200, str(status))
check("POST 응답 CORS 헤더", headers.get("access-control-allow-origin") == GH, headers.get("access-control-allow-origin", "없음"))
status, _, body = call(
    "/api/sales/voice",
    "POST",
    json.dumps({"text": "삼성화재 지게차 견적"}).encode(),
    {"Content-Type": "application/json", "Origin": GH, "Cookie": f"inu_session={cookie}"},
)
check("POST (로그인 세션 쿠키)", status == 200, str(status))

# 3) 초안 필드와 필수 산출기초 기준 ---------------------------------------
status, _, body = post_json(
    {
        "text": "삼성화재 건설기계 지게차 한 대 신규 견적 부탁드립니다. 고객은 다온기계, 차량번호 004가1234, 가입금액은 5억, 2026-12-01부터 1년입니다.",
        "customers": json.dumps([{"id": 7, "name": "다온기계", "bizNo": "123-45-67890"}]),
    }
)
data = as_json(body)
draft = data.get("draft", {})
check("초안 ok", data.get("ok") is True, str(data.get("error", "")))
check("intent 분류", draft.get("intent") == "견적", str(draft.get("intent")))
check("product", draft.get("product") == "건설기계", str(draft.get("product")))
check("insurer", draft.get("insurer") == "삼성화재", str(draft.get("insurer")))
check("customer.name", draft.get("customer", {}).get("name") == "다온기계", str(draft.get("customer")))
check("basis.car_no", draft.get("basis", {}).get("car_no") == "004가1234", str(draft.get("basis", {}).get("car_no")))
check("기간", draft.get("start_date") == "2026-12-01" and draft.get("end_date") == "2027-12-01", f"{draft.get('start_date')} ~ {draft.get('end_date')}")
missing = draft.get("missing", [])
check("missing: 상품별 기준(운전자범위·연령)", "운전자범위·연령" in missing, str(missing))
check("missing: 대물한도·자차여부", "대물한도" in missing and "자차여부" in missing, str(missing))
check("missing: 이미 있는 항목은 제외", "차량번호(차대번호)" not in missing and "차종/톤수" not in missing, str(missing))
check("engine 표시", bool(data.get("engine", {}).get("model")), str(data.get("engine")))

status, _, body = post_json({"text": "김포 창고 화재 가입금액 5억, 건물은 철골조입니다. 삼성화재로 견적 주세요."})
draft2 = as_json(body).get("draft", {})
missing2 = draft2.get("missing", [])
check("화재 기준: product", draft2.get("product") == "화재", str(draft2.get("product")))
check("화재 기준: 면적 누락 감지", "면적(평/㎡)" in missing2, str(missing2))
check("화재 기준: 소재지 누락 감지", "소재지" in missing2, str(missing2))
check("화재 기준: 채워진 구조·금액 제외", "건물구조(급수·판넬여부)" not in missing2 and "가입금액(건물·집기·재고)" not in missing2, str(missing2))

status, _, body = post_json({"text": "다온기계 지게차 사고 접수합니다. 어제 오후 김포 창고에서 후진하다가 벽을 받았습니다. 대물 피해입니다."})
draft3 = as_json(body).get("draft", {})
missing3 = draft3.get("missing", [])
check("사고접수 intent", draft3.get("intent") == "사고접수", str(draft3.get("intent")))
check("사고접수 기준: 사고장소", bool(draft3.get("basis", {}).get("accident_place")), str(draft3.get("basis")))
check("사고접수 기준: 피해대상", "피해대상" not in missing3, str(missing3))

# 4) 개인정보 마스킹 ------------------------------------------------------
status, _, body = post_json(
    {"text": "다온기계 김다온 주민번호 900101-1234567, 카드 1234-5678-9012-3456으로 지게차 견적 부탁드립니다."}
)
masked = as_json(body)
transcript = masked.get("transcript", "")
check("주민번호 뒷자리 마스킹", "900101-1******" in transcript, transcript[:80])
check("주민번호 원문 미포함", "1234567" not in transcript, transcript[:80])
check("카드번호 마스킹", "1234-****-****-3456" in transcript, transcript[:80])
check("마스킹 안내 문구", any("주민등록번호" in w for w in masked.get("warnings") or []), str(masked.get("warnings")))
check("초안에도 원문 없음", "1234567" not in json.dumps(masked.get("draft", {}), ensure_ascii=False), "")

# 5) 음성·이미지 업로드 ---------------------------------------------------
import io, wave
buf = io.BytesIO()
with wave.open(buf, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(16000)
    w.writeframes(b"\x00\x00" * 1600)
audio, ctype = multipart({}, {"audio": ("voice.wav", "audio/wav", buf.getvalue())})
status, _, body = call("/api/sales/voice", "POST", audio, {"Content-Type": ctype, "Origin": GH, "x-a1-passcode": "a1-test-2026"})
voice = as_json(body)
check("POST (음성 multipart)", status == 200 and voice.get("draft", {}).get("product") == "건설기계", str(status) + " " + str(voice.get("error", "")))
check("음성 전사 원문 반환", bool(voice.get("transcript")), str(voice.get("transcript"))[:60])

png = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
img, ctype = multipart({}, {"image": ("biz.png", "image/png", png)})
status, _, body = call("/api/sales/voice", "POST", img, {"Content-Type": ctype, "Origin": GH, "x-a1-passcode": "a1-test-2026"})
image_res = as_json(body)
image_draft = image_res.get("draft", {})
check("POST (서류 사진 multipart)", status == 200, str(status) + " " + str(image_res.get("error", "")))
check("서류에서 고객명·사업자번호", image_draft.get("customer", {}).get("name") == "다온기계" and image_draft.get("customer", {}).get("biz_no") == "123-45-67890", str(image_draft.get("customer")))
check("서류 doc_type", image_draft.get("customer", {}).get("doc_type") == "사업자등록증", str(image_draft.get("customer", {}).get("doc_type")))

status, _, body = post_json({"text": "   "})
check("POST (빈 입력)", status == 400, str(status))

status, _, _ = call(
    "/api/sales/voice",
    "POST",
    b"not-json",
    {"Content-Type": "text/plain", "Origin": GH, "x-a1-passcode": "a1-test-2026"},
)
check("POST (지원하지 않는 형식)", status == 415, str(status))

sys.exit(1 if fails else 0)
PY
if [ $? -ne 0 ]; then FAIL=$((FAIL + 1)); fi

echo "== 9) 구글 드라이브 저장 (시트 미설정 → 건너뜀 표시)"
curl -s -b "$JAR" -X POST "$BASE/api/submit" -H 'Content-Type: application/json' \
  -d '{"mode":"order","data":{"assignee":"문지용","title":"테스트 업무","details":"내용","due_date":"2026-11-18","priority":"높음","raw_transcript":"테스트"}}'; echo

echo "== 10) 로그아웃"
check "POST logout" 200 "$(curl -s -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/logout" -o /dev/null -w '%{http_code}')"
check "GET / after logout" 307 "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/")"

stop_server

echo
echo "============================================================"
echo " B) ADMIN_PASSCODE 미설정 — APP_PASSCODE로 fallback"
echo "============================================================"
unset ADMIN_PASSCODE
start_server "$PORT_B"

check "POST /api/members (팀 비밀번호 = fallback)" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/members" \
  -H 'Content-Type: application/json' -d '{"name":"폴백직원","adminPasscode":"a1-test-2026"}')"
check "DELETE /api/members (팀 비밀번호 = fallback)" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/members" \
  -H 'Content-Type: application/json' -d '{"name":"폴백직원","adminPasscode":"a1-test-2026"}')"
check "POST /api/members (틀린 비밀번호)" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/members" \
  -H 'Content-Type: application/json' -d '{"name":"폴백직원","adminPasscode":"nope"}')"
curl -s "$BASE/api/members" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  members ->', d.get('members'), '| adminConfigured =', d.get('adminConfigured'))"

stop_server

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 스모크 테스트 통과 (실패 0건)"
else
  echo "❌ 스모크 테스트 실패 ${FAIL}건"
  exit 1
fi
