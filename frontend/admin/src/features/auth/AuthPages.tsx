import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { attemptsLeftText, isUrgentAttempts } from "./attemptsLeft";
import { CapsLockWarning, useCapsLock } from "./capsLock";
import { AuthError } from "../../services/errors";
import { OtpInput, type OtpInputHandle } from "./OtpInput";
import { Button, Card, Field } from "../../components/UI";
import { RateLimitError, services } from "../../services/api";
import {
  loginSchema,
  resetPasswordSchema,
  resetRequestSchema,
  resetSchema,
} from "../../services/schemas";
import kumpasLogo from "../../assets/figma/brand/kumpas-logo.png";
import userIcon from "../../assets/figma/login/login-icon-4.svg";
import lockIcon from "../../assets/figma/login/login-icon-1.svg";
import eyeIcon from "../../assets/figma/login/login-icon-2.svg";
import arrowIcon from "../../assets/figma/login/login-icon-5.svg";
export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loginCountdown, setLoginCountdown] = useState(0);
  const [loginPending, setLoginPending] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | undefined>();
  const capsLock = useCapsLock();
  const loginInFlight = useRef(false);
  useEffect(() => {
    if (loginCountdown <= 0) return;
    const timer = setTimeout(() => setLoginCountdown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [loginCountdown]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    defaultValues: { username: "", password: "" },
  });
  const passwordField = register("password");
  const lockedOut = loginCountdown > 0;
  const submit = async (values: { username: string; password: string }) => {
    if (loginInFlight.current || lockedOut) return;
    setError("");
    setAttemptsRemaining(undefined);
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your credentials.");
      return;
    }
    loginInFlight.current = true;
    setLoginPending(true);
    try {
      await login(values.username, values.password);
      navigate("/dashboard");
    } catch (err) {
      if (err instanceof AuthError && err.kind === "invalid_credentials" && err.attemptsRemaining !== undefined) {
        setError(`Incorrect username or password. ${attemptsLeftText(err.attemptsRemaining)}`);
        setAttemptsRemaining(err.attemptsRemaining);
      } else {
        setError(err instanceof Error ? err.message : "Unable to sign in.");
      }
      if (err instanceof RateLimitError) setLoginCountdown(err.retryAfterSeconds);
    } finally {
      loginInFlight.current = false;
      setLoginPending(false);
    }
  };
  return (
    <div className="auth-page">
      <div className="ambient" />
      <Card className="login-card">
        <div className="auth-brand">
          <div className="auth-mark">
            <img src={kumpasLogo} alt="KUMPAS logo" />
          </div>
          <h1>KUMPAS</h1>
          <p>Admin Login</p>
        </div>
        <form onSubmit={handleSubmit(submit)}>
          <label className="field">
            <span>USERNAME</span>
            <div className="input-with-icon">
              <img src={userIcon} alt="" />
              <input
                {...register("username")}
                disabled={lockedOut}
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
                {...passwordField}
                onBlur={(event) => {
                  void passwordField.onBlur(event);
                  capsLock.onBlur();
                }}
                onKeyDown={capsLock.onKeyDown}
                onKeyUp={capsLock.onKeyUp}
                disabled={lockedOut}
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
            <CapsLockWarning visible={capsLock.capsLockOn && !lockedOut} />
            <Link to="/reset-password">Forgot password?</Link>
          </div>
          {(error || errors.username || errors.password) && (
            <div
              className={attemptsRemaining !== undefined && isUrgentAttempts(attemptsRemaining) ? "error error-urgent" : "error"}
              role="alert"
            >
              {error || errors.username?.message || errors.password?.message}
            </div>
          )}
          <Button type="submit" loading={loginPending} disabled={lockedOut}>
            {loginPending ? "Logging in…" : lockedOut ? `Login in ${loginCountdown}s` : "Login"} <img src={arrowIcon} alt="" />
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
          <img src={kumpasLogo} alt="KUMPAS logo" />
        </div>
        <h1>KUMPAS</h1>
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
  const [submitting, setSubmitting] = useState(false);
  const submissionInFlight = useRef(false);
  const [code, setCode] = useState("");
  const otp = useRef<OtpInputHandle>(null);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setTimeout(() => setResendCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  const handleResendCode = async () => {
    if (submissionInFlight.current || resendCountdown > 0) return;
    submissionInFlight.current = true;
    setError("");
    setResendMessage("");
    setSubmitting(true);
    try {
      await services.auth.requestReset(getValues("username"));
      otp.current?.clear();
      setResendMessage("A new 6-digit verification code has been sent.");
      setResendCountdown(60);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to resend code.";
      setError(msg);
      if (err instanceof RateLimitError) setResendCountdown(err.retryAfterSeconds);
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  };
  const { register, getValues } = useForm({
    defaultValues: {
      username: "",
      password: "",
      confirmPassword: "",
    },
  });

  const submit = async (values: {
    username: string;
    password: string;
    confirmPassword: string;
  }) => {
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setError("");
    setSubmitting(true);
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
        setResendCountdown(60);
        setStep("code");
      } else if (step === "code") {
        const parsed = resetSchema.shape.code.safeParse(code);
        if (!parsed.success) {
          setError(
            parsed.error.issues[0]?.message ?? "Enter the 6-digit verification code.",
          );
          return;
        }
        await services.auth.verifyReset(values.username, parsed.data);
        setStep("new");
      } else if (step === "new") {
        const parsed = resetPasswordSchema.safeParse({ ...values, code });
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
      if (e instanceof RateLimitError && step === "code") setResendCountdown(e.retryAfterSeconds);
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
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
              <div className="recovery-success-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h2>Password reset successful</h2>
              <p className="muted recovery-copy">
                Your admin password has been updated. You can now sign in using your new password.
              </p>
              <div className="recovery-spacer" />
              <Button className="recovery-primary" onClick={() => navigate("/login")}>
                Return to Login
              </Button>
            </>
          ) : (
            <>
              <h2>
                {step === "request"
                  ? "Reset your password"
                  : step === "code"
                    ? "Enter verification code"
                    : "Create a new password"}
              </h2>
              <p className="muted recovery-copy">
                {step === "request"
                  ? "Enter your admin username to receive a six-digit code."
                  : step === "code"
                    ? "We sent a 6-digit verification code to the admin’s email on file."
                    : "Choose a strong password for the admin account."}
              </p>
              {step === "request" && (
                <label className="field">
                  <span className="recovery-label">ADMIN USERNAME</span>
                  <input {...register("username")} type="text" placeholder="admin01" />
                </label>
              )}
              {step === "code" && (
                <div className="field">
                  <span className="recovery-label">VERIFICATION CODE</span>
                  <OtpInput ref={otp} onChange={setCode} />
                  <small className="recovery-resend">
                    <span>Didn't receive code?</span>
                    <button
                      type="button"
                      onClick={handleResendCode}
                      disabled={resendCountdown > 0 || submitting}
                    >
                      {resendCountdown > 0 ? `Resend code in ${resendCountdown}s` : "Resend code"}
                    </button>
                  </small>
                  {resendMessage && (
                    <div className="recovery-confirmation">{resendMessage}</div>
                  )}
                </div>
              )}
              {step === "new" && (
                <>
                  <label className="field">
                    <span className="recovery-label">NEW PASSWORD</span>
                    <input {...register("password")} type="password" placeholder="Enter new password" />
                  </label>
                  <label className="field">
                    <span className="recovery-label">CONFIRM NEW PASSWORD</span>
                    <input {...register("confirmPassword")} type="password" placeholder="Confirm new password" />
                  </label>
                  <div className="recovery-hint">
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
                className="recovery-primary recovery-submit"
                onClick={() => void submit(getValues())}
                loading={submitting}
              >
                {submitting
                  ? "Working…"
                  : step === "request"
                    ? "Send Code →"
                    : step === "code"
                      ? "Continue"
                      : "Reset Password"}
              </Button>
              <Link className="back-link" to="/login">
                Back to login
              </Link>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
