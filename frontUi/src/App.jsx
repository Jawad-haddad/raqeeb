import { useEffect, useState } from "react";
import "./App.css";
import Dashboard from "./Dashboard";
import LoginPage from "./LoginPage";
import { supabase } from "../supabase";

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      }
    );

    return () => subscription.subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) return null;

  if (!session) {
    return <LoginPage />;
  }

  return <Dashboard onLogout={handleLogout} />;
}

export default App;






