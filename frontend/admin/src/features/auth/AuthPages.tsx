import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { attemptsLeftText, isUrgentAttempts } from "./attemptsLeft";
import { CapsLockWarning, useCapsLock } from "./capsLock";
import { AuthError } from "../../services/errors";
import { readLoginPrefill } from "./loginPrefill";
import { Button, Card, Field } from "../../components/UI";
import { RateLimitError } from "../../services/api";
import { loginSchema } from "../../services/schemas";
import kumpasLogo from "../../assets/figma/brand/kumpas-logo.png";
import userIcon from "../../assets/figma/login/login-icon-4.svg";
import lockIcon from "../../assets/figma/login/login-icon-1.svg";
import eyeIcon from "../../assets/figma/login/login-icon-2.svg";
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
    defaultValues: { username: readLoginPrefill(location.state), password: "" },
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
            <Link to="/forgot-password">Forgot password?</Link>
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
