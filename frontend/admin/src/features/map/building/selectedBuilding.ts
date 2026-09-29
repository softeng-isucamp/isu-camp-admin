import type { Building, Location, RouteNode } from "../../../types";

/** The selected Building with the Campus Location, entrances, and routability derived for it. */
export interface SelectedBuildingView {
  building: Building;
  location: Location | undefined;
  /** Location id when the Building has one, otherwise the Building id. */
  associationId: string;
  entrances: RouteNode[];
  hasFootprint: boolean;
  routable: boolean;
}
