import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { AuthAlert, RATE_LIMIT_MESSAGE, tryAgainLabel } from "./AuthAlert";
import { CapsLockWarning, useCapsLock } from "./capsLock";
import { AuthError } from "../../services/errors";
import { readLoginPrefill } from "./loginPrefill";
import { PasswordVisibilityIcon } from "./PasswordVisibilityIcon";
import { Button, Card, Field } from "../../components/UI";
import { RateLimitError } from "../../services/api";
import { loginSchema } from "../../services/schemas";
import kumpasLogo from "../../assets/figma/brand/kumpas-logo.png";
import userIcon from "../../assets/figma/login/login-icon-4.svg";
import lockIcon from "../../assets/figma/login/login-icon-1.svg";
import arrowIcon from "../../assets/figma/login/login-icon-5.svg";
export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loginCountdown, setLoginCountdown] = useState(0);
  const [loginPending, setLoginPending] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | undefined>();
  // The field a client-side check rejected; it is marked invalid and points at the alert until edited.
  const [invalidField, setInvalidField] = useState<"username" | "password" | null>(null);
  const alertId = useId();
  const capsLock = useCapsLock();
  const loginInFlight = useRef(false);
  useEffect(() => {
    if (loginCountdown <= 0) return;
    const timer = setTimeout(() => setLoginCountdown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [loginCountdown]);
  const prefilledUsername = readLoginPrefill(location.state);
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm({
    defaultValues: { username: prefilledUsername, password: "" },
  });
  // A recovery flow handed over the username, so the password is all that is left to type.
  useEffect(() => {
    if (prefilledUsername) setFocus("password");
  }, [prefilledUsername, setFocus]);
  // Editing the rejected field clears its validation error; server errors stay until the next attempt.
  const clearInvalid = (field: "username" | "password") => {
    if (invalidField !== field) return;
    setInvalidField(null);
    setError("");
  };
  const usernameField = register("username", { onChange: () => clearInvalid("username") });
  const passwordField = register("password", { onChange: () => clearInvalid("password") });
  const fieldErrorProps = (field: "username" | "password") =>
    invalidField === field ? { "aria-invalid": true, "aria-describedby": alertId } : {};
  const lockedOut = loginCountdown > 0;
  const submit = async (values: { username: string; password: string }) => {
    if (loginInFlight.current || lockedOut) return;
    setError("");
    setAttemptsRemaining(undefined);
    setInvalidField(null);
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.message ?? "Check your credentials.");
      setInvalidField(issue?.path[0] === "password" ? "password" : "username");
      return;
    }
    loginInFlight.current = true;
    setLoginPending(true);
    try {
      await login(values.username, values.password);
      navigate("/dashboard");
    } catch (err) {
      if (err instanceof AuthError && err.kind === "invalid_credentials" && err.attemptsRemaining !== undefined) {
        setError("Incorrect username or password.");
        setAttemptsRemaining(err.attemptsRemaining);
      } else if (err instanceof RateLimitError) {
        setError(RATE_LIMIT_MESSAGE);
        setLoginCountdown(err.retryAfterSeconds);
      } else {
        setError(err instanceof Error ? err.message : "Unable to sign in.");
      }
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
            <span>Username</span>
            <div className="input-with-icon">
              <img src={userIcon} alt="" />
              <input
                {...usernameField}
                {...fieldErrorProps("username")}
                disabled={lockedOut}
                autoComplete="username"
                placeholder="Enter your username"
              />
            </div>
          </label>
          <div className="forgot forgot-username">
            <Link to="/forgot-username">Forgot username?</Link>
          </div>
          <label className="field">
            <span>Password</span>
            <div className="password">
              <img className="password-icon" src={lockIcon} alt="" />
              <input
                {...passwordField}
                {...fieldErrorProps("password")}
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
              <button type="button" onClick={() => setShow(!show)} aria-pressed={show} aria-label="Show password">
                <PasswordVisibilityIcon shown={show} />
              </button>
            </div>
          </label>
          <div className="forgot">
            <CapsLockWarning visible={capsLock.capsLockOn && !lockedOut} />
            <Link to="/forgot-password">Forgot password?</Link>
          </div>
          {(error || errors.username || errors.password) && (
            <AuthAlert id={alertId} attemptsRemaining={attemptsRemaining} urgent={lockedOut}>
              {error || errors.username?.message || errors.password?.message}
            </AuthAlert>
          )}
          <Button type="submit" loading={loginPending} disabled={lockedOut}>
            {loginPending ? "Logging in…" : lockedOut ? tryAgainLabel(loginCountdown) : <>Login <img src={arrowIcon} alt="" /></>}
          </Button>
        </form>
      </Card>
    </div>
  );
}
