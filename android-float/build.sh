#!/bin/sh
# A1 음성 APK 빌드 (Gradle 없이 aapt2 + javac + d8 + apksigner 로 직접 빌드)
#
# 사용법:  KS_PASS='<서명키 비밀번호>' sh build.sh
#   KS_PASS   서명 키 비밀번호 (환경변수로만 받는다 — 저장소에 넣지 않는다)
#   KS        키 파일 경로 (기본: ./keystore/a1voice.jks, 저장소에 없다)
set -e

JAVA_HOME=${JAVA_HOME:-/workspace/tools/jdk}
export JAVA_HOME
PATH=$JAVA_HOME/bin:$PATH
export PATH

SDK=${SDK:-/workspace/tools/sdk}
BT=$SDK/build-tools/34.0.0
PLATFORM=$SDK/platforms/android-34/android.jar
ROOT=$(cd "$(dirname "$0")" && pwd)
SRC=$ROOT/app/src/main
OUT=$ROOT/build
NAME=${NAME:-a1-voice-float}

rm -rf "$OUT"
mkdir -p "$OUT/res" "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "== 1/6 리소스 컴파일 =="
"$BT/aapt2" compile --dir "$SRC/res" -o "$OUT/res/resources.zip"

echo "== 2/6 리소스 링크 =="
"$BT/aapt2" link -o "$OUT/base.apk" \
    -I "$PLATFORM" \
    --manifest "$SRC/AndroidManifest.xml" \
    -R "$OUT/res/resources.zip" \
    --java "$OUT/gen" \
    --auto-add-overlay

echo "== 3/6 자바 컴파일 =="
find "$SRC/java" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -encoding UTF-8 -source 8 -target 8 -nowarn \
    -bootclasspath "$PLATFORM" -classpath "$PLATFORM" \
    -d "$OUT/classes" @"$OUT/sources.txt"

echo "== 4/6 dex 변환 =="
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
"$BT/d8" --release --min-api 26 --lib "$PLATFORM" --output "$OUT/dex" @"$OUT/classes.txt"

echo "== 5/6 classes.dex 넣기 + 정렬 =="
python3 - "$OUT/base.apk" "$OUT/dex/classes.dex" "$OUT/unsigned.apk" <<'PY'
import sys, shutil, zipfile
base, dex, out = sys.argv[1], sys.argv[2], sys.argv[3]
shutil.copyfile(base, out)
with zipfile.ZipFile(out, 'a', zipfile.ZIP_DEFLATED) as z:
    z.write(dex, 'classes.dex')
print('classes.dex added:', dex)
PY
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "== 6/6 서명 =="
KS=${KS:-$ROOT/keystore/a1voice.jks}
KS_ALIAS=${KS_ALIAS:-a1voice}
: "${KS_PASS:?KS_PASS(서명 키 비밀번호)를 환경변수로 지정하세요}"
if [ ! -f "$KS" ]; then
    echo "!! 서명 키가 없습니다: $KS"
    echo "!! 원본 키를 잃으면 기존에 배포한 앱 위로 업데이트 설치가 되지 않습니다. 그래도 새 키를 만들어 계속합니다."
    mkdir -p "$(dirname "$KS")"
    keytool -genkeypair -v -keystore "$KS" -storepass "$KS_PASS" -keypass "$KS_PASS" \
        -alias "$KS_ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
        -dname "CN=A1 Voice, O=A1KOREA, C=KR" > /dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
    --ks-key-alias "$KS_ALIAS" --out "$OUT/$NAME.apk" "$OUT/aligned.apk"

echo "== 검증 =="
"$BT/apksigner" verify --print-certs "$OUT/$NAME.apk" | head -5
"$BT/aapt2" dump badging "$OUT/$NAME.apk" | head -12
ls -l "$OUT/$NAME.apk"
