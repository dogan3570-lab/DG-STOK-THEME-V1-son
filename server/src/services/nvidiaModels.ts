/**
 * NVIDIA NIM — GERÇEK model discovery.
 * Stale OmniRoute registry yerine NVIDIA'nın kendi /v1/models'inden model listesi alınır.
 * Yalnızca üretici (chat/text-generation) modeller döndürülür; safety/guard/embed/rerank/
 * asr/tts/vision/parse gibi modeller genel AI görevleri için havuza alınmaz.
 * Router dispatch'i 'nvidia/<id>' → NVIDIA API '<id>' şeklinde çalışır (provider kimliği korunur).
 */
import { prisma } from '../db/prisma.ts';
import { decryptApiKey } from './crypto.ts';

const NVIDIA_BASE = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const CACHE_TTL_MS = 10 * 60 * 1000;

const NON_GENERATIVE_RE = /safety|guard|moderation|rerank|ranker|embed|asr\b|tts|whisper|parakeet|fastpitch|tacotron|flux|diffusion|calibration|detector|ocr\b|reward|judge|nemoguard|topic-control|allowlist|xlm-roberta|bge-|nv-embed|content-safety|parse|recurrentgemma|vision|\bvl\b|omni|audio|video|seamless|riva|translate|isolation|ising|stockmark|sarvam/i;
const CHAT_RE = /llama|qwen|mistral|nemotron|gemma|deepseek|phi|gpt-oss|glm|minimax|solar|mixtral|dbrx|command|kimi|moonshot|jamba|yi-|chatqa|upstage|step|abacus|dracarys/i;

export interface NvidiaDiscoveredModel {
  id: string;       // 'nvidia/<nvidia-id>' (Router/provider kimliği)
  name: string;
  provider: 'nvidia';
  free: boolean;
}

let cache: NvidiaDiscoveredModel[] = [];
let cacheAt = 0;

export async function discoverNvidiaModels(force = false): Promise<NvidiaDiscoveredModel[]> {
  if (!force && cache.length > 0 && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  try {
    const p = await prisma.aIProviderConfig.findUnique({ where: { provider: 'nvidia' } });
    if (!p?.apiKeyEncrypted || !p.apiKeyIv || !p.apiKeyTag) return cache;
    const key = decryptApiKey(p.apiKeyEncrypted, p.apiKeyIv, p.apiKeyTag);
    const res = await fetch(`${NVIDIA_BASE}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return cache;
    const data: any = await res.json();
    const ids: string[] = (data?.data || []).map((m: any) => String(m?.id || '')).filter(Boolean);
    cache = ids
      .filter((id) => !NON_GENERATIVE_RE.test(id) && CHAT_RE.test(id))
      .map((id) => ({ id: 'nvidia/' + id, name: id, provider: 'nvidia' as const, free: true }));
    cacheAt = Date.now();
  } catch {
    /* ağ hatasında mevcut cache korunur */
  }
  return cache;
}
