import { PropsWithChildren, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { Button, Card } from "./UI";
import logo from "../assets/figma/brand/isu-camp-logo.png";
const links = [
  ["/dashboard", "▦", "Dashboard Overview"],
  ["/map-editor", "⌖", "Map Editor"],
  ["/locations", "▤", "Locations"],
  ["/routes", "⌁", "Routes & Paths"],
  ["/users", "♙", "User Management"],
  ["/system-logs", "≡", "System Logs"],
] as const;
export function Shell({ children }: PropsWithChildren) {
  const { session, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const title =
    links.find((l) => l[0] === location.pathname)?.[2] ?? "Dashboard Overview";
  return (
    <div className="app-shell">
      <aside className={open ? "sidebar open" : "sidebar"}>
        <div>
          <div className="brand">
            <div className="brand-mark">
              <img src={logo} alt="" />
            </div>
            <div>
              <strong>ISU-CAMP</strong>
              <small>ADMIN PORTAL</small>
            </div>
          </div>
          <nav>
            {links.map(([to, icon, label]) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                <i>{icon}</i>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="profile">
          <div className="avatar">AJ</div>
          <div>
            <strong>{session?.username ?? "Admin Justine"}</strong>
            <small>ADMINISTRATOR</small>
          </div>
          <button aria-label="Sign out" onClick={() => setConfirm(true)}>
            ↪
          </button>
        </div>
      </aside>
      {open && <div className="backdrop" onClick={() => setOpen(false)} />}
      <div className="content">
        <header>
          <button className="menu-btn" onClick={() => setOpen(true)}>
            ☰
          </button>
          <div className="crumb">
            ISU Echague <span>/</span> <b>{title}</b>
          </div>
          <div className="global-search">
            <span>⌕</span>
            <input
              placeholder="Search entities..."
              onKeyDown={(e) => e.key === "Enter" && navigate("/locations")}
            />
          </div>
          <button className="icon-btn">
            ♧<em />
          </button>
          <div className="avatar small">AJ</div>
        </header>
        <main>{children}</main>
      </div>
      {confirm && (
        <div className="modal-backdrop">
          <Card className="modal">
            <h2>Sign out?</h2>
            <p>Your session will be ended on this device.</p>
            <div className="modal-actions">
              <Button variant="subtle" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirm(false);
                  logout();
                }}
              >
                Sign Out
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
