import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PasswordField, type PasswordFieldProps } from "./PasswordField";

function Harness(props: Partial<PasswordFieldProps>) {
  const [value, setValue] = useState("");
  return <PasswordField label="Password" value={value} onChange={(event) => setValue(event.target.value)} {...props} />;
}

describe.each(["form", "login", "recovery"] as const)("PasswordField (%s)", (variant) => {
  it("labels the input and toggles its visibility with a pressed state", async () => {
    render(<Harness variant={variant} />);
    const input = screen.getByLabelText("Password", { selector: "input" });
    expect(input).toHaveAttribute("type", "password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("names the toggle after the field", () => {
    render(<Harness variant={variant} label="Confirm" toggleName="confirm password" />);
    expect(screen.getByRole("button", { name: "Show confirm password" })).toBeInTheDocument();
  });
});

it("keeps the toggle independent between fields", async () => {
  render(<><Harness label="First" /><Harness label="Second" /></>);
  await userEvent.click(screen.getByRole("button", { name: "Show first" }));
  expect(screen.getByLabelText("First", { selector: "input" })).toHaveAttribute("type", "text");
  expect(screen.getByLabelText("Second", { selector: "input" })).toHaveAttribute("type", "password");
});

it("warns about Caps Lock when asked to", async () => {
  render(<Harness variant="recovery" capsLockWarning />);
  const input = screen.getByLabelText("Password", { selector: "input" });
  await userEvent.click(input);
  await userEvent.keyboard("{CapsLock}");
  expect(await screen.findByText("Caps Lock is on")).toBeInTheDocument();
});
