// Read lazily: `next build` imports this module without runtime env vars
// (e.g. inside a Docker build), so only fail when the value is actually used.
export const env = {
  get apiUrl(): string {
    const apiUrl = process.env.API_URL;
    if (!apiUrl) {
      throw new Error("API_URL is not set. Check web/.env");
    }
    return apiUrl;
  },
};
