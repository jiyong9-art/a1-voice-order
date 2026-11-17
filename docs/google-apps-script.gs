/**
 * 에이원코리아 업무오더 — 구글 시트 연동 Apps Script (웹앱)
 * ============================================================
 * 이 파일은 "마스터 스프레드시트"(직원목록 탭이 있는 시트)에 붙여 넣는 코드입니다.
 * 서비스 계정 JSON을 발급받지 않고도 앱에서 직원 추가·삭제와 업무오더 저장을 할 수 있습니다.
 *
 * 설치 순서 (약 1분)
 * 1) 마스터 스프레드시트를 엽니다. (예: 에이원코리아 업무오더 DB)
 * 2) 상단 메뉴 [확장 프로그램] → [Apps Script] 를 누릅니다.
 * 3) 왼쪽 편집기의 내용을 모두 지우고 이 파일 전체를 붙여 넣습니다.
 * 4) 아래 SECRET 값을 길고 무작위한 문자열로 바꿉니다. (앱의 GOOGLE_APPS_SCRIPT_SECRET 과 같은 값)
 * 5) [저장] → 오른쪽 위 [배포] → [새 배포] → 유형 ⚙️ [웹 앱]
 *      - 설명: a1-voice-order
 *      - 다음 사용자로 실행: **나**
 *      - 액세스 권한이 있는 사용자: **모든 사용자**
 *    → [배포] → 나오는 웹 앱 URL(.../exec)을 복사합니다.
 * 6) 앱 환경변수에 아래 두 개를 넣고 재배포합니다.
 *      GOOGLE_APPS_SCRIPT_URL = (위에서 복사한 .../exec 주소)
 *      GOOGLE_APPS_SCRIPT_SECRET = (4번에서 정한 SECRET 값)
 *
 * 동작
 * - members:list      직원목록 탭을 읽어 [{name, registeredAt, sheetId}] 반환
 * - members:add       직원 행 추가 + 마스터 시트와 같은 드라이브 폴더에
 *                     `업무오더_{이름}` 스프레드시트를 만들어 C열(시트ID)에 기록
 * - members:remove    직원목록에서 해당 이름 행 삭제 (전용 시트 파일은 보존)
 * - submit:order      작성자(로그인한 직원)의 전용 시트에 업무오더 1행 추가 (없으면 마스터)
 * - submit:summary    작성자(로그인한 직원)의 전용 시트에 통화요약 1행 추가 (없으면 마스터)
 *
 * 주의
 * - 이 스크립트는 시트 소유자(나) 권한으로 실행되며, 새로 만든 전용 시트도 내 드라이브에 저장됩니다.
 * - 코드를 고친 뒤에는 [배포] → [배포 관리] → 수정 → 버전 [새 버전] 으로 다시 배포해야 반영됩니다.
 */

/** 앱의 GOOGLE_APPS_SCRIPT_SECRET 과 반드시 같은 값으로 바꾸세요. 비워 두면 아무나 호출할 수 있습니다. */
var SECRET = "CHANGE_ME_TO_A_LONG_RANDOM_STRING";

var STAFF_TAB = "직원목록";
var ORDER_TAB = "업무오더";
var SUMMARY_TAB = "통화요약";

var STAFF_HEADERS = ["이름", "등록일시", "시트ID"];
var ORDER_HEADERS = [
  "등록일시",
  "지시자",
  "담당자",
  "긴급도",
  "업무제목",
  "상세내용",
  "기한",
  "상태",
  "음성원문",
];
var SUMMARY_HEADERS = [
  "등록일시",
  "작성자",
  "고객명",
  "핵심요청",
  "약속사항",
  "기한",
  "다음할일",
  "요약",
  "음성원문",
];

