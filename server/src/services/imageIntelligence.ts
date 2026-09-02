// FIX(V2 #3): DIRECT BYPASS kaldırıldı — transport Master Orchestrator üzerinden.
import { chatCompletion, type ChatMessage } from './aiGateway.ts';
import { type SemanticIdentity } from './productUnderstanding.ts';

// ==================== TYPES ====================

export interface VisualIdentity {
  visualProductType: string;
  confirmsIdentity: boolean;
  correctedIdentity: SemanticIdentity | null;
  visualNotes: string;
  confidence: number;
}

// ==================== SYSTEM PROMPT ====================

const SYSTEM_PROMPT = `You are a visual product analyst. Examine the product image and determine what it is.

TASK: Look at the image and identify the product type.

INPUT:
- Current identity from text analysis
- Product image URL

OUTPUT FORMAT (JSON only):
{
  "visualProductType": "what you see in the image",
  "confirmsIdentity": true/false,
  "correctedIdentity": { ... } (only if different from current, same SemanticIdentity schema),
  "visualNotes": "description of what you see",
  "confidence": 0.0-1.0
}

RULES:
1. What you SEE in the image is the truth, not the title text.
2. If the image shows a diffuser but the title says "lambası", the product IS a diffuser.
3. correctedIdentity is ONLY provided when the visual clearly contradicts the text identity.
4. Return ONLY valid JSON, no markdown, no explanation.`;

// ==================== MAIN FUNCTION ====================

export async function inspectProductImages(
  images: string[],
  currentIdentity: SemanticIdentity,
): Promise<VisualIdentity> {
  if (!images || images.length === 0) {
    return {
      visualProductType: currentIdentity.productType,
      confirmsIdentity: true,
      correctedIdentity: null,
      visualNotes: 'No images available for inspection',
      confidence: 0.5,
    };
  }

  const imageUrl = images[0];

  const userMessage = `Analyze this product image:

Current Identity:
- Core Object: ${currentIdentity.coreObject}
- Product Type: ${currentIdentity.productType}
- Primary Function: ${currentIdentity.primaryFunction}
- Domain: ${currentIdentity.domain}

Image URL: ${imageUrl}

What does this image show? Return ONLY the JSON.`;

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  const result = await chatCompletion({
    messages,
    temperature: 0.1,
    max_tokens: 1000,
    response_format: { type: 'json_object' },
  }, 'IMAGE_ANALYSIS');

  if (!result.ok || !result.content) {
    return {
      visualProductType: currentIdentity.productType,
      confirmsIdentity: true,
      correctedIdentity: null,
      visualNotes: 'Image inspection failed, defaulting to text identity',
      confidence: 0.5,
    };
  }

  try {
    const parsed = JSON.parse(result.content);

    const visual: VisualIdentity = {
      visualProductType: String(parsed.visualProductType || currentIdentity.productType),
      confirmsIdentity: Boolean(parsed.confirmsIdentity),
      correctedIdentity: parsed.correctedIdentity ? {
        ...currentIdentity,
        coreObject: String(parsed.correctedIdentity.coreObject || currentIdentity.coreObject),
        productType: String(parsed.correctedIdentity.productType || currentIdentity.productType),
        primaryFunction: String(parsed.correctedIdentity.primaryFunction || currentIdentity.primaryFunction),
        secondaryFunction: parsed.correctedIdentity.secondaryFunction ? String(parsed.correctedIdentity.secondaryFunction) : currentIdentity.secondaryFunction,
        useCase: String(parsed.correctedIdentity.useCase || currentIdentity.useCase),
        material: parsed.correctedIdentity.material ? String(parsed.correctedIdentity.material) : currentIdentity.material,
        formFactor: parsed.correctedIdentity.formFactor ? String(parsed.correctedIdentity.formFactor) : currentIdentity.formFactor,
        powerType: parsed.correctedIdentity.powerType ? String(parsed.correctedIdentity.powerType) : currentIdentity.powerType,
        needsImageInspection: false,
        domain: String(parsed.correctedIdentity.domain || currentIdentity.domain),
        confidence: parseFloat(parsed.correctedIdentity.confidence) || currentIdentity.confidence,
      } : null,
      visualNotes: String(parsed.visualNotes || ''),
      confidence: clamp(parseFloat(parsed.confidence) || 0.5, 0, 1),
    };

    return visual;
  } catch {
    return {
      visualProductType: currentIdentity.productType,
      confirmsIdentity: true,
      correctedIdentity: null,
      visualNotes: 'Image inspection parse error',
      confidence: 0.5,
    };
  }
}

// ==================== HELPERS ====================

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
