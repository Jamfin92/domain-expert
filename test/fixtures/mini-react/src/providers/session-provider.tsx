import { createContext, useContext } from "react";

const sessionService = {
  async me(): Promise<unknown> {
    const res = await fetch("/api/session");
    return res.json();
  },
};

const SessionContext = createContext<unknown>(null);

/**
 * The provider swallow, modelled exactly: the provider component references
 * the service, its consumers read a context value and reference nothing, so
 * the session call attributes to SessionProvider and NOT to AccountMenu.
 */
export function SessionProvider(props: { children?: unknown }) {
  const value = sessionService.me;
  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
}

export function useSession(): unknown {
  return useContext(SessionContext);
}