function doGet() {
  return json({ ok: true, service: "a1-voice-order", message: "POST 로만 호출합니다." });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var payload = parsePayload(e);
    if (SECRET && String(payload.secret || "") !== SECRET) {
      return json({ ok: false, error: "인증 실패: secret 값이 올바르지 않습니다." });
    }

    lock.waitLock(20000);

    var action = String(payload.action || "");
    if (action === "members:list") return json(membersList());
    if (action === "members:add") return json(membersAdd(payload));
    if (action === "members:remove") return json(membersRemove(payload));
    if (action === "submit:order") return json(submitOrder(payload));
    if (action === "submit:summary") return json(submitSummary(payload));

    return json({ ok: false, error: "알 수 없는 action 입니다: " + action });
  } catch (err) {
    return json({ ok: false, error: err && err.message ? err.message : String(err) });
  } finally {
    try {
      lock.releaseLock();
    } catch (ignore) {}
  }
}

/* ------------------------------------------------------------------ */
/* 공용 도우미                                                          */
/* ------------------------------------------------------------------ */

function parsePayload(e) {
  if (e && e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (err) {
      throw new Error("요청 본문(JSON)을 해석하지 못했습니다.");
    }
  }
  return (e && e.parameter) || {};
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function masterId() {
  return SpreadsheetApp.getActiveSpreadsheet().getId();
}

function masterSheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function staffSheet() {
  var sheet = masterSheet().getSheetByName(STAFF_TAB);
  if (!sheet) throw new Error("마스터 시트에 '" + STAFF_TAB + "' 탭이 없습니다.");
  return sheet;
}

function normalize(name) {
  return String(name || "").replace(/\s/g, "");
}

function todayKst() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
}

function sheetUrl(spreadsheetId) {
  return "https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/edit";
}

/** 시트에 탭이 없으면 만들고 1행에 헤더를 넣습니다. */
function ensureTab(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (sheet) return { sheet: sheet, created: false };
  sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return { sheet: sheet, created: true };
}

/** 직원목록 전체를 [{name, registeredAt, sheetId}] 로 읽습니다. */
function readStaff() {
  var sheet = staffSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var name = String(values[i][0] || "").trim();
    if (!name) continue;
    rows.push({
      name: name,
      registeredAt: String(values[i][1] || "").trim(),
      sheetId: String(values[i][2] || "").trim(),
    });
  }
  return rows;
}

/** 이름으로 직원 행을 찾습니다. {rowNumber, name, sheetId} 또는 null */
function findStaffRow(name) {
  var wanted = normalize(name);
  var rows = readStaff();
  for (var i = 0; i < rows.length; i++) {
    if (normalize(rows[i].name) === wanted) {
      return { rowNumber: i + 2, name: rows[i].name, sheetId: rows[i].sheetId };
    }
  }
  return null;
}

/** 직원 전용 스프레드시트를 항상 새로 만듭니다. (마스터와 같은 폴더로 이동) */
function createPersonalSheet(staffName) {
  var ss = SpreadsheetApp.create(ORDER_TAB + "_" + staffName);
  ensureTab(ss, ORDER_TAB, ORDER_HEADERS);
  ensureTab(ss, SUMMARY_TAB, SUMMARY_HEADERS);

  // 기본으로 생기는 빈 시트(Sheet1/시트1)를 정리합니다.
  var keep = [ORDER_TAB, SUMMARY_TAB];
  var all = ss.getSheets();
  for (var i = 0; i < all.length; i++) {
    if (keep.indexOf(all[i].getName()) === -1) ss.deleteSheet(all[i]);
  }

  // 마스터 시트가 있는 드라이브 폴더로 옮깁니다.
  try {
    var parents = DriveApp.getFileById(masterId()).getParents();
    if (parents.hasNext()) DriveApp.getFileById(ss.getId()).moveTo(parents.next());
  } catch (err) {
    // 폴더 이동에 실패해도 내 드라이브 루트에 그대로 남습니다.
  }
  return ss;
}

/** 직원 전용 스프레드시트를 찾고, 없으면 만들어서 C열(시트ID)에 기록합니다. */
function personalSheetFor(staffName) {
  var row = findStaffRow(staffName);
  if (!row) return null;

  if (row.sheetId) {
    try {
      var existing = SpreadsheetApp.openById(row.sheetId);
      if (existing) return existing;
    } catch (err) {
      // 시트ID가 잘못되었거나 접근할 수 없으면 새로 만듭니다.
    }
  }

  var ss = createPersonalSheet(row.name);
  staffSheet().getRange(row.rowNumber, 3).setValue(ss.getId());
  return ss;
}

