import { setCashContext } from './offlineQueue';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabaseClient';
import type { AppUser } from './types';

interface AuthState {
  appUser: AppUser | null;
  loading: boolean;
  // Set when the person IS authenticated with Supabase but their
  // app_users row couldn't be loaded (network blip, RLS misconfig,
  // or a genuinely missing row for a new auth user). Previously this
  // silently fell back to showing the Login screen again with zero
  // explanation — the person would just keep "logging in" forever.
  error: string | null;
  // True for the brief window after clicking a password-reset email
  // link — Supabase signs the person into a temporary recovery
  // session and fires this event rather than a normal sign-in.
  passwordRecovery: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  appUser: null,
  loading: true,
  error: null,
  passwordRecovery: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    async function loadUser() {
      setError(null);
      const { data: sessionData } = await supabase.auth.getSession();
      const authUser = sessionData.session?.user;
      if (!authUser) {
        setAppUser(null);
        setLoading(false);
        return;
      }
      const { data, error: fetchError } = await supabase
        .from('app_users')
        .select('*')
        .eq('id', authUser.id)
        .single();
      if (fetchError) {
        // Authenticated but no usable app_users row — not the same
        // as "not logged in", so don't silently treat it that way.
        setAppUser(null);
        setError(
          'Signed in, but your account record could not be loaded. Contact HQ if this persists.'
        );
      } else if (!data.is_active) {
        setAppUser(null); setCashContext(null); setError('This account is inactive. Contact HQ.');
      } else {
        setAppUser(data as AppUser);
      }
      setLoading(false);
    }
    void loadUser();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
        setLoading(false);
        return;
      }
      setTimeout(() => void loadUser(), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    setCashContext(null);
    await supabase.auth.signOut();
    setAppUser(null);
    setError(null);
    setPasswordRecovery(false);
  };

  return (
    <AuthContext.Provider value={{ appUser, loading, error, passwordRecovery, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
