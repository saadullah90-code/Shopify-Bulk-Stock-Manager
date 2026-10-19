import { Router, type IRouter } from "express";
import {
  GetSessionResponse,
  LoginBody,
  LoginResponse,
  LogoutResponse,
} from "@workspace/api-zod";
import {
  clearAppSession,
  getAppSession,
  hasSameOrigin,
  isSecurityConfigurationReady,
  issueAppSession,
  passwordMatches,
} from "../lib/app-session";

const router: IRouter = Router();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 8;
const failedAttempts = new Map<string, { count: number; resetAt: number }>();

router.get("/auth/session", (req, res): void => {
  res.json(GetSessionResponse.parse({ authenticated: Boolean(getAppSession(req)) }));
});

router.post("/auth/login", (req, res): void => {
  if (!hasSameOrigin(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  if (!isSecurityConfigurationReady()) {
    res.status(503).json({
      error:
        "App setup is incomplete. Add APP_PASSWORD and SESSION_SECRET in Replit Secrets.",
    });
    return;
  }

  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter the app password to continue." });
    return;
  }

  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const attempt = failedAttempts.get(key);
  if (attempt && attempt.resetAt > now && attempt.count >= MAX_FAILED_ATTEMPTS) {
    res.status(429).json({
      error: "Too many failed attempts. Wait 15 minutes before trying again.",
    });
    return;
  }
  if (!attempt || attempt.resetAt <= now) {
    failedAttempts.set(key, { count: 0, resetAt: now + ATTEMPT_WINDOW_MS });
  }

  if (!passwordMatches(parsed.data.password)) {
    const current = failedAttempts.get(key)!;
    current.count += 1;
    res.status(401).json({ error: "That password did not match." });
    return;
  }

  failedAttempts.delete(key);
  issueAppSession(res, req);
  res.json(LoginResponse.parse({ authenticated: true }));
});

router.post("/auth/logout", (req, res): void => {
  if (!hasSameOrigin(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  clearAppSession(res, req);
  res.json(LogoutResponse.parse({ authenticated: false }));
});

export default router;
