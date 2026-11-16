import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { services } from "./services/api";
import type { Session } from "./types";

const SESSION: Session = { id: "1", username: "admin_justine", email: "admin@isu.edu.ph", role: "superadmin" } as Session;

function renderApp(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
    </QueryClientProvider>,
  );
}

/** jsdom has neither observers nor media queries; the landing page needs both. */
beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null,
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const landingHeading = () => screen.findByRole("heading", { level: 1, name: /Stop guessing/ });
const userAgent = (ua: string) => vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);

describe("the public landing page at /home (local dev and preview)", () => {
  it("renders for a signed-out visitor, with Admin sign in going to /login", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/home");
    await landingHeading();
    for (const link of screen.getAllByRole("link", { name: "Admin sign in" })) expect(link).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("link", { name: "Go to dashboard" })).not.toBeInTheDocument();
  });

  it("needs no guard, shows a signed-in administrator, and offers Go to dashboard", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(SESSION);
    renderApp("/home");
    await landingHeading();
    for (const link of screen.getAllByRole("link", { name: "Go to dashboard" })) expect(link).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: "Admin sign in" })).not.toBeInTheDocument();
    expect(document.querySelector(".crumb b")).toBeNull();
  });

  it("keeps the OpenStreetMap attribution visible", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/home");
    await landingHeading();
    expect(screen.getByText("Campus map data © OpenStreetMap contributors")).toBeInTheDocument();
  });

  it("overrides the admin body min-width only while mounted", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    document.body.style.minWidth = "1080px";
    const view = renderApp("/home");
    await landingHeading();
    expect(document.body.style.minWidth).toBe("0");
    view.unmount();
    expect(document.body.style.minWidth).toBe("1080px");
    document.body.style.minWidth = "";
  });

  it("leads with the web app and a link to the APK QR on a desktop", async () => {
    userAgent("Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0");
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/home");
    await landingHeading();
    expect(screen.getAllByRole("link", { name: /Open the web app/ })[0]).toHaveAttribute("href", "https://www.kumpas.live");
    expect(screen.getAllByRole("link", { name: /Get the Android app/ })[0]).toHaveAttribute("href", "#download");
    expect(screen.getByRole("img", { name: /QR code that downloads the Kumpas Android APK/ })).toBeInTheDocument();
  });

  it("leads with the APK on Android", async () => {
    userAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile");
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/home");
    await landingHeading();
    expect(screen.getAllByRole("link", { name: /Download for Android/ })[0]).toHaveAttribute("href", "https://github.com/softeng-isucamp/isu-camp-app/releases/latest/download/app-release.apk");
  });

  it("offers only the web app on an iPhone", async () => {
    userAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1");
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/home");
    await landingHeading();
    expect(document.querySelector('a[href$="app-release.apk"]')).toBeNull();
    expect(screen.queryByRole("img", { name: /QR code that downloads the Kumpas Android APK/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Open the web app/ })[0]).toHaveAttribute("href", "https://www.kumpas.live");
  });

  it("names the web app host in the QR label, its caption and the download card", async () => {
    userAgent("Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0");
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/home");
    await landingHeading();
    expect(screen.getByRole("img", { name: "QR code that opens www.kumpas.live" })).toBeInTheDocument();
    expect(screen.getByText("Scan to open www.kumpas.live")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^Open www\.kumpas\.live/ })[0]).toHaveAttribute("href", "https://www.kumpas.live");
    expect(document.body.textContent).not.toContain("app.kumpas.live");
  });

  it("sets viewport-fit=cover and a theme colour only while mounted", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    const meta = document.createElement("meta");
    meta.name = "viewport";
    meta.content = "width=device-width, initial-scale=1.0";
    document.head.appendChild(meta);
    const view = renderApp("/home");
    await landingHeading();
    expect(meta.content).toBe("width=device-width, initial-scale=1.0, viewport-fit=cover");
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute("content", "#0a2b1c");
    view.unmount();
    expect(meta.content).toBe("width=device-width, initial-scale=1.0");
    expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
    meta.remove();
  });

  it("shows the chosen step's text in the phone caption", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/home");
    await landingHeading();
    const caption = document.querySelector(".lp-how-caption") as HTMLElement;
    expect(caption).toHaveAttribute("aria-hidden", "true");
    expect(caption.textContent).toContain("Ask the way you would ask a friend");
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    expect(caption.textContent).toContain("See the walk before you take it");
    expect(caption.textContent).not.toContain("Ask the way you would ask a friend");
  });

  it("keeps the QR mention in its own span so phones, which hide the QR, can drop it", async () => {
    userAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile");
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/home");
    await landingHeading();
    const mention = document.querySelector(".lp-dl-qr-mention");
    expect(mention?.textContent).toBe(" or the QR code");
    expect(mention?.closest("li")?.textContent).toBe("Download the APK from the button below or the QR code.");
  });

  it("marks the unconfirmed FAQ answers visibly", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/home");
    await landingHeading();
    expect(document.querySelectorAll(".lp-confirm").length).toBeGreaterThan(0);
  });
});

