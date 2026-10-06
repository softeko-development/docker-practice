import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler, notFound } from "./common/middleware.js";
import { apiRouter } from "./routes/index.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.split(",") }));
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
app.use("/api", apiRouter);

app.use(notFound);
app.use(errorHandler);
