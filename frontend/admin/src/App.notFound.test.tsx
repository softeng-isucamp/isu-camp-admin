import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as AuthContext from "./features/auth/AuthContext";
import { signInAs } from "./test/session";
import { MissingRoute } from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderMissing = () => render(<MemoryRouter initialEntries={["/nowhere"]}><MissingRoute /></MemoryRouter>);

describe("unknown page", () => {
  it("signed in, shows inside the sidebar layout with both ways out", () => {
    signInAs("admin");
    renderMissing();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Back to Login" })).toHaveAttribute("href", "/login");
  });

  it("signed out, offers only Back to Login and no sidebar", () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      session: null, login: vi.fn(), logout: vi.fn(), loading: false, updateSession: vi.fn(), refreshSession: vi.fn(),
    });
    renderMissing();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Go to Dashboard" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Login" })).toHaveClass("btn-primary");
  });
});
