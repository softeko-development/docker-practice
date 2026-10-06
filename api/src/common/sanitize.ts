import sanitizeHtml from "sanitize-html";
import { z } from "zod";

/** Strip every HTML tag/attribute; keep text only. */
export const stripHtml = (value: string) =>
  sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim();

/** Zod string that is sanitized before further validation runs. */
export const cleanString = () => z.string().transform(stripHtml);
