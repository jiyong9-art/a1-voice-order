import { defaultTeamMembers, sheetsBackend } from "@/lib/env";
import { addStaffRow, listStaffRows, removeStaffRow, type StaffRow } from "@/lib/sheets";
import { todayInSeoul } from "@/lib/types";

export type MemberSource = "apps_script" | "service_account" | "env";

export interface MembersState {
  members: string[];
  staff: StaffRow[];
  /** 실제 목록을 어디서 읽었는지 */
  source: MemberSource;
  /** 구글 시트에 저장되는지 (false면 앱 서버 메모리에만 임시 저장) */
  persistent: boolean;
  warning?: string;
}

export interface MemberMutation {
  ok: boolean;
  error?: string;
  warning?: string;
  state?: MembersState;
}

/** 시트 연동이 없을 때 쓰는 런타임 저장소 (서버 인스턴스가 살아 있는 동안만 유지) */
const runtimeStaff = new Map<string, StaffRow>();
const runtimeRemoved = new Set<string>();

function nameKey(value: string): string {
  return value.replace(/\s/g, "");
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 20);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function envStaff(): StaffRow[] {
  return defaultTeamMembers().map((name) => ({ name, registeredAt: "", sheetId: "" }));
}

/** 시트/기본값 목록 + 런타임 추가·삭제를 하나로 합칩니다. */
function mergeStaff(rows: StaffRow[]): StaffRow[] {
  const seen = new Set<string>();
  const merged: StaffRow[] = [];
  const push = (row: StaffRow) => {
    const key = nameKey(row.name);
    if (!key || seen.has(key) || runtimeRemoved.has(key)) return;
    seen.add(key);
    merged.push(row);
  };
  rows.forEach(push);
  runtimeStaff.forEach(push);
  return merged;
}

function toState(rows: StaffRow[], source: MemberSource, warning?: string): MembersState {
  const staff = mergeStaff(rows);
  return {
    members: staff.map((row) => row.name),
    staff,
    source,
    persistent: source !== "env" || sheetsBackend() !== "none",
    warning,
  };
}

const RUNTIME_WARNING = "구글 시트가 연결되지 않아 이 서버 인스턴스에만 임시로 저장됩니다.";

/** 현재 직원 목록 (구글 시트 → 없으면 TEAM_MEMBERS/기본값 → 런타임 보정) */
export async function listMembers(): Promise<MembersState> {
  const backend = sheetsBackend();

  if (backend !== "none") {
    try {
      const rows = await listStaffRows();
      if (rows !== null) return toState(rows, backend);
      return toState(envStaff(), "env", "직원목록 탭이 없어 기본 명단으로 표시합니다.");
    } catch (err) {
      return toState(envStaff(), "env", `직원목록을 읽지 못했습니다. (${errorMessage(err)})`);
    }
  }

  return toState(envStaff(), "env", RUNTIME_WARNING);
}

export async function addMember(rawName: string): Promise<MemberMutation> {
  const name = normalizeName(rawName);
  if (!name) return { ok: false, error: "이름을 입력해 주세요." };
  if (name.length < 1) return { ok: false, error: "이름을 입력해 주세요." };

  const before = await listMembers();
  if (before.members.some((member) => nameKey(member) === nameKey(name))) {
    return { ok: false, error: "이미 직원 목록에 있는 이름입니다.", state: before };
  }

  const backend = sheetsBackend();
  let warning: string | undefined;

  if (backend === "none") {
    runtimeRemoved.delete(nameKey(name));
    runtimeStaff.set(nameKey(name), { name, registeredAt: todayInSeoul(), sheetId: "" });
    warning = RUNTIME_WARNING;
  } else {
    try {
      const added = await addStaffRow(name, todayInSeoul());
      runtimeRemoved.delete(nameKey(name));
      if (added.sheetId) runtimeStaff.set(nameKey(name), { name, registeredAt: todayInSeoul(), sheetId: added.sheetId });
    } catch (err) {
      return { ok: false, error: `직원을 추가하지 못했습니다. (${errorMessage(err)})`, state: before };
    }
  }

  const state = await listMembers();
  if (state.members.some((member) => nameKey(member) === nameKey(name))) return { ok: true, warning, state };

  // 시트를 다시 읽지 못한 경우에도 방금 추가한 이름은 화면에 보여 줍니다.
  const staff = [...state.staff, { name, registeredAt: todayInSeoul(), sheetId: "" }];
  return {
    ok: true,
    warning: warning ?? state.warning,
    state: { ...state, members: staff.map((row) => row.name), staff },
  };
}

export async function removeMember(rawName: string): Promise<MemberMutation> {
  const name = normalizeName(rawName);
  if (!name) return { ok: false, error: "이름을 입력해 주세요." };

  const before = await listMembers();
  if (!before.members.some((member) => nameKey(member) === nameKey(name))) {
    return { ok: false, error: "직원 목록에 없는 이름입니다.", state: before };
  }

  const key = nameKey(name);
  const backend = sheetsBackend();
  let warning: string | undefined;

  if (backend === "none") {
    runtimeStaff.delete(key);
    runtimeRemoved.add(key);
    warning = RUNTIME_WARNING;
  } else {
    try {
      const result = await removeStaffRow(name);
      if (!result.removed) {
        const reason = result.reason ?? "";
        if (/탭이 없|찾지 못/.test(reason)) {
          // 시트에 반영할 대상이 없을 때만 런타임에서 숨깁니다.
          runtimeStaff.delete(key);
          runtimeRemoved.add(key);
          warning = reason;
        } else {
          return { ok: false, error: `직원을 삭제하지 못했습니다. (${reason})`, state: before };
        }
      } else {
        runtimeStaff.delete(key);
        runtimeRemoved.delete(key);
      }
    } catch (err) {
      return { ok: false, error: `직원을 삭제하지 못했습니다. (${errorMessage(err)})`, state: before };
    }
  }

  const state = await listMembers();
  if (!state.members.some((member) => nameKey(member) === key)) return { ok: true, warning, state };

  // 시트 읽기가 늦게 반영되는 경우를 대비해 이 인스턴스에서는 바로 숨깁니다.
  runtimeRemoved.add(key);
  const staff = state.staff.filter((row) => nameKey(row.name) !== key);
  return {
    ok: true,
    warning: warning ?? state.warning,
    state: { ...state, members: staff.map((row) => row.name), staff },
  };
}
