import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { getRequestLog } from './logger.js';
import { requestLogger } from './middleware/request-logger.js';
import { shuttingDownMiddleware } from './graceful-shutdown.js';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import attendanceRoutes from './routes/attendance.js';
import memberRoutes from './routes/members.js';
import faqRoutes from './routes/faqs.js';
import healthRoutes from './routes/health.js';

/**
 * @param {{ getIsShuttingDown?: () => boolean }} options
 */
export function createApp({ getIsShuttingDown = () => false } = {}) {
  const app = express();

  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
      credentials: true,
    })
  );
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => shuttingDownMiddleware(getIsShuttingDown)(req, res, next));
  app.use(requestLogger());

  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/members', memberRoutes);
  app.use('/api/faqs', faqRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(appErrorHandler);

  return app;
}

export function appErrorHandler(err, req, res, _next) {
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0];
    const message =
      field === 'username'
        ? 'This username is already taken'
        : 'An account with this email already exists';
    return res.status(409).json({ error: message });
  }

  getRequestLog(req).error(
    {
      err,
      requestId: req.id,
      method: req.method,
      url: req.originalUrl,
      userId: req.user?._id?.toString(),
      username: req.user?.username,
    },
    'Unhandled request error'
  );
  res.status(500).json({ error: 'Something went wrong' });
}
