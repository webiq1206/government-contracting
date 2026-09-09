import { cache } from "react";

// Next's server-rendering React build supplies cache. The standalone worker
// uses stable React 18, which does not. Never replace this with a process-wide
// Map: authentication and tenant facts must not persist between requests.
export const requestCache: typeof cache = typeof cache === "function" ? cache : (fn) => fn;
