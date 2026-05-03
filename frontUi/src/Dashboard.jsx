import { useEffect, useState } from "react";
import WhitelistForm from "./whitelist";
import AccountManager from "./AccountManager";
import AccountSettings from "./AccountSettings";
import HallsManager from "./HallsManager";
import SessionsView from "./SessionsView";
import ReportsView from "./ReportsView";
import TAHallView from "./TAHallView";
import { useRoleContext } from "./RoleContext";
import {
  Radio, Activity, LogOut,
  Users, Building2, FileText, ClipboardList, Settings,
} from "lucide-react";

function roleLabel(role) {
  if (role === "admin")   return "Admin";
  if (role === "teacher") return "Teacher";
  if (role === "ta")      return "TA";
  return role || "User";
}

function navItems(role) {
  if (role === "admin") return [
    { id: "sessions",  label: "Sessions",   Icon: Activity },
    { id: "halls",     label: "Halls",      Icon: Building2 },
    { id: "accounts",  label: "Accounts",   Icon: Users },
    { id: "reports",   label: "Reports",    Icon: FileText },
    { id: "settings",  label: "Settings",   Icon: Settings },
  ];
  if (role === "teacher") return [
    { id: "sessions",  label: "Sessions",   Icon: Activity },
    { id: "accounts",  label: "Manage TAs", Icon: Users },
    { id: "reports",   label: "Reports",    Icon: FileText },
    { id: "settings",  label: "Settings",   Icon: Settings },
  ];
  // TA
  return [
    { id: "ta-session", label: "My Session", Icon: ClipboardList },
    { id: "settings",   label: "Settings",   Icon: Settings },
  ];
}

function defaultView(role) {
  if (role === "admin")   return "sessions";
  if (role === "teacher") return "sessions";
  return "ta-session";
}

export default function Dashboard({ onLogout, userEmail }) {
  const { role, isAdmin, isTeacher } = useRoleContext();
  const [view, setView] = useState(() => defaultView(role));

  useEffect(() => { if (role) setView(defaultView(role)); }, [role]);

  const items        = navItems(role);
  const avatarLetter = (userEmail || "U")[0].toUpperCase();
  const showWhitelist = isAdmin || isTeacher;

  const renderMain = () => {
    switch (view) {
      case "sessions":   return <SessionsView />;
      case "halls":      return <HallsManager />;
      case "accounts":   return <AccountManager />;
      case "reports":    return <ReportsView />;
      case "ta-session": return <TAHallView />;
      case "settings":   return <AccountSettings userEmail={userEmail} />;
      default:           return null;
    }
  };

  return (
    <div className="dashboard">
      <aside className="dashboard-sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo-circle">
            <Radio className="sidebar-logo-icon" />
          </div>
          <div>
            <h1 className="sidebar-title">Raqeeb</h1>
            <p className="sidebar-subtitle">
              <span className="sidebar-status-dot" />
              {roleLabel(role)}
            </p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {items.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`sidebar-nav-btn ${view === id ? "sidebar-nav-active" : ""}`}
              onClick={() => setView(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>

        {showWhitelist && (
          <div className="sidebar-whitelist">
            <WhitelistForm />
          </div>
        )}

        <div className="sidebar-user">
          <div className="sidebar-user-info">
            <div className="sidebar-user-avatar">{avatarLetter}</div>
            <div>
              <p className="sidebar-user-name">{userEmail || "User"}</p>
              <p className="sidebar-user-role">{roleLabel(role)}</p>
            </div>
          </div>
          <button className="sidebar-logout-btn" onClick={onLogout}>
            <LogOut className="sidebar-logout-icon" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="dashboard-main">
        {renderMain()}
      </main>
    </div>
  );
}
