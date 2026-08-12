import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { prisma } from './db/prisma.ts';
import { env } from './env.ts';
import { attachRoutes } from './routes/index.ts';
import { ensureDefaultAdminUser, seedDefaultMarketplaces, seedDefaultAIProviders } from './bootstrap.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function buildServer() {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
          styleSrcAttr: ["'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:', 'http:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
      hidePoweredBy: true,
      ieNoOpen: true,
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      xssFilter: true,
    })
  );

  app.use(compression());

  const corsWhitelist = process.env.CORS_ORIGIN
    ?.split(',')
    ?.map((s) => s.trim())
    .filter(Boolean) ?? [];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return callback(null, true);
        if (corsWhitelist.includes(origin)) return callback(null, true);
        console.warn(`[CORS] Blocked origin: ${origin}`);
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token', 'x-token', 'x-csrf-token'],
    })
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  if (process.env.NODE_ENV === 'production') {
    app.use(morgan('combined', {
      skip: (req) => req.url === '/health' || req.url === '/api-status',
    }));
  } else {
    app.use(morgan('dev', {
      skip: (req) => req.url === '/health' || req.url === '/api-status',
    }));
  }

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 1000,
      standardHeaders: true,
      legacyHeaders: false,
      message: { ok: false, error: { code: 'RATE_LIMIT', message: 'too_many_requests' } },
    })
  );

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'dg-stok-integrator-server' });
  });

  app.get('/api-status', (_req, res) => {
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
    });
  });

  // Auth routes (sıkı rate limit - 15 dk / 20 deneme)
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: { code: 'RATE_LIMIT', message: 'too_many_attempts' } },
  });

  app.post('/auth/login', authLimiter, async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'email_password_required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

    const token = jwt.sign(
      { role: user.role, sub: user.id },
      env.JWT_SECRET,
      env.JWT_EXPIRES_IN ? ({ expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions) : undefined
    );

    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
    });

    return res.json({
      ok: true,
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  });

  app.get('/auth/me', async (req, res) => {
    let token = req.cookies?.token;
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }
    if (!token) {
      const xToken = req.headers['x-auth-token'] || req.headers['x-token'];
      if (xToken) token = String(xToken);
    }
    if (!token) {
      return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'unauthorized' } });
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload & { sub?: string; role?: string };
      if (!decoded?.sub) {
        return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'unauthorized' } });
      }

      const user = await prisma.user.findUnique({
        where: { id: String(decoded.sub) },
        select: { id: true, email: true, role: true, name: true },
      });

      if (!user) {
        return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      }

      return res.json(user);
    } catch {
      return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'invalid token' } });
    }
  });

  attachRoutes(app);

  // Serve frontend static files (both dev and production)
  const possiblePaths = [
    path.join(__dirname, '../../dist'),          // tsx runtime: server/src -> dist (repo root)
    path.join(process.cwd(), 'dist'),            // cwd based
    path.join(process.cwd(), '..', 'dist'),      // fallback from server cwd
    path.join(__dirname, '../..', 'dist'),
  ];

  let webDistPath = '';
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        webDistPath = p;
        break;
      }
    } catch { /* ignore */ }
  }

  if (webDistPath) {
    console.log(`[server] Serving frontend from: ${webDistPath}`);
    app.use(express.static(webDistPath));

    app.get('*', (_req, res) => {
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  } else {
    console.warn('[server] Frontend dist not found, API-only mode');
    console.warn('[server] Run: npm run build (vite) in the theme root');
  }

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT ?? 4000);
  const app = buildServer();
  const server = http.createServer(app);

  server.listen(port, async () => {
    console.log(`[server] listening on :${port}`);
    console.log(`[server] Web UI: http://localhost:${port}`);

    try {
      await ensureDefaultAdminUser();
      console.log('[server] admin user ready (admin@dgstok.com / admin123)');
      await seedDefaultMarketplaces();
      console.log('[server] default marketplaces seeded');
      await seedDefaultAIProviders();
      console.log('[server] default AI providers seeded');
    } catch (error) {
      console.error('[server] database bootstrap failed', error);
    }
  });
}
