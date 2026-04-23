import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { Building2, Plus, Trash2, Loader2, RefreshCw } from "lucide-react";

export default function HallsManager() {
  const [halls, setHalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  const [anchorRef, setAnchorRef] = useState("");
  const [anchorIds, setAnchorIds] = useState("");

  const fetchHalls = async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("halls")
      .select("*")
      .order("created_at", { ascending: false });
    if (!err) setHalls(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchHalls(); }, []);

  const createHall = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!name.trim()) { setError("Hall name is required."); return; }
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    const parsedAnchorIds = anchorIds.split(",").map((s) => s.trim()).filter(Boolean);
    const { error: err } = await supabase.from("halls").insert({
      name: name.trim(),
      location: location.trim() || null,
      rows: Number(rows),
      columns: Number(columns),
      anchor_ref: anchorRef.trim() || null,
      anchor_ids: parsedAnchorIds.length > 0 ? parsedAnchorIds : null,
      created_by: user.id,
    });
    if (err) { setError(err.message); }
    else {
      setSuccess(`Hall "${name.trim()}" created.`);
      setName(""); setLocation(""); setRows(3); setColumns(3); setAnchorRef(""); setAnchorIds("");
      fetchHalls();
    }
    setSubmitting(false);
  };

  const deleteHall = async (id, hallName) => {
    if (!window.confirm(`Delete hall "${hallName}"? This will affect any assignments and sessions linked to it.`)) return;
    await supabase.from("halls").delete().eq("id", id);
    setHalls((prev) => prev.filter((h) => h.id !== id));
  };

  return (
    <div className="am-page">
      <div className="am-top-bar">
        <div className="am-top-bar-left">
          <div className="am-icon-circle">
            <Building2 size={18} />
          </div>
          <div>
            <h2 className="am-title">Halls Manager</h2>
            <p className="am-subtitle">Create and manage exam halls</p>
          </div>
        </div>
        <button className="am-refresh-btn" onClick={fetchHalls} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spinning" : ""} />
        </button>
      </div>

      <div className="am-grid">
        {/* Create form */}
        <div className="am-card">
          <h3 className="am-card-title">New Hall</h3>
          <p className="am-card-desc">Define an exam room with its layout.</p>
          <form onSubmit={createHall} className="am-form">
            <div className="am-field">
              <label className="am-label">Hall Name *</label>
              <input className="am-input" placeholder="e.g. Hall A" value={name}
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="am-field">
              <label className="am-label">Location</label>
              <input className="am-input" placeholder="e.g. Building 2, Floor 1" value={location}
                onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="hall-grid-fields">
              <div className="am-field">
                <label className="am-label">Rows</label>
                <input className="am-input" type="number" min={1} max={20} value={rows}
                  onChange={(e) => setRows(e.target.value)} />
              </div>
              <div className="am-field">
                <label className="am-label">Columns</label>
                <input className="am-input" type="number" min={1} max={20} value={columns}
                  onChange={(e) => setColumns(e.target.value)} />
              </div>
            </div>
            <div className="am-field">
              <label className="am-label">Starting Anchor Ref</label>
              <input className="am-input" placeholder="e.g. anchor-1 (front-left)" value={anchorRef}
                onChange={(e) => setAnchorRef(e.target.value)} />
            </div>
            <div className="am-field">
              <label className="am-label">Anchor IDs (comma-separated)</label>
              <input className="am-input" placeholder="e.g. esp-01, esp-02, esp-03" value={anchorIds}
                onChange={(e) => setAnchorIds(e.target.value)} />
            </div>
            {error   && <p className="am-error">{error}</p>}
            {success && <p className="am-success">{success}</p>}
            <button type="submit" disabled={submitting} className="am-submit-btn">
              {submitting ? <Loader2 size={14} className="spinning" /> : <Plus size={14} />}
              Create Hall
            </button>
          </form>
        </div>

        {/* Halls list */}
        <div className="am-card">
          <h3 className="am-card-title">All Halls</h3>
          {loading ? (
            <div className="am-loading"><Loader2 size={20} className="spinning" /></div>
          ) : halls.length === 0 ? (
            <p className="am-empty">No halls created yet.</p>
          ) : (
            <div className="am-list">
              {halls.map((h) => (
                <div key={h.id} className="am-item">
                  <div className="am-item-info">
                    <span className="am-item-email">{h.name}</span>
                    <div className="am-item-badges">
                      <span className="hall-meta-badge">{h.rows}×{h.columns}</span>
                      {h.location && <span className="hall-meta-badge">{h.location}</span>}
                      {h.anchor_ref && <span className="hall-meta-badge">ref: {h.anchor_ref}</span>}
                      {h.anchor_ids?.length > 0 && (
                        <span className="hall-meta-badge">{h.anchor_ids.length} anchor{h.anchor_ids.length !== 1 ? "s" : ""}</span>
                      )}
                    </div>
                  </div>
                  <button className="am-delete-btn" onClick={() => deleteHall(h.id, h.name)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
