import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().regex(/^\d+$/).default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGO_BASE_URI: z.string({ required_error: 'MONGO_BASE_URI is required' }).min(1),
  REDIS_URL: z.string({ required_error: 'REDIS_URL is required' }).min(1),
  JWT_PRIVATE_KEY_PATH: z.string({ required_error: 'JWT_PRIVATE_KEY_PATH is required' }).min(1),
  JWT_PUBLIC_KEY_PATH: z.string({ required_error: 'JWT_PUBLIC_KEY_PATH is required' }).min(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('*'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const issues = result.error.flatten().fieldErrors;
  console.error('[config] Missing or invalid environment variables:');
  for (const [key, errors] of Object.entries(issues)) {
    console.error(`  ${key}: ${errors.join(', ')}`);
  }
  process.exit(1);
}

export const env = Object.freeze(result.data);
