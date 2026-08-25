import { useSession } from "@/providers/session-provider";

/** Consumes the session through the context hook; owns no call. */
export function AccountMenu() {
  const session = useSession();
  return <nav>{String(session)}</nav>;
}
