import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

app.use("/api", router);
app.use((error: { type?: string; status?: number }, req: Request, res: Response, _next: NextFunction) => {
  if (error.type === "entity.too.large") {
    res.status(413).json({ error: "The request is too large. Use at most 100 order numbers." });
    return;
  }
  if (error.status === 400) {
    res.status(400).json({ error: "The request body must be valid JSON." });
    return;
  }
  req.log.error("Unhandled request failure");
  res.status(500).json({ error: "The request could not be completed." });
});

export default app;
