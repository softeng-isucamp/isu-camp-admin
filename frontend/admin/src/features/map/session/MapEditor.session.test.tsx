import { cleanup, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../../services/api";
import { useMapEditorTestLifecycle, renderEditor, clickMap, choosePathwayEditor } from "../testing/mapEditorTestHarness";

vi.mock("leaflet", async () => (await import("../testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("../testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../../services/api", async () => (await import("../testing/mapEditorMocks")).apiMock());
vi.mock("../../auth/AuthContext", async () => (await import("../testing/mapEditorMocks")).authContextMock());

describe("Map Editor preview", () => {
  useMapEditorTestLifecycle();

  it("restores an in-progress polygon draft after a browser refresh", async () => {
    localStorage.clear();
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.7201, 121.6891);
    clickMap(16.7202, 121.6892);
    expect(screen.getByText("Points plotted: 2")).toBeInTheDocument();

    cleanup();
    renderEditor();

    expect(screen.getByRole("button", { name: "Building Polygon" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Points plotted: 2")).toBeInTheDocument();
  });

  it("keeps an interrupted polygon draft on the suspended shelf and resumes it", async () => {
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.7201, 121.6891);
    expect(screen.getByText("Points plotted: 1")).toBeInTheDocument();

    await choosePathwayEditor();
    const firstPrompt = screen.getByRole("dialog", { name: "Switch to Pathway?" });
    fireEvent.click(screen.getByRole("button", { name: "Continue Editing" }));

    expect(firstPrompt).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Building Polygon" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Points plotted: 1")).toBeInTheDocument();

    await choosePathwayEditor();
    fireEvent.click(screen.getByRole("button", { name: "Keep Draft for Later (Suspend)" }));

    expect(screen.getByRole("button", { name: "Pathway" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Suspended Drafts (1)" }));
    const shelf = screen.getByRole("dialog", { name: "Suspended Drafts" });
    expect(shelf).toHaveTextContent("Building Polygon draft");

    fireEvent.click(screen.getByRole("button", { name: "Resume Building Polygon draft" }));
    expect(screen.getByRole("button", { name: "Building Polygon" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Points plotted: 1")).toBeInTheDocument();
  });

  it("restores the selected Path Point and drag mode when resuming a suspended pathway", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897]] },
    ]);
    renderEditor();

    await screen.findByTestId("path-geometry");
    await choosePathwayEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Path Point at 16.7207,121.6897" }));
    fireEvent.change(screen.getByLabelText("Path Point latitude"), { target: { value: "16.7209" } });

    fireEvent.click(screen.getByRole("button", { name: "Building Polygon" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep Draft for Later (Suspend)" }));
    fireEvent.click(screen.getByRole("button", { name: "Suspended Drafts (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume Pathway draft" }));

    expect(screen.getByTestId("path-point-marker")).toHaveAttribute("data-draggable", "true");
    expect(screen.getByLabelText("Path Point latitude")).toHaveValue(16.7209);
  });

  it("suspends and restores polygon draft with all fields preserved", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);

    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Suspended Building" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "SUSP-01" } });
    fireEvent.change(screen.getByLabelText("Building function"), { target: { value: "Administration" } });
    fireEvent.change(screen.getByLabelText("Building keywords"), { target: { value: "admin, office" } });

    // Switch to pathway tool to trigger suspend modal
    await choosePathwayEditor();
    expect(screen.getByRole("dialog", { name: "Switch to Pathway?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keep Draft for Later (Suspend)" }));
    expect(screen.getByRole("button", { name: "Pathway" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Suspended Drafts (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume Building Polygon draft" }));
    expect(screen.getByLabelText("Building name")).toHaveValue("Suspended Building");
    expect(screen.getByLabelText("Building code")).toHaveValue("SUSP-01");
    expect(screen.getByLabelText("Building function")).toHaveValue("Administration");
    expect(screen.getByLabelText("Building keywords")).toHaveValue("admin, office");
  });
});
