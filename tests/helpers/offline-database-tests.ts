/**
 * CI exercises the real disposable database with provider fixtures. Refuse
 * real external traffic even if a fixture forgets to mock a provider call.
 * Installation/build downloads run before this Vitest-only setup is loaded.
 */
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

if (process.env.BROSTCO_TEST_OFFLINE === "1") {
  const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const refuse = () => {
    throw new Error("External network access is disabled in database CI. Mock the provider response.");
  };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args: unknown[]) {
    // Node's connect() normalizer can hand Socket.connect an argument array.
    const values = Array.isArray(args[0]) ? args[0] : args;
    const first = values[0];
    let host: unknown;
    if (first && typeof first === "object") {
      const options = first as { host?: string; path?: string; socket?: unknown };
      if (options.path || options.socket) return refuse();
      host = options.host ?? "localhost";
    } else if (typeof first === "number") {
      host = typeof values[1] === "string" ? values[1] : "localhost";
    } else {
      return refuse();
    }
    if (typeof host !== "string" || !loopback.has(host)) return refuse();
    return Reflect.apply(connect, this, args);
  } as typeof connect;
  tls.connect = refuse as typeof tls.connect;
  const fetchLocal = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!loopback.has(url.hostname)) return refuse();
    // Redirects must not turn an allowed local request into an external send.
    return fetchLocal(input, { ...init, redirect: "error" });
  };
  syncBuiltinESMExports();
}
