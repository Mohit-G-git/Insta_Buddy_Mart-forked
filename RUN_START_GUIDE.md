# Insta Buddy Mart - Run/Start Guide (Windows + PowerShell)

This guide gives you all dependencies and commands needed to run the project now.

Current status:

- The Flutter frontend currently uses mock/demo data for screens, so frontend UI can run even if backend is not started.
- Start backend if you want to test service APIs, auth, chat, payments, and DB flows.

## 1) Dependencies to Install First

Install these on your machine:

1. Git
2. Node.js 20 LTS (includes npm)
3. Docker Desktop (with Docker Compose)
4. Flutter SDK (stable, with Dart 3.10.x or newer)
5. Android Studio (only if you want Android emulator/device)

Optional quick checks:

```powershell
git --version
node -v
npm -v
docker --version
docker compose version
flutter --version
```

## 2) Project Paths

Repo root:

```powershell
cd "c:\Users\MAHENDRA KUMAR GUPTA\Desktop\PROJECTS\Insta_Buddy_Mart-forked"
```

Backend services and ports:

- API Gateway: 3000
- Chat Service: 3001
- Payment Service: 3002
- IAM Service: 3003
- Order Service: 3004

Databases/infra ports:

- Chat PostgreSQL: 5432
- Payment PostgreSQL: 5433
- IAM PostgreSQL: 5434
- Order PostgreSQL: 5435
- Redis (Chat): 6379

## 3) Environment Files

### 3.1 Copy existing examples

```powershell
cd backend/API_Gateway
Copy-Item .env.example .env

cd ../IAM_Service
Copy-Item .env.example .env

cd ../Order_Service
Copy-Item .env.example .env
```

### 3.2 Create/verify Payment .env

Path: backend/Payment_Service/.env

Use at least:

```env
PORT=3002
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://buddyup:buddyup_dev_123@localhost:5433/buddyup_payment_db
JWT_SECRET=your_jwt_secret_here
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
AUTO_RELEASE_POLL_CRON=* * * * *
AUTO_RELEASE_BATCH_SIZE=10
AUTO_RELEASE_MAX_ATTEMPTS=5
```

### 3.3 Create Chat .env (there is no .env.example in Chat_System)

Create file: backend/Chat_System/.env

```env
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://buddyup:buddyup_dev_123@localhost:5432/buddyup_db
REDIS_URL=redis://localhost:6379
REDIS_KEY_PREFIX=buddyup:
JWT_SECRET=your_jwt_secret_here

# Firebase (optional for local startup, needed for push notifications)
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=

# AWS/S3 (needed for media upload endpoints)
AWS_REGION=ap-south-1
S3_BUCKET_NAME=your_s3_bucket_name
CLOUDFRONT_BASE_URL=https://your-cloudfront-domain
REKOGNITION_ENABLED=false
MODERATION_CONFIDENCE_THRESHOLD=60
MAX_FILE_SIZE_MB=10
MAX_VIDEO_SIZE_MB=100
BULL_CONCURRENCY=5
```

Important:

- Keep JWT_SECRET same across IAM, Chat, and Payment.
- If you currently have real Razorpay keys in backend/Payment_Service/.env, rotate/regenerate them if they were exposed.
- If browser calls are blocked by CORS, set each service CORS_ORIGIN to your Flutter web URL (for example, http://localhost:3000 or the exact port printed by flutter run).

## 4) Start Databases/Redis (Docker)

Start only infra containers first:

```powershell
cd backend/IAM_Service
docker compose up -d postgres

cd ../Order_Service
docker compose up -d postgres

cd ../Payment_Service
docker compose up -d postgres

cd ../Chat_System
docker compose up -d postgres redis
```

Check containers:

```powershell
docker ps
```

## 5) Install Backend npm Dependencies

From repo root:

```powershell
cd "c:\Users\MAHENDRA KUMAR GUPTA\Desktop\PROJECTS\Insta_Buddy_Mart-forked"

$services = @(
  "backend/API_Gateway",
  "backend/IAM_Service",
  "backend/Order_Service",
  "backend/Payment_Service",
  "backend/Chat_System"
)

foreach ($s in $services) {
  Push-Location $s
  npm install
  Pop-Location
}
```

## 6) Run DB Migrations

```powershell
cd backend/IAM_Service
npm run migrate

cd ../Order_Service
npm run migrate

cd ../Payment_Service
npm run migrate

cd ../Chat_System
npm run migrate
```

## 7) Start Backend Services (separate terminals)

Open separate terminals and run:

Terminal 1 (Chat):

```powershell
cd backend/Chat_System
npm run dev
```

Terminal 2 (IAM):

```powershell
cd backend/IAM_Service
npm run dev
```

Terminal 3 (Order):

```powershell
cd backend/Order_Service
npm run dev
```

Terminal 4 (Payment API):

```powershell
cd backend/Payment_Service
npm run dev
```

Terminal 5 (Payment worker):

```powershell
cd backend/Payment_Service
npm run start:worker
```

Terminal 6 (API Gateway):

```powershell
cd backend/API_Gateway
npm run dev
```

Notes:

- Gateway proxies IAM, Chat, and Payment routes.
- Order Service runs on 3004 but is not currently mapped in API Gateway service registry.

## 8) Start Flutter Frontend

From repo root:

```powershell
cd frontend
flutter pub get
flutter run -d chrome
```

For Android emulator/device, use:

```powershell
flutter devices
flutter run -d <device_id>
```

## 9) Health Checks

After startup, verify:

```powershell
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
curl http://localhost:3004/health
```

## 10) Stop Everything

Stop Node services with Ctrl+C in each terminal.

Stop docker infra:

```powershell
cd backend/IAM_Service
docker compose down

cd ../Order_Service
docker compose down

cd ../Payment_Service
docker compose down

cd ../Chat_System
docker compose down
```
