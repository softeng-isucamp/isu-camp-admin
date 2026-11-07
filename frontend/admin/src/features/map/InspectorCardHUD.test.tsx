import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InspectorCardHUD, type InspectorCardModel } from "./InspectorCardHUD";

const baseObject = (): InspectorCardModel => ({
  id: "building-1",
  kind: "building",
  title: "Engineering West Hall",
  domain: "Locations",
  status: "Active",
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

    const card = screen.getByRole("complementary", { name: "Engineering West Hall object details" });
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass("map-glass-panel");
    expect(screen.getByText("[Locations]")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "▱ Reshape Boundary" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "✎ Edit Details" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More actions for Engineering West Hall" }));
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

    fireEvent.click(screen.getByRole("button", { name: "More actions for Engineering West Hall" }));
    expect(screen.getByRole("menuitem", { name: "✎ Edit Details" })).toBeDisabled();
  });

  it("drops the ⋯ trigger when no overflow action is left, keeping the primary action and close", () => {
    render(<InspectorCardHUD object={{ ...baseObject(), overflowActions: [] }} onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "More actions for Engineering West Hall" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "▱ Reshape Boundary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear object selection" })).toBeInTheDocument();
  });

  describe("overflow menu keyboard", () => {
    const withDelete = (): InspectorCardModel => ({
      ...baseObject(),
      overflowActions: [
        { label: "✎ Edit Details", onSelect: vi.fn() },
        { label: "▱ Reshape Footprint", onSelect: vi.fn() },
        { label: "🗑 Delete Building", tone: "danger", separatorBefore: true, onSelect: vi.fn() },
      ],
    });
    const openMenu = () => {
      render(<InspectorCardHUD object={withDelete()} onClose={vi.fn()} />);
      const trigger = screen.getByRole("button", { name: "More actions for Engineering West Hall" });
      fireEvent.click(trigger);
      return trigger;
    };

    it("moves focus to the first item on open and sets Delete apart with a separator", () => {
      openMenu();
      expect(screen.getByRole("menuitem", { name: "✎ Edit Details" })).toHaveFocus();
      const separator = screen.getByRole("separator");
      expect(separator.nextElementSibling).toHaveTextContent("Delete Building");
    });

    it("moves between items with ArrowDown and ArrowUp, wrapping at the ends", () => {
      openMenu();
      const menu = screen.getByRole("menu");
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      expect(screen.getByRole("menuitem", { name: "▱ Reshape Footprint" })).toHaveFocus();
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
      expect(screen.getByRole("menuitem", { name: "🗑 Delete Building" })).toHaveFocus();
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
      expect(screen.getByRole("menuitem", { name: "✎ Edit Details" })).toHaveFocus();
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
      expect(screen.getByRole("menuitem", { name: "🗑 Delete Building" })).toHaveFocus();
    });

    it("closes on Escape, returns focus to the trigger, and never lets the map's Escape shortcut see it", () => {
      const mapEscape = vi.fn();
      window.addEventListener("keydown", mapEscape);
      const trigger = openMenu();
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(mapEscape).not.toHaveBeenCalled();

      // With no menu open, Escape still reaches the map (it cancels the active tool or clears the selection).
      fireEvent.keyDown(trigger, { key: "Escape" });
      expect(mapEscape).toHaveBeenCalledOnce();
      window.removeEventListener("keydown", mapEscape);
    });

    it("closes on Tab", () => {
      const trigger = openMenu();
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });
  });

  it("resets the card scroll to the top when another object is selected, but not while the same object is edited", () => {
    const { rerender } = render(<InspectorCardHUD object={baseObject()} onClose={vi.fn()} />);
    const card = screen.getByRole("complementary", { name: "Engineering West Hall object details" });
    card.scrollTop = 120;
    rerender(<InspectorCardHUD object={{ ...baseObject(), status: "Edited" }} onClose={vi.fn()} />);
    expect(card.scrollTop).toBe(120);

    rerender(<InspectorCardHUD object={{ ...baseObject(), id: "building-2", title: "Other" }} onClose={vi.fn()} />);
    expect(screen.getByRole("complementary", { name: "Other object details" }).scrollTop).toBe(0);

    screen.getByRole("complementary", { name: "Other object details" }).scrollTop = 80;
    rerender(<InspectorCardHUD object={{ ...baseObject(), id: "building-2", kind: "campus_location", title: "Other" }} onClose={vi.fn()} />);
    expect(screen.getByRole("complementary", { name: "Other object details" }).scrollTop).toBe(0);
  });

  it("shows a quiet View only note in the header when the model says so", () => {
    render(<InspectorCardHUD object={{ ...baseObject(), viewOnly: true, overflowActions: [] }} onClose={vi.fn()} />);
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /More actions/ })).not.toBeInTheDocument();
  });
});
