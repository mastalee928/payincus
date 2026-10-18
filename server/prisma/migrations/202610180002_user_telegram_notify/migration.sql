-- 用户 Telegram 通知：绑定站点 Bot 后默认接收核心事件推送（充值/开通/续费/到期等）。
-- notify_last_error(_at) 记录最近一次推送失败（例如用户拉黑机器人），供个人设置页提示；不影响其它渠道。
ALTER TABLE "user_telegram_bindings" ADD COLUMN "notify_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "user_telegram_bindings" ADD COLUMN "notify_last_error" TEXT;
ALTER TABLE "user_telegram_bindings" ADD COLUMN "notify_last_error_at" TIMESTAMP(3);
