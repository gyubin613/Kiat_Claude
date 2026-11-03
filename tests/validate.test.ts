import { describe, expect, it } from "vitest";
import { evaluationPatch, evaluatorInput, evaluatorPatch, responseInput } from "@/lib/validate";

describe("입력값 검증", () => {
  it("부분 수정 시 보내지 않은 항목에 기본값을 채우지 않는다", () => {
    expect(evaluatorPatch.parse({ phone: "010-1", version: 1 })).toEqual({ phone: "010-1", version: 1 });
    expect(evaluationPatch.parse({ seats: 3, version: 2 })).toEqual({ seats: 3, version: 2 });
  });
  it("엑셀 빈 칸은 null 로 처리", () => {
    const v = evaluatorInput.parse({ name: "홍길동", pastInvited: "", preference: "" });
    expect(v.pastInvited).toBeNull();
    expect(v.preference).toBeNull();
    expect(v.email).toBe("");
  });
  it("참여 횟수 > 초청 횟수는 오류", () => {
    expect(evaluatorInput.safeParse({ name: "a", pastInvited: 1, pastAttended: 3 }).success).toBe(false);
  });
  it("참석 가능인데 일정 미선택이면 오류, 불참은 일정 없이 가능", () => {
    expect(responseInput.safeParse({ attendance: "yes", slotIds: [] }).success).toBe(false);
    expect(responseInput.safeParse({ attendance: "no" }).success).toBe(true);
    expect(responseInput.safeParse({ attendance: "conditional", slotIds: ["s"], note: "" }).success).toBe(false);
  });
});
