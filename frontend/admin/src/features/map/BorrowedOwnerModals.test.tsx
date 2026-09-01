import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocationDetailsModal } from "../locations/LocationDetailsModal";
import { RouteDetailsModal } from "../routes/RouteDetailsModal";
import type { Location, Pathway, RouteNode } from "../../types";

const location: Location = {
  id: "loc-1",
  name: "Library Plaza",
  code: "LIB-PLZ",
  type: "Facility",
  parentId: null,
  function: "Outdoor gathering space",
  keywords: "library, plaza",
  status: "Active",
  lat: 16.7205,
  lng: 121.6895,
  positioned: true,
};

const nodes: RouteNode[] = [
  { id: "node-a", name: "North Entrance", nodeType: "Entrance", lat: 16.72, lng: 121.68 },
  { id: "node-b", name: "South Junction", nodeType: "Junction", lat: 16.73, lng: 121.69 },
];

const pathway: Pathway = {
  id: "path-1",
  name: "Library Walk",
  sourceNodeId: "node-a",
  destinationNodeId: "node-b",
  distance: "45 m",
  time: "1 min",
  shade: "Mostly Shaded",
  type: "Walkway",
  direction: "Two-way",
  status: "Open",
  pathPoints: [],
};

describe("borrowed owner module forms", () => {
  afterEach(cleanup);

  it("submits canonical Location details without changing spatial coordinates", () => {
    const onSubmit = vi.fn();
    render(
      <LocationDetailsModal
        location={location}
        directory={[location]}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Location name" }), { target: { value: "Main Library Plaza" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: "Main Library Plaza",
      lat: 16.7205,
      lng: 121.6895,
    }));
  });

  it("submits the Routes & Paths pathway form through its owner model", () => {
    const onSubmit = vi.fn();
    render(
      <RouteDetailsModal
        entity={{ kind: "pathway", value: pathway }}
        nodes={nodes}
        locations={[location]}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("NOTES"), { target: { value: "Accessible Library Walk" } });
    expect(screen.getByLabelText("SOURCE")).toBeDisabled();
    expect(screen.getByLabelText("DESTINATION")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: "Accessible Library Walk",
      sourceNodeId: "node-a",
      destinationNodeId: "node-b",
    }));
  });

  it("edits Entrance Route Node ownership details without exposing coordinates", () => {
    const entrance: RouteNode = {
      ...nodes[0],
      associatedPlaceId: "loc-1",
    };
    const onSubmit = vi.fn();
    render(
      <RouteDetailsModal
        entity={{ kind: "route_node", value: entrance }}
        nodes={nodes}
        locations={[{ ...location, type: "Building" }]}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /NODE NAME/ }), { target: { value: "Library Main Entrance" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Route Node" }));

    expect(screen.queryByLabelText("LATITUDE")).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: "Library Main Entrance",
      lat: entrance.lat,
      lng: entrance.lng,
    }));
  });
});
