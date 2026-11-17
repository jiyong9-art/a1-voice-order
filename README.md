# 에이원코리아(A1) 음성 업무 오더 (a1-voice-order)

에이원코리아(A1) 사내용 **음성 업무 오더 + 통화 녹음 핵심 요약** 웹앱입니다.
폰 브라우저에서 앱처럼 설치해 쓰고, 말한 내용이 **구글 시트**에 기록되고 **담당자 메일**로 알림이 갑니다.

- 만든 방식: Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · PWA
- 두 가지 모드
  - **모드 A · 음성 오더**: 🎤로 말하면 → 글자로 변환되어 입력창에 올라옴 → 확인·수정 후 전송 → `{담당자, 업무제목, 상세내용, 기한, 긴급도}` 카드 → 시트 `업무오더` 탭 + 담당자 메일
  - **모드 B · 통화 요약**: 📎로 통화 녹음(.mp3/.m4a/.webm)을 올리면 → 화자를 나눠 `{고객명, 핵심요청, 약속사항, 기한, 다음할일, 요약}` 카드 → 시트 `통화요약` 탭 + 대표 메일
- 팀 공용 비밀번호(`APP_PASSCODE`) + 이름 선택으로 잠가 두어, 외부인이 OpenAI 크레딧을 쓰지 못합니다.

---

## 1. 빠른 시작 (로컬, 5분)

```bash
# Node.js 20.9 이상 필요 (권장 22 LTS 이상)
cd projects/a1-voice-order
npm install
cp .env.example .env.local     # 값을 채웁니다 (아래 2번)
npm run dev                    # http://localhost:3000
```

처음 화면에서 **이름 선택 + 팀 비밀번호**를 넣으면 들어갑니다.
키를 아직 발급하지 않았다면 `.env.local`에 `MOCK_AI=true`만 넣고 켜 보세요. 예시 데이터로 화면 전체 흐름(변환→정리→등록)을 그대로 시험할 수 있습니다.

배포용 빌드 확인:

```bash
npm run typecheck   # 타입 검사
npm run build       # 프로덕션 빌드
npm start           # 빌드 결과 실행
bash scripts/smoke-test.sh   # 로그인·API 전 구간 자동 점검 (모의 모드)
```

---

## 2. 환경변수

`.env.example`을 그대로 복사해 쓰면 됩니다. Vercel에서는 **Settings → Environment Variables**에 같은 이름으로 넣습니다.

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `APP_PASSCODE` | ✅ | 팀 공용 비밀번호. 직원에게만 공유. 비우면 로그인 불가 |
| `APP_SESSION_SECRET` | 권장 | 로그인 쿠키 서명 키(아무 긴 무작위 문자열). 비우면 `APP_PASSCODE`로 대신 서명 |
| `TEAM_MEMBERS` | 선택 | 로그인 화면 이름 목록 · 기본 `문지용, 이광훈, 송현준, 백남우, 김남국, 한원석, 차정호, 유병은` |
| `COMPANY_VOCABULARY` | 선택 | 음성 인식 고유명사 힌트 추가 (기본값에 `에이원코리아, A1, 에이원, 에이팩스미디어, 인유, 문지용, 이광훈, 송현준, 백남우, 김남국, 한원석, 차정호, 유병은, 보험, 설계사 ...` 포함) |
| `OPENAI_API_KEY` | ✅ | 음성 변환·업무 정리 |
| `OPENAI_TRANSCRIBE_MODEL` | 선택 | 기본 `gpt-4o-transcribe` (실패 시 `whisper-1` 자동 재시도) |
| `OPENAI_CHAT_MODEL` | 선택 | 기본 `gpt-4o-mini` (원하면 `gpt-4.1`, `gpt-5` 등) |
| `GOOGLE_SPREADSHEET_ID` | 권장 | 시트 주소의 `/d/`와 `/edit` 사이 문자열 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 권장 | 서비스 계정 JSON 키 **전문**을 한 줄로 |
| `GOOGLE_SPREADSHEET_URL` | 선택 | 시트 바로가기 링크 (비우면 ID로 자동 생성) |
| `RESEND_API_KEY` / `MAIL_FROM` | 선택 | Resend로 메일 발송 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 선택 | SMTP로 메일 발송 (네이버·지메일 앱 비밀번호 등) |
| `NOTIFY_EMAIL` | 선택 | 통화요약·업무오더를 항상 함께 받을 대표 메일 |
| `MOCK_AI` | 선택 | `true`면 OpenAI 호출 없이 예시 데이터로 동작 (시연·점검용) |

