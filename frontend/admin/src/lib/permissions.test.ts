import { describe, expect, it } from "vitest";
import {
  PERMISSION_ACTIONS, allPermissions, canPerform, readPermissions, samePermissions, viewOnlyPermissions,
} from "./permissions";

const actions = PERMISSION_ACTIONS.map(({ key }) => key);

describe("canPerform", () => {
  it("lets a superadmin do everything, whatever switches the record carries", () => {
    for (const action of actions) {
      expect(canPerform({ role: "superadmin" }, action)).toBe(true);
      expect(canPerform({ role: "superadmin", permissions: viewOnlyPermissions() }, action)).toBe(true);
    }
  });

  it("follows a regular administrator's own switch, one action at a time", () => {
    const admin = { role: "admin" as const, permissions: { add: true, edit: false, delete: true, changeUserStatus: false } };
    expect(canPerform(admin, "add")).toBe(true);
    expect(canPerform(admin, "edit")).toBe(false);
    expect(canPerform(admin, "delete")).toBe(true);
    expect(canPerform(admin, "changeUserStatus")).toBe(false);
  });

  it("allows nothing to a view-only administrator", () => {
    for (const action of actions) expect(canPerform({ role: "admin", permissions: viewOnlyPermissions() }, action)).toBe(false);
  });

  it("treats a session without reported permissions as everything allowed, until the backend sends them", () => {
    for (const action of actions) {
      expect(canPerform({ role: "admin" }, action)).toBe(true);
      expect(canPerform({}, action)).toBe(true);
    }
  });

  it("allows nothing when nobody is signed in", () => {
    for (const action of actions) {
      expect(canPerform(null, action)).toBe(false);
      expect(canPerform(undefined, action)).toBe(false);
    }
  });
});

describe("readPermissions", () => {
  it("keeps explicit booleans", () => {
    expect(readPermissions({ add: true, edit: false, delete: true, changeUserStatus: false }))
      .toEqual({ add: true, edit: false, delete: true, changeUserStatus: false });
  });

  it("reads anything that is not an explicit true as off, so a partial record never grants", () => {
    expect(readPermissions({ add: true, edit: "yes", delete: 1 })).toEqual({ add: true, edit: false, delete: false, changeUserStatus: false });
  });

  it("reports nothing for a missing, null or non-object value", () => {
    for (const raw of [undefined, null, "all", 3, ["add"]]) expect(readPermissions(raw)).toBeUndefined();
  });
});

describe("presets", () => {
  it("has a switch on for every action in all-permissions and off in view-only", () => {
    for (const action of actions) {
      expect(allPermissions()[action]).toBe(true);
      expect(viewOnlyPermissions()[action]).toBe(false);
    }
  });

  it("compares two sets switch by switch", () => {
    expect(samePermissions(allPermissions(), allPermissions())).toBe(true);
    expect(samePermissions(allPermissions(), { ...allPermissions(), delete: false })).toBe(false);
  });
});
