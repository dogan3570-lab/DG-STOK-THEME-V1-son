import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import type { AuthedRequest } from './authMiddleware.ts';

export interface ContextRequest extends AuthedRequest {
  context?: {
    xmlSourceId: string;
    marketplaceId: string;
  };
}

export async function requireContext(req: ContextRequest, res: Response, next: NextFunction) {
  const xmlSourceId = req.query.xmlSourceId as string | undefined;
  const marketplaceId = req.query.marketplaceId as string | undefined;

  if (!xmlSourceId || !marketplaceId) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'CONTEXT_REQUIRED',
        message: 'Context gerekli: xmlSourceId ve marketplaceId parametreleri zorunludur',
      },
    });
  }

  const [xmlSource, marketplace] = await Promise.all([
    prisma.xmlSource.findUnique({ where: { id: xmlSourceId }, select: { id: true, name: true, active: true } }),
    prisma.marketplace.findUnique({ where: { id: marketplaceId }, select: { id: true, name: true, key: true, active: true } }),
  ]);

  if (!xmlSource) {
    return res.status(404).json({
      ok: false,
      error: { code: 'XML_SOURCE_NOT_FOUND', message: 'XML kaynağı bulunamadı' },
    });
  }

  if (!marketplace) {
    return res.status(404).json({
      ok: false,
      error: { code: 'MARKETPLACE_NOT_FOUND', message: 'Pazaryeri bulunamadı' },
    });
  }

  req.context = { xmlSourceId, marketplaceId };
  next();
}

export function optionalContext(req: ContextRequest, res: Response, next: NextFunction) {
  const xmlSourceId = req.query.xmlSourceId as string | undefined;
  const marketplaceId = req.query.marketplaceId as string | undefined;

  if (xmlSourceId && marketplaceId) {
    req.context = { xmlSourceId, marketplaceId };
  }
  next();
}

export function attachContextParams(req: ContextRequest, res: Response, next: NextFunction) {
  const xmlSourceId = req.query.xmlSourceId as string | undefined;
  const marketplaceId = req.query.marketplaceId as string | undefined;

  if (xmlSourceId || marketplaceId) {
    req.context = { xmlSourceId: xmlSourceId || '', marketplaceId: marketplaceId || '' };
  }
  next();
}