/* place-zh.js —— 震源地名的中文化（USGS 英文模板 / 方向词 / 地理通名）
 *
 * 为什么单独一个模块：
 *   · USGS 的 place 是固定模板生成的英文（`92 km N of Ruteng, Indonesia`、
 *     `South of the Fiji Islands`、`Kermadec Islands region`），必须按中文语序重排；
 *   · 中国/台湾源给的中文里方向词是「南南西」「东北东」这种日语式写法
 *     （用户看到的「智利 Colchane 以南南西 72km」），要换成「西南偏南」；
 *   · 日本源的地名是官方 nm 零件（不走这里）。
 * 词典不够时**保留专名原文**（硬译会错），只把通名/方向译出来。
 *
 * ★ 本轮（用户：「翻译的地区太少了吧」）：
 *   实测真实 USGS 近一个月 M2.5+ 语料（2321 条 / 1596 个不同 place）时，旧版按条数
 *   只有 **6.7%** 完全中文化 —— 因为 `REGION` 只认「逗号后面整段的国家名」，
 *   而 USGS 里还有三类没覆盖：
 *     1) 州缩写 / 别名       `CA` `MX` `B.C.` `Burma (Myanmar)` `Japan region`
 *     2) 多级逗号段          `Rat Islands, Aleutian Islands, Alaska`
 *     3) 专名本身是地名      `Adak` `Nikolski` `Tadine` `Petropavlovsk-Kamchatsky`
 *   现在：`REGION` 从 330 条扩到 **约 480 条**，新增 `PLACE`（专名→中译）**约 380 条**，
 *   并给 `usgs()` 补上「多级逗号段逐段翻译」和「专名前缀方向词」两条通路。
 *   实测按条数 **6.7% → 96%+**（见 `build/place-test.js`）。
 *
 * 兜底原则不变：查不到的专名宁可留英文，也不硬译（`Volcano` 是夏威夷地名，不是「火山」）。
 */
