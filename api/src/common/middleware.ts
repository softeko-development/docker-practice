import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "./errors.js";

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ message: "Not found" });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message, errors: err.errors });
    return;
  }
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
};
