import { PropsWithChildren, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { Button, Card } from "./UI";
import logo from "../assets/figma/brand/isu-camp-logo.png";
import dashboardIcon from "../assets/figma/navigation/dashboard.svg";
import mapEditorIcon from "../assets/figma/navigation/map-editor.svg";
import locationsIcon from "../assets/figma/navigation/locations.svg";
import routesIcon from "../assets/figma/navigation/routes.svg";
import usersIcon from "../assets/figma/navigation/users.svg";
import logsIcon from "../assets/figma/navigation/logs.svg";
import profileUserIcon from "../assets/figma/navigation/profile-user.svg";
import signOutIcon from "../assets/figma/navigation/sign-out.svg";
const links = [
  ["/dashboard", dashboardIcon, "Dashboard Overview"],
  ["/map-editor", mapEditorIcon, "Map Editor"],
  ["/locations", locationsIcon, "Locations"],
  ["/routes", routesIcon, "Routes & Paths"],
  ["/users", usersIcon, "User Management"],
  ["/system-logs", logsIcon, "System Logs"],
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
                <i>
                  <img src={icon} alt="" />
                </i>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="profile">
          <div className="avatar">
            <img src={profileUserIcon} alt="" />
          </div>
          <div>
            <strong>{session?.username ?? "Admin Justine"}</strong>
            <small>ADMINISTRATOR</small>
          </div>
          <button aria-label="Sign out" onClick={() => setConfirm(true)}>
            <img src={signOutIcon} alt="" />
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
          <div className="avatar small">
            <img src={profileUserIcon} alt="" />
          </div>
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
