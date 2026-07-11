import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';

import { env } from './config/env';
import { sessionRouter } from './routes/session';
import { toolsRouter } from './routes/tools';
import { miscRouter } from './routes/misc';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(
  pinoHttp({
    autoLogging: {
      ignore: (req) => req.url === '/api/health',
    },
  })
);

// Lock CORS down to the configured frontend origin(s) - the browser talks
// directly to OpenAI for audio, so this backend only ever handles JSON.
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || env.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: false,
  })
);

// The realtime session endpoint calls out to OpenAI, and the tool endpoints
// call out to GoHighLevel, both worth protecting from abuse independent of
// any reverse-proxy rate limiting you add in front of this service.
app.use(
  '/api/',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use('/api', sessionRouter);
app.use('/api', toolsRouter);
app.use('/api', miscRouter);

app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`GLG Emma backend listening on port ${env.port} (${env.nodeEnv})`);
  console.log(`Allowed origins: ${env.allowedOrigins.join(', ')}`);
});
