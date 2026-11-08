import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { POINT_MARKER_Z_OFFSET, PathwayDraftLayer } from "./PathwayMapLayers";

vi.mock("leaflet", () => ({ default: { divIcon: (options: object) => options } }));
vi.mock("react-leaflet", () => ({
  // Records what each marker would hand to Leaflet: the stacking offset, the title and its handlers.
  Marker: ({ title, zIndexOffset, eventHandlers, icon }: { title?: string; zIndexOffset?: number; eventHandlers?: { click?: () => void; add?: (event: { target: unknown }) => void }; icon?: { className?: string } }) => (
    <button data-testid="marker" data-kind={icon?.className} data-z={zIndexOffset} title={title} onClick={eventHandlers?.click}
      ref={(element) => { if (element) eventHandlers?.add?.({ target: { getElement: () => element } }); }} />
  ),
  Polyline: () => null,
  Tooltip: () => null,
}));

const nodes = [
  { id: "a", name: "A", nodeType: "Junction", lat: 0, lng: 0, status: "Active", associatedPlaceId: null },
  { id: "b", name: "B", nodeType: "Junction", lat: 0, lng: 0.002, status: "Active", associatedPlaceId: null },
];

function renderLayer() {
  const pathway = {
    activePathway: { id: "p1", sourceNodeId: "a", destinationNodeId: "b" },
    editingPathId: "p1", pathPoints: [[0, 0.001]], setPathPoints: vi.fn(), selectedPathPointIndex: null,
    setSelectedPathPointIndex: vi.fn(), setPathDraftDirty: vi.fn(), setPathPointDragPreview: vi.fn(), insertPathPoint: vi.fn(), canModify: true,
  };
  const onSelect = vi.fn();
  render(<PathwayDraftLayer pathway={pathway as never} nodes={nodes as never} mode="path" campusBoundary={[]} isOverviewZoom={false} onSelect={onSelect} onError={vi.fn()} />);
  return { pathway, onSelect };
}

describe("Path point markers and split handles", () => {
  it("stack existing path points above every split handle, so a point on a midpoint wins the click", () => {
    renderLayer();
    const markers = screen.getAllByTestId("marker");
    const point = markers.find((marker) => marker.dataset.kind?.includes("path-point-icon"))!;
    const handles = markers.filter((marker) => marker !== point);
    expect(handles.length).toBeGreaterThan(0);
    expect(Number(point.dataset.z)).toBe(POINT_MARKER_Z_OFFSET);
    for (const handle of handles) expect(Number(handle.dataset.z)).toBeLessThan(Number(point.dataset.z));
  });

  it("names each point and handle, and activates a point with Space as well as click", () => {
    const { onSelect, pathway } = renderLayer();
    const point = screen.getByRole("button", { name: "Path point 1" });
    expect(point).toHaveAttribute("title", "Path point 1");
    fireEvent.keyDown(point, { key: " " });
    expect(pathway.setSelectedPathPointIndex).toHaveBeenCalledWith(0);
    expect(onSelect).toHaveBeenCalledWith({ type: "path_point", id: "p1:point:0" });

    const handle = screen.getByRole("button", { name: "Add a path point on segment 1" });
    fireEvent.keyDown(handle, { key: " " });
    expect(pathway.insertPathPoint).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "Add a path point on segment 2" }));
    expect(pathway.insertPathPoint).toHaveBeenCalledWith(1);
  });
});
