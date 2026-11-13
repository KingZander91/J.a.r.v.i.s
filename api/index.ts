/* Vercel serverless entry point.
   The Express app is exported as the function handler; server/index.ts
   skips app.listen() when VERCEL is set. All /api/* requests are routed
   here by vercel.json. */
import app from '../server/index';

export default app;