> 메일 설정이 없으면 **메일만 조용히 건너뛰고** 시트 기록은 정상 동작합니다. 시트 설정이 없으면 등록 결과에 "저장되지 않았습니다"가 명확히 표시됩니다.

---

## 3. 구글 시트 준비 (10분)

### 3-1. 스프레드시트 만들기
구글 드라이브에서 새 스프레드시트를 만들고 이름을 `에이원 업무 오더 대장`으로 저장한 뒤, 탭 3개를 만듭니다. (탭이 없으면 앱이 자동으로 만들고 헤더까지 넣어 줍니다.)

**`업무오더`** 1행:
```
등록일시 | 지시자 | 담당자 | 긴급도 | 업무제목 | 상세내용 | 기한 | 상태 | 음성원문
```

**`통화요약`** 1행:
```
등록일시 | 작성자 | 고객명 | 핵심요청 | 약속사항 | 기한 | 다음할일 | 요약 | 음성원문
```

**`직원목록`** 1행:
```
이름 | 등록일시 | 시트ID
```
예)
```
문지용 | 2026-11-17 | 1AbCdEf...
이광훈 | 2026-11-17 |
송현준 | 2026-11-17 |
```

> `시트ID`(C열)는 그 직원의 **전용 스프레드시트 파일 ID**입니다. 값이 있으면 그 직원이 등록한 업무오더·통화요약은 마스터 시트가 아니라 **본인 전용 파일**에 쌓입니다. 비어 있으면 마스터 시트에 기록되고, 이후 그 직원이 처음 저장할 때 Apps Script가 전용 시트를 만들어 줍니다.

> 기본 팀원은 **문지용 · 이광훈 · 송현준 · 백남우 · 김남국 · 한원석 · 차정호 · 유병은** 8명입니다. (`TEAM_MEMBERS`를 비워 두면 이 8명이 로그인 화면 선택지와 담당자 매칭에 쓰입니다. 인원이 바뀌면 앱의 **직원 관리**에서 추가·삭제하거나 `TEAM_MEMBERS`에 쉼표로 이어 붙이세요.)

### 3-2. 서비스 계정 키 만들기
1. https://console.cloud.google.com → 새 프로젝트 생성 (예: `a1-voice-order`)
2. **API 및 서비스 → 라이브러리** → `Google Sheets API` → 사용 설정
3. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → 서비스 계정** → 이름 입력 후 생성
4. 생성된 서비스 계정 → **키 → 키 추가 → JSON** → 다운로드 (파일은 절대 공개 금지)
5. 다운로드한 JSON 안의 `client_email`(예: `a1-voice-order@a1-voice-order.iam.gserviceaccount.com`)을 복사
6. 스프레드시트 우측 상단 **공유** → 그 이메일을 **편집자**로 추가

### 3-3. 값 넣기
- `GOOGLE_SPREADSHEET_ID`: `https://docs.google.com/spreadsheets/d/`**`여기`**`/edit`
- `GOOGLE_SERVICE_ACCOUNT_JSON`: 다운로드한 JSON 파일 내용 **전체**를 한 줄로 붙여넣기
  - 터미널에서: `pbcopy < service-account.json` (맥) / PowerShell `Get-Content -Raw service-account.json | Set-Clipboard`
  - Vercel 입력창에는 파일 내용을 그대로 붙여넣으면 됩니다. 줄바꿈이 `\n` 문자열로 들어가도 앱이 자동 처리합니다.

### 3-4. (더 쉬운 방법) Apps Script 웹앱 연동 — 서비스 계정 키 불필요
구글 클라우드 서비스 계정을 만들지 않고, 마스터 시트에 붙이는 스크립트 한 번으로 끝낼 수 있습니다.

