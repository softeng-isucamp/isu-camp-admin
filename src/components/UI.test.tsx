import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Pagination } from "./UI";

describe("Pagination", () => {
  it("renders the current range and emits page changes", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Pagination total={5} page={1} pageSize={2} onChange={onChange} />,
    );

    expect(screen.getByText("Showing 1–2 of 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(onChange).toHaveBeenCalledWith(2);

    rerender(
      <Pagination total={5} page={2} pageSize={2} onChange={onChange} />,
    );
    expect(screen.getByText("Showing 3–4 of 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2" })).toHaveClass("active");
  });
});
