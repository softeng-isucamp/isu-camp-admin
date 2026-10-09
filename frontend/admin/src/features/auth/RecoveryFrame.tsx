import type { PropsWithChildren } from "react";
import { Link } from "react-router-dom";
import { Button, Card } from "../../components/UI";
import kumpasLogo from "../../assets/figma/brand/kumpas-logo.png";
import userIcon from "../../assets/figma/login/login-icon-4.svg";
import lockIcon from "../../assets/figma/login/login-icon-1.svg";
import eyeIcon from "../../assets/figma/login/login-icon-2.svg";
import arrowIcon from "../../assets/figma/login/login-icon-5.svg";

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

/** The recovery modal over the blurred login preview. Every recovery step renders inside it. */
export function RecoveryFrame({ children }: PropsWithChildren) {
  return (
    <div className="auth-page">
      <div className="ambient" />
      <LoginPreview />
      <div className="recovery-overlay">
        <Card className="recovery-modal">{children}</Card>
      </div>
    </div>
  );
}

/** The exit every recovery step offers; use it as the last child of a step. */
export function BackToLogin() {
  return (
    <Link className="back-link" to="/login">
      Back to login
    </Link>
  );
}
