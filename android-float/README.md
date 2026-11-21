# A1 음성 (a1-voice-float)

카톡·문자·네이트온 어디서든 **화면 위 A1 동그라미**를 두 번 톡톡 누르면 녹음이 시작되고,
말이 끝나면 `a1-voice-order` 의 Whisper(`gpt-4o-transcribe`)로 변환해 **입력칸에 바로 넣어주는**(또는 자동 복사하는) 안드로이드 앱.

- 패키지: `kr.inu.a1voice` · 이름: `A1 음성` · **versionName 1.2 (versionCode 3 · 2026-11-21 다크네이비·바로입력·로그인잠금)**
- minSdk 26 (Android 8) / targetSdk 34
- 외부 라이브러리 0개 (Android 프레임워크만 사용) → APK 약 131KB
- 배포: `https://a1kr.com/app/a1-voice.apk`

## 기능

| 동작 | 설명 |
|---|---|
| 플로팅 동그라미 | `SYSTEM_ALERT_WINDOW` 오버레이. **다크네이비 원 + 가운데 흰색 마이크** (테두리·그림자 없이). 드래그로 이동, 놓으면 좌우 테두리에 붙고 위치 저장 |
| 두 번 톡톡 | 녹음 시작. 녹음 중에는 **다크네이비 유지 + 은은한 하늘색 테두리 펄스 + 작은 타이머**. 다시 누르면 종료 |
| 한 번 탭 | 녹음 중이면 종료. 아니면 "두 번 톡톡!" 안내만 |
| 자동 종료 | 최대 2분 |
| 변환 | `/api/auth/login` → 쿠키(7일 재사용) → `/api/transcribe` (multipart, `audio` 필드, m4a/AAC 16kHz 모노 64kbps) |
| **입력칸 바로 넣기** | 접근성 서비스(`A1VoiceAccessibilityService`)를 켜 두면, 변환 후 **팝업 없이** 지금 커서가 있는 입력칸에 글자를 넣고 토스트 `입력했어요` (기존 글자가 있으면 커서 자리에 이어 붙임) |
| 복사 팝업 (기본 안전망) | 접근성이 꺼져 있거나 입력칸을 못 찾으면(웹뷰·게임·잠금 등) **자동 클립보드 복사 + 편집 가능한 결과 창** |
| **로그인 잠금** | 서버 로그인(200 OK + `inu_session` 쿠키)이 확인된 기기에서만 플로팅이 켜진다. 이름·비밀번호 칸은 기본 **빈칸**이며 저장된 값이 있을 때만 채워진다 |
| 실패 | 팝업에 오류 사유 + `다시 시도` (녹음 파일 유지) |
| 백그라운드 | 포그라운드 서비스(`foregroundServiceType=microphone`) + 상시 알림 |

### 접근성(입력칸 바로 넣기) 켜는 법

1. 앱 첫 화면 → 준비 상태의 **`입력칸 바로 넣기 (접근성)`** → **[설정 열기]**
2. 목록에서 **`A1 음성 입력칸 넣기`** 를 찾아 켜기 (삼성: 설정 → 접근성 → 설치된 앱)
3. 안드로이드 13 이상에서 "제한된 설정" 경고가 뜨면: 설정 → 앱 → A1 음성 → 오른쪽 위 ⋮ → **제한된 설정 허용** 후 다시 켜기

켜지 않아도 앱은 그대로 동작한다(자동 복사 + 결과 창). 켜면 한 단계가 줄어든다.

## 빌드 (Gradle 없이)

```sh
KS_PASS='<서명키 비밀번호>' sh build.sh   # aapt2 → javac → d8 → zipalign → apksigner
# 결과: build/a1-voice-float.apk
```

필요한 것: JDK 17(`/workspace/tools/jdk`), Android SDK 빌드툴 34 + platform 34(`/workspace/tools/sdk`).
서명 키는 `keystore/a1voice.jks` 이며 **저장소에 넣지 않는다**(비밀번호는 `KS_PASS` 환경변수로만 받는다).
**이 키를 잃으면 같은 앱으로 업데이트 설치가 안 된다** — 보관할 것.
배포는 `servers/a1-total-seoul/apk-put.py <apk>` → `/var/www/a1-dl/a1-voice.apk`.

## 서버 계약 (a1-voice-order)

```
POST {server}/api/auth/login      {"name":"<이름>","passcode":"<팀 비밀번호>"}
  → 200 {"ok":true,"name":"문지용"} + Set-Cookie: inu_session=...
  → 401 {"ok":false,"error":"팀 비밀번호가 맞지 않습니다."}

POST {server}/api/transcribe      multipart/form-data, field "audio" (파일)
  Cookie: inu_session=...
  → 200 {"ok":true,"text":"...","model":"gpt-4o-transcribe"}
  → 401 로그인 필요 / 422 인식 실패 / 429 요청 과다
```

`/api/transcribe` 는 개인정보 가림(masking)을 하지 않아 붙여넣기용 원문이 그대로 온다.
(서버에 그 경로가 없으면 `/api/sales/voice` + `x-a1-passcode` 로 대신 시도하고 `transcript` 만 사용)

## 알려진 사항

- 무음/잡음만 녹음하면 Whisper 가 엉뚱한 문장을 만들 수 있다(모델 특성). 0.7초 미만 녹음은 아예 보내지 않는다.
- 재부팅하면 버블은 사라진다. 앱 아이콘을 눌러 다시 켜면 된다(로그인·권한이 있으면 자동으로 뜬다).
- 팀 비밀번호 기본값은 넣지 않는다 — 처음 한 번 직접 입력하면 그 기기에만 저장된다. (v1.0은 팀 비밀번호가 기본값으로 들어 있어 배포용으로 부적합 → `archive/a1-voice-float-v1.0.apk`에만 남겨 둠)
- 이름 칸도 v1.2부터 빈칸이 기본이다. 저장된 값이 있을 때만 채워진다.
- 로그인 게이트는 "이 기기에서 서버 로그인이 확인됐는가"를 본다. 쿠키가 만료돼 `/api/transcribe` 가 401을 주면 앱이 저장된 비밀번호로 자동 재로그인한다.
- 접근성 서비스는 입력칸을 찾아 글자를 넣는 데만 쓴다. 화면의 다른 글자를 읽거나 저장·전송하지 않는다(이벤트도 포커스/창 전환만 받는다).
