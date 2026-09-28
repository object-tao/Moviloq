-- Owner-confirmed fixed customer quotes from Khorgos. These are route totals in USD.
-- They are separate from the generic distance tariffs and do not imply a fleet assignment.
CREATE TABLE ops_route_quotes (
  id TEXT PRIMARY KEY,
  origin_country_code TEXT NOT NULL CHECK (length(origin_country_code) = 2),
  origin_city TEXT NOT NULL CHECK (length(origin_city) BETWEEN 1 AND 80),
  destination_country_code TEXT NOT NULL CHECK (length(destination_country_code) = 2),
  destination_city TEXT NOT NULL CHECK (length(destination_city) BETWEEN 1 AND 80),
  vehicle_id TEXT NOT NULL CHECK (length(vehicle_id) BETWEEN 2 AND 80),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  price_basis TEXT NOT NULL CHECK (price_basis = 'customer-final'),
  tax_included INTEGER NOT NULL CHECK (tax_included = 1),
  fleet_id TEXT REFERENCES ops_resources(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','disabled')),
  source TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ops_route_quotes_active ON ops_route_quotes(
  origin_country_code,origin_city,destination_country_code,destination_city,vehicle_id
) WHERE status = 'active';
CREATE INDEX ops_route_quotes_lookup ON ops_route_quotes(
  origin_country_code,origin_city,destination_country_code,destination_city,status,effective_at DESC
);
CREATE INDEX ops_route_quotes_fleet ON ops_route_quotes(fleet_id) WHERE fleet_id IS NOT NULL;

WITH
vehicle_order(vehicle_id,position) AS (VALUES
  ('heavy-datongdao-5-axle',0),
  ('heavy-datongdao-6-axle',1),
  ('heavy-120m3-5-axle',2),
  ('heavy-120m3-6-axle',3),
  ('heavy-130m3',4),
  ('heavy-140m3',5),
  ('heavy-flatbed-13m-5-axle',6),
  ('heavy-flatbed-13m-6-axle',7),
  ('heavy-flatbed-17m-5-axle',8),
  ('heavy-flatbed-17m-6-axle',9)
),
route_prices(destination_country_code,destination_city,destination_slug,amounts) AS (VALUES
  ('KZ','Almaty','almaty','[3952,4992,5292,5304,5408,5512,3952,4576,4784,5096]'),
  ('KZ','Astana','astana','[5200,6136,6436,6552,6864,7176,5096,5720,6136,6656]'),
  ('KZ','Karaganda','karaganda','[4992,5928,6228,6344,6656,6968,4888,5512,5928,6448]'),
  ('KZ','Shymkent','shymkent','[4992,5928,6228,6344,6656,6968,4888,5512,5928,6448]'),
  ('KZ','Kostanay','kostanay','[6240,7176,7476,7696,8112,8528,6136,6864,7384,8008]'),
  ('KZ','Aktobe','aktobe','[6656,7592,7892,8112,8528,8944,6552,7384,7904,8528]'),
  ('KZ','Aktau','aktau','[8008,8944,9244,9464,9984,10400,7904,8944,9464,10400]'),
  ('KZ','Atyrau','atyrau','[7176,8112,8412,8632,9152,9568,7072,8112,8632,9568]'),
  ('KZ','Taraz','taraz','[4784,5720,5720,6136,6344,6552,4680,5304,5720,6240]'),
  ('UZ','Tashkent','tashkent','[6084,7852,7020,7956,8268,8476,6084,6812,7332,7852]'),
  ('UZ','Nukus','nukus','[7748,9516,8684,9620,9932,10140,7748,8476,8996,9516]'),
  ('UZ','Samarkand','samarkand','[6604,8372,7540,8476,8788,8996,6604,7332,7852,8372]'),
  ('UZ','Bukhara','bukhara','[7020,8788,7956,8892,9204,9412,7020,7748,8268,8788]'),
  ('UZ','Navoi','navoi','[6916,8684,7852,8788,9100,9308,6916,7644,8164,8684]'),
  ('UZ','Qarshi','qarshi','[6916,8684,7852,8788,9100,9308,6916,7644,8164,8684]'),
  ('UZ','Fergana','fergana','[7228,8996,8164,9100,9412,9620,7228,7956,8476,8996]'),
  ('UZ','Kokand','kokand','[7228,8996,8164,9100,9412,9620,7228,7956,8476,8996]'),
  ('UZ','Namangan','namangan','[7228,8996,8164,9100,9412,9620,7228,7956,8476,8996]'),
  ('UZ','Almalyk','almalyk','[6292,8060,7228,9204,8476,8684,6292,7020,7540,8060]'),
  ('RU','Moscow','moscow','[9672,null,13000,13312,13520,null,9672,9672,10400,10920]'),
  ('BY','Minsk','minsk','[10400,null,13416,13832,14560,null,10400,9000,11960,13000]'),
  ('RU','Saint Petersburg','saint-petersburg','[11440,null,14040,15080,15600,null,11440,8800,12480,13520]'),
  ('RU','Yekaterinburg','yekaterinburg','[9360,null,11440,11960,13000,null,9360,7200,10712,11960]'),
  ('TJ','Khujand','khujand','[7436,9204,8164,9308,9620,9828,7436,8164,8684,9204]'),
  ('TJ','Dushanbe','dushanbe','[8164,9932,8892,10036,10348,10556,8164,8892,9412,9932]')
)
INSERT INTO ops_route_quotes(
  id,origin_country_code,origin_city,destination_country_code,destination_city,vehicle_id,
  amount_cents,currency,price_basis,tax_included,fleet_id,status,source,version,effective_at,created_at,updated_at
)
SELECT
  'khorgos-' || route_prices.destination_slug || '-' || vehicle_order.vehicle_id || '-v1',
  'CN','Khorgos',route_prices.destination_country_code,route_prices.destination_city,vehicle_order.vehicle_id,
  CAST(json_extract(route_prices.amounts,'$[' || vehicle_order.position || ']') * 100 AS INTEGER),
  'USD','customer-final',1,NULL,'active','owner-khorgos-route-quotes-20260928-v1',1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM route_prices CROSS JOIN vehicle_order
WHERE json_extract(route_prices.amounts,'$[' || vehicle_order.position || ']') IS NOT NULL;

-- The owner confirmed that Minsk belongs under Belarus. Preserve the old RU:Minsk key as
-- disabled so historical drafts remain readable, then publish the corrected BY catalogue.
-- Seed the previously owner-approved catalogue on clean installations. Production imports
-- with the same stable IDs are left untouched.
WITH countries(code,name_zh,name_en,sort_order) AS (VALUES
  ('CN','中国','China',100),('KZ','哈萨克斯坦','Kazakhstan',101),('UZ','乌兹别克斯坦','Uzbekistan',102),
  ('RU','俄罗斯','Russia',103),('TJ','塔吉克斯坦','Tajikistan',104)
)
INSERT OR IGNORE INTO ops_settings(id,kind,scope,title,data_json,status,version,effective_at,publication_sequence,created_at,updated_at)
SELECT 'central-asia-country-'||lower(code)||'-v1','country',code,'中亚业务测试国家 / '||code,json_object('enabled',json('true'),'nameZh',name_zh,'nameEn',name_en,'sortOrder',sort_order),'published',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),(SELECT revision+1 FROM ops_meta),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM countries;

WITH cities(country_code,city_value,name_zh,name_en,sort_order,slug) AS (VALUES
  ('CN','Khorgos','霍尔果斯','Khorgos',0,'khorgos'),('CN','Alashankou','阿拉山口','Alashankou',1,'alashankou'),('CN','Baktu','巴克图','Baktu',2,'baktu'),
  ('KZ','Almaty','阿拉木图','Almaty',0,'almaty'),('KZ','Astana','阿斯塔纳','Astana',1,'astana'),('KZ','Karaganda','卡拉干达','Karaganda',2,'karaganda'),('KZ','Shymkent','奇姆肯特','Shymkent',3,'shymkent'),('KZ','Kostanay','库斯塔奈','Kostanay',4,'kostanay'),('KZ','Aktobe','阿克托别','Aktobe',5,'aktobe'),('KZ','Aktau','阿克套','Aktau',6,'aktau'),('KZ','Atyrau','阿特劳','Atyrau',7,'atyrau'),('KZ','Taraz','塔拉兹','Taraz',8,'taraz'),
  ('UZ','Tashkent','塔什干','Tashkent',0,'tashkent'),('UZ','Nukus','努库斯','Nukus',1,'nukus'),('UZ','Samarkand','撒马尔罕','Samarkand',2,'samarkand'),('UZ','Bukhara','布哈拉','Bukhara',3,'bukhara'),('UZ','Navoi','纳沃伊','Navoi',4,'navoi'),('UZ','Qarshi','卡尔西','Qarshi',5,'qarshi'),('UZ','Fergana','费尔干纳','Fergana',6,'fergana'),('UZ','Kokand','浩罕','Kokand',7,'kokand'),('UZ','Namangan','纳曼干','Namangan',8,'namangan'),('UZ','Almalyk','阿尔马雷克','Almalyk',9,'almalyk'),
  ('RU','Moscow','莫斯科','Moscow',0,'moscow'),('RU','Minsk','明斯克','Minsk',1,'minsk'),('RU','Saint Petersburg','圣彼得堡','Saint Petersburg',2,'saint-petersburg'),('RU','Yekaterinburg','叶卡捷琳堡','Yekaterinburg',3,'yekaterinburg'),
  ('TJ','Khujand','苦盏','Khujand',0,'khujand'),('TJ','Dushanbe','杜尚别','Dushanbe',1,'dushanbe')
)
INSERT OR IGNORE INTO ops_settings(id,kind,scope,title,data_json,status,version,effective_at,publication_sequence,created_at,updated_at)
SELECT 'central-asia-city-'||lower(country_code)||'-'||slug||'-v1','city',country_code||':'||replace(city_value,' ','%20'),'中亚业务测试城市 / '||country_code||' / '||name_zh,json_object('enabled',json('true'),'countryCode',country_code,'cityValue',city_value,'nameZh',name_zh,'nameEn',name_en,'sortOrder',sort_order),'published',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),(SELECT revision+1 FROM ops_meta),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM cities;