(function (global) {
  'use strict';

  /* ---- 方向 ---- */
  var DIR = {
    N: '北', S: '南', E: '东', W: '西', C: '中部',
    NE: '东北', NW: '西北', SE: '东南', SW: '西南',
    NNE: '东北偏北', ENE: '东北偏东', ESE: '东南偏东', SSE: '东南偏南',
    SSW: '西南偏南', WSW: '西南偏西', WNW: '西北偏西', NNW: '西北偏北'
  };
  /* 全拼（USGS 有时用整词：`South of the Fiji Islands`） */
  var WORD_DIR = {
    north: 'N', south: 'S', east: 'E', west: 'W', central: 'C',
    northeast: 'NE', 'north-east': 'NE', southeast: 'SE', 'south-east': 'SE',
    northwest: 'NW', 'north-west': 'NW', southwest: 'SW', 'south-west': 'SW',
    'north-northeast': 'NNE', 'north northeast': 'NNE',
    'east-northeast': 'ENE', 'east northeast': 'ENE',
    'east-southeast': 'ESE', 'east southeast': 'ESE',
    'south-southeast': 'SSE', 'south southeast': 'SSE',
    'south-southwest': 'SSW', 'south southwest': 'SSW',
    'west-southwest': 'WSW', 'west southwest': 'WSW',
    'west-northwest': 'WNW', 'west northwest': 'WNW',
    'north-northwest': 'NNW', 'north northwest': 'NNW'
  };
  /** 方向：'SSW' / 'south-southwest' / 'South' → 中文 */
  function dir(s) {
    var t = String(s == null ? '' : s).trim();
    if (!t) return '';
    var k = t.toUpperCase().replace(/\s+/g, '');
    if (DIR[k]) return DIR[k];
    var w = WORD_DIR[t.toLowerCase()];
    if (w) return DIR[w];
    var w2 = WORD_DIR[t.toLowerCase().replace(/\s+/g, ' ')];
    return w2 ? DIR[w2] : t;
  }

  /* 专名开头的方向/序数修饰词：`northern Mid-Atlantic Ridge` → `Mid-Atlantic Ridge` + 前缀
   *  ⚠️ 只在这些词**后面还有内容**时才算修饰词；`South Georgia` 这种是完整地名（在词典里先命中） */
  var NAME_PREFIX = {
    northern: '北', southern: '南', eastern: '东', western: '西', central: '中部',
    north: '北', south: '南', east: '东', west: '西',
    upper: '上', lower: '下', middle: '中', outer: '外', inner: '内',
    'north-central': '中北', 'south-central': '中南',
    'northeastern': '东北', 'northwestern': '西北',
    'southeastern': '东南', 'southwestern': '西南'
  };

  /* ---- 地理通名（英文 → 中文）；按长到短匹配 ---- */
  var SUFFIX = [
    ['archipelago', '群岛'], ['peninsula', '半岛'], ['mountains', '山脉'],
    ['islands', '群岛'], ['island', '岛'], ['region', '地区'], ['province', '省'],
    ['county', '县'], ['strait', '海峡'], ['trench', '海沟'], ['ridge', '海岭'],
    ['basin', '海盆'], ['plateau', '高原'], ['volcano', '火山'], ['valley', '谷'],
    ['seamount', '海山'], ['fracture zone', '断裂带'], ['passage', '水道'],
    ['canyon', '峡谷'], ['shoal', '浅滩'], ['atoll', '环礁'], ['range', '山脉'],
    ['state', '州'], ['city', '市'], ['coast', '海岸'], ['delta', '三角洲'],
    ['river', '河'], ['ocean', '洋'], ['reef', '礁'], ['bank', '浅滩'],
    ['point', '角'], ['peak', '峰'], ['mount', '山'], ['rise', '海隆'],
    ['area', '地区'], ['gulf', '湾'], ['bay', '湾'], ['sea', '海'],
    ['lake', '湖'], ['cove', '湾'], ['zone', '带']
  ];
  function suffixCN(s) {
    var t = String(s == null ? '' : s).trim();
    if (!t) return '';
    var low = t.toLowerCase(), out = t;
    for (var i = 0; i < SUFFIX.length; i++) {
      var en = SUFFIX[i][0], cn = SUFFIX[i][1];
      var re = new RegExp('\\s+' + en + '$', 'i');
      if (re.test(t)) { out = t.replace(re, ' ' + cn); break; }
      if (low === en) { out = cn; break; }
    }
    return out;
  }
  /** 是不是方向前缀词（`South` / `NNE` / `south-southwest`） */
  function isDirWord(w) {
    var t = String(w == null ? '' : w).trim();
    if (!t) return false;
    return !!(WORD_DIR[t.toLowerCase()] || DIR[t.toUpperCase().replace(/\s+/g, '')]);
  }

  /* ============================ 词典 ============================ */

  /* ---- 国家 / 地区 / 州 / 海域（USGS 逗号段里高频出现） ---- */
  var REGION = {
    /* --- 国家 --- */
    'Indonesia': '印度尼西亚', 'Japan': '日本', 'China': '中国', 'Philippines': '菲律宾',
    'Taiwan': '台湾', 'Taiwan region': '台湾地区', 'Papua New Guinea': '巴布亚新几内亚',
    'New Zealand': '新西兰', 'Russia': '俄罗斯', 'United States': '美国', 'Mexico': '墨西哥',
    'Chile': '智利', 'Peru': '秘鲁', 'Argentina': '阿根廷', 'Bolivia': '玻利维亚',
    'India': '印度', 'Nepal': '尼泊尔', 'Bhutan': '不丹', 'Bangladesh': '孟加拉国',
    'Myanmar': '缅甸', 'Burma': '缅甸', 'Burma (Myanmar)': '缅甸', 'Thailand': '泰国',
    'Vietnam': '越南', 'Laos': '老挝', 'Cambodia': '柬埔寨', 'Malaysia': '马来西亚',
    'Singapore': '新加坡', 'Brunei': '文莱', 'Timor Leste': '东帝汶', 'East Timor': '东帝汶',
    'Iran': '伊朗', 'Iraq': '伊拉克', 'Turkey': '土耳其', 'Greece': '希腊', 'Italy': '意大利',
    'Spain': '西班牙', 'Portugal': '葡萄牙', 'Iceland': '冰岛', 'Norway': '挪威',
    'Sweden': '瑞典', 'Finland': '芬兰', 'Korea': '韩国', 'South Korea': '韩国',
    'North Korea': '朝鲜', 'Mongolia': '蒙古', 'Australia': '澳大利亚', 'Canada': '加拿大',
    'Brazil': '巴西', 'Colombia': '哥伦比亚', 'Ecuador': '厄瓜多尔', 'Venezuela': '委内瑞拉',
    'Guatemala': '危地马拉', 'Costa Rica': '哥斯达黎加', 'Panama': '巴拿马',
    'Nicaragua': '尼加拉瓜', 'El Salvador': '萨尔瓦多', 'Honduras': '洪都拉斯', 'Cuba': '古巴',
    'Haiti': '海地', 'Dominican Republic': '多米尼加', 'Jamaica': '牙买加',
    'Puerto Rico': '波多黎各', 'Trinidad and Tobago': '特立尼达和多巴哥',
    'Afghanistan': '阿富汗', 'Pakistan': '巴基斯坦', 'Tajikistan': '塔吉克斯坦',
    'Kyrgyzstan': '吉尔吉斯斯坦', 'Uzbekistan': '乌兹别克斯坦', 'Turkmenistan': '土库曼斯坦',
    'Kazakhstan': '哈萨克斯坦', 'Azerbaijan': '阿塞拜疆', 'Armenia': '亚美尼亚',
    'Georgia': '格鲁吉亚', 'Ukraine': '乌克兰', 'Romania': '罗马尼亚', 'Bulgaria': '保加利亚',
    'Serbia': '塞尔维亚', 'Croatia': '克罗地亚', 'Bosnia and Herzegovina': '波黑',
    'Albania': '阿尔巴尼亚', 'North Macedonia': '北马其顿', 'Montenegro': '黑山',
    'Slovenia': '斯洛文尼亚', 'Hungary': '匈牙利', 'Slovakia': '斯洛伐克',
    'Czechia': '捷克', 'Czech Republic': '捷克', 'Poland': '波兰', 'Germany': '德国',
    'Austria': '奥地利', 'Switzerland': '瑞士', 'France': '法国', 'Belgium': '比利时',
    'Netherlands': '荷兰', 'Luxembourg': '卢森堡', 'Denmark': '丹麦', 'Estonia': '爱沙尼亚',
    'Latvia': '拉脱维亚', 'Lithuania': '立陶宛', 'Belarus': '白俄罗斯', 'Moldova': '摩尔多瓦',
    'United Kingdom': '英国', 'Ireland': '爱尔兰', 'Malta': '马耳他', 'Cyprus': '塞浦路斯',
    'Greenland': '格陵兰', 'Morocco': '摩洛哥', 'Algeria': '阿尔及利亚', 'Tunisia': '突尼斯',
    'Libya': '利比亚', 'Egypt': '埃及', 'Sudan': '苏丹', 'Ethiopia': '埃塞俄比亚',
    'Eritrea': '厄立特里亚', 'Djibouti': '吉布提', 'Somalia': '索马里', 'Kenya': '肯尼亚',
    'Tanzania': '坦桑尼亚', 'Uganda': '乌干达', 'Rwanda': '卢旺达', 'Burundi': '布隆迪',
    'DR Congo': '刚果（金）', 'Congo': '刚果（布）', 'Gabon': '加蓬', 'Cameroon': '喀麦隆',
    'Nigeria': '尼日利亚', 'Ghana': '加纳', 'Ivory Coast': '科特迪瓦', 'Mali': '马里',
    'Niger': '尼日尔', 'Chad': '乍得', 'Senegal': '塞内加尔', 'Guinea': '几内亚',
    'Zambia': '赞比亚', 'Zimbabwe': '津巴布韦', 'Mozambique': '莫桑比克', 'Malawi': '马拉维',
    'Madagascar': '马达加斯加', 'South Africa': '南非', 'Namibia': '纳米比亚',
    'Botswana': '博茨瓦纳', 'Angola': '安哥拉', 'Mauritania': '毛里塔尼亚',
    'Western Sahara': '西撒哈拉', 'Yemen': '也门', 'Oman': '阿曼', 'Saudi Arabia': '沙特阿拉伯',
    'Jordan': '约旦', 'Israel': '以色列', 'Lebanon': '黎巴嫩', 'Syria': '叙利亚',
    'Kuwait': '科威特', 'Qatar': '卡塔尔', 'United Arab Emirates': '阿联酋',
    'Sri Lanka': '斯里兰卡', 'Maldives': '马尔代夫',

    /* --- 美国州 / 加拿大省（含 USGS 常用的两字母缩写） --- */
    'Alaska': '阿拉斯加', 'California': '加利福尼亚', 'CA': '加州', 'Calif.': '加州',
    'Hawaii': '夏威夷', 'HI': '夏威夷', 'Nevada': '内华达', 'NV': '内华达',
    'Washington': '华盛顿州', 'WA': '华盛顿州', 'Oregon': '俄勒冈', 'OR': '俄勒冈',
    'Idaho': '爱达荷', 'Montana': '蒙大拿', 'Wyoming': '怀俄明', 'Utah': '犹他',
    'Colorado': '科罗拉多', 'Arizona': '亚利桑那', 'New Mexico': '新墨西哥',
    'Texas': '得克萨斯', 'Oklahoma': '俄克拉何马', 'Kansas': '堪萨斯', 'Missouri': '密苏里',
    'Arkansas': '阿肯色', 'Louisiana': '路易斯安那', 'Mississippi': '密西西比',
    'Alabama': '亚拉巴马', 'Tennessee': '田纳西', 'Kentucky': '肯塔基', 'Illinois': '伊利诺伊',
    'Indiana': '印第安纳', 'Ohio': '俄亥俄', 'Michigan': '密歇根', 'Wisconsin': '威斯康星',
    'Minnesota': '明尼苏达', 'Iowa': '艾奥瓦', 'Nebraska': '内布拉斯加',
    'South Dakota': '南达科他', 'North Dakota': '北达科他', 'Pennsylvania': '宾夕法尼亚',
    'New York': '纽约', 'New Jersey': '新泽西', 'Virginia': '弗吉尼亚',
    'North Carolina': '北卡罗来纳', 'South Carolina': '南卡罗来纳', 'Florida': '佛罗里达',
    'Maine': '缅因', 'Massachusetts': '马萨诸塞', 'Connecticut': '康涅狄格',
    'Rhode Island': '罗得岛', 'Vermont': '佛蒙特', 'New Hampshire': '新罕布什尔',
    'Maryland': '马里兰', 'Delaware': '特拉华', 'West Virginia': '西弗吉尼亚',
    'British Columbia': '不列颠哥伦比亚', 'B.C.': '不列颠哥伦比亚', 'BC': '不列颠哥伦比亚',
    'Quebec': '魁北克', 'Ontario': '安大略', 'Alberta': '艾伯塔', 'Yukon': '育空',
    'Northwest Territories': '西北地区', 'Nunavut': '努纳武特',
    /* 墨西哥的 USGS 两字母缩写 */
    'MX': '墨西哥', 'B.C.N.': '下加利福尼亚', 'B.C.S.': '南下加利福尼亚',

    /* --- 大洋洲 / 太平洋岛屿 --- */
    'Fiji': '斐济', 'Fiji Islands': '斐济群岛', 'Tonga': '汤加', 'Samoa': '萨摩亚',
    'American Samoa': '美属萨摩亚', 'Vanuatu': '瓦努阿图', 'Solomon Islands': '所罗门群岛',
    'New Caledonia': '新喀里多尼亚', 'Wallis and Futuna': '瓦利斯和富图纳',
    'French Polynesia': '法属波利尼西亚', 'Society Islands': '社会群岛',
    'Guam': '关岛', 'Northern Mariana Islands': '北马里亚纳群岛', 'Mariana Islands': '马里亚纳群岛',
    'Federated States of Micronesia': '密克罗尼西亚联邦', 'Micronesia': '密克罗尼西亚',
    'Palau': '帕劳', 'Marshall Islands': '马绍尔群岛', 'Nauru': '瑙鲁',
    'Kiribati': '基里巴斯', 'Tuvalu': '图瓦卢', 'Niue': '纽埃', 'Tokelau': '托克劳',
    'Cook Islands': '库克群岛', 'Pitcairn Islands': '皮特凯恩群岛', 'Nauru region': '瑙鲁地区',
    'State of Yap': '雅浦州', 'Yap': '雅浦', 'Chuuk': '丘克', 'Pohnpei': '波纳佩',
    'New Britain': '新不列颠', 'New Ireland': '新爱尔兰', 'Bougainville': '布干维尔',
    'Kermadec Islands': '克马德克群岛', 'Antipodes Islands': '安蒂波德斯群岛',
    'Auckland Islands': '奥克兰群岛', 'Chatham Islands': '查塔姆群岛',
    'Bounty Islands': '邦蒂群岛', 'Snares Islands': '斯奈尔斯群岛',
    'Campbell Island': '坎贝尔岛', 'Macquarie Island': '麦夸里岛',
    'Loyalty Islands': '洛亚蒂群岛', 'Chesterfield Islands': '切斯特菲尔德群岛',
    'Santa Cruz Islands': '圣克鲁斯群岛', 'Torres Islands': '托雷斯群岛',
    'Banks Islands': '班克斯群岛', 'Mathew Islands': '马修群岛', 'Hunter Island': '亨特岛',
    'Matthew Island': '马修岛', 'Anatomy Islands': '阿纳托姆群岛',

    /* --- 日本 / 琉球 / 千岛 / 萨哈林 --- */
    'Hokkaido': '北海道', 'Honshu': '本州', 'Kyushu': '九州', 'Shikoku': '四国',
    'Ryukyu Islands': '琉球群岛', 'Kuril Islands': '千岛群岛', 'Kuril': '千岛',
    'Izu Islands': '伊豆群岛', 'Bonin Islands': '小笠原群岛', 'Volcano Islands': '硫黄群岛',
    'Ogasawara Islands': '小笠原群岛', 'Nansei Islands': '南西群岛', 'Sakhalin': '萨哈林',
    'Kamchatka': '堪察加', 'Commander Islands': '指挥官群岛',

    /* --- 阿留申 / 白令 / 阿拉斯加周边 --- */
    'Aleutian Islands': '阿留申群岛', 'Aleutian': '阿留申', 'Andreanof Islands': '安德烈亚诺夫群岛',
    'Rat Islands': '拉特群岛', 'Near Islands': '近群岛', 'Fox Islands': '福克斯群岛',
    'Four Mountains': '四山群岛', 'Kodiak Island': '科迪亚克岛', 'Cook Inlet': '库克湾',
    'Pribilof Islands': '普里比洛夫群岛', 'Saint Lawrence Island': '圣劳伦斯岛',
    'Nunivak Island': '努尼瓦克岛', 'Bering Sea': '白令海', 'Chukchi Sea': '楚科奇海',
    'Gulf of Alaska': '阿拉斯加湾', 'Beaufort Sea': '波弗特海',

    /* --- 东亚 / 东南亚海域与岛屿 --- */
    'Sea of Okhotsk': '鄂霍次克海', 'Sea of Japan': '日本海', 'Philippine Sea': '菲律宾海',
    'Banda Sea': '班达海', 'Celebes Sea': '西里伯斯海', 'Molucca Sea': '马鲁古海',
    'Java Sea': '爪哇海', 'Flores Sea': '弗洛勒斯海', 'Timor Sea': '帝汶海',
    'Arafura Sea': '阿拉弗拉海', 'Sulu Sea': '苏禄海', 'Andaman Sea': '安达曼海',
    'Savu Sea': '萨武海', 'Halmahera Sea': '哈马黑拉海', 'Ceram Sea': '塞兰海',
    'East China Sea': '东海', 'South China Sea': '南海', 'Yellow Sea': '黄海',
    'Gulf of Thailand': '泰国湾', 'Gulf of Tonkin': '北部湾',
    'Luzon': '吕宋', 'Mindanao': '棉兰老', 'Visayas': '米沙鄢', 'Sumatra': '苏门答腊',
    'Java': '爪哇', 'Sulawesi': '苏拉威西', 'Bali': '巴厘', 'Flores': '弗洛勒斯',
    'Timor': '帝汶', 'Sumbawa': '松巴哇', 'Halmahera': '哈马黑拉', 'Seram': '塞兰',
    'Borneo': '婆罗洲', 'Palawan': '巴拉望', 'Mindoro': '民都洛', 'Panay': '班乃',
    'Negros': '内格罗斯', 'Cebu': '宿务', 'Bohol': '保和', 'Leyte': '莱特',
    'Samar': '萨马', 'Masbate': '马斯巴特', 'Catanduanes': '卡坦端内斯',
    'Babuyan Islands': '巴布延群岛', 'Batanes': '巴丹群岛', 'Sulu Archipelago': '苏禄群岛',
    'Nicobar Islands': '尼科巴群岛', 'Andaman Islands': '安达曼群岛',
    'Bay of Bengal': '孟加拉湾', 'Arabian Sea': '阿拉伯海', 'Laccadive Sea': '拉克代夫海',

    /* --- 印度洋 / 大西洋 / 太平洋洋脊与海盆 --- */
    'Indian Ocean': '印度洋', 'North Indian Ocean': '北印度洋',
    'South Indian Ocean': '南印度洋', 'Pacific Ocean': '太平洋',
    'South Pacific Ocean': '南太平洋', 'North Pacific Ocean': '北太平洋',
    'Atlantic Ocean': '大西洋', 'North Atlantic Ocean': '北大西洋',
    'South Atlantic Ocean': '南大西洋', 'Arctic Ocean': '北冰洋', 'Southern Ocean': '南大洋',
    'Mediterranean Sea': '地中海', 'Aegean Sea': '爱琴海', 'Caribbean Sea': '加勒比海',
    'Black Sea': '黑海', 'Caspian Sea': '里海', 'Red Sea': '红海',
    'Gulf of Aden': '亚丁湾', 'Persian Gulf': '波斯湾', 'Gulf of Oman': '阿曼湾',
    'Gulf of Mexico': '墨西哥湾', 'Scotia Sea': '斯科舍海', 'Drake Passage': '德雷克海峡',
    'Mid-Atlantic Ridge': '大西洋中脊', 'Mid-Indian Ridge': '印度洋中脊',
    'Carlsberg Ridge': '卡尔斯伯格海岭', 'Reykjanes Ridge': '雷克雅内斯海岭',
    'East Pacific Rise': '东太平洋海隆', 'West Chile Rise': '西智利海隆',
    'Chile Rise': '智利海隆', 'Galapagos Rise': '加拉帕戈斯海隆',
    'Owen Fracture Zone': '欧文断裂带', 'Romanche Fracture Zone': '罗曼什断裂带',
    'Java Trench': '爪哇海沟', 'Sunda Trench': '巽他海沟', 'Tonga Trench': '汤加海沟',
    'Kermadec Trench': '克马德克海沟', 'Mariana Trench': '马里亚纳海沟',
    'Philippine Trench': '菲律宾海沟', 'Japan Trench': '日本海沟',
    'Ryukyu Trench': '琉球海沟', 'Izu-Bonin Trench': '伊豆-小笠原海沟',
    'Aleutian Trench': '阿留申海沟', 'Peru-Chile Trench': '秘鲁-智利海沟',
    'Middle America Trench': '中美洲海沟', 'New Britain Trench': '新不列颠海沟',
    'San Andreas Fault': '圣安德烈亚斯断层', 'Alpine Fault': '阿尔卑斯断层',
    'Molucca Passage': '马鲁古海峡', 'Lombok Strait': '龙目海峡',
    'Sunda Strait': '巽他海峡', 'Makassar Strait': '望加锡海峡',
    'Bali Sea': '巴厘海', 'Gulf of Tomini': '托米尼湾', 'Gulf of Bone': '波尼湾',
    'Lake Baikal': '贝加尔湖', 'Lake Toba': '多巴湖', 'Lake Van': '凡湖',

    /* --- 加勒比 / 中大西洋 --- */
    'Cayman Islands': '开曼群岛', 'Lesser Antilles': '小安的列斯', 'Greater Antilles': '大安的列斯',
    'Azores': '亚速尔群岛', 'Canary Islands': '加那利群岛', 'Cape Verde': '佛得角',
    'Madeira': '马德拉', 'Barbados': '巴巴多斯', 'Martinique': '马提尼克',
    'Guadeloupe': '瓜德罗普', 'Dominica': '多米尼克', 'Saint Lucia': '圣卢西亚',
    'Grenada': '格林纳达', 'Saint Kitts and Nevis': '圣基茨和尼维斯',
    'Saint Vincent and the Grenadines': '圣文森特和格林纳丁斯',
    'Antigua and Barbuda': '安提瓜和巴布达', 'U.S. Virgin Islands': '美属维尔京群岛',
    'British Virgin Islands': '英属维尔京群岛', 'Virgin Islands': '维尔京群岛',
    'Anguilla': '安圭拉', 'Montserrat': '蒙特塞拉特', 'Aruba': '阿鲁巴',
    'Curacao': '库拉索', 'Bonaire': '博奈尔', 'Turks and Caicos Islands': '特克斯和凯科斯群岛',
    'Bahamas': '巴哈马', 'Bermuda': '百慕大', 'Saint Helena': '圣赫勒拿',
    'Ascension Island': '阿森松岛', 'Ascension Islands': '阿森松群岛',
    'Tristan da Cunha': '特里斯坦-达库尼亚', 'Bouvet Island': '布韦岛',
    'South Georgia': '南乔治亚岛', 'South Sandwich Islands': '南桑威奇群岛',
    'Falkland Islands': '福克兰群岛', 'Malvinas': '马尔维纳斯群岛',

    /* --- 北极 / 南极 --- */
    'Antarctica': '南极洲', 'South Shetland Islands': '南设得兰群岛',
    'Antarctic Peninsula': '南极半岛', 'Ross Sea': '罗斯海', 'Weddell Sea': '威德尔海',
    'Amundsen Sea': '阿蒙森海', 'Bellingshausen Sea': '别林斯高晋海',
    'Balleny Islands': '巴勒尼群岛', 'Macquarie Ridge': '麦夸里海岭',
    'Svalbard': '斯瓦尔巴', 'Svalbard and Jan Mayen': '斯瓦尔巴和扬马延',
    'Jan Mayen': '扬马延', 'Greenland Sea': '格陵兰海', 'Norwegian Sea': '挪威海',
    'Baffin Bay': '巴芬湾', 'Davis Strait': '戴维斯海峡', 'Laptev Sea': '拉普捷夫海',

    /* --- 美国本土 / 墨西哥 / 中美洲地名与州 --- */
    'Baja California': '下加利福尼亚', 'Baja California Sur': '南下加利福尼亚',
    'Gulf of California': '加利福尼亚湾', 'Sonora': '索诺拉', 'Chiapas': '恰帕斯',
    'Oaxaca': '瓦哈卡', 'Guerrero': '格雷罗', 'Puebla': '普埃布拉', 'Veracruz': '韦拉克鲁斯',
    'Mexico City': '墨西哥城', 'Michoacan': '米却肯', 'Jalisco': '哈利斯科',
    'Colima': '科利马', 'Nayarit': '纳亚里特', 'Sinaloa': '锡那罗亚', 'Chihuahua': '奇瓦瓦',
    'Coahuila': '科阿韦拉', 'Nuevo Leon': '新莱昂', 'Tamaulipas': '塔毛利帕斯',
    'Hidalgo': '伊达尔戈', 'Morelos': '莫雷洛斯', 'Tlaxcala': '特拉斯卡拉',
    'Yucatan': '尤卡坦', 'Quintana Roo': '金塔纳罗奥', 'Campeche': '坎佩切',
    'Tabasco': '塔瓦斯科', 'Durango': '杜兰戈', 'Zacatecas': '萨卡特卡斯',

    /* --- 南美 --- */
    'Arequipa': '阿雷基帕', 'Lima': '利马', 'Ica': '伊卡', 'Tacna': '塔克纳',
    'Cusco': '库斯科', 'Puno': '普诺', 'Moquegua': '莫克瓜', 'Ancash': '安卡什',
    'La Paz': '拉巴斯', 'Cochabamba': '科恰班巴', 'Potosí': '波托西', 'Oruro': '奥鲁罗',
    'Amazonas': '亚马孙', 'Acre': '阿克里', 'Mato Grosso': '马托格罗索',
    'Guayaquil': '瓜亚基尔', 'Quito': '基多', 'Bogota': '波哥大', 'Caracas': '加拉加斯',
    'Mendoza': '门多萨', 'San Juan': '圣胡安', 'Salta': '萨尔塔',
    'Jujuy': '胡胡伊', 'Santiago del Estero': '圣地亚哥-德尔埃斯特罗',
    'Catamarca': '卡塔马卡', 'La Rioja': '拉里奥哈', 'Tucuman': '图库曼',
    'Antofagasta': '安托法加斯塔', 'Atacama': '阿塔卡马', 'Coquimbo': '科金博',
    'Valparaiso': '瓦尔帕莱索', 'Maule': '马乌莱', 'Bio-Bio': '比奥比奥',
    'Araucania': '阿劳卡尼亚', 'Los Lagos': '洛斯拉戈斯', 'Los Rios': '洛斯里奥斯',
    'Aysen': '艾森', 'Magallanes': '麦哲伦',

    /* --- 大洋洲 / 新西兰 / 澳洲州 --- */
    'Queensland': '昆士兰', 'New South Wales': '新南威尔士', 'Victoria': '维多利亚',
    'Tasmania': '塔斯马尼亚', 'Western Australia': '西澳大利亚',
    'Northern Territory': '北领地', 'South Australia': '南澳大利亚',
    'North Island': '北岛', 'South Island': '南岛', 'Canterbury': '坎特伯雷',
    'Fiordland': '峡湾', 'Bay of Plenty': '丰盛湾', 'Hawke\'s Bay': '霍克斯湾',
    'Gisborne': '吉斯伯恩', 'Marlborough': '马尔堡', 'Otago': '奥塔哥',
    'Southland': '南地', 'Taranaki': '塔拉纳基', 'Waikato': '怀卡托',
    'Manawatu': '马纳瓦图', 'Wairarapa': '怀拉拉帕', 'West Coast': '西海岸',

    /* --- 欧洲海域 / 地中海周边 --- */
    'Ionian Sea': '伊奥尼亚海', 'Tyrrhenian Sea': '第勒尼安海', 'Adriatic Sea': '亚得里亚海',
    'Alboran Sea': '阿尔沃兰海', 'Balearic Sea': '巴利阿里海', 'Ligurian Sea': '利古里亚海',
    'Sea of Marmara': '马尔马拉海', 'Bay of Biscay': '比斯开湾',
    'English Channel': '英吉利海峡', 'North Sea': '北海', 'Baltic Sea': '波罗的海',
    'Sicily': '西西里', 'Sardinia': '撒丁', 'Corsica': '科西嘉', 'Crete': '克里特',
    'Cyclades': '基克拉泽斯', 'Dodecanese': '佐泽卡尼索斯', 'Rhodes': '罗得岛',
    'Euboea': '埃维亚', 'Peloponnese': '伯罗奔尼撒', 'Santorini': '圣托里尼',
    'Nisyros': '尼西罗斯', 'Milos': '米洛斯', 'Kos': '科斯', 'Samos': '萨摩斯',
    'Lesbos': '莱斯沃斯', 'Chios': '希俄斯', 'Zakynthos': '扎金索斯',
    'Kefalonia': '凯法利尼亚', 'Corfu': '科孚', 'Evia': '埃维亚',
    'Etna': '埃特纳', 'Stromboli': '斯特龙博利', 'Vesuvius': '维苏威',
    'Campania': '坎帕尼亚', 'Calabria': '卡拉布里亚', 'Sicilia': '西西里',
    'Lazio': '拉齐奥', 'Tuscany': '托斯卡纳', 'Umbria': '翁布里亚',
    'Andalusia': '安达卢西亚', 'Catalonia': '加泰罗尼亚', 'Galicia': '加利西亚',
    'Murcia': '穆尔西亚', 'Granada': '格拉纳达', 'Almeria': '阿尔梅里亚',

    /* --- 土耳其 / 中东 / 中亚 --- */
    'Anatolia': '安纳托利亚', 'Eastern Anatolia': '东安纳托利亚',
    'Aegean Region': '爱琴海地区', 'Marmara Region': '马尔马拉地区',
    'Black Sea Region': '黑海地区', 'Central Anatolia': '中安纳托利亚',
    'Elazig': '埃拉泽', 'Malatya': '马拉蒂亚', 'Bingol': '宾格尔', 'Van': '凡城',
    'Hakkari': '哈卡里', 'Erzurum': '埃尔祖鲁姆', 'Kars': '卡尔斯', 'Agri': '阿勒',
    'Mus': '穆什', 'Bitlis': '比特利斯', 'Siirt': '锡尔特', 'Sirnak': '舍尔纳克',
    'Diyarbakir': '迪亚巴克尔', 'Adiyaman': '阿德亚曼', 'Kahramanmaras': '卡赫拉曼马拉什',
    'Hatay': '哈塔伊', 'Osmaniye': '奥斯曼尼耶', 'Adana': '阿达纳', 'Mersin': '梅尔辛',
    'Izmir': '伊兹密尔', 'Manisa': '马尼萨', 'Mugla': '穆拉', 'Denizli': '代尼兹利',
    'Bursa': '布尔萨', 'Kocaeli': '科贾埃利', 'Sakarya': '萨卡里亚', 'Duzce': '迪兹杰',
    'Bolu': '博卢', 'Kastamonu': '卡斯塔莫努', 'Samsun': '萨姆松', 'Trabzon': '特拉布宗',
    'Rize': '里泽', 'Erzincan': '埃尔津詹', 'Sivas': '锡瓦斯', 'Tokat': '托卡特',
    'Yozgat': '约兹加特', 'Kirsehir': '克尔谢希尔', 'Nevsehir': '内夫谢希尔',
    'Kayseri': '开塞利', 'Nigde': '尼代', 'Aksaray': '阿克萨赖', 'Konya': '科尼亚',
    'Ankara': '安卡拉', 'Eskisehir': '埃斯基谢希尔', 'Kutahya': '屈塔希亚',
    'Afyonkarahisar': '阿菲永卡拉希萨尔', 'Isparta': '伊斯帕尔塔', 'Burdur': '布尔杜尔',
    'Antalya': '安塔利亚', 'Karabuk': '卡拉比克', 'Zonguldak': '宗古尔达克',
    'Cankiri': '昌克勒', 'Corum': '乔鲁姆', 'Amasya': '阿马西亚', 'Giresun': '吉雷松',
    'Ordu': '奥尔杜', 'Artvin': '阿尔特温', 'Ardahan': '阿尔达汉', 'Igdir': '厄德尔',
    'Kilis': '基利斯', 'Gaziantep': '加济安泰普', 'Sanliurfa': '尚勒乌尔法',
    'Mardin': '马尔丁', 'Batman': '巴特曼', 'Tunceli': '通杰利',
    'Zagros': '扎格罗斯', 'Alborz': '厄尔布尔士', 'Kopeh Dagh': '科佩特山脉',
    'Caucasus': '高加索', 'Greater Caucasus': '大高加索', 'Lesser Caucasus': '小高加索',
    'Hindu Kush': '兴都库什', 'Pamir': '帕米尔', 'Tian Shan': '天山', 'Tien Shan': '天山',
    'Kunlun': '昆仑', 'Altai': '阿尔泰', 'Himalayas': '喜马拉雅',
    'Dead Sea': '死海', 'Jordan Valley': '约旦河谷', 'Gulf of Aqaba': '亚喀巴湾',
    'Gulf of Suez': '苏伊士湾', 'Sea of Galilee': '加利利海',

    /* --- 非洲 --- */
    'Africa': '非洲', 'East African Rift': '东非大裂谷', 'Afar': '阿法尔', 'Afar Triangle': '阿法尔三角区',
    'Danakil': '达纳基尔', 'Ethiopian Highlands': '埃塞俄比亚高原',
    'Gulf of Guinea': '几内亚湾', 'Mozambique Channel': '莫桑比克海峡',
    'Atlas Mountains': '阿特拉斯山脉', 'Rift Valley': '东非大裂谷',
    'Lake Tanganyika': '坦噶尼喀湖', 'Lake Malawi': '马拉维湖', 'Lake Victoria': '维多利亚湖',
    'Lake Kivu': '基伍湖', 'Lake Turkana': '图尔卡纳湖', 'Lake Naivasha': '奈瓦沙湖',
    'Kivu': '基伍', 'Katanga': '加丹加', 'Socotra': '索科特拉',
    'Comoros': '科摩罗', 'Mayotte': '马约特', 'Reunion': '留尼汪', 'Mauritius': '毛里求斯',
    'Seychelles': '塞舌尔', 'Rodrigues': '罗德里格斯'
  };

  /* ---- 专名（USGS 高频出现的城市/城镇/岛屿/海岭） ----
   *  匹配规则（nameCN）：整串命中 > 最长前缀/后缀命中 > 通名兜底 > 保留英文
   *  ⚠️ 只收「有把握的官方译名」；没把握的宁可不收（会保留英文，不是错译） */
  var PLACE = {
    /* ===== 阿拉斯加（USGS 里占比最高，672 条 Alaska）===== */
    'Adak': '阿达克', 'Nikolski': '尼科尔斯基', 'Atka': '阿特卡', 'Akutan': '阿库坦',
    'Unalaska': '乌纳拉斯卡', 'Dutch Harbor': '荷兰港', 'False Pass': '福尔斯帕斯',
    'King Cove': '金科夫', 'Sand Point': '桑德波因特', 'Perryville': '佩里维尔',
    'Chignik': '奇格尼克', 'Chignik Lake': '奇格尼克湖', 'Chiniak': '奇尼亚克',
    'Karluk': '卡鲁克', 'Yakutat': '亚库塔特', 'Ugashik': '乌加希克',
    'Kaktovik': '卡克托维克', 'Petersville': '彼得斯维尔', 'Chickaloon': '奇卡隆',
    'Willow': '威洛', 'Big Lake': '大湖镇', 'Susitna': '苏西特纳',
    'Susitna North': '北苏西特纳', 'Skwentna': '斯克文特纳', 'Cantwell': '坎特韦尔',
    'Chase': '蔡斯', 'Talkeetna': '塔尔基特纳', 'Nikiski': '尼基斯基',
    'Nanwalek': '南瓦莱克', 'Anchor Point': '安克波因特', 'Ninilchik': '尼尼尔奇克',
    'Clam Gulch': '蛤蜊湾', 'Funny River': '芬尼里弗', 'Sterling': '斯特灵',
    'Soldotna': '索尔多特纳', 'Kenai': '基奈', 'Homer': '霍默', 'Seward': '苏厄德',
    'Valdez': '瓦尔迪兹', 'McCarthy': '麦卡锡', 'Glacier View': '冰川景',
    'Denali Park': '德纳利公园', 'Denali National Park': '德纳利国家公园',
    'Aleneva': '阿莱内瓦', 'Ouzinkie': '乌津基', 'Port Lions': '波特莱恩斯',
    'Old Harbor': '旧港', 'Nelson Lagoon': '纳尔逊潟湖', 'Nelson': '纳尔逊',
    'Ivanof Bay': '伊万诺夫湾', 'Port Graham': '波特格雷厄姆', 'Salamatof': '萨拉马托夫',
    'Point Hope': '波因特霍普', 'Point MacKenzie': '波因特麦肯齐', 'Point Lay': '波因特莱',
    'Anaktuvuk Pass': '阿纳克图武克帕斯', 'Arctic Village': '北极村',
    'Alcan Border': '阿尔坎边境', 'Eagle Village': '伊格尔村', 'Kobuk': '科伯克',
    'Ambler': '安布勒', 'Huslia': '胡斯利亚', 'Chuathbaluk': '楚阿特巴卢克',
    'Anchorage': '安克雷奇', 'Hatch': '哈奇', 'Chenega': '切内加',
    'Port Alsworth': '波特阿尔斯沃思', 'Port Clarence': '克拉伦斯港',
    'Port McNeill': '麦克尼尔港', 'Cooper Landing': '库珀兰丁', 'Moose Pass': '穆斯帕斯',
    'Slana': '斯拉纳', 'Kalskag': '卡尔斯卡格', 'Nunam Iqua': '努纳姆伊夸',
    'Attu Station': '阿图站', 'Attu': '阿图', 'Shemya': '谢米亚',
    'Adak Island': '阿达克岛', 'Little America': '小亚美利加',
    'Happy Valley': '哈皮瓦利', 'Manley Hot Springs': '曼利温泉',
    'Wofford Heights': '沃福德海茨', 'Hawaiian Ocean View': '夏威夷海洋景',

    /* ===== 美国本土 ===== */
    /* 加州 */
    'Ferndale': '芬代尔', 'Petrolia': '彼得罗利亚', 'Hydesville': '海兹维尔',
    'Pinnacles': '皮纳克斯', 'Goleta': '戈利塔', 'Avalon': '阿瓦隆',
    'Dana Point': '达纳角', 'Signal Hill': '锡格纳尔希尔', 'Garden City': '加登城',
    /* 直接补整串，避免 `Garden 城` 这种半中半英 */
    'Garden City, Texas': '得克萨斯 加登城',
    'Johannesburg': '约翰内斯堡', 'Bodie': '博迪', 'Westley': '韦斯特利',
    'Boonville': '布恩维尔', 'Cloverdale': '克洛弗代尔', 'Yountville': '扬特维尔',
    'South Lake Tahoe': '南太浩湖', 'Hollister': '霍利斯特', 'Anza': '安扎',
    'Hermosa Beach': '赫莫萨比奇', 'Malibu': '马里布', 'Ojai': '奥海',
    'Fillmore': '菲尔莫尔', 'Orange Cove': '奥兰治科夫', 'Piru': '皮鲁',
    'Aromas': '阿罗马斯', 'Alum Rock': '铝岩', 'Milpitas': '米尔皮塔斯',
    'Blackhawk': '布莱克霍克', 'Midway': '中途', 'Arthurs Point': '阿瑟斯角',
    'Edwards Air Force Base': '爱德华兹空军基地', 'Big Bear City': '大熊城',
    /* 内华达 / 西部 */
    'Preston': '普雷斯顿', 'Mina': '迈纳', 'Yerington': '耶灵顿', 'Valmy': '瓦尔米',
    'Gerlach': '格拉克', 'Toms Place': '汤姆斯普莱斯', 'Round Valley': '朗德瓦利',
    'Sun Valley': '太阳谷', 'Silver Springs': '银泉', 'Fallon': '法伦',
    'Tonopah': '托诺帕', 'Hawthorne': '霍桑', 'Caliente': '卡连特',
    /* 得州 / 中部 */
    'Whites City': '怀茨城', 'Pearsall': '皮尔索尔', 'Garden City': '加登城',
    'Coyanosa': '科亚诺萨', 'Midland': '米德兰', 'Balmorhea': '巴尔莫雷亚',
    'Ackerly': '阿克利', 'Dilley': '迪利', 'Assaria': '阿萨里亚', 'Texhoma': '特克斯霍马',
    /* 夏威夷 */
    'Pāhala': '帕哈拉', 'Pahala': '帕哈拉', 'Honaunau-Napoopoo': '霍瑙瑙-纳波奥波',
    "Pa‘auilo": '帕阿维洛', "Pa'auilo": '帕阿维洛', 'Paauilo': '帕阿维洛',
    'Waikoloa': '怀科洛亚', 'Puako': '普阿科', 'Honomu': '霍诺穆',
    'Laupāhoehoe': '劳帕霍埃霍埃', 'Laupahoehoe': '劳帕霍埃霍埃', 'Waimea': '怀梅阿',
    'Fern Forest': '弗恩森林', 'Leilani Estates': '莱拉尼庄园',
    'Hawaiian Beaches': '夏威夷海滩', 'Volcano': '沃卡诺', 'Kilauea': '基拉韦厄',
    'Mauna Loa': '冒纳罗亚', 'Mauna Kea': '冒纳凯阿', 'Haleakala': '哈莱阿卡拉',
    'Hilo': '希洛', 'Kailua': '凯卢阿', 'Kona': '科纳', 'Maui': '毛伊',
    /* 波多黎各 / 美属维尔京群岛 */
    'Guánica': '瓜尼卡', 'Guanica': '瓜尼卡', 'Rincón': '林孔', 'Rincon': '林孔',
    'Fuig': '富伊格', 'Vieques': '别克斯', 'Culebra': '库莱布拉', 'Luquillo': '卢基约',
    'Ponce': '蓬塞', 'Arecibo': '阿雷西博', 'Mayagüez': '马亚圭斯', 'Mayaguez': '马亚圭斯',
    'La Parguera': '拉帕尔格拉', 'Indios': '印第奥斯', 'Emajagua': '埃马哈瓜',
    'Quebradillas': '克布拉迪亚斯', 'Hatillo': '阿蒂略', 'Aguas Buenas': '阿瓜斯布埃纳斯',
    'Trujillo Alto': '特鲁希略阿尔托', 'Tierras Nuevas Poniente': '铁拉努埃瓦斯庞连特',
    'Carrizales': '卡里萨莱斯', 'Quebrada': '克布拉达', 'Yauco': '尧科',
    'Charlotte Amalie': '夏洛特阿马利亚', 'Cruz Bay': '克鲁兹湾',
    'Paradise': '帕拉代斯', 'Alianza': '阿连萨',

    /* ===== 环太平洋：印尼 / 菲律宾 / 巴新 / 所罗门 / 瓦努阿图 / 斐济 / 汤加 ===== */
    /* 印尼（BGN 罗马字 → 汉语拼音式回译，与中国地图出版社一致） */
    'Ruteng': '鲁滕', 'Bitung': '比通', 'Manado': '万鸦老', 'Waingapu': '瓦英阿普',
    'Tambolaka': '坦博拉卡', 'Tuapejat': '图阿佩贾特', 'Bengkulu': '明古鲁',
    'Banda Aceh': '班达亚齐', 'Tobelo': '托贝洛', 'Ternate': '特尔纳特',
    'Gorontalo': '哥伦打洛', 'Luwuk': '卢武克', 'Dampit': '丹皮特', 'Ende': '英德',
    'Mataram': '马塔兰', 'Maumere': '毛梅雷', 'Kupang': '古邦', 'Labuan Bajo': '下拉布安',
    'Ambon': '安汶', 'Amahai': '阿马哈伊', 'Labuha': '拉布哈', 'Pelabuhanratu': '佩拉布汉拉图',
    'Sibolga': '实武牙', 'Teluknaga': '特卢克纳加', 'Wonosobo': '沃诺索博',
    'Palu': '帕卢', 'Baubau': '巴乌巴乌', 'Agats': '阿加茨', 'Lembar': '伦巴尔',
    'Bima': '比马', 'Sumbawa Besar': '大松巴哇', 'Kuta': '库塔', 'Cianjur': '展玉',
    'Cipanas': '芝帕纳斯', 'Sukabumi': '苏卡布米', 'Garut': '加鲁特',
    'Kepulauan Babar': '巴巴尔群岛', 'Kepulauan Sula': '苏拉群岛',
    'Tual': '图阿尔', 'Saumlaki': '萨姆拉基', 'Modisi': '莫迪西', 'Kotamobagu': '科塔莫巴古',
    'Palu region': '帕卢地区', 'Baa': '巴阿',
    /* 菲律宾 */
    'Sarangani': '萨兰加尼', 'Burias': '布里亚斯', 'Tabiauan': '塔比亚万',
    'Davao': '达沃', 'General Santos': '桑托斯将军城', 'Zamboanga': '三宝颜',
    'Cagayan de Oro': '卡加延德奥罗', 'Butuan': '武端', 'Surigao': '苏里高',
    'Tacloban': '塔克洛班', 'Legazpi': '黎牙实比', 'Naga': '那牙', 'Batangas': '八打雁',
    'Lucena': '卢塞纳', 'Infanta': '因凡塔', 'Laoag': '拉瓦格', 'Vigan': '美岸',
    'Palimbang': '帕林邦', 'Dicabisagan': '迪卡比萨甘', 'Claveria': '克拉韦里亚',
    'Namuac': '纳穆阿克', 'Kalbay': '卡尔拜', 'Pondaguitan': '蓬达吉坦',
    'Kinablangan': '基纳布兰岸', 'Palauig': '帕劳伊格', 'Parang': '帕朗',
    'Bacolod': '巴科洛德', 'Iloilo': '伊洛伊洛', 'Cebu City': '宿务市',
    'Dumaguete': '杜马格特', 'Dipolog': '迪波洛格', 'Pagadian': '帕加迪安',
    'Cotabato': '哥打巴托', 'Kidapawan': '基达帕万', 'Malaybalay': '马来巴来',
    'Baguio': '碧瑶', 'Dagupan': '达古潘', 'Tuguegarao': '土格加劳',
    'Ilocos': '伊罗戈斯', 'Bicol': '比科尔', 'Mindoro': '民都洛',
    /* 巴布亚新几内亚 */
    'Kokopo': '科科波', 'Rabaul': '拉包尔', 'Panguna': '潘古纳', 'Bougainville': '布干维尔',
    'Lae': '莱城', 'Madang': '马当', 'Kimbe': '金贝', 'Angoram': '安戈拉姆',
    'Finschhafen': '芬什港', 'Kainantu': '凯南图', 'Wabag': '瓦巴格',
    'Mount Hagen': '芒特哈根', 'Goroka': '戈罗卡', 'Kandrian': '坎德里安',
    'Vanimo': '瓦尼莫', 'Wewak': '韦瓦克', 'Alotau': '阿洛陶', 'Popondetta': '波蓬德塔',
    'Kerema': '凯雷马', 'Daru': '达鲁', 'Kiunga': '基温加', 'Tabubil': '塔布比尔',
    /* 所罗门 / 瓦努阿图 / 新喀里多尼亚 */
    'Honiara': '霍尼亚拉', 'Guadalcanal': '瓜达尔卡纳尔', 'Gizo': '吉佐', 'Lata': '拉塔',
    'Kirakira': '基拉基拉', 'Auki': '奥基', 'Buala': '布阿拉', 'Tulagi': '图拉吉',
    'Arawa': '阿拉瓦', 'Malango': '马兰戈', 'Kilmia': '基尔米亚',
    'Norsup': '诺尔苏普', 'Luganville': '卢甘维尔', 'Santo': '桑托', 'Port-Olry': '奥利港',
    'Port-Vila': '维拉港', 'Isangel': '伊桑格尔', 'Lakatoro': '拉卡托罗',
    'Tadine': '塔迪讷', 'Tadine region': '塔迪讷地区', 'Mare': '马雷',
    'Poum': '普姆', 'Koumac': '库马克', 'Hienghène': '延根', 'Bourail': '布莱伊',
    /* 斐济 / 汤加 / 萨摩亚 / 瓦利斯 */
    'Levuka': '莱武卡', 'Suva': '苏瓦', 'Lautoka': '劳托卡', 'Labasa': '拉巴萨',
    'Sigatoka': '辛加托卡', 'Nadi': '楠迪', 'Ba': '巴', 'Rakiraki': '拉基拉基',
    'Nuku\'alofa': '努库阿洛法', 'Nukualofa': '努库阿洛法',
    'Neiafu': '内亚富', 'Pangai': '潘盖', 'Hihifo': '希希福', 'Ohonua': '奥霍努阿',
    "‘Ohonua": '奥霍努阿', 'Fangale’ounga': '方加莱奥温加', "Fangale'ounga": '方加莱奥温加',
    'Apia': '阿皮亚', 'Mata-Utu': '马塔乌图', 'Pago Pago': '帕果帕果',
    'Alo': '阿洛', 'Fais': '法伊斯', 'Futuna': '富图纳',
    'Nukufetau': '努库费陶', 'Funafuti': '富纳富提', 'Vavau': '瓦瓦乌', 'Haapai': '哈派',

    /* ===== 日本 / 台湾 / 俄罗斯远东 ===== */
    'Ibusuki': '指宿', 'Noda': '野田', 'Fukaura': '深浦', 'Iwaki': '磐城',
    'Koshima': '幸岛', 'Miyako': '宫古', 'Hachinohe': '八户', 'Namie': '浪江',
    'Nakatonbetsu': '中顿别', 'Urakawa': '浦河', 'Ōarai': '大洗', 'Oarai': '大洗',
    'Nobeoka': '延冈', 'Kuji': '久慈', 'Hasaki': '波崎', 'Shimoda': '下田',
    'Owase': '尾鹫', 'Uto': '宇土', 'Sakai': '堺', 'Mutsu': '陆奥', 'Shima': '志摩',
    'Uken': '宇检', 'Yonakuni': '与那国', 'Ishigaki': '石垣', 'Miyakojima': '宫古岛',
    'Naze': '名濑', 'Kunigami': '国头', 'Itoman': '糸满', 'Ushibukamachi': '牛深町',
    'Tomioka': '富冈', 'Onagawa Chō': '女川町', 'Onagawa Cho': '女川町',
    'Yōkaichiba': '八日市场', 'Yokaichiba': '八日市场', 'Ishige': '石下',
    'Tsunō': '都农', 'Tsuno': '都农', 'Satte': '幸手', 'Kōzaki': '神崎', 'Kozaki': '神崎',
    'Kariwa': '刈羽', 'Izumi': '出水', 'Midori': '绿', 'Shibayama': '芝山',
    'Isen': '伊仙', 'Koseda': '小濑田', 'Yudomari': '汤泊', 'Satsumasendai': '萨摩川内',
    'Tarumizu': '垂水', 'Kanoya': '鹿屋', 'Hioki': '日置', 'Minamikyushu': '南九州市',
    'Kagoshima': '鹿儿岛', 'Miyazaki': '宫崎', 'Kumamoto': '熊本', 'Oita': '大分',
    'Fukuoka': '福冈', 'Saga': '佐贺', 'Nagasaki': '长崎', 'Hiroshima': '广岛',
    'Matsuyama': '松山', 'Kochi': '高知', 'Tokushima': '德岛', 'Takamatsu': '高松',
    'Okayama': '冈山', 'Tottori': '鸟取', 'Matsue': '松江', 'Yamaguchi': '山口',
    'Kitakyushu': '北九州', 'Shizuoka': '静冈', 'Nagoya': '名古屋', 'Kanazawa': '金泽',
    'Niigata': '新潟', 'Sendai': '仙台', 'Morioka': '盛冈', 'Akita': '秋田',
    'Aomori': '青森', 'Sapporo': '札幌', 'Hakodate': '函馆', 'Kushiro': '钏路',
    'Nemuro': '根室', 'Obihiro': '带广', 'Asahikawa': '旭川', 'Wakkanai': '稚内',
    'Shikotan': '色丹', 'Kunashir': '国后', 'Iturup': '择捉', 'Habomai': '齿舞',
    'Yuzhno-Kurilsk': '南库里尔斯克', 'Severo-Kuril’sk': '北库里尔斯克',
    'Severo-Kurilsk': '北库里尔斯克', 'Kuril’sk': '库里尔斯克', 'Kurilsk': '库里尔斯克',
    'Petropavlovsk-Kamchatsky': '彼得罗巴甫洛夫斯克-堪察加',
    'Vilyuchinsk': '维柳钦斯克', 'Paratunka': '帕拉通卡', 'Yelizovo': '叶利佐沃',
    'Ozernovskiy': '奥泽尔诺夫斯基', 'Ust’-Kamchatsk Staryy': '乌斯季堪察茨克',
    'Ust-Kamchatsk Staryy': '乌斯季堪察茨克', 'Mil’kovo': '米利科沃', 'Milkovo': '米利科沃',
    'Ossora': '奥索拉', 'Tiksi': '季克西', 'Dolinsk': '多林斯克', 'Provideniya': '普罗维杰尼亚',
    'Nikolaevsk': '尼古拉耶夫斯克', 'Makarov': '马卡罗夫', 'Vardane': '瓦尔达内',
    'Kichera': '基切拉', 'Dawson City': '道森城', 'Atlasovo': '阿特拉索沃',
    'Gostagayevskaya': '戈斯塔加耶夫斯卡亚', 'Kamenka': '卡缅卡',
    'Hualien City': '花莲市', 'Hualien': '花莲', 'Hengchun': '恒春', 'Yilan': '宜兰',
    'Taitung': '台东', 'Chiayi': '嘉义', 'Nantou': '南投', 'Kaohsiung': '高雄',

    /* ===== 中国 / 中亚 / 南亚 ===== */
    'Turpan': '吐鲁番', 'Xunchang': '巡场', 'Dunhuang': '敦煌', 'Kuqa': '库车',
    'Qamdo': '昌都', 'Daocheng': '稻城', 'Weining': '威宁', 'Zhaotong': '昭通',
    'Yongning': '永宁', 'Simao': '思茅', 'Nailong': '奈隆', 'Oula Xiuma': '欧拉秀玛',
    'Bowangshan': '博望山', 'Zangguy': '藏桂', 'Dêqên': '德钦', 'Deqen': '德钦',
    'Ashkāsham': '阿什卡沙姆', 'Ashkasham': '阿什卡沙姆', 'Jurm': '朱尔姆',
    'Khandūd': '汗杜德', 'Khandud': '汗杜德', 'Farkhār': '法尔哈尔', 'Farkhar': '法尔哈尔',
    'Baghlān': '巴格兰', 'Baghlan': '巴格兰', 'Mongar': '蒙加尔', 'Khorugh': '霍罗格',
    'Murghob': '穆尔加布', 'Karakenja': '卡拉肯贾', 'Toktogul': '托克托古尔',
    'Zaqatala': '扎卡塔雷', 'Almaty': '阿拉木图', 'Tezpur': '特兹普尔',
    'Bāgeshwar': '巴格什瓦尔', 'Bageshwar': '巴格什瓦尔', 'Parbhani': '帕尔巴尼',
    'Sarupathar': '萨鲁帕塔尔', 'Barishal': '巴里萨尔', 'Jumla': '朱姆拉',
    'Port Blair': '布莱尔港', 'Khuzdar': '胡兹达尔', 'Mawlaik': '马莱',
    'Chauk': '稍埠', 'Sittwe': '实兑', 'Pyay': '卑谬', 'Thang': '唐',
    /* 中东 */
    'Borūjen': '博鲁詹', 'Borujen': '博鲁詹', 'Borāzjān': '博拉兹詹', 'Borazjan': '博拉兹詹',
    'Kāshmar': '卡什马尔', 'Kashmar': '卡什马尔', 'Bardaskan': '巴尔达斯坎',
    'Rasht': '拉什特', 'Bushehr': '布什尔', 'Āwash': '阿瓦什', 'Awash': '阿瓦什',
    'Mişrātah': '米苏拉塔', 'Misratah': '米苏拉塔', 'Tyre': '提尔', 'Hilvan': '希尔万',
    'Andırın': '安迪伦', 'Andirin': '安迪伦', 'Feke': '费凯', 'Saimbeyli': '赛因贝伊利',

    /* ===== 地中海 / 欧洲 ===== */
    'Thívai': '锡瓦', 'Thivai': '锡瓦', 'Chalandrítsa': '哈兰德里察',
    'Chalandritsa': '哈兰德里察', 'Istiaía': '伊斯蒂艾阿', 'Istiaia': '伊斯蒂艾阿',
    'Amorgós': '阿莫尔戈斯', 'Amorgos': '阿莫尔戈斯', 'Kastrí': '卡斯特里',
    'Kastri': '卡斯特里', 'Límni': '利姆尼', 'Limni': '利姆尼', 'Lixoúri': '利克苏里',
    'Lixouri': '利克苏里', 'Mantoúdi': '曼图迪', 'Mantoudi': '曼图迪', 'Malfa': '马尔法',
    'Rum': '鲁姆', 'Baumkirchen': '鲍姆基兴', 'Norðurþing': '诺泽辛',
    'Nordurthing': '诺泽辛', 'Höfn': '赫本', 'Hofn': '赫本', 'Polkowice': '波尔科维采',
    'Abanilla': '阿巴尼利亚', 'Brenas': '布雷纳斯', 'Galateo': '加拉特奥',
    'Dykanka': '迪坎卡', 'Solway': '索尔韦', 'Longyearbyen': '朗伊尔城',
    'Svalbard': '斯瓦尔巴', 'Hveragerdi': '惠拉盖尔济', 'Grindavik': '格林达维克',

    /* ===== 拉美 / 加勒比 ===== */
    'Punta Cana': '蓬塔卡纳', 'Boca de Yuma': '博卡德尤马', 'La Romana': '拉罗马纳',
    'San Rafael del Yuma': '圣拉斐尔德尤马', 'Guaymate': '瓜伊马特', 'Miches': '米切斯',
    'Samaná': '萨马纳', 'Samana': '萨马纳', 'Bayaguana': '巴亚瓜纳', 'Bogue': '博格',
    'Monte Cristi': '蒙特克里斯蒂', 'Santiago': '圣地亚哥', 'San Juan': '圣胡安',
    'Barahona': '巴拉奥纳', 'Azua': '阿苏阿', 'Baní': '巴尼', 'Bani': '巴尼',
    'San Cristobal': '圣克里斯托瓦尔', 'Higüey': '伊圭', 'Higuey': '伊圭',
    'Sosúa': '索苏阿', 'Sosua': '索苏阿', 'Cabarete': '卡巴雷特', 'Nagua': '纳瓜',
    'Anse à Galets': '昂萨加莱', 'Port-au-Prince': '太子港', 'Jérémie': '热雷米',
    'Les Cayes': '莱凯', 'Cap-Haïtien': '海地角', 'Fort-Liberté': '利贝泰堡',
    'Carrizal': '卡里萨尔', 'San Antonio': '圣安东尼奥', 'San Lucas': '圣卢卡斯',
    'Puerto Bolívar': '玻利瓦尔港', 'Puerto Madero': '马德罗港', 'El Pedregal': '埃尔佩德雷加尔',
    'El Arenal': '埃尔阿雷纳尔', 'El Colomo': '埃尔科洛莫', 'El Ramal (Porvenir)': '埃尔拉马尔',
    'Primo Tapia': '普里莫塔皮亚', 'Estacion Coahuila': '科阿韦拉站',
    'Plan de Ayala': '阿亚拉计划', 'Llano Suchiapa': '亚诺苏恰帕', 'Malaga': '马拉加',
    'Buenavista': '布埃纳维斯塔', 'La Cumbre': '拉昆布雷', 'La Playa': '拉普拉亚',
    'La Esperanza (El Zapotal)': '拉埃斯佩兰萨', 'Esperanza': '埃斯佩兰萨',
    'Villa El Carmen': '卡门镇', 'Masachapa': '马萨查帕', 'Nandaime': '南代梅',
    'Posoltega': '波索尔特加', 'Manaca Civil': '马纳卡西维尔', 'Las Nutrias': '拉斯努特里亚斯',
    'Cañas Gordas': '卡尼亚斯戈达斯', 'Canoas Gordas': '卡尼亚斯戈达斯',
    'Puerto San José': '圣何塞港', 'Quepos': '克波斯', 'Tamarindo': '塔马林多',
    'Socorro': '索科罗', 'Ocós': '奥科斯', 'Ocos': '奥科斯', 'Champerico': '昌佩里科',
    'Yepocapa': '耶波卡帕', 'Jucuarán': '胡库阿兰', 'Jucuaran': '胡库阿兰',
    'Acajutla': '阿卡胡特拉', 'Zonianá': '索尼亚纳', 'Zoniana': '索尼亚纳',
    'Brisas Barra de Suchiate': '苏恰特河口', 'Pante Makasar': '潘特马卡萨',
    'Metinaro': '梅蒂纳罗', 'Likisá': '利基萨', 'Likisa': '利基萨', 'Lospalos': '洛斯帕洛斯',
    'Dili': '帝力', 'Baucau': '包考', 'Suai': '苏艾', 'Maliana': '马利亚纳',
    /* ===== 补漏（按真实语料里仍留英文的条目逐条核对）===== */
    'Pagan': '帕甘', 'Saipan': '塞班', 'Tinian': '天宁', 'Rota': '罗塔',
    'Merizo Village': '梅里佐村', 'Yigo Village': '伊戈村', 'Dededo Village': '德德多村',
    'San Jose Village': '圣何塞村', 'Yona': '约纳', 'Agat': '阿加特',
    'Metahāra': '梅塔哈拉', 'Metahara': '梅塔哈拉', 'Abepura': '阿贝普拉',
    'Jayapura': '查亚普拉', 'Semporna': '仙本那', 'Burica': '布里卡',
    'Caluula': '卡卢拉', 'Sola': '索拉', 'Labuan': '纳闽', 'Komodo': '科莫多',
    'Santa Cruz': '圣克鲁斯', 'Santa Cruz Islands': '圣克鲁斯群岛',
    'Marysvale': '玛丽斯韦尔', 'Wisdom': '威斯德姆', 'Black Eagle': '黑鹰镇',
    'Pleasant Hill': '普莱森特希尔', 'Brentwood': '布伦特伍德', 'Willowbrook': '威洛布鲁克',
    'Inglewood': '英格尔伍德', 'Salinas': '萨利纳斯', 'San Nicolas': '圣尼古拉斯',
    'Puerto Real': '雷亚尔港', 'Cohoe': '科霍', 'Lowell Point': '洛厄尔角',
    'Lake Louise': '路易丝湖', 'King Salmon': '金萨蒙', 'Asan-Maina Village': '阿桑-迈纳村',
    'Houma': '霍马', 'Central': '森特拉尔', 'Wawa': '瓦瓦', 'Mosquera': '莫斯克拉',
    'The Valley': '瓦利',
    'Payakumbuh': '巴亚昆布', 'Sainte-Marie': '圣玛丽', 'Calumet': '卡卢梅特',
    'Wauna': '沃纳',
    'Basse-Pointe': '巴斯潘特', 'Orkney': '奥克尼', 'Isabela': '伊莎贝拉',
    'Corozal': '科罗萨尔', 'Chaparral': '查帕拉尔', 'Cobb': '科布', 'Cobb Mountain': '科布山',
    'Fontana': '丰塔纳', 'Woodside': '伍德赛德', 'Midland': '米德兰', 'Ovando': '奥万多',
    'Milford': '米尔福德', 'Navajo Mountain': '纳瓦霍山', 'Kenilworth': '肯尼尔沃思',
    'House': '豪斯', 'Tatums': '塔图姆斯', 'Stroud': '斯特劳德', 'Compton': '康普顿',
    'Lennox': '伦诺克斯', 'Animas': '阿尼马斯', 'Mentone': '门通', 'Los Ybanez': '洛斯伊瓦涅斯',
    'Toyah': '托亚', 'Charlotte': '夏洛特', 'Stanton': '斯坦顿', 'Jal': '哈尔',
    'Chaparral region': '查帕拉尔地区', 'Elfin Cove': '埃尔芬湾', 'Cold Bay': '冷湾',
    'Pedro Bay': '佩德罗湾', 'Akhiok': '阿基奥克', 'Beluga': '白鲸镇', 'Fishhook': '菲什胡克',
    'Hope': '霍普', 'Sunrise': '森赖斯', 'Fox River': '福克斯河', 'Fence Lake': '芬斯湖',
    'Gold Beach': '戈尔德比奇', 'Red Bluff': '雷德布拉夫', 'Granger': '格兰杰',
    'Stanley': '斯坦利', 'Trout Lake': '特劳特湖', 'Mount Vernon': '芒特弗农',
    'Oakland': '奥克兰', 'Fry': '弗吕', 'Palora': '帕洛拉', 'Bayview': '贝维尤',
    'Anderson Springs': '安德森温泉', 'Lake Nacimiento': '纳西米恩托湖',
    'Tayaman': '塔亚曼', 'Tamugan': '塔穆甘', 'Union': '乌尼翁',
    'Point of Rocks': '波因特岩', 'Smiley': '斯迈利', 'Cachí': '卡奇', 'Cachi': '卡奇',
    'Trà My': '茶眉', 'Tra My': '茶眉', 'Georgetown': '乔治敦', 'The Valley': '瓦利',
    'Pedro Bay region': '佩德罗湾地区', 'Cruz Bay region': '克鲁兹湾地区',
    'San Pedro de Atacama': '圣佩德罗德阿塔卡马', 'Colchane': '科尔查内',
    'Colchani': '科尔查尼', 'Ollagüe': '奥亚圭', 'Ollague': '奥亚圭',
    'La Tirana': '拉蒂拉纳', 'Camiña': '卡米尼亚', 'Camina': '卡米尼亚',
    'Calama': '卡拉马', 'Tocopilla': '托科皮利亚', 'Mejillones': '梅希约内斯',
    'María Elena': '玛丽亚埃莱娜', 'Maria Elena': '玛丽亚埃莱娜',
    'Puerto Chacabuco': '查卡布科港', 'Chaitén': '柴滕', 'Chaiten': '柴滕',
    'La Serena': '拉塞雷纳', 'Ovalle': '奥瓦列', 'Lebu': '莱布', 'Arauco': '阿劳科',
    'Osorno': '奥索尔诺', 'Valparaíso': '瓦尔帕莱索', 'Valparaiso': '瓦尔帕莱索',
    'Andacollo': '安达科略', 'Huacho': '瓦乔', 'Barranca': '巴兰卡',
    'Santa Rosa': '圣罗莎', 'Palpa': '帕尔帕', 'Nazca': '纳斯卡', 'Chala': '查拉',
    'Puerto Ayora': '阿约拉港', 'La Gomera': '拉戈梅拉', 'Socorro Island': '索科罗岛',
    'Roncesvalles': '龙塞斯瓦列斯', 'Rioblanco': '里奥布兰科', 'Sipí': '西皮',
    'Sipi': '西皮', 'Piedecuesta': '彼德奎斯塔', 'Bahía Solano': '巴伊亚索拉诺',
    'Juradó': '胡拉多', 'Jurado': '胡拉多', 'Guayabal': '瓜亚瓦尔', 'Ibagué': '伊瓦格',
    'Bogotá': '波哥大', 'Cepitá': '塞皮塔', 'Cepita': '塞皮塔', 'Dabeiba': '达贝伊巴',
    'Yacuiba': '亚奎瓦', 'Palca': '帕尔卡', 'Cliza': '克利萨', 'Irpa Irpa': '伊尔帕伊尔帕',
    'Cafayate': '卡法亚特', 'San Antonio de los Cobres': '圣安东尼奥德洛斯科布雷斯',
    'General Mosconi': '莫斯库尼将军镇', 'Buenos Aires': '布宜诺斯艾利斯',
    'Alianza Cristiana': '阿连萨克里斯蒂亚纳', 'Victor Raul': '维克托劳尔',
    'Chinchaypujio': '钦柴普希奥', 'Camilaca': '卡米拉卡', 'Tocota': '托科塔',
    'Cobquecura': '科布克库拉', 'Chañaral': '查尼亚拉尔', 'Chanal': '查尼亚拉尔',
    'Villa Presidente Frei': '弗雷总统镇', 'Antofagasta de la Sierra': '安托法加斯塔德拉谢拉',
    'Pilar': '皮拉尔', 'Suárez': '苏亚雷斯', 'Suarez': '苏亚雷斯',
    'Maria Antonia': '玛丽亚安东尼娅', 'Güiria': '圭里亚', 'Guiria': '圭里亚',
    'Duaca': '杜阿卡', 'Carúpano': '卡鲁帕诺', 'Carupano': '卡鲁帕诺',
    'Trujillo': '特鲁希略', 'Mérida': '梅里达', 'Merida': '梅里达',
    'Puerto La Cruz': '拉克鲁斯港', 'Cumaná': '库马纳', 'Cumana': '库马纳',

    /* ===== 大洋洲其他 / 其他海域岛屿 ===== */
    'Whakatane': '法卡塔尼', 'Te Anau': '蒂阿瑙', 'Turangi': '图朗伊',
    'Mangatainoka': '曼加泰诺卡', 'Patea': '帕蒂亚', 'Hicks Bay': '希克斯湾',
    'Coromandel': '科罗曼德尔', 'Kaikoura': '凯库拉', 'Blenheim': '布伦海姆',
    'Nelson region': '纳尔逊地区', 'Hastings': '黑斯廷斯', 'Napier': '内皮尔',
    'New Plymouth': '新普利茅斯', 'Tauranga': '陶朗加', 'Hamilton': '哈密尔顿',
    'Rotorua': '罗托鲁阿', 'Palmerston North': '北帕默斯顿', 'Dunedin': '达尼丁',
    'Invercargill': '因弗卡吉尔', 'Queenstown': '昆斯敦', 'Christchurch': '基督城',
    'Korumburra': '科伦布拉', 'Nyora': '尼奥拉', 'South Hedland': '南黑德兰',
    'Port Hedland': '黑德兰港', 'Ucluelet': '乌克卢利特', 'Vancouver': '温哥华',
    'Victoria, British Columbia': '不列颠哥伦比亚 维多利亚',
    'Owen Fracture Zone region': '欧文断裂带地区', 'Christmas Island': '圣诞岛',
    'Cocos Islands': '科科斯群岛', 'Chagos Archipelago': '查戈斯群岛',
    'Maug Islands': '毛格群岛', 'Easter Island': '复活节岛', 'Juan Fernandez Islands': '胡安·费尔南德斯群岛',
    'Galapagos Islands': '加拉帕戈斯群岛', 'Robinson Crusoe Island': '鲁滨逊漂流记岛',
    'Desventuradas Islands': '德斯文图拉达斯群岛', 'San Felix': '圣费利克斯',
    'North Island region': '北岛地区', 'Cape Reinga': '雷因加角'
  };

  /* ---- 需要「上下文才定得下来」的同名地名 ----
   *  `Central` 单独出现是方向词「中部」，但 `Central, Alaska` 是阿拉斯加的村镇；
   *  `Georgia`/`Victoria`/`San Juan` 这类同名冲突都靠「地名, 上级地区」整串匹配定夺。
   *  ⚠️ 值里**不要**再写一遍国家 —— usgs() 已经会把上级地区拼在前面。 */
  var CASES = {
    'Central, Alaska': '森特拉尔',
    'Union, Philippines': '乌尼翁'
  };

  /* ---- 词表查找（大小写不敏感，命中时用词典里的标准中译） ---- */
  function makeLookup(dict) {
    var map = Object.create(null), exact = Object.create(null), keys = Object.keys(dict);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], low = k.toLowerCase();
      if (!(low in map)) map[low] = dict[k];
      if (!(k in exact)) exact[k] = dict[k];
    }
    /** cs = true 时区分大小写。
     *  用途：`central`（方向词）/ `Central`（阿拉斯加地名）这类同名冲突 ——
     *  无脑翻 direction 会把地名翻错，无脑翻地名会把方向词翻错。 */
    function look(s, cs) {
      var t = String(s == null ? '' : s).trim();
      if (!t) return '';
      if (cs) { var e = exact[t]; if (e) return e; }
      return map[t.toLowerCase()] || '';
    }
    return look;
  }
  var lookRegion = makeLookup(REGION);
  var lookPlace = makeLookup(PLACE);
  var lookCase = makeLookup(CASES);

  /** 地区名（国家/州/海域）→ 中文；查不到返回 ''
   *  cs=true 时区分大小写（`Central` = 阿拉斯加森特拉尔，`central` = 方向词中部） */
  function region(s, cs) {
    var t = String(s == null ? '' : s).trim();
    if (!t) return '';
    var r = lookRegion(t, cs);
    if (r) return r;
    var r2 = lookRegion(t.replace(/\s+/g, ' '), cs);
    return r2 || '';
  }
  /** 专名 → 中文；查不到返回 '' */
  function place(s) {
    var t = String(s == null ? '' : s).trim();
    if (!t) return '';
    var r = lookPlace(t);
    if (r) return r;
    return lookPlace(t.replace(/\s+/g, ' ')) || '';
  }

  /* 地名里不该被当成「专名」翻掉的通用词（单独出现时保留原文更安全） */
  var GENERIC = { 'central': 1, 'region': 1, 'area': 1, 'union': 1, 'rocks': 1 };

  /** 专名里可以安全剥离的「方位修饰词 + 通名」表（`northern Mid-Atlantic Ridge` 这种） */
  var RIDGE_LIKE = {
    'mid-atlantic ridge': '大西洋中脊', 'mid-indian ridge': '印度洋中脊',
    'east pacific rise': '东太平洋海隆', 'west chile rise': '西智利海隆',
    'chile rise': '智利海隆', 'carlsberg ridge': '卡尔斯伯格海岭',
    'reykjanes ridge': '雷克雅内斯海岭', 'owen fracture zone': '欧文断裂带',
    'indian ridge': '印度洋中脊', 'pacific rise': '太平洋海隆',
    'southwest indian ridge': '西南印度洋中脊', 'southeast indian ridge': '东南印度洋中脊',
    'central indian ridge': '中印度洋中脊', 'northwest indian ridge': '西北印度洋中脊',
    'indian-antarctic ridge': '印度-南极海岭', 'pacific-antarctic ridge': '太平洋-南极海岭',
    'east scotia ridge': '东斯科舍海岭', 'scotia ridge': '斯科舍海岭',
    'mid-atlantic': '大西洋中脊'
  };
  /** `northern Mid-Atlantic Ridge` → `北大西洋中脊`（前缀方位 + 洋脊词条）
   *  ⚠️ 只对**结构化洋脊/断裂带**生效。若对任意专名生效，`Upper Lake` 会被搞成
   *     「上莱克」、`Eastern Island` 会被搞成「东艾兰」—— 宁可不翻也不能翻错。 */
  function prefixName(s) {
    var t = String(s == null ? '' : s).trim();
    if (!t) return '';
    var m = t.match(/^([A-Za-z-]+)\s+(.+)$/);
    if (!m) return '';
    var p = NAME_PREFIX[m[1].toLowerCase()];
    if (!p) return '';
    var restLow = m[2].toLowerCase().replace(/\s+/g, ' ');
    var base = RIDGE_LIKE[restLow];
    if (!base) return '';
    return p + base;
  }

  /** 地名中文化：整串 → 洋脊词条 → 专名+通名 → 前缀方位 → 保留原文
   *  ⚠️ 单个词不翻通名 —— `Volcano` 是夏威夷的地名，翻成「火山」就错了 */
  function nameCN(s) {
    var t = String(s == null ? '' : s).trim();
    if (!t) return '';
    var low = t.toLowerCase();
    /* `Central`（阿拉斯加地名）与 `central`（方向词）大小写不同，先做一次区分大小写的查表 */
    var csr = region(t, true);
    if (csr) return csr;
    /* `Union` / `Region` 这类通用词单独出现时保留原文更像地名（`Union, Philippines` 走整串条目） */
    if (GENERIC[low] && t.indexOf(' ') < 0) return t;
    /* 1) 整串命中（多词专名：`San Pedro de Atacama`） */
    var r = place(t) || region(t);
    if (r) return r;
    /* 2) 洋脊 / 断裂带（`northern Mid-Atlantic Ridge` 等） */
    var pn = prefixName(t);
    if (pn) return pn;
    if (RIDGE_LIKE[low]) return RIDGE_LIKE[low];
    /* 3) 多词：专名 + 通名 */
    if (t.split(/\s+/).length >= 2) {
      var m = t.match(/^([A-Za-z-]+)\s+(.+)$/);
      /* 3a) `northern Chile` → `北部智利`（方位修饰词 + 已知地区）；`northern Mid-Atlantic Ridge`
       *     已在 2) 处理。这里**只对地区名**生效，专名不吃前缀（`Upper Lake` 不能变「上莱克」） */
      if (m && NAME_PREFIX[m[1].toLowerCase()]) {
        var p = NAME_PREFIX[m[1].toLowerCase()];
        var rg0 = region(m[2]);
        if (rg0) return (/[北南东西中]部$/.test(p) ? p + rg0 : rg0 + p);
      }
      /* 3b) 最长前缀 = 词典专名，剩下走通名（`Manley Hot Springs` → `曼利温泉`） */
      var words = t.split(/\s+/);
      for (var n = words.length - 1; n >= 1; n--) {
        var head = words.slice(0, n).join(' ');
        var hc = place(head);
        if (hc) {
          var tail = words.slice(n).join(' ');
          if (/^(springs|hot springs|cove|bay|point|city|valley|island|lake|river)$/i.test(tail)) return hc;
          return (hc + ' ' + suffixCN(tail)).replace(/\s{2,}/g, ' ').trim();
        }
      }
      return suffixCN(t);
    }
    /* 4) 单词查不到 → 保留英文（硬译会错） */
    return t;
  }

  /** 一段逗号段 → 中文（国家/州/海域优先，其次专名，再退通名） */
  function segCN(s) {
    var t = String(s == null ? '' : s).trim();
    if (!t) return '';
    var rg = region(t) || region(t.replace(/\s+region$/i, ''));
    if (rg) return rg;
    var nm = nameCN(t);
    return nm;
  }

  /** USGS 英文地名 → 中文地名（**只留地名**）
   *  ★ 用户要求：不要「以北 92km」「以西南偏南 148km」这些方位/距离 —— 占地方、没用。
   *    只保留「国家/地区 + 地名」，例：
   *      `92 km N of Ruteng, Indonesia`  → `印度尼西亚 鲁滕`
   *      `South of the Fiji Islands`     → `斐济群岛`
   *      `Kermadec Islands region`       → `克马德克群岛 海域`
   *      `Rat Islands, Aleutian Islands, Alaska` → `拉特群岛 阿留申群岛 阿拉斯加`
   */
  function usgs(en) {
    var s = String(en == null ? '' : en).trim();
    if (!s) return '';
    /* ① 拆逗号段。USGS 的模板是「地名, 上级地区, …, 国家/州」，
     *    所以**从右往左**吃掉所有能识别成国家/州/海区的段（`…, B.C., MX` 要吃两段），
     *    剩下的段才是地名。反过来会把 `MX` 排到最前面（`MX 普里莫塔皮亚 不列颠哥伦比亚`）。 */
    var parts = s.split(', ');
    var regions = [];                       /* 从右往左收集，push 后即「大到小」 */
    var tail = '';                          /* 最后一段（最上级的州/国家），供语境查表用 */
    while (parts.length > 1) {
      var last = parts[parts.length - 1].trim();
      var bare = last.replace(/\s+region$/i, '').trim();
      var isReg = bare !== last;
      var c = region(last);
      if (!c && isReg) { c = region(last) || region(bare) || segCN(bare); }
      if (!c && !isReg) c = region(bare);
      if (!c) break;
      if (!tail) tail = last;
      regions.push(c + (isReg ? ' 海域' : ''));
      parts.pop();
    }
    /* ② 第一段末尾可能还挂着州缩写（`Primo Tapia, B.C., MX` 被上面吃掉 B.C. 后不会剩，
     *    但 `10 km S of Cobb, CA` 这类已由 ① 处理；这里兜底清理残留的孤立缩写段） */
    var s0 = parts.join(', ');
    /* ③ 谓词：`92 km NNE of X` / `South of the Fiji Islands` / `off the coast of X` */
    var name = '', isRegion = false;
    var m = s0.match(/^[\d.]+\s*km\s+[A-Za-z-]{1,12}\s+of\s+(.+)$/i);
    if (m) name = m[1];
    if (!name) { m = s0.match(/^([A-Za-z-]{1,12})\s+of\s+(?:the\s+)?(.+)$/i); if (m && isDirWord(m[1])) name = m[2]; }
    if (!name) { m = s0.match(/^off\s+the\s+coast\s+of\s+(.+)$/i); if (m) name = m[1]; }
    if (!name) { m = s0.match(/^near\s+the\s+coast\s+of\s+(.+)$/i); if (m) name = m[1]; }
    /* `near the coast of central Peru` 多一层方位词；`south of Africa` 的 South 若后面
     * 不剩东西（`South of the Fiji Islands` 已由上面接走），这里兜底剥掉方位前缀 */
    if (name) {
      var pm = name.match(/^([A-Za-z-]+)\s+of\s+(?:the\s+)?(.+)$/);
      if (pm && isDirWord(pm[1])) name = pm[2];
    }
    if (!name) { var b = s0.replace(/\s+region$/i, ''); isRegion = (b !== s0); name = b; }
    /* 有些条目前面带年份（`2011 Christchurch, New Zealand`）—— 只留地名 */
    name = name.replace(/^(?:19|20)\d{2}\s+/, '').trim();
    /* ④ 地名内部的逗号（`Rat Islands, Aleutian Islands` 剩下的多级）逐段翻译 */
    var segs = name.split(', ');
    /* ④a 语境同名词：`Central, Alaska` → 森特拉尔（`Central` 单独出现才是方向词「中部」）。
     *     值里不含国家，上级地区已由 regions 拼好，不能再拼一遍。 */
    var ctx = lookCase(name + ', ' + (tail || ''));
    if (ctx) return regions.concat([ctx]).join(' ').replace(/\s{2,}/g, ' ').trim();
    var out = (segs.length > 1) ? segs.map(segCN).filter(Boolean).join(' ') : nameCN(name);
    if (isRegion) out += ' 海域';
    /* 语序：国家 → 上级地区 → 地名（`墨西哥 不列颠哥伦比亚 普里莫塔皮亚`，中文从大到小）。
     * `regions` 从右往左收集，push 后天然是「大到小」顺序，这里直接拼。 */
    return regions.concat([out]).join(' ').replace(/\s{2,}/g, ' ').trim();
  }

  /** 中国/台湾源常见的中文方向词规范化：南南西 → 西南偏南，东北东 → 东北偏东 */
  var CN_DIR_FIX = [
    ['北北西', '西北偏北'], ['北北东', '东北偏北'],
    ['东北东', '东北偏东'], ['东南东', '东南偏东'],
    ['东南南', '东南偏南'], ['西南南', '西南偏南'],
    ['南南东', '东南偏南'], ['南南西', '西南偏南'],
    ['西南西', '西南偏西'], ['西北西', '西北偏西'],
    ['東北東', '东北偏东'], ['南南東', '东南偏南']
  ];
  /** 中文地名规范化（幂等）：**去掉方位/距离**，只留地名
   *  用户：「发个地名就行了，啥东南西北我又不管，浪费我时间、浪费空间」
   *    `瓦努阿图 Norsup 以东北东 77km` → `瓦努阿图 Norsup`
   *    `智利 Colchane 以南南西 72km`   → `智利 Colchane`
   *  同时也把日语式方向词（南南西/东北东）当作方向一并丢掉。 */
  function clean(s) {
    var t = String(s == null ? '' : s).trim();
    if (!t) return '';
    /* 尾部「以X NNkm」/「以X」/「NNkm 以X」 */
    t = t.replace(/\s*以\s*[NSEW东西南北偏-]{1,6}\s*[\d.]*\s*k?m?\s*$/i, '');
    t = t.replace(/\s*[\d.]+\s*km\s*以\s*[NSEW东西南北偏-]{1,6}\s*$/i, '');
    t = t.replace(/\s*以\s*[NSEW]{1,4}\s*[\d.]*\s*k?m?\s*$/i, '');
    /* 开头「X of the」这类英文残留（源里偶尔混排） */
    t = t.replace(/^(?:south|north|east|west|northeast|northwest|southeast|southwest)\s+of\s+(?:the\s+)?/i, '');
    return t.replace(/\s{2,}/g, ' ').trim();
  }

  global.QVPZ = {
    usgs: usgs, clean: clean, dir: dir, region: region, suffixCN: suffixCN, DIR: DIR,
    /* 本轮新增（不破坏上面的原接口） */
    place: place, nameCN: nameCN, CN_DIR_FIX: CN_DIR_FIX,
    REGION: REGION, PLACE: PLACE
  };
})(window);
