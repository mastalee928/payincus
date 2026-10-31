CREATE TABLE "renewal_requests" (
  "user_id" INTEGER NOT NULL,
  "request_key" VARCHAR(128) NOT NULL,
  "input_hash" TEXT NOT NULL,
  "results" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "renewal_requests_pkey" PRIMARY KEY ("user_id", "request_key"),
  CONSTRAINT "renewal_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
