import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { supabaseAdmin } from "./supabase-admin";
import { Lock, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { useRoleContext } from "./RoleContext";

// ── Change own password ───────────────────────────────────────
function ChangeMyPassword() {
  const [newPass,     setNewPass]     = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");
  const [success,     setSuccess]     = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (newPass.length < 6)       { setError("Password must be at least 6 characters."); return; }
    if (newPass !== confirmPass)   { setError("Passwords do not match."); return; }

    setSaving(true);
    const { error: err } = await supabase.auth.updateUser({ password: newPass });
    if (err) { setError(err.message); }
    else {
      setSuccess("Password updated successfully.");
      setNewPass(""); setConfirmPass("");
    }
    setSaving(false);
  };

  return (
    <div className="am-card">
      <h3 className="am-card-title">Change My Password</h3>
      <p className="am-card-desc">Takes effect immediately — you stay logged in.</p>
      <form onSubmit={submit} className="am-form">
        <div className="am-field">
          <label className="am-label">New Password</label>
          <input
            className="am-input"
            type="password"
            placeholder="Min. 6 characters"
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="am-field">
          <label className="am-label">Confirm New Password</label>
          <input
            className="am-input"
            type="password"
            placeholder="Re-enter new password"
            value={confirmPass}
            onChange={(e) => setConfirmPass(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        {error   && <p className="am-error">{error}</p>}
        {success && <p className="am-success">{success}</p>}
        <button type="submit" disabled={saving} className="am-submit-btn">
          {saving ? <Loader2 size={14} className="spinning" /> : <Lock size={14} />}
          Update Password
        </button>
      </form>
    </div>
  );
}

// ── Reset another user's password (admin / teacher) ──────────
function ResetUserPassword({ canResetRoles }) {
  const [users,      setUsers]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [targetId,   setTargetId]   = useState("");
  const [newPass,    setNewPass]    = useState("");
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState("");
  const [success,    setSuccess]    = useState("");

  const load = async () => {
    setLoading(true);
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("role", canResetRoles);

    const ids = (roleRows || []).map((r) => r.user_id);
    if (!ids.length) { setUsers([]); setLoading(false); return; }

    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
    const roleMap = Object.fromEntries((roleRows || []).map((r) => [r.user_id, r.role]));

    const filtered = (usersData?.users || [])
      .filter((u) => ids.includes(u.id))
      .map((u) => ({ id: u.id, email: u.email, role: roleMap[u.id] }));

    setUsers(filtered);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!targetId)           { setError("Select a user."); return; }
    if (newPass.length < 6)  { setError("Password must be at least 6 characters."); return; }

    setSaving(true);
    const { error: err } = await supabaseAdmin.auth.admin.updateUserById(targetId, { password: newPass });
    if (err) { setError(err.message); }
    else {
      const u = users.find((u) => u.id === targetId);
      setSuccess(`Password reset for ${u?.email || targetId}.`);
      setTargetId(""); setNewPass("");
    }
    setSaving(false);
  };

  const roleLabel = (r) => r === "ta" ? "TA" : r === "teacher" ? "Teacher" : r;

  return (
    <div className="am-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <h3 className="am-card-title" style={{ marginBottom: 0 }}>Reset User Password</h3>
        <button className="am-refresh-btn" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={loading ? "spinning" : ""} />
        </button>
      </div>
      <p className="am-card-desc">
        Reset the password for {canResetRoles.includes("teacher") ? "any" : "a TA"} account immediately.
      </p>
      {loading ? (
        <div className="am-loading"><Loader2 size={18} className="spinning" /></div>
      ) : users.length === 0 ? (
        <p className="am-empty">No accounts available to reset.</p>
      ) : (
        <form onSubmit={submit} className="am-form">
          <div className="am-field">
            <label className="am-label">Select User</label>
            <select
              className="am-input am-select"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">Choose account…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email} ({roleLabel(u.role)})
                </option>
              ))}
            </select>
          </div>
          <div className="am-field">
            <label className="am-label">New Password</label>
            <input
              className="am-input"
              type="password"
              placeholder="Min. 6 characters"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          {error   && <p className="am-error">{error}</p>}
          {success && <p className="am-success">{success}</p>}
          <button type="submit" disabled={saving} className="am-submit-btn">
            {saving ? <Loader2 size={14} className="spinning" /> : <KeyRound size={14} />}
            Reset Password
          </button>
        </form>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function AccountSettings({ userEmail }) {
  const { isAdmin, isTeacher } = useRoleContext();

  // Admin can reset teachers + TAs; teacher can reset TAs only
  const resetRoles = isAdmin ? ["teacher", "ta"] : isTeacher ? ["ta"] : null;

  return (
    <div className="am-page">
      <div className="am-top-bar">
        <div className="am-top-bar-left">
          <div className="am-icon-circle"><Lock size={18} /></div>
          <div>
            <h2 className="am-title">Account Settings</h2>
            <p className="am-subtitle">{userEmail}</p>
          </div>
        </div>
      </div>

      <div className="am-grid">
        <ChangeMyPassword />
        {resetRoles && <ResetUserPassword canResetRoles={resetRoles} />}
      </div>
    </div>
  );
}