1. 마스터 스프레드시트 → **확장 프로그램 → Apps Script**
2. 편집기 내용을 지우고 `docs/google-apps-script.gs` 전체를 붙여넣기
3. 파일 위쪽 `var SECRET = "CHANGE_ME_TO_A_LONG_RANDOM_STRING";` 를 길고 무작위한 문자열로 바꾸기 (예: `a1-9f3c2b7e41d8`)
4. **저장 → 배포 → 새 배포 → 유형: 웹 앱**
   - 다음 사용자로 실행: **나**
   - 액세스 권한이 있는 사용자: **모든 사용자**
5. 나오는 웹 앱 URL(`https://script.google.com/macros/s/.../exec`)을 복사
6. 앱 환경변수(Vercel)에 등록하고 재배포
   - `GOOGLE_APPS_SCRIPT_URL` = 복사한 `.../exec` 주소
   - `GOOGLE_APPS_SCRIPT_SECRET` = 3번에서 정한 문자열

이 방식이 설정되어 있으면 `GOOGLE_SERVICE_ACCOUNT_JSON` 없이도 직원 목록·추가·삭제와 업무오더 저장이 모두 동작합니다. (둘 다 있으면 Apps Script가 우선입니다.)

**Apps Script가 처리하는 일**

| action | 동작 |
| --- | --- |
| `members:list` | `직원목록` 탭을 읽어 이름·등록일시·시트ID 반환 |
| `members:add` | 직원 행 추가 + `업무오더_{이름}` 스프레드시트를 마스터와 같은 폴더에 생성하고 C열에 ID 기록 |
| `members:remove` | 해당 직원 행 삭제 (전용 시트 파일은 보존) |
| `submit:order` | 로그인한 작성자의 전용 시트 `업무오더` 탭에 1행 추가 (없으면 마스터) |
| `submit:summary` | 로그인한 작성자의 전용 시트 `통화요약` 탭에 1행 추가 (없으면 마스터) |

---

## 4. OpenAI 키 준비

1. https://platform.openai.com 가입 → 결제수단 등록 → 크레딧 충전 (처음 $10 ≈ 1.4만 원)
2. **API keys → Create new secret key** → `sk-...` 복사 → `OPENAI_API_KEY`
3. 사용량 한도를 걸어 두면 안전합니다: **Settings → Limits → Monthly budget** (예: $10)

예상 비용(가이드 기준): 직원 8명 · 하루 50건 · 월 1,500분 ≈ **월 1만~2만 원**.

---

## 5. 메일 알림 (선택)

**A. Resend (가장 빠름)**
1. https://resend.com 가입 → API Keys → `re_...` 생성
2. `RESEND_API_KEY`에 입력, `MAIL_FROM`은 도메인 인증 전이면 `에이원 업무오더 <onboarding@resend.dev>` 사용
   (도메인 인증 전에는 **계정 소유자 메일로만** 발송됩니다. `a1korea.co.kr` 도메인 인증 후 `order@a1korea.co.kr`로 변경)

**B. SMTP (회사 메일 그대로)**
- 네이버: `smtp.naver.com` / 587 / 아이디 / **애플리케이션 비밀번호**
- 지메일: `smtp.gmail.com` / 587 / 앱 비밀번호(2단계 인증 필요)
- `SMTP_FROM`은 보통 `SMTP_USER`와 같은 주소

---

## 6. Vercel 배포 (5분)

1. https://vercel.com 가입 (GitHub 계정 연동 권장)
2. 이 폴더를 GitHub 저장소로 올린 뒤 **Add New → Project → Import**
   - Framework Preset: **Next.js** (자동 감지) · Build Command/Output 기본값 그대로
3. **Environment Variables**에 2번 표의 값을 등록 (Production / Preview 모두)
4. **Deploy** → `https://a1-voice-order.vercel.app` 같은 주소가 나옵니다.
5. (선택) 도메인 연결: **Settings → Domains → `order.a1korea.co.kr` 추가** 후 DNS CNAME 등록

