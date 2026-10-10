import { PropsWithChildren, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import logo from "../assets/figma/brand/kumpas-logo.png";
import dashboardIcon from "../assets/figma/navigation/dashboard.svg";
import mapEditorIcon from "../assets/figma/navigation/map-editor.svg";
import locationsIcon from "../assets/figma/navigation/locations.svg";
import usersIcon from "../assets/figma/navigation/users.svg";
import logsIcon from "../assets/figma/navigation/logs.svg";
import profileUserIcon from "../assets/figma/navigation/profile-user.svg";

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
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(() => {
    return localStorage.getItem("isucamp_sidebar_minimized") === "true";
  });
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
    </div>
  );
}
