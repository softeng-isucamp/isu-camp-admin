import { PropsWithChildren, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { Button } from "./UI";
import logo from "../assets/figma/brand/kumpas-logo.png";
import dashboardIcon from "../assets/figma/navigation/dashboard.svg";
import mapEditorIcon from "../assets/figma/navigation/map-editor.svg";
import locationsIcon from "../assets/figma/navigation/locations.svg";
import usersIcon from "../assets/figma/navigation/users.svg";
import logsIcon from "../assets/figma/navigation/logs.svg";
import profileUserIcon from "../assets/figma/navigation/profile-user.svg";
import signOutIcon from "../assets/figma/navigation/sign-out.svg";

export const links = [
  {
    to: "/dashboard",
    icon: dashboardIcon,
    label: "Dashboard Overview",
    description: "System overview and campus metrics",
  },
  {
    to: "/map-editor",
    icon: mapEditorIcon,
    label: "Map Editor",
    description: "Interactive campus geometry canvas",
  },
  {
    to: "/locations",
    icon: locationsIcon,
    label: "Locations",
    description: "Manage buildings, offices, and landmarks",
  },
  {
    to: "/users",
    icon: usersIcon,
    label: "User Management",
    description: "Admin accounts and user roles",
  },
  {
    to: "/system-logs",
    icon: logsIcon,
    label: "System Logs",
    description: "Audit trails and system events",
  },
] as const;

export function Shell({ children }: PropsWithChildren) {
  const { session, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(() => {
    return localStorage.getItem("isucamp_sidebar_minimized") === "true";
  });
  const [confirm, setConfirm] = useState(false);
  const location = useLocation();

  const title =
    location.pathname === "/profile" ? "My Profile" : links.find((l) => l.to === location.pathname)?.label ?? "Dashboard Overview";

  useEffect(() => {
    localStorage.setItem("isucamp_sidebar_minimized", String(minimized));
  }, [minimized]);

  const handleToggleMinimize = () => {
    setMinimized((current) => !current);
  };

  return (
    <div className="app-shell">
      <aside
        className={`sidebar${open ? " open" : ""}${minimized ? " minimized" : ""}`}
        aria-label="Main Navigation"
      >
        <div className="sidebar-top-section">
          <div className="brand">
            <div className="brand-mark" title="KUMPAS">
              <img src={logo} alt="KUMPAS logo" />
            </div>
            {!minimized && (
              <div className="sidebar-brand-copy">
                <strong>KUMPAS</strong>
                <small>ADMIN PORTAL</small>
              </div>
            )}
            <button
              type="button"
              className="sidebar-toggle"
              onClick={handleToggleMinimize}
              aria-label={minimized ? "Expand sidebar" : "Minimize sidebar"}
              aria-expanded={!minimized}
              title={minimized ? "Expand sidebar (»)" : "Minimize sidebar («)"}
            >
              {minimized ? "»" : "«"}
            </button>
          </div>
          <nav>
            {links.map(({ to, icon, label, description }) => (
              <div key={to} className="sidebar-nav-item">
                <NavLink
                  to={to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => (isActive ? "active" : "")}
                >
                  <i>
                    <img src={icon} alt="" />
                  </i>
                  {!minimized && <span className="sidebar-link-label">{label}</span>}
                </NavLink>
                {minimized && (
                  <div className="sidebar-tooltip" role="tooltip">
                    <div className="tooltip-title">{label}</div>
                    <div className="tooltip-sub">{description}</div>
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>

        <div className="sidebar-bottom-section">
          {minimized ? (
            <div className="minimized-profile-container">
              <NavLink to="/profile" className="minimized-avatar-btn" aria-label="Open profile" title="My Profile" onClick={() => setOpen(false)}>
                <img src={profileUserIcon} alt="" /><span className="online-indicator" />
              </NavLink>
              <button type="button" className="profile-popover-signout" aria-label="Sign out" onClick={() => setConfirm(true)}><img src={signOutIcon} alt="" /></button>
            </div>
          ) : (
            <div className="profile">
              <NavLink to="/profile" className="sidebar-profile-link" aria-label={`Open profile for ${session?.username ?? "Administrator"}`} onClick={() => setOpen(false)}>
              <div className="avatar">
                <img src={profileUserIcon} alt="" />
              </div>
              <div className="profile-copy">
                <strong>{session?.username ?? "Admin Justine"}</strong>
                <small>{session?.role === "superadmin" ? "SUPERADMIN" : "ADMINISTRATOR"}</small>
              </div>
              </NavLink>
              <button
                type="button"
                aria-label="Sign out"
                title="Sign out"
                onClick={() => setConfirm(true)}
              >
                <img src={signOutIcon} alt="" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {open && <div className="backdrop" onClick={() => setOpen(false)} />}

      <div className={minimized ? "content sidebar-minimized" : "content"}>
        <header>
          <button
            className="menu-btn"
            onClick={() => setOpen(true)}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          <div className="crumb">
            ISU Echague <span>/</span> <b>{title}</b>
          </div>
          <NavLink
            to="/profile"
            aria-label="Open my profile"
            className="avatar small"
            style={{ cursor: "pointer" }}
            title={`Signed in as ${session?.username ?? "Admin User"}`}
          >
            <img src={profileUserIcon} alt="" />
          </NavLink>
        </header>
        <main>{children}</main>
      </div>

      {confirm && (
        <div className="modal-backdrop">
          <div
            className="modal-card"
            style={{
              background: "#fff",
              borderRadius: "28px",
              padding: "32px",
              width: "460px",
              maxWidth: "90%",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "16px",
                alignItems: "flex-start",
                marginBottom: "16px",
              }}
            >
              <div
                style={{
                  width: "44px",
                  height: "44px",
                  borderRadius: "50%",
                  background: "#fee2e2",
                  color: "#dc2626",
                  display: "grid",
                  placeItems: "center",
                  fontSize: "20px",
                  flexShrink: 0,
                }}
              >
                <img
                  src={signOutIcon}
                  alt=""
                  style={{
                    width: "22px",
                    height: "22px",
                    filter:
                      "invert(24%) sepia(85%) saturate(3000%) hue-rotate(345deg) brightness(95%) contrast(95%)",
                  }}
                />
              </div>
              <div>
                <h2
                  style={{
                    fontSize: "22px",
                    fontWeight: "bold",
                    margin: "0",
                    color: "#191c1d",
                  }}
                >
                  Sign out?
                </h2>
                <p
                  style={{
                    margin: "6px 0 0",
                    color: "#525c57",
                    fontSize: "14px",
                    lineHeight: "20px",
                  }}
                >
                  You’ll need to sign in again to access the KUMPAS admin
                  dashboard.
                </p>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "12px",
                marginTop: "24px",
              }}
            >
              <Button
                variant="subtle"
                style={{ borderRadius: "999px", padding: "0 22px" }}
                onClick={() => setConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                style={{
                  borderRadius: "999px",
                  padding: "0 24px",
                  background: "#dc2626",
                  color: "#fff",
                }}
                onClick={() => {
                  setConfirm(false);
                  logout();
                }}
              >
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
