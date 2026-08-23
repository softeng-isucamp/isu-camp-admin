import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Shell } from "./Shell";
import * as AuthContext from "../features/auth/AuthContext";

vi.mock("../services/api", () => ({
  services: {
    notifications: {
      list: vi.fn().mockResolvedValue([]),
      markAllRead: vi.fn().mockResolvedValue(undefined),
      markRead: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

describe("Shell Sidebar Component", () => {
  const mockLogout = vi.fn();
  const mockSession = {
    id: "usr-admin",
    username: "admin_justine",
    role: "ADMINISTRATOR",
    token: "fake-jwt",
  };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      session: mockSession,
      login: vi.fn(),
      logout: mockLogout,
      loading: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders expanded sidebar by default and shows navigation labels", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Shell>
          <div>Child Content</div>
        </Shell>
      </MemoryRouter>
    );

    const sidebar = screen.getByRole("complementary", { name: /main navigation/i });
    expect(within(sidebar).getByText("ISU-CAMP")).toBeInTheDocument();
    expect(within(sidebar).getByText("ADMIN PORTAL")).toBeInTheDocument();
    expect(within(sidebar).getByText("Dashboard Overview")).toBeInTheDocument();
    expect(within(sidebar).getByText("Map Editor")).toBeInTheDocument();
    expect(within(sidebar).getByText("Locations")).toBeInTheDocument();
    expect(within(sidebar).getByText("admin_justine")).toBeInTheDocument();

    const toggleBtn = within(sidebar).getByRole("button", { name: /minimize sidebar/i });
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveTextContent("«");
  });

  it("toggles to minimized state, updates localStorage, and adjusts UI", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Shell>
          <div>Child Content</div>
        </Shell>
      </MemoryRouter>
    );

    const sidebar = screen.getByRole("complementary", { name: /main navigation/i });
    const toggleBtn = within(sidebar).getByRole("button", { name: /minimize sidebar/i });
    await user.click(toggleBtn);

    expect(localStorage.getItem("isucamp_sidebar_minimized")).toBe("true");

    const expandBtn = within(sidebar).getByRole("button", { name: /expand sidebar/i });
    expect(expandBtn).toHaveTextContent("»");

    expect(within(sidebar).queryByText("ADMIN PORTAL")).not.toBeInTheDocument();
  });

  it("initializes from localStorage minimized state", () => {
    localStorage.setItem("isucamp_sidebar_minimized", "true");

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Shell>
          <div>Child Content</div>
        </Shell>
      </MemoryRouter>
    );

    const sidebar = screen.getByRole("complementary", { name: /main navigation/i });
    const expandBtn = within(sidebar).getByRole("button", { name: /expand sidebar/i });
    expect(expandBtn).toBeInTheDocument();
    expect(expandBtn).toHaveTextContent("»");
  });

  it("opens profile popover in minimized mode and allows signing out", async () => {
    localStorage.setItem("isucamp_sidebar_minimized", "true");
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Shell>
          <div>Child Content</div>
        </Shell>
      </MemoryRouter>
    );

    const sidebar = screen.getByRole("complementary", { name: /main navigation/i });
    const avatarBtn = within(sidebar).getByRole("button", { name: /open user profile menu/i });
    await user.click(avatarBtn);

    const popover = within(sidebar).getByRole("dialog", { name: /user details/i });
    expect(popover).toBeInTheDocument();
    expect(within(popover).getByText("admin_justine")).toBeInTheDocument();

    const signOutBtn = within(popover).getByRole("button", { name: /sign out/i });
    await user.click(signOutBtn);

    expect(screen.getByText("Sign out?")).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: /^sign out$/i });
    await user.click(confirmBtn);

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
