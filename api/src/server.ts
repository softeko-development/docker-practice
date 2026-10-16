import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { z } from "zod";
import { env } from "./env.js";
import { usersRouter } from "./routes/users.js";

const app = express();

// ---------- Middleware ----------
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.split(",") }));
app.use(express.json({ limit: "100kb" }));

// ---------- Routes (add new resources here) ----------
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
app.use("/api/users", usersRouter);

app.use((_req, res) => {
  res.status(404).json({ message: "Not found" });
});

// ---------- Error handler (must be last) ----------
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(err).fieldErrors });
    return;
  }
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
};
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`API listening on :${env.PORT}`);
});
