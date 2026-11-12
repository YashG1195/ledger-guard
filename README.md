# LedgerGuard

LedgerGuard is a multi-tenant double-entry ledger and billing API built on Node.js, Express, MongoDB, and Redis. It provides transactional accounting, idempotency protection for payment/billing events, tenant-scoped data isolation, and real-time transaction feeds.

## Requirements

- Node.js 20+
- MongoDB 6+
- Redis 7+

## Tech Stack

- **Runtime & API**: Node.js, Express 5
- **Datastores**: MongoDB (via Mongoose), Redis (via ioredis)
- **Locking & Idempotency**: Redlock for distributed concurrency control, Redis key-value cache with TTL
- **Auth & Crypto**: RS256 JWT tokens, asymmetric RSA request signature verification
- **Validation**: Zod
- **Logging**: Pino with per-request correlation IDs (`X-Request-Id`)
- **Realtime**: Socket.io with tenant rooms
- **Test Runner**: Jest, Supertest

## Directory Layout

```
ledger-guard/
├── backend/
│   ├── keys/             # RSA private/public keys (gitignored)
│   ├── src/
│   │   ├── config/       # Env validation and Redis/Redlock client
│   │   ├── gateway/      # Auth, tenant resolution, and error middleware
│   │   ├── db/           # Mongo connection manager and Mongoose schemas
│   │   ├── ledger/       # Ledger routes, controllers, services, and schemas
│   │   ├── analytics/    # Reporting and aggregation services
│   │   ├── crypto/       # RSA key management and signing utilities
│   │   ├── realtime/     # Socket.io event emitters and handlers
│   │   ├── utils/        # App logger, custom errors, response formatting
│   │   ├── app.js        # Express app initialization
│   │   └── server.js     # Server entry point and graceful shutdown
│   ├── tests/            # Integration and unit tests
│   ├── .env.example
│   └── package.json
└── README.md
```

## Setup & Local Development

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/YashG1195/ledger-guard.git
cd ledger-guard/backend
npm install
```

### 2. Generate Local RSA Keys

The auth and crypto services expect RS256 keys in `backend/keys/`:

```bash
mkdir -p keys
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
```

### 3. Spin Up Local Services (Docker)

If you don't have MongoDB and Redis running locally:

```bash
docker run -d --name ledger-mongo -p 27017:27017 mongo:7
docker run -d --name ledger-redis -p 6379:6379 redis:7-alpine
```

### 4. Configure Environment

Create `.env` from the example file:

```bash
cp .env.example .env
```

Review values in `.env` to make sure ports, credentials, and key paths match your local setup.

### 5. Start the Server

```bash
# Development with automatic restart
npm run dev

# Production
npm start

# Run tests
npm test
```

## API Conventions

### Response Envelope

All API endpoints return JSON payloads wrapped in a standard structure:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

When an error occurs, `success` is `false`, `data` is `null`, and `error` contains `{ code, message, details }`.

### Tenant Context

LedgerGuard routes are multi-tenant. Requests must supply tenant context either via the `X-Tenant-Id` header or inside the JWT claims (`tenantId`). Database queries and WebSocket event channels are dynamically segmented using this identifier.
