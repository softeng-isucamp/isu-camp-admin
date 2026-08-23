import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { Button, Card, Field } from "../../components/UI";
import { services } from "../../services/api";
import {
  loginSchema,
  resetPasswordSchema,
  resetRequestSchema,
  resetSchema,
} from "../../services/schemas";
import mapIcon from "../../assets/figma/login/login-icon-3.svg";
import userIcon from "../../assets/figma/login/login-icon-4.svg";
import lockIcon from "../../assets/figma/login/login-icon-1.svg";
import eyeIcon from "../../assets/figma/login/login-icon-2.svg";
import arrowIcon from "../../assets/figma/login/login-icon-5.svg";
export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    defaultValues: { username: "", password: "" },
  });
  const submit = async (values: { username: string; password: string }) => {
    setError("");
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your credentials.");
      return;
    }
    try {
      await login(values.username, values.password);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
    }
  };
  return (
    <div className="auth-page">
      <div className="ambient" />
      <Card className="login-card">
        <div className="auth-brand">
          <div className="auth-mark">
            <img src={mapIcon} alt="" />
          </div>
          <h1>ISU-CAMP</h1>
          <p>Admin Login</p>
        </div>
        <form onSubmit={handleSubmit(submit)}>
          <label className="field">
            <span>USERNAME</span>
            <div className="input-with-icon">
              <img src={userIcon} alt="" />
              <input
                {...register("username")}
                autoComplete="username"
                placeholder="Enter your username"
              />
            </div>
          </label>
          <label className="field">
            <span>PASSWORD</span>
            <div className="password">
              <img className="password-icon" src={lockIcon} alt="" />
              <input
                {...register("password")}
                type={show ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label="Toggle password visibility"
              >
                <img src={eyeIcon} alt="" />
              </button>
            </div>
          </label>
          <div className="forgot">
            <Link to="/reset-password">Forgot password?</Link>
          </div>
          {(error || errors.username || errors.password) && (
            <div className="error" role="alert">
              {error || errors.username?.message || errors.password?.message}
            </div>
          )}
          <Button type="submit">
            Login <img src={arrowIcon} alt="" />
          </Button>
        </form>
      </Card>
    </div>
  );
}

function LoginPreview() {
  return (
    <Card className="login-card" aria-hidden="true">
      <div className="auth-brand">
        <div className="auth-mark">
          <img src={mapIcon} alt="" />
        </div>
        <h1>ISU-CAMP</h1>
        <p>Admin Login</p>
      </div>
      <form>
        <label className="field">
          <span>USERNAME</span>
          <div className="input-with-icon">
            <img src={userIcon} alt="" />
            <input placeholder="Enter your username" readOnly />
          </div>
        </label>
        <label className="field">
          <span>PASSWORD</span>
          <div className="password">
            <img className="password-icon" src={lockIcon} alt="" />
            <input placeholder="Enter your password" type="password" readOnly />
            <button type="button" tabIndex={-1}>
              <img src={eyeIcon} alt="" />
            </button>
          </div>
        </label>
        <div className="forgot">Forgot password?</div>
        <Button type="button">
          Login <img src={arrowIcon} alt="" />
        </Button>
      </form>
    </Card>
  );
}

