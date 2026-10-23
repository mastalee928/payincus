ALTER TABLE "management_gateway_tasks" ADD COLUMN "recovery_context" TEXT
    CHECK ("recovery_context" IS NULL OR "recovery_context" ~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$');
