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

// Render sits in front of this app behind its own reverse proxy - without
// this, express-rate-limit can't reliably tell real clients apart by IP
// (everything looks like it's coming from the same proxy hop).
app.set('trust proxy', 1);

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
//
// A single live voice call is far chattier than it looks: the frontend logs
// every finalized transcript line (both sides of the conversation) and calls
// save_lead_details repeatedly as details come up naturally, easily 40-60+
// requests over a few minutes - all *before* booking, which tends to happen
// late in the call. 60 req/min for the whole API meant a normal call could
// trip the limit right as book_demo_appointment ran, get a non-JSON 429 back
// with no useful detail, and then trip the same limit again on the immediate
// retry - surfacing as a booking failure that had nothing to do with the
// calendar. 300/min gives a real call comfortable headroom while still
// catching scripted abuse (5 req/s sustained is not normal browser traffic).
app.use(
  '/api/',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
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
