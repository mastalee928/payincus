-- Snapshot of client/src/utils/poolRegionCatalog.ts (45 existing project locations).
-- Append missing locations only to built-in machine groups. Preserve every existing ID,
-- name, country, assignment, custom group and price. Unambiguous legacy city names count as present.
WITH catalog(name, name_en, name_tw, country_code, city) AS (VALUES
  ('美国东部（阿什本）', 'US East (Ashburn)', '美國東部（阿什本）', 'us', '阿什本'),
  ('美国中西部（芝加哥）', 'US Midwest (Chicago)', '美國中西部（芝加哥）', 'us', '芝加哥'),
  ('美国西部（凤凰城）', 'US West (Phoenix)', '美國西部（鳳凰城）', 'us', '凤凰城'),
  ('美国西部（圣何塞）', 'US West (San Jose)', '美國西部（聖荷西）', 'us', '圣何塞'),
  ('加拿大东南部（蒙特利尔）', 'Canada Southeast (Montreal)', '加拿大東南部（蒙特婁）', 'ca', '蒙特利尔'),
  ('加拿大东南部（多伦多）', 'Canada Southeast (Toronto)', '加拿大東南部（多倫多）', 'ca', '多伦多'),
  ('墨西哥中部（克雷塔罗）', 'Mexico Central (Querétaro)', '墨西哥中部（克雷塔羅）', 'mx', '克雷塔罗'),
  ('墨西哥东北部（蒙特雷）', 'Mexico Northeast (Monterrey)', '墨西哥東北部（蒙特雷）', 'mx', '蒙特雷'),
  ('巴西东部（圣保罗）', 'Brazil East (São Paulo)', '巴西東部（聖保羅）', 'br', '圣保罗'),
  ('巴西东南部（维涅杜）', 'Brazil Southeast (Vinhedo)', '巴西東南部（維涅杜）', 'br', '维涅杜'),
  ('智利中部（圣地亚哥）', 'Chile Central (Santiago)', '智利中部（聖地牙哥）', 'cl', '圣地亚哥'),
  ('智利西部（瓦尔帕莱索）', 'Chile West (Valparaiso)', '智利西部（瓦爾帕萊索）', 'cl', '瓦尔帕莱索'),
  ('哥伦比亚中部（波哥大）', 'Colombia Central (Bogota)', '哥倫比亞中部（波哥大）', 'co', '波哥大'),
  ('法国中部（巴黎）', 'France Central (Paris)', '法國中部（巴黎）', 'fr', '巴黎'),
  ('法国南部（马赛）', 'France South (Marseille)', '法國南部（馬賽）', 'fr', '马赛'),
  ('德国中部（法兰克福）', 'Germany Central (Frankfurt)', '德國中部（法蘭克福）', 'de', '法兰克福'),
  ('意大利西北部（米兰）', 'Italy Northwest (Milan)', '義大利西北部（米蘭）', 'it', '米兰'),
  ('意大利北部（都灵）', 'Italy North (Turin)', '義大利北部（都靈）', 'it', '都灵'),
  ('荷兰西北部（阿姆斯特丹）', 'Netherlands Northwest (Amsterdam)', '荷蘭西北部（阿姆斯特丹）', 'nl', '阿姆斯特丹'),
  ('塞尔维亚中部（乔万诺瓦茨）', 'Serbia Central (Jovanovac)', '塞爾維亞中部（喬萬諾瓦茨）', 'rs', '乔万诺瓦茨'),
  ('西班牙中部（马德里）', 'Spain Central (Madrid)', '西班牙中部（馬德里）', 'es', NULL),
  ('西班牙中部 2（马德里）', 'Spain Central 2 (Madrid)', '西班牙中部 2（馬德里）', 'es', NULL),
  ('瑞典中部（斯德哥尔摩）', 'Sweden Central (Stockholm)', '瑞典中部（斯德哥爾摩）', 'se', '斯德哥尔摩'),
  ('瑞士北部（苏黎世）', 'Switzerland North (Zurich)', '瑞士北部（蘇黎世）', 'ch', '苏黎世'),
  ('英国南部（伦敦）', 'UK South (London)', '英國南部（倫敦）', 'gb', '伦敦'),
  ('英国西部（纽波特）', 'UK West (Newport)', '英國西部（紐波特）', 'gb', '纽波特'),
  ('以色列中部（耶路撒冷）', 'Israel Central (Jerusalem)', '以色列中部（耶路撒冷）', 'il', '耶路撒冷'),
  ('摩洛哥西部（卡萨布兰卡）', 'Morocco West (Casablanca)', '摩洛哥西部（卡薩布蘭卡）', 'ma', '卡萨布兰卡'),
  ('沙特阿拉伯西部（吉达）', 'Saudi Arabia West (Jeddah)', '沙烏地阿拉伯西部（吉達）', 'sa', '吉达'),
  ('沙特阿拉伯中部（利雅得）', 'Saudi Arabia Central (Riyadh)', '沙烏地阿拉伯中部（利雅德）', 'sa', '利雅得'),
  ('南非中部（约翰内斯堡）', 'South Africa Central (Johannesburg)', '南非中部（約翰尼斯堡）', 'za', '约翰内斯堡'),
  ('阿联酋东部（迪拜）', 'UAE East (Dubai)', '阿聯酋東部（杜拜）', 'ae', '迪拜'),
  ('阿联酋中部（阿布扎比）', 'UAE Central (Abu Dhabi)', '阿聯酋中部（阿布達比）', 'ae', '阿布扎比'),
  ('澳大利亚东部（悉尼）', 'Australia East (Sydney)', '澳洲東部（雪梨）', 'au', '悉尼'),
  ('澳大利亚东南部（墨尔本）', 'Australia Southeast (Melbourne)', '澳洲東南部（墨爾本）', 'au', '墨尔本'),
  ('印度西部（孟买）', 'India West (Mumbai)', '印度西部（孟買）', 'in', '孟买'),
  ('印度南部（海得拉巴）', 'India South (Hyderabad)', '印度南部（海德拉巴）', 'in', '海得拉巴'),
  ('印度尼西亚北部（巴淡）', 'Indonesia North (Batam)', '印尼北部（巴淡）', 'id', '巴淡'),
  ('日本东部（东京）', 'Japan East (Tokyo)', '日本東部（東京）', 'jp', '东京'),
  ('日本中部（大阪）', 'Japan Central (Osaka)', '日本中部（大阪）', 'jp', '大阪'),
  ('马来西亚西部（古来）', 'Malaysia West (Kulai)', '馬來西亞西部（古來）', 'my', '古来'),
  ('新加坡（新加坡）', 'Singapore (Singapore)', '新加坡（新加坡）', 'sg', NULL),
  ('新加坡西部（新加坡）', 'Singapore West (Singapore)', '新加坡西部（新加坡）', 'sg', NULL),
  ('韩国中部（首尔）', 'South Korea Central (Seoul)', '韓國中部（首爾）', 'kr', '首尔'),
  ('韩国北部（春川）', 'South Korea North (Chuncheon)', '韓國北部（春川）', 'kr', '春川')
)
INSERT INTO host_region_groups (machine_group_id, name, country_code)
SELECT machine.id, catalog.name, catalog.country_code
FROM host_machine_groups machine CROSS JOIN catalog
WHERE machine.name IN ('E2', 'ARM') AND NOT EXISTS (
  SELECT 1 FROM host_region_groups existing
  WHERE existing.machine_group_id = machine.id AND (
    existing.name IN (catalog.name, catalog.name_en, catalog.name_tw)
    OR (lower(existing.country_code) = catalog.country_code AND catalog.city IS NOT NULL
      AND regexp_replace(existing.name, '^.*[·]\s*', '') = catalog.city)
  )
)
ON CONFLICT (machine_group_id, name) DO NOTHING;
