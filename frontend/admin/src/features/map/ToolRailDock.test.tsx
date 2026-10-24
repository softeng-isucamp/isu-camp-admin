import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signInAs } from "../../test/session";
import { allPermissions, viewOnlyPermissions } from "../../lib/permissions";
import { ToolRailDock } from "./ToolRailDock";

const renderRail = (session: Parameters<typeof signInAs>, onBrowseWalkingNetwork = vi.fn()) => {
  signInAs(...session);
  render(
    <ToolRailDock activeTool="select" onSelectTool={vi.fn()} onBrowseWalkingNetwork={onBrowseWalkingNetwork} suspendedDrafts={[]} onResumeDraft={vi.fn()} />,
  );
  return { onBrowseWalkingNetwork };
};
const toolNames = () => screen.getAllByRole("button").map((button) => button.textContent?.replace(/^[^A-Za-z]+/, "") ?? "");

describe("ToolRailDock", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("offers every tool to an administrator who may add", () => {
    renderRail(["admin", { permissions: allPermissions() }]);
    expect(screen.getByRole("button", { name: /Route Node/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Building Polygon/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pathway/ })).toBeInTheDocument();
  });

  it("keeps Select and a way into Browse Walking Network, and no mutation tools without Add or Edit", () => {
    const { onBrowseWalkingNetwork } = renderRail(["admin", { permissions: viewOnlyPermissions() }]);

    expect(screen.getByRole("button", { name: /Select/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Route Node/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Building Polygon/ })).not.toBeInTheDocument();
    expect(toolNames()).toContain("Walking Network");

    fireEvent.click(screen.getByRole("button", { name: /Walking Network/ }));
    expect(screen.getByRole("menuitem", { name: "Browse Walking Network" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Create or edit Pathway" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Browse Walking Network" }));
    expect(onBrowseWalkingNetwork).toHaveBeenCalledOnce();
  });

  it("treats a session that reports no switches as allowed to add", () => {
    renderRail(["admin"]);
    expect(screen.getByRole("button", { name: /Route Node/ })).toBeInTheDocument();
  });

  it("shows a view-only administrator the same trimmed rail", () => {
    renderRail(["admin", { permissions: viewOnlyPermissions() }]);
    expect(screen.queryByRole("button", { name: /Route Node/ })).not.toBeInTheDocument();
  });
});

describe("Pathway menu permission wording", () => {
  afterEach(cleanup);
  it.each([
    [true, false, "Create Pathway"],
    [false, true, "Edit Pathway"],
    [true, true, "Create or edit Pathway"],
  ] as const)("labels Add=%s, Edit=%s as %s", (add, edit, label) => {
    renderRail(["admin", { permissions: { ...viewOnlyPermissions(), add, edit } }]);
    fireEvent.click(screen.getByRole("button", { name: "Pathway" }));
    expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
  });
});
