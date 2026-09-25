import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocationDetailsModal } from "../locations/LocationDetailsModal";
import type { Location } from "../../types";

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

describe("borrowed owner module forms", () => {
  afterEach(cleanup);

  it("submits canonical Location details without changing spatial coordinates", async () => {
    const onSubmit = vi.fn();
    render(
      <LocationDetailsModal
        location={location}
        directory={[location]}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    // Save stays disabled until the existing photo gallery has loaded.
    const saveLocation = screen.getByRole("button", { name: "Save Location" });
    await waitFor(() => expect(saveLocation).toBeEnabled());

    fireEvent.change(screen.getByRole("textbox", { name: "Location name" }), { target: { value: "Main Library Plaza" } });
    fireEvent.click(saveLocation);

    // onSubmit receives the location plus the gallery drafts it was opened with.
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: "Main Library Plaza",
      lat: 16.7205,
      lng: 121.6895,
    }), []));
  });

  it("shows latitude and longitude as greyed-out coordinate fields without a read-only notice", () => {
    render(
      <LocationDetailsModal
        location={location}
        directory={[location]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Latitude")).toHaveValue("16.720500");
    expect(screen.getByLabelText("Latitude")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Latitude")).toHaveAttribute("title", "Read-only coordinate");
    expect(screen.getByLabelText("Longitude")).toHaveValue("121.689500");
    expect(screen.getByLabelText("Longitude")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Longitude")).toHaveAttribute("title", "Read-only coordinate");
    expect(screen.queryByText(/managed in map editor/i)).not.toBeInTheDocument();
    expect(screen.queryByText("SPATIAL POSITION")).not.toBeInTheDocument();
    expect(screen.queryByText("16.720500, 121.689500")).not.toBeInTheDocument();
  });

  it("opens indoor map placement without submitting unsaved modal details", () => {
    const indoorLocation: Location = {
      ...location,
      id: "room-1",
      name: "Room 1",
      code: "ROOM-1",
      type: "Room",
      parentId: "building-1",
      building: "Administration Building",
      lat: null,
      lng: null,
      positioned: false,
    };
    const onSubmit = vi.fn();
    const onPickIndoorLocationOnMap = vi.fn();
    render(
      <LocationDetailsModal
        location={indoorLocation}
        directory={[location, indoorLocation]}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        onPickIndoorLocationOnMap={onPickIndoorLocationOnMap}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Location name" }), { target: { value: "Unsaved room name" } });
    fireEvent.click(screen.getByRole("button", { name: "Pick on map" }));

    expect(onPickIndoorLocationOnMap).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("limits map-edited building classification to Building and Facility", () => {
    render(
      <LocationDetailsModal
        location={location}
        directory={[location]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("combobox")[0].querySelectorAll("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: "Building" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Facility" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Room" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Laboratory" })).not.toBeInTheDocument();
  });

});
