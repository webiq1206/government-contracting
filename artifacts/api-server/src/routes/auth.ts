import { Router } from "express";
import type { Request, Response } from "express";
import { authenticate, createSession, destroySession, SESSION_COOKIE } from "../lib/auth";

const router = Router();

router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }
  const user = await authenticate(String(email), String(password)).catch(() => null);
  if (!user) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }
  const token = await createSession(user.id);
  const isProd = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${isProd ? "; Secure" : ""}`
  );
  res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

router.post("/logout", async (req: Request, res: Response) => {
  const raw = req.headers.cookie ?? "";
  const token = parseCookie(raw, SESSION_COOKIE);
  await destroySession(token).catch(() => {});
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

router.get("/me", (req: Request, res: Response) => {
  if (!req.sessionUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(req.sessionUser);
});

function parseCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v ?? "");
  }
  return undefined;
}

export default router;
