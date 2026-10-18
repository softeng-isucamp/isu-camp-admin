import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PLACE_CLASSIFICATIONS } from "../../types";
import { locationTypeIconContents, LocationTypeIcon } from "./LocationTypeIcon";

afterEach(cleanup);

describe("LocationTypeIcon", () => {
  it.each(PLACE_CLASSIFICATIONS)("draws an icon for the %s classification", (classification) => {
    const { container } = render(<LocationTypeIcon type="Place" classification={classification} />);
    expect(container.querySelector("svg")?.innerHTML).not.toBe("");
  });

  it("gives every classification its own icon", () => {
    const drawings = PLACE_CLASSIFICATIONS.map((classification) => locationTypeIconContents("Place", classification));
    expect(new Set(drawings).size).toBe(PLACE_CLASSIFICATIONS.length);
  });
});
