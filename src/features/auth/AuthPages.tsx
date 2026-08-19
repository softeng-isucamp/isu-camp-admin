import { useState } from "react";
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
    defaultValues: { username: "admin_justine", password: "password123" },
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
              <input {...register("username")} autoComplete="username" />
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
            <input value="admin_justine" readOnly />
          </div>
        </label>
        <label className="field">
          <span>PASSWORD</span>
          <div className="password">
            <img className="password-icon" src={lockIcon} alt="" />
            <input value="password123" type="password" readOnly />
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
  const { register, getValues } = useForm({
    defaultValues: {
      email: "admin@isu.edu.ph",
      code: "000000",
      password: "password123",
      confirmPassword: "password123",
    },
  });
  const submit = async (values: {
    email: string;
    code: string;
    password: string;
    confirmPassword: string;
  }) => {
    setError("");
    try {
      if (step === "request") {
        const parsed = resetRequestSchema.safeParse({ email: values.email });
        if (!parsed.success) {
          setError(
            parsed.error.issues[0]?.message ?? "Enter a valid email address.",
          );
          return;
        }
        setStep("code");
      } else if (step === "code") {
        const parsed = resetSchema.shape.code.safeParse(values.code);
        if (!parsed.success) {
          setError(
            parsed.error.issues[0]?.message ?? "Enter the verification code.",
          );
          return;
        }
        setStep("new");
      } else if (step === "new") {
        const parsed = resetPasswordSchema.safeParse(values);
        if (!parsed.success) {
          setError(
            parsed.error.issues[0]?.message ?? "Check your new password.",
          );
          return;
        }
        await services.auth.reset(parsed.data.code, parsed.data.password);
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
              <div className="recovery-success-icon">✓</div>
              <h2>Password reset successful</h2>
              <p className="muted">
                Your password has been updated. You can now sign in.
              </p>
              <Button onClick={() => navigate("/login")}>
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
                    : "Create new password"}
              </h2>
              <p className="muted">
                {step === "request"
                  ? "We will send a six-digit code to your admin email."
                  : step === "code"
                    ? "We sent a verification code to the admin’s email."
                    : "Choose a new password with at least 8 characters."}
              </p>
              {step === "request" && (
                <label className="field">
                  <span>ADMIN EMAIL</span>
                  <input {...register("email")} type="email" />
                </label>
              )}
              {step === "code" && (
                <label className="field">
                  <span>VERIFICATION CODE</span>
                  <input {...register("code")} inputMode="numeric" />
                </label>
              )}
              {step === "new" && (
                <>
                  <label className="field">
                    <span>NEW PASSWORD</span>
                    <input {...register("password")} type="password" />
                  </label>
                  <label className="field">
                    <span>CONFIRM NEW PASSWORD</span>
                    <input {...register("confirmPassword")} type="password" />
                  </label>
                </>
              )}
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <Button type="button" onClick={() => void submit(getValues())}>
                {step === "request"
                  ? "Send Code"
                  : step === "code"
                    ? "Continue"
                    : "Save Password"}{" "}
                <span>→</span>
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