> Git 없이 배포하려면 `npx vercel` CLI로도 가능합니다. 어느 쪽이든 **서비스 계정 JSON과 OpenAI 키는 저장소에 절대 커밋하지 마세요.** (`.gitignore`에 `.env*` 포함되어 있음)

---

## 7. 직원 폰에 설치

1. 폰 브라우저(크롬/사파리)로 배포 주소 접속 → 팀 비밀번호 로그인
2. **홈 화면에 추가**
   - 아이폰 사파리: 공유 → 홈 화면에 추가
   - 안드로이드 크롬: ⋮ → 앱 설치 / 홈 화면에 추가
3. 이후 아이콘으로 실행하면 주소창 없는 앱처럼 열립니다. (PWA manifest + 아이콘 + 서비스 워커 포함)

---

## 8. 사용법

### 모드 A · 음성 오더
1. 상단 **음성 오더** 탭 선택
2. 🎤 누르고 편하게 말하기 (최대 2분, 다시 누르면 종료)
3. 1~2초 뒤 변환된 문장이 **입력창에 올라옴** → 틀린 부분만 고치기
4. **[전송]** → 업무 카드로 정리됨 (담당자·기한·긴급도)
5. 카드에서 내용을 고친 뒤 **[시트에 등록하고 담당자에게 알림]**

### 모드 B · 통화 요약
1. 상단 **통화 요약** 탭 선택
2. 📎로 통화 녹음 파일(.mp3/.m4a/.wav/.webm, 24MB 이하) 업로드
   또는 통화 중에 🎤로 직접 녹음해도 됩니다
3. 화자 구분 + 잡담 제거된 **핵심 요약 카드** 생성
4. 필요하면 수정 → **[통화요약 시트에 등록]** (대표 메일로도 발송)

> 10분 통화도 5~10초 안에 정리됩니다. 24MB가 넘는 긴 통화는 앞/뒤로 나눠 올려 주세요.

---

## 9. 화면·동작 구조

| 경로 | 역할 |
| --- | --- |
| `app/login/page.tsx` · `components/LoginForm.tsx` | 팀 비밀번호 + 이름 선택 로그인 |
| `app/page.tsx` | 로그인 확인 후 메인 화면(서버 컴포넌트) |
| `components/AppShell.tsx` | 채팅형 화면·상태 관리·흐름 제어 |
| `components/Composer.tsx` | 하단 바: 글자 입력 + 🎤 + 📎 + 전송, 녹음/업로드 |
| `components/OrderCard.tsx` | 업무 오더 확인·수정 카드 + 등록 버튼 |
| `components/CallSummaryCard.tsx` | 통화 요약 확인·수정 카드 + 등록 버튼 |
| `app/api/auth/login` · `logout` | 세션 쿠키(HMAC 서명, 7일) 발급/삽입 |
| `app/api/members` | 직원 목록 조회(GET) · 추가(POST) · 삭제(DELETE). 세션 또는 팀 비밀번호로 보호 |
| `app/api/transcribe` | 음성 → 텍스트 (OpenAI, 한국어 + 고유명사 프롬프트, 24MB 제한) |
| `app/api/structure` | 텍스트 → `order` / `call_summary` JSON (JSON Schema 강제) |
| `app/api/submit` | 시트 행 추가 + 담당자 메일 (미설정 시 건너뜀) |
| `lib/ai.ts` | 모델 호출·JSON 정규화·모의 모드 |
| `lib/sheets.ts` | 시트 읽기/쓰기, `직원목록`·직원 전용 시트 라우팅, Apps Script 웹앱 호출 |
| `lib/members.ts` | 직원 목록·추가·삭제 (시트 연동이 없으면 런타임 fallback) |
| `lib/mail.ts` | Resend / SMTP 발송 |
| `lib/auth.ts` · `lib/rate-limit.ts` | 세션 검증 · 요청 수 제한(크레딧 보호) |
| `public/manifest.json` · `public/icons/*` · `public/sw.js` | PWA 설치·아이콘·앱 셸 캐시 |