INSERT INTO ops_settings(id,kind,scope,title,data_json,status,version,effective_at,publication_sequence,created_at,updated_at)
VALUES
  ('central-asia-country-by-v1','country','BY','中亚业务测试国家 / BY',json_object('enabled',json('true'),'nameZh','白俄罗斯','nameEn','Belarus','sortOrder',104),'published',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),(SELECT revision+1 FROM ops_meta),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('central-asia-city-by-minsk-v1','city','BY:Minsk','中亚业务测试城市 / BY / 明斯克',json_object('enabled',json('true'),'countryCode','BY','cityValue','Minsk','nameZh','明斯克','nameEn','Minsk','sortOrder',0),'published',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),(SELECT revision+1 FROM ops_meta),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('central-asia-city-ru-minsk-v2','city','RU:Minsk','更正城市归属 / RU / 明斯克',json_object('enabled',json('false'),'countryCode','RU','cityValue','Minsk','nameZh','明斯克','nameEn','Minsk','sortOrder',1),'published',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),(SELECT revision+1 FROM ops_meta),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO ops_events(id,actor_id,actor_role,action,resource_type,resource_id,reason,before_json,after_json,created_at)
VALUES
  ('route-quotes-khorgos-import-v1','automation:owner-authorized-route-import','automation','route_quotes.imported','route_quote_batch','owner-khorgos-route-quotes-20260928-v1','用户确认 USD 客户最终线路报价；空白单元格保持暂无报价；未绑定车队。',NULL,json_object('source','owner-khorgos-route-quotes-20260928-v1','activeQuotes',242,'currency','USD','priceBasis','customer-final','fleetAssigned',json('false')),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('location-minsk-country-correction-v1','automation:owner-authorized-route-import','automation','location.corrected','city','BY:Minsk','用户确认明斯克归属白俄罗斯；旧 RU:Minsk 仅停用，不删除历史记录。',json_object('scope','RU:Minsk'),json_object('scope','BY:Minsk','countryCode','BY'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
