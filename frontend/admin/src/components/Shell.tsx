import { PropsWithChildren, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { Button, Card } from "./UI";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationsList, setNotificationsList] = useState<NotificationItem[]>([]);
  const location = useLocation();
  const navigate = useNavigate();
  const title =
    links.find((l) => l[0] === location.pathname)?.[2] ?? "Dashboard Overview";

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

  return (
    <div className="app-shell">
      <aside className={open ? "sidebar open" : "sidebar"}>
        <div>
          <div className="brand">
            <div className="brand-mark">
              <img src={logo} alt="ISU-CAMP logo" />
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
          <button className="menu-btn" onClick={() => setOpen(true)} aria-label="Toggle navigation">
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
                            current.map((n) => (n.id === item.id ? { ...n, read: true } : n))
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
            title={`Signed in as ${session?.username ?? "Admin Justine"}`}
            onClick={() => setConfirm(true)}
          >
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