export function PasswordReset() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"request" | "code" | "new" | "success">(
    "request",
  );
  const [error, setError] = useState("");
  const [resendMessage, setResendMessage] = useState("");
  const [resendCountdown, setResendCountdown] = useState(0);
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setTimeout(() => setResendCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  const handleResendCode = async () => {
    setError("");
    setResendMessage("");
    setDigits(["", "", "", "", "", ""]);
    setValue("code", "");
    try {
      await services.auth.requestReset(getValues("username"));
      setResendMessage("A new 6-digit verification code has been sent.");
      setResendCountdown(60);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to resend code.";
      setError(msg);
      setResendCountdown(0);
    }
  };
  const { register, getValues, setValue } = useForm({
    defaultValues: {
      username: "",
      code: "",
      password: "",
      confirmPassword: "",
    },
  });

  const handleDigitChange = (index: number, val: string) => {
    const clean = val.replace(/\D/g, "");
    if (!clean) {
      const nextDigits = [...digits];
      nextDigits[index] = "";
      setDigits(nextDigits);
      setValue("code", nextDigits.join(""));
      return;
    }
    const nextDigits = [...digits];
    if (clean.length > 1) {
      const chars = clean.slice(0, 6).split("");
      const startIndex = chars.length === 6 ? 0 : index;
      for (let i = 0; i < chars.length; i++) {
        if (startIndex + i < 6) nextDigits[startIndex + i] = chars[i];
      }
      setDigits(nextDigits);
      setValue("code", nextDigits.join(""));
      const nextInput = document.getElementById(`digit-${Math.min(5, startIndex + chars.length - 1)}`);
      nextInput?.focus();
      return;
    }
    nextDigits[index] = clean[clean.length - 1];
    setDigits(nextDigits);
    setValue("code", nextDigits.join(""));
    if (index < 5) {
      const nextInput = document.getElementById(`digit-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handlePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    const nextDigits = [...digits];
    const startIndex = pasted.length === 6 ? 0 : index;
    for (let i = 0; i < pasted.length; i++) {
      if (startIndex + i < 6) {
        nextDigits[startIndex + i] = pasted[i];
      }
    }
    setDigits(nextDigits);
    setValue("code", nextDigits.join(""));
    const focusTarget = Math.min(5, startIndex + pasted.length - 1);
    const nextInput = document.getElementById(`digit-${focusTarget}`);
    nextInput?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      const nextDigits = [...digits];
      nextDigits[index - 1] = "";
      setDigits(nextDigits);
      setValue("code", nextDigits.join(""));
      const prevInput = document.getElementById(`digit-${index - 1}`);
      prevInput?.focus();
    }
  };

  const submit = async (values: {
    username: string;
    code: string;
    password: string;
    confirmPassword: string;
  }) => {
    setError("");
    try {
      if (step === "request") {
        const parsed = resetRequestSchema.safeParse({ username: values.username });
        if (!parsed.success) {
          setError(
            parsed.error.issues[0]?.message ?? "Username is required.",
          );
          return;
        }
        await services.auth.requestReset(values.username);
        setStep("code");
      } else if (step === "code") {
        const rawCode = values.code || digits.join("");
        const parsed = resetSchema.shape.code.safeParse(rawCode);
        if (!parsed.success) {
          setError(
            parsed.error.issues[0]?.message ?? "Enter the 6-digit verification code.",
          );
          return;
        }
        setValue("code", parsed.data);
        setStep("new");
      } else if (step === "new") {
        const rawCode = values.code || digits.join("");
        const parsed = resetPasswordSchema.safeParse({ ...values, code: rawCode });
        if (!parsed.success) {
          setError(
            parsed.error.issues[0]?.message ?? "Check your new password.",
          );
          return;
        }
        await services.auth.reset(
          values.username,
          parsed.data.code,
          parsed.data.password,
        );
        setStep("success");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to reset password");
    }
  };

  return (
    <div className="auth-page">
      <div className="ambient" />
      <LoginPreview />
      <div className="recovery-overlay">
        <Card className="recovery-modal">
          {step === "success" ? (
            <>
              <div className="recovery-success-icon" style={{ background: "#0c7441", color: "#fff", width: "54px", height: "54px", borderRadius: "999px", display: "grid", placeItems: "center" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h2 style={{ fontSize: "26px", color: "#191c1d", margin: "0" }}>Password reset successful</h2>
              <p className="muted" style={{ fontSize: "16px", color: "#525c57", lineHeight: "24px" }}>
                Your admin password has been updated. You can now sign in using your new password.
              </p>
              <div style={{ flex: 1, minHeight: "12px" }} />
              <Button style={{ background: "#0c7441", height: "50px", borderRadius: "999px", color: "#fff", fontSize: "16px", width: "100%" }} onClick={() => navigate("/login")}>
                Return to Login
              </Button>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: "26px", color: "#191c1d", margin: "0" }}>
                {step === "request"
                  ? "Reset your password"
                  : step === "code"
                    ? "Enter verification code"
                    : "Create a new password"}
              </h2>
              <p className="muted" style={{ fontSize: "16px", color: "#525c57", lineHeight: "24px" }}>
                {step === "request"
                  ? "Enter your admin username to receive a six-digit code."
                  : step === "code"
                    ? "We sent a 6-digit verification code to the admin’s email on file."
                    : "Choose a strong password for the admin account."}
              </p>
              {step === "request" && (
                <label className="field">
                  <span style={{ fontSize: "12px", color: "#191c1d", fontWeight: 600 }}>ADMIN USERNAME</span>
                  <input {...register("username")} type="text" placeholder="admin01" />
                </label>
              )}
              {step === "code" && (
                <div className="field">
                  <span style={{ fontSize: "12px", color: "#191c1d", fontWeight: 600 }}>VERIFICATION CODE</span>
                  <div className="segmented-code-container" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "8px", width: "100%", boxSizing: "border-box" }}>
                    {digits.map((digit, i) => (
                      <input
                        key={i}
                        id={`digit-${i}`}
                        type="text"
                        inputMode="numeric"
                        value={digit}
                        onChange={(e) => handleDigitChange(i, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(i, e)}
                        onPaste={(e) => handlePaste(i, e)}
                        onFocus={(e) => e.target.select()}
                        className="segmented-code-input"
                        style={{
                          width: "100%",
                          height: "52px",
                          minWidth: 0,
                          textAlign: "center",
                          fontSize: "20px",
                          fontWeight: "bold",
                          borderRadius: "14px",
                          background: "#e1e3e4",
                          border: "1px solid #d1d5db",
                          color: "#191c1d",
                          boxSizing: "border-box",
                        }}
                        aria-label={`Digit ${i + 1}`}
                      />
                    ))}
                  </div>
                  {/* Accessible/Test input */}
                  <input
                    {...register("code")}
                    type="text"
                    aria-label="VERIFICATION CODE"
                    style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }}
                    onChange={(e) => {
                      setValue("code", e.target.value);
                      const chars = e.target.value.slice(0, 6).split("");
                      const next = ["", "", "", "", "", ""];
                      for (let i = 0; i < chars.length; i++) next[i] = chars[i];
                      setDigits(next);
                    }}
                  />
                  <small style={{ color: "#666e69", fontSize: "13px", marginTop: "4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Didn't receive code?</span>
                    <button
                      type="button"
                      onClick={handleResendCode}
                      disabled={resendCountdown > 0}
                      style={{ background: "none", border: "none", color: resendCountdown > 0 ? "#999" : "#0c7441", fontWeight: 600, fontSize: "13px", cursor: resendCountdown > 0 ? "default" : "pointer", padding: 0 }}
                    >
                      {resendCountdown > 0 ? `Resend code in ${resendCountdown}s` : "Resend code"}
                    </button>
                  </small>
                  {resendMessage && (
                    <div style={{ color: "#0c7441", fontSize: "13px", marginTop: "6px", fontWeight: 500 }}>
                      {resendMessage}
                    </div>
                  )}
                </div>
              )}
              {step === "new" && (
                <>
                  <label className="field">
                    <span style={{ fontSize: "12px", color: "#191c1d", fontWeight: 600 }}>NEW PASSWORD</span>
                    <input {...register("password")} type="password" placeholder="Enter new password" />
                  </label>
                  <label className="field">
                    <span style={{ fontSize: "12px", color: "#191c1d", fontWeight: 600 }}>CONFIRM NEW PASSWORD</span>
                    <input {...register("confirmPassword")} type="password" placeholder="Confirm new password" />
                  </label>
                  <div style={{ background: "#f0f8f3", borderRadius: "14px", padding: "12px 16px", color: "#0c5430", fontSize: "13px", lineHeight: "19px" }}>
                    Use a strong password with at least one uppercase letter, one lowercase letter, one number, and one symbol.
                  </div>
                </>
              )}
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <Button
                type="button"
                style={{ background: "#0c7441", height: "50px", borderRadius: "999px", color: "#fff", fontSize: "16px", width: "100%", marginTop: "8px" }}
                onClick={() => void submit(getValues())}
              >
                {step === "request"
                  ? "Send Code →"
                  : step === "code"
                    ? "Continue"
                    : "Reset Password"}
              </Button>
              <Link className="back-link" to="/login" style={{ color: "#0c7441", textAlign: "center", fontSize: "14px", marginTop: "4px" }}>
                Back to login
              </Link>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
