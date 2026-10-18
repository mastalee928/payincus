-- 管理员告警渠道：NotificationChannel.alert_category 非空表示该渠道属于某类管理员告警 Bot
-- （ticket/host/payment/instance）；host_agents.admin_offline_alerted_at 记录离线告警已发送时间，
-- 用于「离线发一次、恢复发一次」的状态机。
ALTER TABLE "notification_channels" ADD COLUMN "alert_category" TEXT;
ALTER TABLE "host_agents" ADD COLUMN "admin_offline_alerted_at" TIMESTAMP(3);
