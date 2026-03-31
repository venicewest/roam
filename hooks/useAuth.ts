// hooks/useAuth.ts
import type { Session, User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { supabase } from "../services/supabase";
import { useUserStore } from "../stores/userStore";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingPasswordRecovery, setPendingPasswordRecovery] = useState(false);
  const { fetchProfile, fetchCategories, reset } = useUserStore();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile();
        fetchCategories();
      }
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (event === "PASSWORD_RECOVERY") {
        // User clicked the reset link — flag this so the root layout
        // does NOT redirect to /(tabs). forgot-password.tsx handles navigation.
        setPendingPasswordRecovery(true);
        return;
      }

      if (event === "SIGNED_IN" && session?.user) {
        setPendingPasswordRecovery(false);
        await fetchProfile();
        await fetchCategories();
      }

      if (event === "USER_UPDATED") {
        // Password was successfully changed — clear recovery flag
        setPendingPasswordRecovery(false);
      }

      if (event === "SIGNED_OUT") {
        setPendingPasswordRecovery(false);
        reset();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return { user, session, loading, signOut, pendingPasswordRecovery };
}
