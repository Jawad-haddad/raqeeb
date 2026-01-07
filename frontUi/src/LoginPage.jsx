import { useState } from "react";

const CORRECT_EMAIL = import.meta.env.VITE_ADMIN_EMAIL;
const CORRECT_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();

    if (email === CORRECT_EMAIL && password === CORRECT_PASSWORD) {
      setError("");
      onLogin();
    } else {
      setError("Wrong email or password");
    }
  };

  return (
    <div className="login-page">
      <div className="login-card-wrapper">
        <div className="login-logo-circle">
          <span className="login-logo">📡</span>
        </div>
        <h1 className="login-title">ESP32 Monitor</h1>
        <p className="login-subtitle">Sign in to your dashboard</p>

        <div className="login-card">
          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label className="login-label">Email Address</label>
              <input
                type="email"
                className="login-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="login-field">
              <label className="login-label">Password</label>
              <input
                type="password"
                className="login-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && <p className="login-error">{error}</p>}

            <button type="submit" className="login-button">
              Sign in
            </button>
          </form>

          <p className="login-hint">
            Hint: {CORRECT_EMAIL} / {CORRECT_PASSWORD}
          </p>
        </div>
      </div>
    </div>
  );
}
// env fix
// using env variables for login
// force change for supabase auth
// force change for supabase auth
// force commit