/* ------------------------------------------------------------------ */
/* members:*                                                           */
/* ------------------------------------------------------------------ */

function membersList() {
  return { ok: true, staff: readStaff() };
}

function membersAdd(payload) {
  var name = String(payload.name || "").replace(/\s+/g, " ").trim().slice(0, 20);
  if (!name) return { ok: false, error: "이름이 비어 있습니다." };

  var existing = findStaffRow(name);
  if (existing && existing.sheetId) {
    return { ok: true, sheetId: existing.sheetId, url: sheetUrl(existing.sheetId), duplicated: true };
  }

  var ss = createPersonalSheet(existing ? existing.name : name);
  var sheetId = ss.getId();
  if (existing) {
    staffSheet().getRange(existing.rowNumber, 3).setValue(sheetId);
  } else {
    staffSheet().appendRow([name, String(payload.registeredAt || todayKst()), sheetId]);
  }

  return { ok: true, sheetId: sheetId, url: sheetUrl(sheetId) };
}

function membersRemove(payload) {
  var name = String(payload.name || "").trim();
  if (!name) return { ok: false, error: "이름이 비어 있습니다." };

  var row = findStaffRow(name);
  if (!row || row.rowNumber < 2) return { ok: false, error: "직원목록에서 이름을 찾지 못했습니다." };

  // 전용 시트 파일은 지우지 않습니다. (기록 보존)
  staffSheet().deleteRow(row.rowNumber);
  return { ok: true, removed: true, name: row.name };
}

/* ------------------------------------------------------------------ */
/* submit:*                                                            */
/* ------------------------------------------------------------------ */

function submitOrder(payload) {
  var data = payload.data || {};
  var sender = String(payload.sender || data.sender || "미확인").trim();
  var registeredAt = String(payload.registeredAt || data.registeredAt || todayKst());

  var personal = null;
  try {
    personal = personalSheetFor(sender);
  } catch (err) {
    personal = null; // 전용 시트를 못 만들면 마스터에 기록
  }
  var target = personal || masterSheet();
  var tab = ensureTab(target, ORDER_TAB, ORDER_HEADERS);
  var sheet = tab.sheet;

  var row = [
    registeredAt,
    sender,
    String(data.assignee || "미지정"),
    String(data.priority || "보통"),
    String(data.title || "(제목 없음)"),
    String(data.details || ""),
    String(data.due_date || "") || "-",
    "신규",
    String(data.raw_transcript || ""),
  ];
  sheet.appendRow(row);
  var rowNumber = sheet.getLastRow();

  return {
    ok: true,
    tab: ORDER_TAB,
    row: rowNumber,
    spreadsheetId: target.getId(),
    url: sheetUrl(target.getId()),
    target: personal ? "personal" : "master",
    createdTab: tab.created,
  };
}

function submitSummary(payload) {
  var data = payload.data || {};
  var sender = String(payload.sender || data.sender || "미확인").trim();
  var registeredAt = String(payload.registeredAt || data.registeredAt || todayKst());

  var personal = null;
  try {
    personal = personalSheetFor(sender);
  } catch (err) {
    personal = null;
  }
  var target = personal || masterSheet();
  var tab = ensureTab(target, SUMMARY_TAB, SUMMARY_HEADERS);
  var sheet = tab.sheet;

  var row = [
    registeredAt,
    sender,
    String(data.customer_name || "미확인"),
    toText(data.key_requests),
    toText(data.promises),
    String(data.due_date || "") || "-",
    toText(data.next_actions),
    String(data.summary || ""),
    String(data.raw_transcript || ""),
  ];
  sheet.appendRow(row);
  var rowNumber = sheet.getLastRow();

  return {
    ok: true,
    tab: SUMMARY_TAB,
    row: rowNumber,
    spreadsheetId: target.getId(),
    url: sheetUrl(target.getId()),
    target: personal ? "personal" : "master",
    createdTab: tab.created,
  };
}

function toText(value) {
  if (value === null || value === undefined) return "";
  if (Object.prototype.toString.call(value) === "[object Array]") return value.join("\n");
  return String(value);
}
