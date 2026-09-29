import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMapEditorTestLifecycle, renderEditor } from "../testing/mapEditorTestHarness";

vi.mock("leaflet", async () => (await import("../testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("../testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../../services/api", async () => (await import("../testing/mapEditorMocks")).apiMock());
vi.mock("../../auth/AuthContext", async () => (await import("../testing/mapEditorMocks")).authContextMock());

describe("Map Editor preview", () => {
  useMapEditorTestLifecycle();

  it("does not render imported local map features", async () => {
    renderEditor();

    expect(screen.queryByRole("button", { name: "local-feature-feat-poly-water-pond-01" })).not.toBeInTheDocument();
    expect(screen.queryByText("Campus Aquaculture Lagoon")).not.toBeInTheDocument();
  });
});
