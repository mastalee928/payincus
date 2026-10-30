// Short display names transcribed from poolRegionCatalog's existing Chinese names.
// English spelling continues to come from the verified geographic directory.
const names: Record<string, readonly [string, string]> = {
  Ashburn: ['阿什本', '阿什本'], Chicago: ['芝加哥', '芝加哥'], Phoenix: ['凤凰城', '鳳凰城'],
  'San Jose': ['圣何塞', '聖荷西'], Montreal: ['蒙特利尔', '蒙特婁'], Toronto: ['多伦多', '多倫多'],
  'Querétaro': ['克雷塔罗', '克雷塔羅'], Monterrey: ['蒙特雷', '蒙特雷'],
  'São Paulo': ['圣保罗', '聖保羅'], Vinhedo: ['维涅杜', '維涅杜'], Santiago: ['圣地亚哥', '聖地牙哥'],
  Valparaiso: ['瓦尔帕莱索', '瓦爾帕萊索'], Bogota: ['波哥大', '波哥大'], Paris: ['巴黎', '巴黎'],
  Marseille: ['马赛', '馬賽'], Frankfurt: ['法兰克福', '法蘭克福'], Milan: ['米兰', '米蘭'],
  Turin: ['都灵', '都靈'], Amsterdam: ['阿姆斯特丹', '阿姆斯特丹'], Jovanovac: ['乔万诺瓦茨', '喬萬諾瓦茨'],
  Madrid: ['马德里', '馬德里'], Stockholm: ['斯德哥尔摩', '斯德哥爾摩'], Zurich: ['苏黎世', '蘇黎世'],
  London: ['伦敦', '倫敦'], Newport: ['纽波特', '紐波特'], Jerusalem: ['耶路撒冷', '耶路撒冷'],
  Casablanca: ['卡萨布兰卡', '卡薩布蘭卡'], Jeddah: ['吉达', '吉達'], Riyadh: ['利雅得', '利雅德'],
  Johannesburg: ['约翰内斯堡', '約翰尼斯堡'], Dubai: ['迪拜', '杜拜'], 'Abu Dhabi': ['阿布扎比', '阿布達比'],
  Sydney: ['悉尼', '雪梨'], Melbourne: ['墨尔本', '墨爾本'], Mumbai: ['孟买', '孟買'],
  Hyderabad: ['海得拉巴', '海德拉巴'], Batam: ['巴淡', '巴淡'], Tokyo: ['东京', '東京'],
  Osaka: ['大阪', '大阪'], Kulai: ['古来', '古來'], Singapore: ['新加坡', '新加坡'],
  Seoul: ['首尔', '首爾'], Chuncheon: ['春川', '春川']
}

export function homeMapCityName(city: string, locale: string): string {
  return locale === 'zh-CN' ? names[city]?.[0] ?? city : locale === 'zh-TW' ? names[city]?.[1] ?? city : city
}
