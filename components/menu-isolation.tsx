"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";

function createMenuStore() {
  let open = false;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => open,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setOpen: (next: boolean) => { if (open === next) return; open = next; listeners.forEach(listener => listener()); },
  };
}
const inactive = createMenuStore();
const MenuStore = createContext(inactive);
const serverSnapshot = () => false;

/** Each shell owns its menu. Streamed regions hydrate with the server snapshot
 * before applying the current state, without mutating another React tree. */
export function MenuIsolationProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createMenuStore);
  return <MenuStore.Provider value={store}>{children}</MenuStore.Provider>;
}
export function useMenuIsolation() {
  const store = useContext(MenuStore);
  const open = useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);
  return { open, setOpen: store.setOpen };
}
export function ShellMain(props: ComponentProps<"main">) {
  const { open } = useMenuIsolation();
  return <main {...props} inert={open || undefined} />;
}
