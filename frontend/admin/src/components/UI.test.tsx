import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, Field, Modal, Pagination } from "./UI";

describe("UI Components", () => {
  it("renders Pagination, calculates range, and handles page change", () => {
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

  it("renders Modal with title and subtitle, handles close button click and Escape key", () => {
    const onClose = vi.fn();
    render(
      <Modal
        title="Add Pathway"
        subtitle="Connect two campus nodes for navigation."
        size="md"
        variant="green"
        onClose={onClose}
      >
        <div>Modal Child Content</div>
      </Modal>,
    );

    expect(screen.getByText("Add Pathway")).toBeInTheDocument();
    expect(
      screen.getByText("Connect two campus nodes for navigation."),
    ).toBeInTheDocument();
    expect(screen.getByText("Modal Child Content")).toBeInTheDocument();

    const closeBtn = screen.getByLabelText("Close dialog");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders Button and Field with label, required indicator, and subhelper", () => {
    render(
      <div>
        <Field
          label="SOURCE"
          required
          subhelper="Required · must differ from destination"
          placeholder="Select source"
        />
        <Button variant="primary">Save Pathway</Button>
      </div>,
    );

    expect(screen.getByText("SOURCE")).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
    expect(
      screen.getByText("Required · must differ from destination"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Select source")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Pathway" })).toHaveClass(
      "btn-pill",
    );
  });
});
