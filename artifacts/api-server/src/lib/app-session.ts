import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Request, Response } from "express";

export const SESSION_COOKIE = "sbsm_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const sessions = new Map<string, AppSession>();

export interface AppSession {
  id: string;
  expiresAt: number;
}

function secret(): string | undefined {
  return process.env.SESSION_SECRET;
}

function signature(payload: string): string | undefined {
  const key = secret();
  if (!key) return undefined;
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function getAppSession(req: Request): AppSession | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string") return null;

  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;

  const expectedSignature = signature(payload);
  if (!expectedSignature) return null;

  const expected = Buffer.from(expectedSignature);
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<AppSession>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      return null;
    }
    const live = sessions.get(parsed.id);
    if (!live || live.expiresAt !== parsed.expiresAt) return null;
    return live;
  } catch {
    return null;
  }
}

export function issueAppSession(res: Response, req: Request): AppSession {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const session: AppSession = { id: randomUUID(), expiresAt };
  for (const [id, existing] of sessions) {
    if (existing.expiresAt <= Date.now()) sessions.delete(id);
  }
  sessions.set(session.id, session);
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signed = signature(payload);
  if (!signed) throw new Error("SESSION_SECRET is not configured.");

  res.cookie(SESSION_COOKIE, `${payload}.${signed}`, {
    httpOnly: true,
    secure:
      process.env.NODE_ENV === "production" ||
      req.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https",
    sameSite: "strict",
    path: "/api",
    maxAge: SESSION_DURATION_MS,
  });
  return session;
}

export function clearAppSession(res: Response, req: Request): void {
  const session = getAppSession(req);
  if (session) sessions.delete(session.id);
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure:
      process.env.NODE_ENV === "production" ||
      req.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https",
    sameSite: "strict",
    path: "/api",
  });
}

export function passwordMatches(candidate: string): boolean {
  const configured = process.env.APP_PASSWORD;
  if (!configured) return false;
  const candidateHash = createHash("sha256").update(candidate).digest();
  const configuredHash = createHash("sha256").update(configured).digest();
  return timingSafeEqual(candidateHash, configuredHash);
}

export function isSecurityConfigurationReady(): boolean {
  return Boolean(process.env.APP_PASSWORD && process.env.SESSION_SECRET);
}

export function hasSameOrigin(req: Request): boolean {
  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const origin = req.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).host === req.get("host");
  } catch {
    return false;
  }
}
