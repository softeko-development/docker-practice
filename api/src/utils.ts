import sanitizeHtml from "sanitize-html";
import { z } from "zod";

// A string that has all HTML tags removed, so <script> can never be stored.
export const cleanString = () =>
  z.string().transform((value) => sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim());
