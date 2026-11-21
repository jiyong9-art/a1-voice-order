# A1 음성 (a1-voice-float)

카톡·문자·네이트온 어디서든 **화면 위 A1 동그라미**를 두 번 톡톡 누르면 녹음이 시작되고,
말이 끝나면 `a1-voice-order` 의 Whisper(`gpt-4o-transcribe`)로 변환해 **글자 창을 띄우고 자동으로 클립보드에 복사**하는 안드로이드 앱.

- 패키지: `kr.inu.a1voice` · 이름: `A1 음성` · versionName 1.0
- minSdk 26 (Android 8) / targetSdk 34
- 외부 라이브러리 0개 (Android 프레임워크만 사용) → APK 약 125KB

## 기능

| 동작 | 설명 |
|---|---|
| 플로팅 동그라미 | `SYSTEM_ALERT_WINDOW` 오버레이. 드래그로 이동, 놓으면 좌우 테두리에 붙고 위치 저장 |
| 두 번 톡톡 | 녹음 시작(빨간 원 + 진동 + `● 0:03` 타이머). 녹음 중에 다시 누르면 종료 |
| 한 번 탭 | 녹음 중이면 종료. 녹음 중이 아니면 "두 번 톡톡!" 안내만 |
| 자동 종료 | 최대 2분 |
| 변환 | `/api/auth/login` → 쿠키(7일 재사용) → `/api/transcribe` (multipart, `audio` 필드, m4a/AAC 16kHz 모노 64kbps) |
| 결과 창 | 오버레이 팝업에 편집 가능한 텍스트 + **자동 클립보드 복사** + `복사` / `닫기` |
| 실패 | 팝업에 오류 사유 + `다시 시도` (녹음 파일 유지) |
| 백그라운드 | 포그라운드 서비스(`foregroundServiceType=microphone`) + 상시 알림 |

## 저장소 보관 규칙

- 이 폴더는 **소스 보관용**이다. APK 바이너리(`build/`)와 서명 키(`keystore/*.jks`)는 저장소에 올리지 않는다 (`.gitignore` 처리).
- 서명 키와 팀 비밀번호는 이 저장소를 공개해도 드러나지 않게 **코드·문서에 실제 값을 쓰지 않는다**. 빌드할 때 `KS_PASS` 환경변수로 넘긴다.
- 웹 앱(`a1-voice-order`)의 루트 코드는 건드리지 않는다. 이 폴더는 Vercel 배포 대상에서 제외된다(`/.vercelignore`).

## 빌드 (Gradle 없이)

```sh
KS_PASS='<서명키 비밀번호>' sh build.sh   # aapt2 → javac → d8 → zipalign → apksigner
# 결과: build/a1-voice-float.apk
```

필요한 것: JDK 17(`/workspace/tools/jdk`), Android SDK 빌드툴 34 + platform 34(`/workspace/tools/sdk`).
서명 키(`keystore/a1voice.jks`)와 그 비밀번호는 **저장소에 없다**. **이 키를 잃으면 같은 앱으로 업데이트 설치가 안 된다** — 저장소 밖에 따로 안전하게 보관할 것.

## 서버 계약 (a1-voice-order)

```
POST {server}/api/auth/login      {"name":"문지용","passcode":"<팀 비밀번호>"}
  → 200 {"ok":true,"name":"문지용"} + Set-Cookie: inu_session=...

POST {server}/api/transcribe      multipart/form-data, field "audio" (파일)
  Cookie: inu_session=...
  → 200 {"ok":true,"text":"...","model":"gpt-4o-transcribe"}
  → 401 로그인 필요 / 422 인식 실패 / 429 요청 과다
```

`/api/transcribe` 는 개인정보 가림(masking)을 하지 않아 붙여넣기용 원문이 그대로 온다.
(서버에 그 경로가 없으면 `/api/sales/voice` + `x-a1-passcode` 로 대신 시도하고 `transcript` 만 사용)

## 알려진 사항

- 무음/잡음만 녹음하면 Whisper 가 엉뚱한 문장을 만들 수 있다(모델 특성). 0.7초 미만 녹음은 아예 보내지 않는다.
- 재부팅하면 버블은 사라진다. 앱 아이콘을 눌러 다시 켜면 된다(권한이 있으면 자동으로 뜬다).
- 팀 비밀번호는 앱 첫 화면에서 한 번 입력하면 기기에 저장된다. 이 저장소 빌드본에는 미리 채워 둔 값이 없다(공개 저장소에 실제 비밀번호를 남기지 않기 위해).
