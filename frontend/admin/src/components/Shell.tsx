import { PropsWithChildren, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { Button } from "./UI";
import { services } from "../services/api";
import type { NotificationItem } from "../types";
import logo from "../assets/figma/brand/isu-camp-logo.png";
import dashboardIcon from "../assets/figma/navigation/dashboard.svg";
import mapEditorIcon from "../assets/figma/navigation/map-editor.svg";
import locationsIcon from "../assets/figma/navigation/locations.svg";
import routesIcon from "../assets/figma/navigation/routes.svg";
import usersIcon from "../assets/figma/navigation/users.svg";
import logsIcon from "../assets/figma/navigation/logs.svg";
import profileUserIcon from "../assets/figma/navigation/profile-user.svg";
import signOutIcon from "../assets/figma/navigation/sign-out.svg";
import searchIcon from "../assets/figma/navigation/search.svg";
import notificationsIcon from "../assets/figma/navigation/notifications.svg";

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
    to: "/routes",
    icon: routesIcon,
    label: "Routes & Paths",
    description: "Geospatial routing configurations",
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
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationsList, setNotificationsList] = useState<NotificationItem[]>([]);
  const location = useLocation();
  const navigate = useNavigate();

  const title =
    links.find((l) => l.to === location.pathname)?.label ?? "Dashboard Overview";

  useEffect(() => {
    localStorage.setItem("isucamp_sidebar_minimized", String(minimized));
  }, [minimized]);

  useEffect(() => {
    services.notifications.list().then(setNotificationsList).catch(() => {});
  }, [location.pathname]);

  const hasUnread = notificationsList.some((n) => !n.read);

  const handleSearchSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      const q = searchQuery.trim();
      if (q.toLowerCase().startsWith("dev-") || q.toLowerCase().startsWith("usr-")) {
        navigate(`/users?q=${encodeURIComponent(q)}`);
      } else {
        navigate(`/locations?q=${encodeURIComponent(q)}`);
      }
    }
  };

  const handleMarkAllRead = async () => {
    await services.notifications.markAllRead();
    setNotificationsList((current) => current.map((n) => ({ ...n, read: true })));
  };

  const handleToggleMinimize = () => {
    setMinimized((current) => !current);
    setShowProfileMenu(false);
  };

  return (
    <div className="app-shell">
      <aside
        className={`sidebar${open ? " open" : ""}${minimized ? " minimized" : ""}`}
        aria-label="Main Navigation"
      >
        <div className="sidebar-top-section">
          <div className="brand">
            <div className="brand-mark" title="ISU-CAMP">
              <img src={logo} alt="ISU-CAMP logo" />
            </div>
            {!minimized && (
              <div className="sidebar-brand-copy">
                <strong>ISU-CAMP</strong>
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
              <button
                type="button"
                className="minimized-avatar-btn"
                onClick={() => setShowProfileMenu((prev) => !prev)}
                aria-label="Open user profile menu"
                aria-expanded={showProfileMenu}
                title={`Signed in as ${session?.username ?? "Admin Justine"}`}
              >
                <img src={profileUserIcon} alt="" />
                <span className="online-indicator" />
              </button>

              {showProfileMenu && (
                <>
                  <div
                    className="profile-popover-backdrop"
                    onClick={() => setShowProfileMenu(false)}
                  />
                  <div className="profile-popover" role="dialog" aria-label="User details">
                    <div className="profile-popover-header">
                      <div className="popover-avatar">
                        <img src={profileUserIcon} alt="" />
                      </div>
                      <div>
                        <strong>{session?.username ?? "Admin Justine"}</strong>
                        <span className="popover-role">ADMINISTRATOR</span>
                      </div>
                    </div>
                    <div className="profile-popover-divider" />
                    <button
                      type="button"
                      className="profile-popover-signout"
                      onClick={() => {
                        setShowProfileMenu(false);
                        setConfirm(true);
                      }}
                    >
                      <img src={signOutIcon} alt="" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="profile">
              <div className="avatar">
                <img src={profileUserIcon} alt="" />
              </div>
              <div className="profile-copy">
                <strong>{session?.username ?? "Admin Justine"}</strong>
                <small>ADMINISTRATOR</small>
              </div>
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
          <div className="global-search">
            <img src={searchIcon} alt="" />
            <input
              placeholder="Search entities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchSubmit}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="search-clear-btn"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <div className="notification-wrapper" style={{ position: "relative" }}>
            <button
              className="icon-btn"
              aria-label="Notifications"
              onClick={() => setShowNotifications(!showNotifications)}
            >
              <img src={notificationsIcon} alt="" />
              {hasUnread && <em />}
            </button>
            {showNotifications && (
              <div className="notification-dropdown">
                <div className="notification-header">
                  <strong>Notifications</strong>
                  <button type="button" onClick={handleMarkAllRead}>
                    Mark all read
                  </button>
                </div>
                <div className="notification-list">
                  {notificationsList.length > 0 ? (
                    notificationsList.map((item) => (
                      <div
                        key={item.id}
                        className={`notification-item ${item.read ? "read" : "unread"}`}
                        onClick={async () => {
                          await services.notifications.markRead(item.id);
                          setNotificationsList((current) =>
                            current.map((n) =>
                              n.id === item.id ? { ...n, read: true } : n
                            )
                          );
                        }}
                      >
                        <div className="notification-title">
                          <span>{item.title}</span>
                          <small>{item.time}</small>
                        </div>
                        <p>{item.message}</p>
                      </div>
                    ))
                  ) : (
                    <div className="notification-empty">No notifications</div>
                  )}
                </div>
                <div className="notification-footer">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNotifications(false);
                      navigate("/system-logs");
                    }}
                  >
                    View System Logs →
                  </button>
                </div>
              </div>
            )}
          </div>
          <div
            className="avatar small"
            style={{ cursor: "pointer" }}
            title={`Signed in as ${session?.username ?? "Admin User"}`}
            onClick={() => setConfirm(true)}
          >
            <img src={profileUserIcon} alt="" />
          </div>
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
                  You’ll need to sign in again to access the ISU-CAMP admin
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
