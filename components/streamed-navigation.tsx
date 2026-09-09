"use client";

import { createContext, startTransition, useContext, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Nav } from "@/components/nav";

type NavigationProps = ComponentProps<typeof Nav>;
const UpdateNavigation = createContext<((data: NavigationProps) => void) | null>(null);

/** Keep menu state and focus intact while server status arrives or refreshes. */
export function StreamedNavigation({ initial, children }: { initial: NavigationProps; children: ReactNode }) {
  const [data, setData] = useState<NavigationProps | null>(null);
  return <UpdateNavigation.Provider value={setData}>
    <Nav {...initial} {...data} />
    {children}
  </UpdateNavigation.Provider>;
}

export function NavigationUpdate({ data }: { data: NavigationProps }) {
  const update = useContext(UpdateNavigation);
  // Status is nonurgent. Updating synchronously here can interrupt hydration
  // or an in-flight route transition while the surrounding shell is streaming.
  useEffect(() => { startTransition(() => { update?.(data); }); }, [update, data]);
  return null;
}