### 보안·비용 장치
- 모든 AI/시트 API는 **로그인 세션 필수** (쿠키는 HttpOnly + HMAC 서명)
- 세션당 시간당 요청 제한 (변환 40회 / 정리 60회 / 등록 120회)
- 업로드 24MB 제한, 통화 텍스트 6만 자 제한
- `robots.txt` + `noindex`로 검색 노출 차단, `X-Frame-Options: DENY`
- OpenAI 키·서비스 계정 키는 **서버에서만** 사용 (브라우저로 전달되지 않음)

---

## 10. 알려진 제약 — Vercel의 4.5MB 업로드 한도

Vercel 서버리스 함수는 **요청 본문 4.5MB**까지만 받습니다. 그래서 Vercel에 배포하면:

- 폰에서 🎤로 짧게 녹음하는 음성 오더(수십 초~1분): 문제 없음
- 통화 녹음 파일 업로드: **약 4MB 이하(약 4~6분 분량)** 파일까지 가능
- 10분 통화(보통 6~10MB)는 앱이 “파일이 너무 커서 서버가 거절했습니다”라고 안내하며, 통화를 앞/뒤로 나눠 올리면 정상 처리됩니다. (로컬·자체 서버 실행 시에는 최대 24MB)

긴 통화를 한 번에 올려야 한다면 다음 중 하나로 확장합니다. (이번 MVP에는 미포함)

1. **Vercel Blob 직접 업로드**: 브라우저 → Blob(대용량 허용) → 서버가 내려받아 전사. `@vercel/blob` 클라이언트 업로드 토큰 필요
2. **자체 서버/VPS**: `next start`를 Node 서버로 돌리면 본문 제한이 없어 24MB까지 그대로 동작
3. **통화 중 🎤 녹음**: 통화를 스피커폰으로 두고 앱에서 직접 녹음하면 2분 단위로 나뉘어 저장하기 쉬움

---

## 11. 문제 해결

| 증상 | 원인 / 해결 |
| --- | --- |
| 로그인 화면에 "APP_PASSCODE 미설정" | 배포 환경변수에 `APP_PASSCODE` 추가 후 재배포 |
| 🎤 눌러도 "마이크 권한" | 브라우저 주소창 자물쇠 → 마이크 허용. HTTPS에서만 동작(Vercel은 자동 HTTPS) |
| "음성을 인식하지 못했습니다" | 너무 짧거나 무음. 5초 이상 말하기 |
| "OpenAI API 키가 올바르지 않습니다" | 키 오타·폐기 여부 확인, 결제 잔액 확인 |
| 정리 결과가 영어/어색함 | `OPENAI_CHAT_MODEL`을 더 큰 모델로 (예: `gpt-4.1`) |
| "Unable to parse range" | `업무오더` 탭 이름 오타 또는 서비스 계정 권한 없음. 앱이 탭을 자동 생성하지만 시트 공유(편집자)가 안 되어 있으면 실패 |
| 메일이 안 옴 | Resend 도메인 미인증 시 계정 소유자 메일로만 발송됨. `NOTIFY_EMAIL` 확인. 스팸함 확인 |
| 시트에 저장은 되는데 메일만 실패 | `직원목록` 탭의 이름과 카드의 담당자 이름이 다르면 수신자를 못 찾음 (이름 띄어쓰기 무시하고 비교) |
| `직원목록` 시트에 직원을 추가했는데 로그인 화면에 안 뜸 | ① 시트 연결(Apps Script 또는 서비스 계정)이 설정됐는지 확인 ② 앱을 새로고침(목록은 화면을 열 때마다 읽어옵니다) ③ `직원 관리` 모달의 배지가 `기본 명단`이면 시트 미연결 상태 |
| 직원은 추가됐는데 업무오더가 마스터 시트에 쌓임 | `직원목록` C열(시트ID)이 비어 있으면 마스터에 기록됩니다. Apps Script 모드에서는 첫 저장 때 전용 시트가 자동 생성됩니다. 서비스 계정 모드에서는 직접 만든 시트 ID를 C열에 넣고 그 파일도 서비스 계정에 **편집자**로 공유해야 합니다. |
| 통화 파일이 너무 큼 | 24MB 이하로 나누기. 아이폰 녹음은 `음성 메모 → 공유 → 파일 저장` 후 업로드 |

