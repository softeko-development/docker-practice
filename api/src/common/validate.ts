import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { z } from "zod";
import { HttpError } from "./errors.js";

type Source = "body" | "query";

/** Validates req[source] with zod and stores the parsed result on res.locals[source]. */
export const validate =
  (schema: ZodType, source: Source): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      throw new HttpError(400, "Validation failed", z.flattenError(result.error).fieldErrors as Record<string, string[]>);
    }
    res.locals[source] = result.data;
    next();
  };
