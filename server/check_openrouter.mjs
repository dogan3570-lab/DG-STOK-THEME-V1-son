import { PrismaClient } from '@prisma/client';
import { getRegistry } from './src/services/openRouterManager.ts';

const prisma = new PrismaClient();

async function test() {
  console.log('OMNIROUTE_BASE_URL:', process.env.OMNIROUTE_BASE_URL || 'NOT SET (defaults to http://localhost:20128)');
  
  try {
    const registry = await getRegistry();
    console.log('OpenRouter Registry models:', registry.models.length);
    const freeModels = registry.models.filter(m => m.free);
    console.log('Free models count:', freeModels.length);
    if (freeModels.length > 0) {
      console.log('First few free models:', freeModels.slice(0, 5).map(m => ({ id: m.id, name: m.name, free: m.free })));
    }
  } catch (e) {
    console.log('Registry error:', e.message);
  }
  
  await prisma.$disconnect();
}

test();