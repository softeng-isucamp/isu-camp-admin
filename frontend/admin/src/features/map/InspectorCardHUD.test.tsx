import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InspectorCardHUD, type InspectorCardModel } from "./InspectorCardHUD";

const baseObject = (): InspectorCardModel => ({
  id: "feature-1",
  kind: "local_map_feature",
  title: "Engineering West Parking Lot",
  domain: "Local Map Data",
  status: "Active Parking Area",
  summary: [
    { label: "Geometry", value: "Polygon" },
    { label: "Area", value: "1,420 m²" },
  ],
  primaryAction: {
    label: "▱ Reshape Boundary",
    onSelect: vi.fn(),
  },
  overflowActions: [
    { label: "✎ Edit Details", onSelect: vi.fn() },
    { label: "Retire Feature", tone: "danger", onSelect: vi.fn() },
  ],
  provenance: {
    osmId: "way/74920194",
    osmVersion: 4,
    importedAt: "2026-08-15T08:30:00Z",
    license: "ODbL (OpenStreetMap contributors)",
    rawTags: { amenity: "parking", surface: "asphalt" },
  },
});

describe("InspectorCardHUD", () => {
  afterEach(cleanup);

  it("shows identity, domain authority, one primary CTA, and overflow actions", () => {
    const object = baseObject();
    render(<InspectorCardHUD object={object} onClose={vi.fn()} />);

    const card = screen.getByRole("complementary", { name: "Engineering West Parking Lot object details" });
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass("map-glass-panel");
    expect(screen.getByText("[Local Map Data]")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "▱ Reshape Boundary" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "✎ Edit Details" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More actions for Engineering West Parking Lot" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✎ Edit Details" }));
    expect(object.overflowActions[0].onSelect).toHaveBeenCalledOnce();
  });

  it("reveals complete OSM source lineage on demand", () => {
    render(<InspectorCardHUD object={baseObject()} onClose={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: "Source Lineage & OSM Tags" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("way/74920194")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("way/74920194")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("2026-08-15T08:30:00Z")).toBeInTheDocument();
    expect(screen.getByText("ODbL (OpenStreetMap contributors)")).toBeInTheDocument();
    expect(screen.getByText("amenity")).toBeInTheDocument();
    expect(screen.getByText("parking")).toBeInTheDocument();
  });

  it("makes basemap objects visibly read-only and explains disabled edits", () => {
    const object = baseObject();
    object.readOnly = true;
    object.primaryAction = {
      label: "▱ Reshape Boundary",
      disabled: true,
      disabledReason: "Imported basemap context cannot be edited in the Map Editor.",
      onSelect: vi.fn(),
    };
    object.overflowActions[0] = {
      ...object.overflowActions[0],
      disabled: true,
      disabledReason: "Imported basemap context cannot be edited in the Map Editor.",
    };

    render(<InspectorCardHUD object={object} onClose={vi.fn()} />);

    expect(screen.getByText("[🔒 Read-Only Basemap]")).toBeInTheDocument();
    const primary = screen.getByRole("button", { name: "▱ Reshape Boundary" });
    expect(primary).toBeDisabled();
    expect(primary).toHaveAttribute("title", "Imported basemap context cannot be edited in the Map Editor.");

    fireEvent.click(screen.getByRole("button", { name: "More actions for Engineering West Parking Lot" }));
    expect(screen.getByRole("menuitem", { name: "✎ Edit Details" })).toBeDisabled();
  });
});
