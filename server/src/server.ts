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
import { router } from './routes/index.ts';
import { ensureDefaultAdminUser, seedDefaultMarketplaces, seedDefaultAIProviders, ensureDefaultListingTemplates, migrateMarketplaceCredentials, migrateAiProviderKeys } from './bootstrap.ts';

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

  // FIX(F-06): CORS — localhost wildcard yerine açık liste. Production'da yalnızca
  // CORS_ORIGIN env'i; development'ta bilinen yerel portlar otomatik izinli.
  const corsWhitelist = process.env.CORS_ORIGIN
    ?.split(',')
    ?.map((s) => s.trim())
    .filter(Boolean) ?? [];

  const DEV_ALLOWED_ORIGINS = ['http://localhost:5175', 'http://127.0.0.1:5175', 'http://localhost:4000', 'http://127.0.0.1:4000'];
  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = [...corsWhitelist, ...(isProduction ? [] : DEV_ALLOWED_ORIGINS)];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        console.warn(`[CORS] Blocked origin: ${origin}`);
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token', 'x-token', 'x-csrf-token'],
    })
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());
  // FIX(F-06): CSRF — cookie ile kimliklenen tarayıcı istekleri için Origin/Host doğrulaması.
  // En az invaziv çözüm: Bearer/x-token kullanan API istemcileri ve Origin göndermeyen
  // non-browser çağrılar etkilenmez; çapraz-origin state-changing istek reddedilir.
  const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  app.use((req, res, next) => {
    if (!STATE_CHANGING_METHODS.has(req.method)) return next();
    const usesCookieAuth = Boolean(req.cookies?.token)
      && !req.headers.authorization
      && !req.headers['x-auth-token']
      && !req.headers['x-token'];
    if (!usesCookieAuth) return next();

    const origin = req.headers.origin;
    if (!origin) return next(); // same-origin tool / non-browser

    try {
      const originHost = new URL(origin).host;
      if (originHost === req.headers.host) return next(); // aynı origin (prod SPA :4000'den servis edilir)
      if (!isProduction && allowedOrigins.includes(origin)) return next(); // vite dev proxy (5175→4000)
    } catch {
      /* bozuk Origin → reddedilir */
    }
    return res.status(403).json({ ok: false, error: { code: 'CSRF_ORIGIN_REJECTED', message: 'cross-origin state change rejected' } });
  });


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

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'dg-stok-integrator-server' });
  });

  app.get('/api/status', (_req, res) => {
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
    });
  });

  // also keep legacy /system/health for backward compat
  app.get('/system/health', (_req, res) => {
    res.json({ ok: true, service: 'dg-stok-integrator-server' });
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

    const usesDefaultPassword = await bcrypt.compare('admin123', user.password);

    let prefs: Record<string, unknown> = {};
    try { prefs = JSON.parse(user.preferences || '{}'); } catch { prefs = {}; }

    // Bilinen default parola tespit edilirse kalıcı zorunlu değişim bayrağı işlenir.
    if (usesDefaultPassword && !prefs.mustChangePassword) {
      prefs.mustChangePassword = true;
      await prisma.user.update({
        where: { id: user.id },
        data: { preferences: JSON.stringify(prefs) },
      });
    }

    const token = jwt.sign(
      { role: user.role, sub: user.id },
      env.JWT_SECRET,
      ({ expiresIn: env.JWT_EXPIRES_IN ?? '8h' } as jwt.SignOptions)
    );

    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      // FIX(F-06): secure yalnızca production'da true — local HTTP development bozulmaz.
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });

    return res.json({
      ok: true,
      token,
      mustChangePassword: usesDefaultPassword || !!prefs.mustChangePassword,
      user: { id: user.id, email: user.email, role: user.role },
    });
  });

  // FIX(LOGOUT-404): UI (index.html doLogout) POST /auth/logout çağırıyordu ama bu route
  // hiç yazılmamıştı → 404. httpOnly cookie JS'ten silinemediği için server-side clearCookie zorunlu.
  // JWT stateless'dır; verilmiş Bearer token süresi dolana kadar geçerli kalır (bilinen sınırlama,
  // davranış değişikliği yapılmaz — yalnızca tarayıcı oturum çerezi temizlenir).
  app.post('/auth/logout', authLimiter, async (_req, res) => {
    res.clearCookie('token', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
    return res.json({ ok: true });
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
      // Oturum yokluğu normal bir durumdur (ilk yükleme); 401 yerine 200+authenticated:false
      // döner ki tarayıcı console'unu kirleten sahte hata oluşmasın. Geçersiz token hâlâ 401'dir.
      return res.json({ ok: true, authenticated: false });
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload & { sub?: string; role?: string };
      if (!decoded?.sub) {
        return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'unauthorized' } });
      }

      const user = await prisma.user.findUnique({
        where: { id: String(decoded.sub) },
        select: { id: true, email: true, role: true, name: true, preferences: true },
      });

      if (!user) {
        return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      }

      // PASSWORD CHANGE DEADLOCK DÜZELTMESİ: /auth/me mustChangePassword durumunu da döndürür;
      // böylece frontend sayfa yenilendiğinde de şifre değişikliği ekranını gösterebilir.
      let mustChangePassword = false;
      try {
        const prefs = JSON.parse(user.preferences || '{}');
        if (prefs && typeof prefs === 'object' && !Array.isArray(prefs)) {
          mustChangePassword = !!prefs.mustChangePassword;
        }
      } catch { /* bozuk preferences mustChangePassword kapısını atlamaz */ }

      return res.json({ id: user.id, email: user.email, role: user.role, name: user.name, mustChangePassword });
    } catch {
      return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'invalid token' } });
    }
  });

  app.post('/auth/change-password', authLimiter, async (req, res) => {
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

    let decoded: jwt.JwtPayload & { sub?: string };
    try {
      decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload & { sub?: string };
    } catch {
      return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'invalid token' } });
    }
    if (!decoded?.sub) {
      return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'unauthorized' } });
    }

    const currentPassword = String(req.body?.currentPassword ?? '');
    const newPassword = String(req.body?.newPassword ?? '');
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: 'current_password_and_new_password_required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ ok: false, error: 'new_password_too_short' });
    }
    if (newPassword === 'admin123') {
      return res.status(400).json({ ok: false, error: 'new_password_is_default' });
    }

    const user = await prisma.user.findUnique({ where: { id: String(decoded.sub) } });
    if (!user) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ ok: false, error: 'invalid_current_password' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    let prefs: Record<string, unknown> = {};
    try { prefs = JSON.parse(user.preferences || '{}'); } catch { prefs = {}; }
    prefs.mustChangePassword = false;

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, preferences: JSON.stringify(prefs) },
    });

    return res.json({ ok: true, message: 'password_changed' });
  });

  // Frontend (vanilla JS) calls endpoints WITHOUT /api prefix (e.g. /xml-sources, /categories).
  // Rewrite URL internally so POST/PUT/DELETE also work correctly.
  const frontendPaths = ['/products', '/xml-sources', '/categories', '/brands', '/variants', '/listings', '/listing-v2', '/ready-to-ship', '/orders', '/marketplace-manage', '/marketplace-send', '/ai-settings', '/stock-automation', '/dashboard', '/settings', '/marketplaces', '/auth', '/notifications', '/nav-badges', '/reports', '/category-engine', '/category-core-v2', '/trendyol-mapping', '/finance', '/users', '/audit-logs'];
  app.use((req, res, next) => {
    for (const p of frontendPaths) {
      if (req.path === p || req.path.startsWith(p + '/')) {
        req.url = '/api' + req.url;
        return next();
      }
    }
    next();
  });

  app.use('/api', router);

  // Cache busting: index.html / API yanıtları asla stale kalmasın (göz testi tutarlılığı).
  app.use((req, res, next) => {
    if (req.path === '/' || req.path.endsWith('.html') || !req.path.includes('.')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }
    next();
  });

