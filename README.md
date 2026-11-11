# LedgerGuard

LedgerGuard is an enterprise-grade multi-tenant financial ledger and billing engine built with Node.js 20, Express, MongoDB, and Redis. It is engineered for transaction integrity, strict tenant isolation, distributed locking, and real-time observability.

---

## ⚡ Tech Stack

- **Runtime & Framework:** Node.js 20, Express 5
- **Databases:** MongoDB (via Mongoose), Redis (via ioredis)
- **Concurrency & Idempotency:** Redlock (distributed locks), Redis-backed idempotency cache
- **Security & Cryptography:** RS256 JWT authentication, RSA key signing/verification, Helmet, CORS
- **Validation & Parsing:** Zod (runtime env and schema validation)
- **Logging & Tracing:** Pino with per-request correlation IDs (`X-Request-Id`)
- **Real-Time:** Socket.io with tenant-scoped event channels
- **Testing:** Jest, Supertest

---

## 📁 Project Structure

```
ledger-guard/
├── backend/
│   ├── keys/                  # RSA key pairs (gitignored)
│   ├── src/
│   │   ├── config/            # env.js (Zod-validated env), redis.js (ioredis + Redlock)
│   │   ├── gateway/           # authMiddleware, tenantMiddleware, errorHandler
│   │   ├── db/                # connectionManager.js, schemas/ (Mongoose)
│   │   ├── ledger/            # routes, controller, service, idempotency, schemas
│   │   ├── analytics/         # aggregation service, routes, controller
│   │   ├── crypto/            # RSA key loader, digital signature helpers
│   │   ├── realtime/          # Socket.io connection and tenant room handlers
│   │   ├── utils/             # logger, errors, asyncHandler, requestId, response
│   │   ├── app.js             # Express app setup and middleware pipeline
│   │   └── server.js          # HTTP server bootstrap and graceful shutdown
│   ├── tests/                 # Unit and integration test suites
│   ├── .env.example           # Template for required environment variables
│   └── package.json
└── README.md
```

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js >= 20.0.0
- MongoDB instance (local or MongoDB Atlas)
- Redis instance (local or cloud)

### 2. Installation
```bash
cd backend
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env` in the `backend/` directory:
```bash
cp .env.example .env
```
Ensure all required environment variables are defined (`PORT`, `NODE_ENV`, `MONGO_BASE_URI`, `REDIS_URL`, `JWT_PRIVATE_KEY_PATH`, `JWT_PUBLIC_KEY_PATH`). The application validates configuration at startup via Zod and will fail fast if any required variables are missing.

### 4. Running the Application
```bash
# Development (with nodemon)
npm run dev

# Production
npm start

# Run tests
npm test
```

---

## 🔒 Security & Response Standard

- **Tenant Isolation:** Enforced via `X-Tenant-Id` header or JWT tenant claims; database operations are dynamically scoped per tenant.
- **Unified Response Contract:** All API endpoints respond in a consistent envelope:
  ```json
  {
    "success": true,
    "data": { ... },
    "error": null
  }
  ```
- **Error Handling:** Operational errors inherit from `AppError` and are safely mapped to client responses, while unexpected exceptions are logged with full stack traces and correlation IDs.
