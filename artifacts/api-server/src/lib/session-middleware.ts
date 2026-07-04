import type { Request, Response, NextFunction } from "express";
import { resolveSession, SESSION_COOKIE, type SessionUser } from "./auth";

declare global {
  namespace Express {
    interface Request {
      sessionUser?: SessionUser | null;
    }
  }
}

export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const raw = req.headers.cookie ?? "";
  const token = parseCookie(raw, SESSION_COOKIE);
  req.sessionUser = await resolveSession(token).catch(() => null);
  next();
}

function parseCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v ?? "");
  }
  return undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.sessionUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
