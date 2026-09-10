import { prisma } from '../db/prisma.ts';

/**
 * DISPATCH PROGRESS — Gerçek zamanlı gönderim ilerleme takibi.
 *
 * KURALLAR:
 * - Her gönderim job'ı benzersiz ID ile takip edilir
 * - Marketplace bazında + genel progress ayrı ayrı
 * - SSE (Server-Sent Events) ile real-time push
 * - Job state: PENDING → RUNNING → COMPLETED / FAILED
 * - Progress: sent / successful / failed / pending counts
 * - Frontend SSE ile dinler, sayfa refresh'ten sonra da job state'ini okuyabilir
 */

export type DispatchJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type DispatchJob = {
  id: string;
  status: DispatchJobStatus;
  xmlSourceIds: string[];
  marketplaceIds: string[];
  productIds: string[];
  totalCount: number;
  sentCount: number;
  successfulCount: number;
  failedCount: number;
  pendingCount: number;
  marketplaceBreakdown: Array<{
    marketplaceId: string;
    marketplaceName: string;
    total: number;
    sent: number;
    successful: number;
    failed: number;
    pending: number;
  }>;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateDispatchJobInput = {
  xmlSourceIds: string[];
  marketplaceIds: string[];
  productIds: string[];
  userId: string;
};

export type DispatchProgressUpdate = {
  jobId: string;
  marketplaceId: string;
  productId: string;
  success: boolean;
  error?: string;
};

interface InMemoryJobStore {
  [jobId: string]: DispatchJob;
}

const jobStore: InMemoryJobStore = {};

/**
 * Yeni gönderim job'ı oluştur.
 */
export function createDispatchJob(input: CreateDispatchJobInput): DispatchJob {
  const jobId = crypto.randomUUID();
  const now = new Date();

  const marketplaceBreakdown = input.marketplaceIds.map(mid => ({
    marketplaceId: mid,
    marketplaceName: '', // will be filled when processing starts
    total: input.productIds.length,
    sent: 0,
    successful: 0,
    failed: 0,
    pending: input.productIds.length,
  }));

  const job: DispatchJob = {
    id: crypto.randomUUID(),
    status: 'PENDING',
    xmlSourceIds: input.xmlSourceIds,
    marketplaceIds: input.marketplaceIds,
    productIds: input.productIds,
    totalCount: input.productIds.length,
    sentCount: 0,
    successfulCount: 0,
    failedCount: 0,
    pendingCount: input.productIds.length,
    marketplaceBreakdown,
    startedAt: null,
    completedAt: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  jobStore[job.id] = job;
  return job;
}

/**
 * Job'ı başlat.
 */
export function startDispatchJob(jobId: string): DispatchJob | null {
  const job = jobStore[jobId];
  if (!job || job.status !== 'PENDING') return null;

  job.status = 'RUNNING';
  job.startedAt = new Date();
  job.updatedAt = new Date();
  return job;
}

/**
 * Marketplace isimlerini doldur.
 */
export async function populateMarketplaceNames(jobId: string): Promise<void> {
  const job = jobStore[jobId];
  if (!job) return;

  const marketplaces = await prisma.marketplace.findMany({
    where: { id: { in: job.marketplaceIds } },
    select: { id: true, name: true },
  });

  const nameMap = new Map(marketplaces.map(m => [m.id, m.name]));
  job.marketplaceBreakdown.forEach(mb => {
    mb.marketplaceName = nameMap.get(mb.marketplaceId) || mb.marketplaceId;
  });
}

/**
 * Progress güncelle — marketplace bazında.
 */
export function updateProgress(update: DispatchProgressUpdate): DispatchJob | null {
  const job = jobStore[update.jobId];
  if (!job || job.status !== 'RUNNING') return null;

  // Marketplace breakdown güncelle
  const mb = job.marketplaceBreakdown.find(m => m.marketplaceId === update.marketplaceId);
  if (mb) {
    mb.sent++;
    mb.pending--;
    if (update.success) {
      mb.successful++;
    } else {
      mb.failed++;
    }
  }

  // Genel sayaçlar
  job.sentCount++;
  job.pendingCount--;
  if (update.success) {
    job.successfulCount++;
  } else {
    job.failedCount++;
  }

  job.updatedAt = new Date();

  // Tamamlandı kontrolü
  if (job.sentCount >= job.totalCount) {
    job.status = job.failedCount > 0 ? 'COMPLETED' : 'COMPLETED';
    job.completedAt = new Date();
  }

  return job;
}

/**
 * Job'ı tamamla (başarılı/başarısız).
 */
export function completeDispatchJob(jobId: string, error?: string): DispatchJob | null {
  const job = jobStore[jobId];
  if (!job) return null;

  job.status = error ? 'FAILED' : 'COMPLETED';
  job.completedAt = new Date();
  job.error = error || null;
  job.updatedAt = new Date();
  return job;
}

/**
 * Job durumunu getir.
 */
export function getDispatchJob(jobId: string): DispatchJob | null {
  return jobStore[jobId] || null;
}

/**
 * Job'ı iptal et.
 */
export function cancelDispatchJob(jobId: string): DispatchJob | null {
  const job = jobStore[jobId];
  if (!job || job.status === 'COMPLETED' || job.status === 'FAILED') return null;

  job.status = 'CANCELLED';
  job.completedAt = new Date();
  job.updatedAt = new Date();
  return job;
}

/**
 * Job listesini getir (son 50).
 */
export function listDispatchJobs(limit = 50): DispatchJob[] {
  return Object.values(jobStore)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

/**
 * SSE stream generator — frontend real-time dinlemek için.
 */
export function* createProgressStream(jobId: string): Generator<string, void, unknown> {
  const job = jobStore[jobId];
  if (!job) return;

  let lastUpdate = job.updatedAt.getTime();
  let isComplete = false;

  while (!isComplete) {
    const job = jobStore[jobId];
    if (!job) break;

    if (job.updatedAt.getTime() > lastUpdate) {
      lastUpdate = job.updatedAt.getTime();
      yield `data: ${JSON.stringify({
        jobId: job.id,
        status: job.status,
        totalCount: job.totalCount,
        sentCount: job.sentCount,
        successfulCount: job.successfulCount,
        failedCount: job.failedCount,
        pendingCount: job.pendingCount,
        marketplaceBreakdown: job.marketplaceBreakdown,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      })}\n\n`;
    }

    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      isComplete = true;
      break;
    }

    // Small delay to prevent busy loop
    const start = Date.now();
    while (Date.now() - start < 500) {
      // busy wait 500ms
    }
  }
}

/**
 * Eski job'ları temizle (24 saatten eski).
 */
export function cleanupOldJobs(maxAgeMs = 24 * 60 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, job] of Object.entries(jobStore)) {
    if (now - job.createdAt.getTime() > maxAgeMs) {
      delete jobStore[id];
      cleaned++;
    }
  }
  return cleaned;
}

// Periodic cleanup
setInterval(() => cleanupOldJobs(), 60 * 60 * 1000); // hourly