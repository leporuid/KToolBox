import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, ApiError } from "./api";
import type { Session } from "../types";

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  sessionError: Error | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  invalidateSession: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    api<Session>("/session")
      .then((value) => {
        if (active) {
          setSession(value);
          setSessionError(null);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          setSessionError(null);
          return;
        }
        setSessionError(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      sessionError,
      login: async (username, password) => {
        const next = await api<Session>("/session/login", {
          method: "POST",
          body: { username, password },
        });
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        setSessionError(null);
        setSession(next);
      },
      logout: async () => {
        if (session) {
          await api<void>("/session/logout", {
            method: "POST",
            csrfToken: session.csrf_token,
          });
        }
        setSession(null);
      },
      invalidateSession: () => setSession(null),
    }),
    [loading, session, sessionError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue;
export function useAuth(required: false): AuthContextValue | null;
export function useAuth(required = true): AuthContextValue | null {
  const value = useContext(AuthContext);
  if (!value && required) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
