#!/usr/bin/env bash
# 로컬 스모크 테스트: 모의 AI + 시트/메일 미설정 상태에서 전체 플로우를 확인합니다.
set -u
PORT="${PORT:-3100}"
BASE="http://127.0.0.1:${PORT}"
JAR="$(mktemp)"
LOG="$(mktemp)"

export APP_PASSCODE="a1-test-2026"
export MOCK_AI="true"
export TEAM_MEMBERS="문지용,이광훈,송현준,백남우,김남국,한원석,차정호,유병은"
unset OPENAI_API_KEY GOOGLE_SERVICE_ACCOUNT_JSON GOOGLE_SPREADSHEET_ID RESEND_API_KEY SMTP_HOST

NODE_OPTIONS=--max-old-space-size=1024 npx next start -p "$PORT" >"$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null' EXIT

for i in $(seq 1 60); do
  if curl -fsS "$BASE/login" -o /dev/null 2>/dev/null; then break; fi
  sleep 1
done

echo "== 1) 로그인 페이지"
curl -s -o /dev/null -w "GET /login -> %{http_code}\n" "$BASE/login"

echo "== 2) 잘못된 비밀번호"
curl -s -o /dev/null -w "POST login(wrong) -> %{http_code}\n" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d '{"name":"문지용","passcode":"nope"}'

echo "== 3) 정상 로그인"
curl -s -c "$JAR" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"name":"문지용","passcode":"a1-test-2026"}'; echo

echo "== 4) 로그인 후 메인 페이지"
curl -s -b "$JAR" -o /dev/null -w "GET / -> %{http_code}\n" "$BASE/"
curl -s -o /dev/null -w "GET / (no cookie) -> %{http_code} (redirect)\n" "$BASE/"
curl -s -o /dev/null -w "GET /manifest.json -> %{http_code}\n" "$BASE/manifest.json"
curl -s -o /dev/null -w "GET /icons/icon-192.png -> %{http_code}\n" "$BASE/icons/icon-192.png"

echo "== 5) 인증 없이 API 호출"
curl -s -o /dev/null -w "POST /api/structure (no cookie) -> %{http_code}\n" -X POST "$BASE/api/structure" \
  -H 'Content-Type: application/json' -d '{"mode":"order","transcript":"테스트"}'

echo "== 6) 음성 오더 구조화 (모의)"
curl -s -b "$JAR" -X POST "$BASE/api/structure" -H 'Content-Type: application/json' \
  -d '{"mode":"order","transcript":"문지용 사장님 내일 오전까지 에이원코리아 견적서 수정본 보내줘"}'; echo

echo "== 7) 통화 요약 구조화 (모의)"
curl -s -b "$JAR" -X POST "$BASE/api/structure" -H 'Content-Type: application/json' \
  -d '{"mode":"call_summary","transcript":"안녕하세요 다음 주 화요일 두시 상담 가능할까요"}'; echo

echo "== 8) 음성 변환 업로드 (모의)"
COOKIE=$(python3 -c "import sys;[print(l.split(chr(9))[-1].strip()) for l in open(sys.argv[1]) if 'inu_session' in l][0]" "$JAR")
python3 - "$BASE" "$COOKIE" <<'PY'
import sys, io, wave, json, urllib.request, uuid
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
body = b"".join(parts)
req = urllib.request.Request(base + "/api/transcribe", data=body, method="POST")
req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
req.add_header("Cookie", f"inu_session={cookie}")
with urllib.request.urlopen(req) as res:
    print("POST /api/transcribe ->", res.status, res.read().decode()[:300])
PY

echo "== 9) 등록 (시트 미설정 → 미리보기)"
curl -s -b "$JAR" -X POST "$BASE/api/submit" -H 'Content-Type: application/json' \
  -d '{"mode":"order","data":{"assignee":"문지용","title":"테스트 업무","details":"내용","due_date":"2026-11-18","priority":"높음","raw_transcript":"테스트"}}'; echo

echo "== 10) 로그아웃"
curl -s -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/logout" -o /dev/null -w "POST logout -> %{http_code}\n"
curl -s -b "$JAR" -o /dev/null -w "GET / after logout -> %{http_code}\n" "$BASE/"
