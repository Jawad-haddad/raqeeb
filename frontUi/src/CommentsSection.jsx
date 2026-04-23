import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { MessageSquare, Trash2, Plus, Loader2, X } from "lucide-react";
import { useRoleContext } from "./RoleContext";

export default function CommentsSection({ detectionMac, ssid }) {
  const { isAdmin, isTeacher, isTA } = useRoleContext();
  const canWrite = isAdmin || isTeacher || isTA;
  const canDelete = isAdmin || isTeacher;
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Fetch just the count on mount so the button shows it immediately
  useEffect(() => {
    supabase
      .from("comments")
      .select("id", { count: "exact", head: true })
      .eq("detection_mac", detectionMac)
      .then(({ count: c }) => { if (c !== null) setCount(c); });
  }, [detectionMac]);

  const fetchComments = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("comments")
      .select("id, content, created_at, author_email")
      .eq("detection_mac", detectionMac)
      .order("created_at", { ascending: true });
    if (!error) {
      setComments(data || []);
      setCount(data?.length ?? 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (open) fetchComments();
  }, [open]);

  const addComment = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("comments").insert({
      detection_mac: detectionMac,
      content: trimmed,
      author_id: user.id,
      author_email: user.email,
    });
    if (!error) { setText(""); fetchComments(); }
    setSubmitting(false);
  };

  const deleteComment = async (id) => {
    await supabase.from("comments").delete().eq("id", id);
    setComments((prev) => prev.filter((c) => c.id !== id));
    setCount((n) => n - 1);
  };

  return (
    <>
      <button
        className="comments-toggle"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
      >
        <MessageSquare size={13} />
        <span>Comments{count > 0 ? ` (${count})` : ""}</span>
      </button>

      {open && (
        <div className="comments-modal-backdrop" onClick={() => setOpen(false)}>
          <div className="comments-modal" onClick={(e) => e.stopPropagation()}>
            <div className="comments-modal-header">
              <div>
                <h3 className="comments-modal-title">Comments</h3>
                <p className="comments-modal-sub">{ssid || detectionMac}</p>
              </div>
              <button className="comments-modal-close" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="comments-modal-body">
              {loading ? (
                <div className="comments-loading"><Loader2 size={18} className="spinning" /></div>
              ) : comments.length === 0 ? (
                <p className="comments-empty">No comments yet.</p>
              ) : (
                <div className="comments-list">
                  {comments.map((c) => (
                    <div key={c.id} className="comment-item">
                      <div className="comment-meta">
                        <span className="comment-author">{c.author_email || "Unknown"}</span>
                        <span className="comment-time">{new Date(c.created_at).toLocaleString()}</span>
                      </div>
                      <div className="comment-content-row">
                        <p className="comment-text">{c.content}</p>
                        {canDelete && (
                          <button className="comment-delete-btn" onClick={() => deleteComment(c.id)}>
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {canWrite && (
              <div className="comments-modal-footer">
                <textarea
                  className="comment-input"
                  placeholder="Add a comment… (Ctrl+Enter to submit)"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addComment(); }}
                  rows={2}
                />
                <button
                  className="comment-submit-btn"
                  onClick={addComment}
                  disabled={submitting || !text.trim()}
                >
                  {submitting ? <Loader2 size={12} className="spinning" /> : <Plus size={12} />}
                  Add
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
