# A1 음성 (a1-voice-float)

카톡·문자·네이트온 어디서든 **화면 위 A1 동그라미**를 두 번 톡톡 누르면 녹음이 시작되고,
말이 끝나면 `a1-voice-order` 의 Whisper(`gpt-4o-transcribe`)로 변환해 **입력칸에 바로 넣어주는**(또는 자동 복사하는) 안드로이드 앱.

- 패키지: `kr.inu.a1voice` · 이름: `A1 음성` · **versionName 1.3 (versionCode 4 · 2026-11-21 음성파일 15분분할·기기저장·자동 업데이트 안내)**
- 이전 버전: v1.2(versionCode 3) — `archive/a1-voice-float-v1.2.apk`, v1.0 — `archive/a1-voice-float-v1.0.apk`
- minSdk 26 (Android 8) / targetSdk 34
- 외부 라이브러리 0개 (Android 프레임워크만 사용) → APK 약 163KB
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
| **음성 파일 변환 (v1.3)** | 첫 화면의 **`음성 파일 변환 (녹음 열기)`** → `[녹음 파일 열기]`(파일 선택) 또는 `[폴더 열기]`(폴더 안 음성파일 목록). `.m4a .mp3 .wav .ogg .aac .flac .amr` 지원 |
| **15분 자동 분할 (v1.3)** | 15분 초과 또는 20MB 초과 파일은 `MediaExtractor`+`MediaCodec`+`MediaMuxer` 로 16kHz 모노 m4a 조각을 15분마다 만들어 순서대로 변환. 진행률 `1/3 구간 변환 중…` |
| **기기 저장 기록 (v1.3)** | 변환한 글·파일명·길이·시각을 **이 폰 안에만**(`filesDir/transcripts.json`) 저장. `기록 보기`에서 열어 확인·전체 복사·삭제. 서버로는 보내지 않음 |
| **자동 업데이트 안내 (v1.3)** | 앱을 열면 3시간에 한 번 `https://a1kr.com/app/version.json` 확인 → 새 버전이면 `New version v1.3 available` + `[Update]` → 누르면 `Updating...` 과 함께 `https://a1kr.com/app/a1-voice.apk` 로 이동 |

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

## 음성 파일 변환 · 기기 저장 · 업데이트 (v1.3)

### 1) 파일/폴더 열어 변환 (`FileTranscribeActivity`)
- 첫 화면 `플로팅 켜기` 아래 **`음성 파일 변환 (녹음 열기)`** → `[녹음 파일 열기]` 또는 `[폴더 열기]`
- 파일 선택은 SAF(`ACTION_OPEN_DOCUMENT`), 폴더는 `ACTION_OPEN_DOCUMENT_TREE` 후 `DocumentsContract` 로 폴더 안 음성 파일 목록을 만든다(외부 라이브러리 없이).
- 지원: `.m4a .mp3 .wav .ogg .aac .flac .amr`(+`.mp4 .3gp .m4b .opus .wma` 시도)
- **20MB 이하이고 15분 이하**면 원본을 그대로 `/api/transcribe` 로 보낸다(확장자를 유지해 임시 사본을 만든 뒤 업로드).

### 2) 15분 자동 분할 (`AudioChunker`)
15분 초과 또는 20MB 초과면 `MediaExtractor`(원본 트랙) → `MediaCodec` 디코더(PCM) → 모노 다운믹스 + 선형보간 16kHz → `MediaCodec` AAC 인코더 → `MediaMuxer` 로 **`part_01.m4a`, `part_02.m4a` … 15분 조각**을 만든다(64kbps → 15분 약 7MB).
조각은 순서대로 변환한 뒤 `\n` 으로 이어 하나의 글로 만든다. 진행률은 `i/n 구간 변환 중…`, 나누는 동안은 `15분 단위로 나누는 중… 42%`.
> 왜 재인코딩하나: mp3·wav·ogg·flac·amr 은 MP4 컨테이너로 그냥 잘라 담을 수 없어서, 어떤 형식이든 같은 파이프라인으로 통일했다(서버·Whisper 모두 m4a/AAC 16k 모노를 가장 잘 받는다).

### 3) 기기 저장 기록 (`History` · `HistoryActivity`)
- 저장 위치: **앱 전용 `filesDir/transcripts.json`** (JSON 배열, 최근 300건). 서버·클라우드로 전송하지 않는다.
- 항목: 제목(파일명) · 구분(파일/플로팅) · 시각 · 길이 · 구간 수 · 글 전체
- 첫 화면 `기록 보기` → 목록(제목·시각·길이·글자수·미리보기) → 열어서 확인/복사/삭제, 상단 `전체 삭제`
- 플로팅으로 말해 변환한 글도 같은 기록에 `플로팅` 으로 쌓인다.
- 앱을 지우면 기록도 같이 사라진다(백업·복원 없음 — "남의 것까지 듣고 싶지 않다" 지시에 맞춘 기기 전용).

### 4) 자동 업데이트 안내 (`UpdateChecker`)
- `https://a1kr.com/app/version.json` 을 앱을 열 때 백그라운드로 확인(3시간에 한 번, 실패는 조용히 무시).
- 서버 `versionCode` > 깔린 `versionCode` 면 **`New version v1.3 available`** + `[Update]` / `[Later]`.
- `[Update]` → 제목이 **`Updating...`** 으로 바뀌고 진행 막대와 함께 `version.json` 의 `url`(기본 `https://a1kr.com/app/a1-voice.apk`)을 브라우저로 연다. 사용자는 브라우저에서 받아 "설치"만 누르면 된다(같은 서명키라 덮어쓰기 업데이트).
- 첫 화면 맨 아래 `A1 음성 v1.3 · 새 버전 확인` 을 누르면 즉시 확인하고, 최신이면 `Latest version v1.3` 토스트.

```
GET https://a1kr.com/app/version.json
{"versionCode":4,"versionName":"1.3","url":"https://a1kr.com/app/a1-voice.apk"}
```

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
- v1.3 파일 변환은 안드로이드 기본 디코더가 지원하는 형식만 된다. 디코더가 없는 형식(일부 DRM·특이 코덱)은 "이 형식의 소리를 풀지 못했습니다" 로 안내한다.
- 서버 `/api/transcribe` 는 Vercel 함수라 **요청당 120초** 제한, **시간당 40회** 제한이 있다. 아주 긴 녹음은 15분 조각 수만큼 요청이 나가므로, 2시간 넘는 파일은 10조각(요청 10회) 이상이 될 수 있다.
- 변환 기록은 기기에만 있어서 앱 삭제·기기 변경 시 옮겨지지 않는다. 필요하면 결과 화면에서 `전체 복사` 로 밖에 빼 둘 것.
