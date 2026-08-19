import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { Button, Card, Field } from "../../components/UI";
import { services } from "../../services/api";
import { loginSchema, resetSchema } from "../../services/schemas";
import mapIcon from "../../assets/figma/login/login-icon-3.svg";
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
            <input {...register("username")} autoComplete="username" />
          </label>
          <label className="field">
            <span>PASSWORD</span>
            <div className="password">
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
                {show ? "◉" : "◌"}
              </button>
            </div>
          </label>
          <div className="forgot">
            <Link to="/reset-password">Forgot password?</Link>
          </div>
          {(error || errors.username || errors.password) && (
            <div className="error">
              {error || errors.username?.message || errors.password?.message}
            </div>
          )}
          <Button type="submit">
            Login <img src={arrowIcon} alt="" />
          </Button>
        </form>
        <footer>Authorized Personnel Only · Echague Main Campus</footer>
      </Card>
    </div>
  );
}
export function PasswordReset() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"request" | "code" | "new" | "success">(
    "request",
  );
  const [email, setEmail] = useState("admin@isu.edu.ph");
  const [code, setCode] = useState("000000");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState("");
  const submit = async () => {
    setError("");
    try {
      if (step === "request") setStep("code");
      else if (step === "code") {
        const parsed = resetSchema.shape.code.safeParse(code);
        if (!parsed.success) {
          setError(
            parsed.error.issues[0]?.message ?? "Enter the verification code.",
          );
          return;
        }
        setStep("new");
      } else if (step === "new") {
        const parsed = resetSchema.safeParse({ code, password });
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
      <Card className="login-card">
        <div className="auth-brand">
          <div className="auth-mark">
            <img src={mapIcon} alt="" />
          </div>
          <h1>ISU-CAMP</h1>
          <p>Admin Login</p>
        </div>
        {step === "success" ? (
          <>
            <h2>Password reset successful</h2>
            <p className="muted">
              Your password has been updated. You can now sign in.
            </p>
            <Button onClick={() => navigate("/login")}>Return to Login</Button>
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
                  ? "Enter the code from the email. Use 000000 in the demo."
                  : "Choose a new password with at least 8 characters."}
            </p>
            {step === "request" && (
              <Field
                label="ADMIN EMAIL"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
              />
            )}
            {step === "code" && (
              <Field
                label="VERIFICATION CODE"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
              />
            )}
            {step === "new" && (
              <Field
                label="NEW PASSWORD"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
              />
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <Button onClick={submit}>
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
  );
}
