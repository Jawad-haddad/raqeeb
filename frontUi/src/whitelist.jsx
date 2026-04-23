import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { Shield, Plus, Loader2, Trash2 } from "lucide-react";
import { useRoleContext } from "./RoleContext";

export default function WhitelistForm({ onInserted }) {
  const { isAdmin, isTeacher } = useRoleContext();
  const canManage = isAdmin || isTeacher;
  const [mac, setMac] = useState("");
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const normMac = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
  const MAC_REGEX = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

  const fetchEntries = async () => {
    const { data } = await supabase
      .from("whitelist")
      .select("id, mac")
      .order("id", { ascending: false });
    setEntries(data || []);
  };

  useEffect(() => { fetchEntries(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const cleanMAC = normMac(mac);
    if (!cleanMAC) { setError("❌ Enter a MAC address."); return; }
    if (!MAC_REGEX.test(cleanMAC)) { setError("❌ Invalid MAC format. Use AA:BB:CC:DD:EE:FF"); return; }

    setLoading(true);
    try {
      const { data: existing } = await supabase
        .from("whitelist").select("id").eq("mac", cleanMAC).limit(1);

      if (existing && existing.length > 0) {
        setError("❌ Already whitelisted.");
        return;
      }

      const { error: insertErr } = await supabase.from("whitelist").insert({ mac: cleanMAC });
      if (insertErr) throw insertErr;

      setSuccess("✔ Device whitelisted!");
      setMac("");
      fetchEntries();
      onInserted?.();
    } catch (err) {
      setError("❌ Failed to insert entry.");
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (id, entryMac) => {
    await supabase.from("whitelist").delete().eq("id", id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    onInserted?.();
  };

  return (
    <div className="whitelist-card">
      <div className="whitelist-header">
        <div className="whitelist-icon-circle">
          <Shield className="whitelist-icon" />
        </div>
        <div>
          <h2 className="whitelist-title">Whitelist</h2>
          <p className="whitelist-subtitle">Trusted devices by MAC</p>
        </div>
      </div>

      {canManage && <form onSubmit={handleSubmit} className="whitelist-form">
        <div className="whitelist-field">
          <label className="whitelist-label">Device MAC</label>
          <input
            className="whitelist-input"
            placeholder="AA:BB:CC:DD:EE:FF"
            value={mac}
            onChange={(e) => setMac(e.target.value)}
          />
        </div>
        <button type="submit" disabled={loading} className="whitelist-button">
          {loading
            ? <><Loader2 className="whitelist-button-icon spinning" />Checking...</>
            : <><Plus className="whitelist-button-icon" />Add to whitelist</>
          }
        </button>
      </form>}

      {canManage && error   && <div className="whitelist-message whitelist-error">{error}</div>}
      {canManage && success && <div className="whitelist-message whitelist-success">{success}</div>}

      {entries.length > 0 && (
        <div className="whitelist-entries">
          <div className="whitelist-entries-list">
            {entries
              .filter((e) => !mac.trim() || e.mac.includes(mac.trim().toLowerCase()))
              .map((entry) => (
                <div key={entry.id} className="whitelist-entry">
                  <span className="whitelist-entry-mac">{entry.mac}</span>
                  {canManage && (
                    <button
                      className="whitelist-entry-remove"
                      onClick={() => handleRemove(entry.id, entry.mac)}
                      title="Remove from whitelist"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))
            }
            {entries.filter((e) => !mac.trim() || e.mac.includes(mac.trim().toLowerCase())).length === 0 && (
              <p className="whitelist-no-results">No matches for "{mac}"</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