---

## 12. 다음 단계 (프로젝트 2)

이 앱은 가이드의 **프로젝트 1**입니다. 같은 구조 위에 프로젝트 2(AI 인바운드 콜센터)를 얹을 수 있습니다.

1. RAG 문서 4종 작성: `01_회사_및_서비스_소개.md`, `02_자주묻는질문_FAQ.md`, `03_필수수집정보.md`, `04_금지규칙.md`
2. `a1korea.co.kr` 우측 하단 `[🎤 AI 음성 상담]` 위젯 → 이 앱의 `/api/transcribe` · `/api/structure` 패턴 재사용
3. 안전장치: 1회 3분 제한, IP별 일일 횟수 제한, 실시간 자막
4. 전화(인바운드) 확장: Twilio 또는 국내 클라우드 전화 API + 발신번호 사전등록

---

## 13. 검증 결과 (2026-11-17 기준)

검증 환경: Linux 컨테이너 · Node.js 26.13.1 (LTS) · npm 11.20

- `npm install` 완료 — Next 16.4.6, React 19.3.1, Tailwind 4.3.5, openai 7.57, @googleapis/sheets 18.1.3, google-auth-library 11.3.4, nodemailer 10.6
- `npm run typecheck` (`tsc --noEmit`) **통과**
- `npm run build` **통과** — `/`, `/login`, `/api/auth/login`, `/api/auth/logout`, `/api/members`, `/api/transcribe`, `/api/structure`, `/api/submit` 모두 생성
- `npm run dev` **정상 기동** (`/login` 200, 비로그인 `/` 307 리다이렉트)
- `scripts/smoke-test.sh` **통과** — 잘못된 비밀번호 401 / 정상 로그인 200 / 미로그인 접근 307 / API 무단호출 401 / **직원 관리 API: GET 200, 무인증·오답 POST/DELETE 401, 비밀번호·세션 쿠키로 추가·삭제 성공(시트 미연결 시 `persistent:false` + 안내 문구)** / 음성 업로드 200 / 정리 200 / 등록 응답 정상(시트·메일 미설정 시 건너뜀 표시) / 로그아웃 후 307
- 브라우저 실제 렌더(360px·1280px)로 로그인·메인·직원 관리 모달을 확인 — 가로 넘침 없음, 버튼·칩·말풍선 색상 `rgb(0, 58, 132)`(#003a84), 콘솔 오류 0건
- `docs/google-apps-script.gs`를 가짜 구글 환경(SpreadsheetApp/DriveApp/ContentService 모킹)에서 실행해 `members:list/add/remove`, `submit:order/summary` 동작과 전용 시트 자동 생성·C열 기록을 확인
- 정적 헤더 확인 — `X-Frame-Options: DENY`, `Permissions-Policy: microphone=(self)`, `/manifest.json`은 `application/manifest+json`, `/sw.js`는 `no-cache`
- 실제 OpenAI·구글 시트·메일 호출은 **키 발급 후** 확인 필요 (아래 참고)

### 배포 시 대표님이 준비해 주셔야 하는 것
1. **OpenAI API 키** (`sk-...`) — 카드 등록 후 크레딧 충전
2. **구글 스프레드시트** 1개 + 탭 3개(`업무오더`/`통화요약`/`직원목록`)
3. **시트 연결 — 둘 중 하나**
   - (쉬움) `docs/google-apps-script.gs` 붙여넣고 웹 앱으로 배포 → `GOOGLE_APPS_SCRIPT_URL` + `GOOGLE_APPS_SCRIPT_SECRET`
   - (직접) **서비스 계정 JSON** (위 3-2 단계) + `GOOGLE_SPREADSHEET_ID` — 시트에 편집자 공유
4. **팀 비밀번호** 정하기 (`APP_PASSCODE`)
5. (선택) 메일: Resend 키 또는 회사 메일 SMTP 정보, 대표 수신 메일 `NOTIFY_EMAIL`
