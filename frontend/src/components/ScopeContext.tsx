// Holds the header filters for the whole shell, so a scope picked on the
// overview still applies after moving to the Alert queue or Cases.
import { createContext, useContext, useState, type ReactNode } from "react";
import { DEFAULT_SCOPE, type Scope } from "../lib/scope";

interface Value { scope: Scope; setScope: (s: Scope) => void }

const ScopeContext = createContext<Value | null>(null);

export function ScopeProvider({ children, initial = DEFAULT_SCOPE }: { children: ReactNode; initial?: Scope }) {
  const [scope, setScope] = useState(initial);
  return <ScopeContext.Provider value={{ scope, setScope }}>{children}</ScopeContext.Provider>;
}

export function useScope(): Value {
  const v = useContext(ScopeContext);
  if (!v) throw new Error("useScope must be used inside <ScopeProvider>");
  return v;
}
