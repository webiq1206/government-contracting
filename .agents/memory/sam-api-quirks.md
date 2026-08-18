---
name: SAM.gov API quirks
description: How api.sam.gov reports a bad API key, and why that once looked like an outage or a blocked network.
---

# An unrecognized SAM.gov key returns an empty 404, not 401 or 403

`api.sam.gov` turns an unknown `api_key` away at its gateway before the
application sees it. The response is **HTTP 404, zero-length body,
`server: istio-envoy`**, returned in a couple of milliseconds. It is byte for
byte what a dead URL or a blocking egress proxy looks like.

Verified against the live API on the same URL, same moment: a valid key returns
200, a well-formed but unknown key returns the empty 404.

**Why it matters:** any code that maps 401/403 to "bad key" and everything else
to a generic `HTTP ${status}` will report the single most common credential
problem as a server outage, and send whoever is holding a perfectly good key
hunting for a nonexistent one.

**How to apply:**
- Treat an empty-bodied 404 from `api.sam.gov` as "key not recognized".
- A 404 that *does* carry a body is something else. Show the body.
- Do not conclude "SAM is down" or "our network is blocked" from a 404 alone.
- The v2 opportunities search endpoint is current. A 404 there is about the
  key, not the path.

## curl and Node disagree in this workspace

`curl` picks up the workspace's outbound proxy; Node's `fetch` does not, so a
curl probe can fail in ways the running app never sees. Probe an upstream with
a Node script or through the app's own endpoint.

# A connection test must test the credential the app would use

Integration keys are per organization and encrypted at rest; nothing copies
them into `process.env`, because a shared process environment leaks one
tenant's credential to every other.

**Why:** a "Test connection" button reading `process.env` while the page beside
it says "saved here" about a database value tests a different credential than
the one running. In production that meant testing a leftover placeholder and
reporting SAM.gov as broken.

**How to apply:** resolve through the same per-organization getter the runtime
uses. Also, only record the test outcome against the saved credential when the
saved credential is what was tested. A mistyped draft key must not stamp
"invalid" on a working saved one. And redact the key before putting an upstream
error body on screen or in the database: it travels in the query string, so
gateways quote it back.
