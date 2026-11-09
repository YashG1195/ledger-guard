import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z
    .string()
    .regex(/^\d+$/, 'PORT must be a numeric string')
    .default('3000'),

  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  MONGO_BASE_URI: z
    .string({ required_error: 'MONGO_BASE_URI is required' })
    .min(1, 'MONGO_BASE_URI cannot be empty'),

  REDIS_URL: z
    .string({ required_error: 'REDIS_URL is required' })
    .min(1, 'REDIS_URL cannot be empty'),

  JWT_PRIVATE_KEY_PATH: z
    .string({ required_error: 'JWT_PRIVATE_KEY_PATH is required' })
    .min(1, 'JWT_PRIVATE_KEY_PATH cannot be empty'),

  JWT_PUBLIC_KEY_PATH: z
    .string({ required_error: 'JWT_PUBLIC_KEY_PATH is required' })
    .min(1, 'JWT_PUBLIC_KEY_PATH cannot be empty'),

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),

  CORS_ORIGIN: z.string().default('*'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const formatted = result.error.flatten().fieldErrors;
  const lines = Object.entries(formatted)
    .map(([field, msgs]) => `  • ${field}: ${msgs.join(', ')}`)
    .join('\n');

  console.error('\n❌  Invalid or missing environment variables:\n' + lines + '\n');
  console.error('Copy .env.example → .env and fill in every required value.\n');
  process.exit(1);
}

export const env = Object.freeze(result.data);
