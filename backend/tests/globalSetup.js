export default async function globalSetup() {
  process.env.PORT = '3001';
  process.env.NODE_ENV = 'test';
  process.env.MONGO_BASE_URI = 'mongodb://localhost:27017';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.JWT_PRIVATE_KEY_PATH = 'keys/private.pem';
  process.env.JWT_PUBLIC_KEY_PATH = 'keys/public.pem';
  process.env.LOG_LEVEL = 'silent';
}