// Serve frontend static files from dist (repo root)
  // __dirname = C:\PROJE 1\DG-STOK-THEME-V1\server\src
  // Project root = __dirname + '/../..'
  const projectRoot = path.resolve(__dirname, '../..');
  const webDistPath = path.join(projectRoot, 'dist');

  if (fs.existsSync(webDistPath) && fs.statSync(webDistPath).isDirectory()) {
    console.log(`[server] Serving frontend from: ${webDistPath}`);
    app.use(express.static(webDistPath, { etag: false, lastModified: false, maxAge: 0 }));

    // API 404: SPA catch-all'dan önce /api/* isteklerine JSON 404 döndür
    app.use('/api/*', (_req, res) => {
      res.status(404).json({ error: 'API endpoint not found' });
    });

    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  } else {
    console.warn('[server] Frontend dist not found at:', webDistPath);
    console.warn('[server] Run: npm run build (vite) in the theme root');
  }

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT ?? 4000);
  const app = buildServer();
  const server = http.createServer(app);

  server.on('error', (err) => {
    console.error('[server] HTTP server error:', err);
  });

  server.on('close', () => {
    console.log('[server] HTTP server closed');
  });

  server.listen(port, async () => {
    console.log(`[server] listening on :${port}`);
    console.log(`[server] Web UI: http://localhost:${port}`);

    try {
      await ensureDefaultAdminUser();
      console.log('[server] admin user ready');
      await seedDefaultMarketplaces();
      console.log('[server] default marketplaces seeded');
      await ensureDefaultListingTemplates();
      console.log('[server] default listing templates ensured');
      await seedDefaultAIProviders();
      console.log('[server] default AI providers seeded');
      await migrateMarketplaceCredentials();
      console.log('[server] marketplace credentials migrated');
      await migrateAiProviderKeys();
      console.log('[server] AI provider keys migrated');
      // OpenRouter model registry + background refresh
      const { ensureRegistrySeeded, startBackgroundRefresh } = await import('./services/openRouterManager.ts');
      await ensureRegistrySeeded();
      console.log('[server] OpenRouter model registry seeded');
      startBackgroundRefresh();
      console.log('[server] OpenRouter background refresh started');
      // FIX(RT-ACC): OmniRoute background refresh hiç başlatılmıyordu —
      // katalog yalnızca manuel keşifle güncelleniyor, kaldırılan/dönen
      // modeller fark edilmiyordu. (startBackgroundRefresh export'u boşta duruyordu.)
      const { startBackgroundRefresh: startOmniRouteRefresh } = await import('./services/omniRouteManager.ts');
      startOmniRouteRefresh();
      console.log('[server] OmniRoute background refresh started');
      // V3 ZERO-AI-GAP: Availability Supervisor — sağlık/recovery katmanı (tek beyin
      // Master Orchestrator kalır). Startup'ta en kısa sürede eligible hazırlığı.
      const { startAvailabilitySupervisor } = await import('./services/omniRouteOrchestrator.ts');
      startAvailabilitySupervisor();
      console.log('[server] AI Availability Supervisor started');
      console.log('[server] Bootstrap completed, server should stay alive');
    } catch (error) {
      console.error('[server] database bootstrap failed', error);
    }
  });

  // Keep the process alive
  setInterval(() => {}, 1000 * 60 * 60);
}

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
});
