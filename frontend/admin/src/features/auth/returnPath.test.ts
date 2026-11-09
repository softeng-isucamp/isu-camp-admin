import { describe, expect, it } from "vitest";
import { links } from "../../components/Shell";
import { ADMIN_PAGES, landingAfterSignIn } from "./returnPath";

const from = (pathname: string, search = "", hash = "") => ({ from: { pathname, search, hash } });

describe("landingAfterSignIn", () => {
  it("covers every page in the sidebar, so a return never skips one", () => {
    for (const link of links) expect(ADMIN_PAGES).toContain(link.to);
  });

  it("returns to the page the guard turned away from, with its query and hash", () => {
    expect(landingAfterSignIn(from("/users"))).toBe("/users");
    expect(landingAfterSignIn(from("/system-logs", "?q=admin_justine&category=Admin"))).toBe("/system-logs?q=admin_justine&category=Admin");
    expect(landingAfterSignIn(from("/profile", "", "#backups"))).toBe("/profile#backups");
  });

  it.each([
    ["no state", undefined],
    ["a state without a from", { username: "admin_justine" }],
    ["an external address", from("https://evil.example/steal")],
    ["a protocol-relative address", from("//evil.example")],
    ["the sign-in page", from("/login")],
    ["a recovery page", from("/forgot-password")],
    ["the username recovery page", from("/forgot-username")],
    ["an unknown page", from("/nowhere")],
    ["a page with a trailing slash", from("/users/")],
    ["the root", from("/")],
  ])("falls back to the Dashboard for %s", (_label, state) => {
    expect(landingAfterSignIn(state)).toBe("/dashboard");
  });

  it("drops a query or hash that is not a plain query or fragment", () => {
    expect(landingAfterSignIn(from("/users", "tab=admins"))).toBe("/users");
    expect(landingAfterSignIn(from("/users", "?tab=admins evil", "x"))).toBe("/users");
  });
});
