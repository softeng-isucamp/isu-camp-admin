import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, Field, LoadingState, Modal, Pagination, ProgressBar, Spinner } from "./UI";

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

  it("condenses large page ranges around the current page", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Pagination total={466} page={1} pageSize={10} onChange={onChange} />,
    );

    const pageButtons = () =>
      screen.getAllByRole("button", { name: /^\d+$/ }).map((button) => button.textContent);
    expect(pageButtons()).toEqual(["1", "2", "3", "47"]);
    expect(screen.getAllByText("…")).toHaveLength(1);

    rerender(<Pagination total={466} page={24} pageSize={10} onChange={onChange} />);
    expect(pageButtons()).toEqual(["1", "23", "24", "25", "47"]);
    expect(screen.getAllByText("…")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "24" })).toHaveClass("active");

    rerender(<Pagination total={466} page={47} pageSize={10} onChange={onChange} />);
    expect(pageButtons()).toEqual(["1", "45", "46", "47"]);
    expect(screen.getAllByText("…")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    expect(onChange).toHaveBeenCalledWith(1);
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

  it("reports an in-flight Button as busy and refuses further clicks", () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Saving…</Button>);

    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    expect(button.querySelector(".spinner")).toBeInTheDocument();

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("leaves a settled Button clickable and free of progress markup", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save Location</Button>);

    const button = screen.getByRole("button", { name: "Save Location" });
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button.querySelector(".spinner")).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("announces a LoadingState and hides its decorative Spinner", () => {
    render(<LoadingState>Loading campus locations…</LoadingState>);

    const state = screen.getByRole("status");
    expect(state).toHaveTextContent("Loading campus locations…");
    expect(state).toHaveAttribute("aria-live", "polite");
    expect(state.querySelector(".spinner")).toHaveAttribute("aria-hidden", "true");
  });

  it("names a standalone Spinner only when it carries no visible label", () => {
    const { rerender } = render(<Spinner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(<Spinner label="Refreshing locations" />);
    expect(screen.getByRole("status")).toHaveAccessibleName("Refreshing locations");
  });

  it("shows the ProgressBar only while a refresh is in flight", () => {
    const { rerender } = render(<ProgressBar active={false} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    rerender(<ProgressBar active />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-busy", "true");
  });
});
