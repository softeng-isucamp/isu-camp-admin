import { describe, expect, it } from "vitest";
import { ADMIN_LOGIN_URL, ADMIN_ORIGIN, LANDING_HOST, adminUrlFor, isLandingHost } from "./links";

describe("isLandingHost", () => {
  it("is true only on the landing host", () => {
    expect(LANDING_HOST).toBe("home.kumpas.live");
    expect(isLandingHost("home.kumpas.live")).toBe(true);
  });

  it("ignores letter case and a single trailing dot, the fully qualified form of the same host", () => {
    expect(isLandingHost("home.kumpas.live.")).toBe(true);
    expect(isLandingHost("HOME.Kumpas.Live")).toBe(true);
    expect(isLandingHost("home.kumpas.live..")).toBe(false);
  });

  it("is false on the admin host, the apex, www, localhost and look-alikes", () => {
    for (const host of ["admin.kumpas.live", "kumpas.live", "www.kumpas.live", "app.kumpas.live", "localhost", "127.0.0.1", "home.kumpas.live.evil.example", "home.kumpas.live.evil.com", "xhome.kumpas.live", "home.kumpas.live.example.", ""]) {
      expect(isLandingHost(host)).toBe(false);
    }
  });
});

describe("admin links", () => {
  it("builds the sign-in link from the admin origin", () => {
    expect(ADMIN_ORIGIN).toBe("https://admin.kumpas.live");
    expect(ADMIN_LOGIN_URL).toBe("https://admin.kumpas.live/login");
  });

  it("keeps path, query and hash when moving an address to the admin origin", () => {
    expect(adminUrlFor({ pathname: "/system-logs", search: "?q=a&category=Admin", hash: "#x" })).toBe("https://admin.kumpas.live/system-logs?q=a&category=Admin#x");
  });
});
