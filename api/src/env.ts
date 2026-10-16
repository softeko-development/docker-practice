import { z } from "zod";

// Read and validate environment variables once, at startup.
const schema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
});

export const env = schema.parse(process.env);
