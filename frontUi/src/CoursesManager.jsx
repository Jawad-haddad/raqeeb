import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { BookOpen, Plus, Trash2, Loader2, RefreshCw } from "lucide-react";

export default function CoursesManager() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const fetchCourses = async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("courses")
      .select("*")
      .order("created_at", { ascending: false });
    if (!err) setCourses(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchCourses(); }, []);

  const createCourse = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!name.trim()) { setError("Course name is required."); return; }
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: err } = await supabase.from("courses").insert({
      name: name.trim(),
      code: code.trim() || null,
      created_by: user.id,
    });
    if (err) { setError(err.message); }
    else {
      setSuccess(`Course "${name.trim()}" created.`);
      setName(""); setCode("");
      fetchCourses();
    }
    setSubmitting(false);
  };

  const deleteCourse = async (id, courseName) => {
    if (!window.confirm(`Delete course "${courseName}"?`)) return;
    await supabase.from("courses").delete().eq("id", id);
    setCourses((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="am-page">
      <div className="am-top-bar">
        <div className="am-top-bar-left">
          <div className="am-icon-circle">
            <BookOpen size={18} />
          </div>
          <div>
            <h2 className="am-title">Courses</h2>
            <p className="am-subtitle">Manage courses used in exam sessions</p>
          </div>
        </div>
        <button className="am-refresh-btn" onClick={fetchCourses} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spinning" : ""} />
        </button>
      </div>

      <div className="am-grid">
        <div className="am-card">
          <h3 className="am-card-title">Add Course</h3>
          <form onSubmit={createCourse} className="am-form">
            <div className="am-field">
              <label className="am-label">Course Name *</label>
              <input className="am-input" placeholder="e.g. Data Structures" value={name}
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="am-field">
              <label className="am-label">Course Code</label>
              <input className="am-input" placeholder="e.g. CS301" value={code}
                onChange={(e) => setCode(e.target.value)} />
            </div>
            {error   && <p className="am-error">{error}</p>}
            {success && <p className="am-success">{success}</p>}
            <button type="submit" disabled={submitting} className="am-submit-btn">
              {submitting ? <Loader2 size={14} className="spinning" /> : <Plus size={14} />}
              Add Course
            </button>
          </form>
        </div>

        <div className="am-card">
          <h3 className="am-card-title">All Courses</h3>
          {loading ? (
            <div className="am-loading"><Loader2 size={20} className="spinning" /></div>
          ) : courses.length === 0 ? (
            <p className="am-empty">No courses yet.</p>
          ) : (
            <div className="am-list">
              {courses.map((c) => (
                <div key={c.id} className="am-item">
                  <div className="am-item-info">
                    <span className="am-item-email">{c.name}</span>
                    {c.code && (
                      <div className="am-item-badges">
                        <span className="hall-meta-badge">{c.code}</span>
                      </div>
                    )}
                  </div>
                  <button className="am-delete-btn" onClick={() => deleteCourse(c.id, c.name)}>
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