describe("scroll reveal fails open", () => {
  it("shows the content when the observer never reports", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/home");
    await landingHeading();
    const root = document.querySelector(".lp")!;
    expect(root).toHaveClass("lp-reveal-on");
    await waitFor(() => expect(root).not.toHaveClass("lp-reveal-on"), { timeout: 2500 });
  });

  it("shows the content when the preference changes to reduced motion after mount", async () => {
    const listeners: Array<() => void> = [];
    let reduced = false;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() { return reduced && query.includes("reduce"); }, media: query,
      addEventListener: (_: string, fn: () => void) => { if (query.includes("reduce")) listeners.push(fn); }, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null,
    }));
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/home");
    await landingHeading();
    const root = document.querySelector(".lp")!;
    expect(root).toHaveClass("lp-reveal-on");
    reduced = true;
    act(() => listeners.forEach(fn => fn()));
    expect(root).not.toHaveClass("lp-reveal-on");
  });
});

describe("the landing host (home.kumpas.live)", () => {
  const replace = vi.fn();
  beforeEach(() => {
    replace.mockClear();
    vi.stubGlobal("location", { ...window.location, hostname: "home.kumpas.live", replace });
  });

  it("shows the landing at /, never asks for a session, and links to the admin host's sign-in", async () => {
    const me = vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/");
    await landingHeading();
    expect(me).not.toHaveBeenCalled();
    const links = screen.getAllByRole("link", { name: "Admin sign in" });
    expect(links.length).toBeGreaterThan(1);
    for (const link of links) expect(link).toHaveAttribute("href", "https://admin.kumpas.live/login");
    expect(screen.queryByRole("link", { name: "Go to dashboard" })).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    ["/login", "https://admin.kumpas.live/login"],
    ["/dashboard", "https://admin.kumpas.live/dashboard"],
    ["/system-logs?q=a#b", "https://admin.kumpas.live/system-logs?q=a#b"],
  ])("sends %s to the admin origin with a full-page redirect", async (path, target) => {
    const me = vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp(path);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(target));
    expect(me).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { level: 1, name: /Stop guessing/ })).not.toBeInTheDocument();
  });
});

describe("the admin host", () => {
  beforeEach(() => {
    vi.stubGlobal("location", { ...window.location, hostname: "admin.kumpas.live" });
  });

  it("redirects / to the dashboard for a signed-in administrator", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(SESSION);
    renderApp("/");
    await waitFor(() => expect(document.querySelector(".crumb b")).toHaveTextContent("Dashboard Overview"));
  });

  it("sends / to sign-in when signed out", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/");
    expect(await screen.findByPlaceholderText("Enter your username")).toBeInTheDocument();
  });

  it("/home checks the session: signed out gets an in-app /login link", async () => {
    const me = vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/home");
    await landingHeading();
    expect(me).toHaveBeenCalled();
    for (const link of screen.getAllByRole("link", { name: "Admin sign in" })) expect(link).toHaveAttribute("href", "/login");
  });

  it("/home checks the session: signed in gets Go to dashboard", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(SESSION);
    renderApp("/home");
    await landingHeading();
    for (const link of screen.getAllByRole("link", { name: "Go to dashboard" })) expect(link).toHaveAttribute("href", "/dashboard");
  });
});

describe("the admin pages are still behind the guard", () => {
  it("sends a signed-out visitor from /dashboard to sign-in, not to the landing page", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/dashboard");
    expect(await screen.findByPlaceholderText("Enter your username")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: /Stop guessing/ })).not.toBeInTheDocument();
  });

  it("signing in at /login lands on /dashboard, not the landing page", async () => {
    vi.spyOn(services.auth, "me").mockResolvedValue(null);
    renderApp("/login");
    fireEvent.change(await screen.findByPlaceholderText("Enter your username"), { target: { value: "admin_justine" } });
    fireEvent.change(screen.getByPlaceholderText("Enter your password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /login/i }));
    await waitFor(() => expect(document.querySelector(".crumb b")).toHaveTextContent("Dashboard Overview"));
    expect(screen.queryByRole("heading", { level: 1, name: /Stop guessing/ })).not.toBeInTheDocument();
  });
});
