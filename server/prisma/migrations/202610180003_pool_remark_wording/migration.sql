-- 余额流水中的「一机一卖」是内部用语；历史记录统一改为面向客户的「购买实例」，与新的下单文案保持一致。
UPDATE "balance_logs"
SET "remark" = REPLACE(REPLACE("remark", '一机一卖订单', '购买实例订单'), '一机一卖', '购买实例')
WHERE "remark" LIKE '%一机一卖%';
