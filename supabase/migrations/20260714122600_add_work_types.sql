-- A-1. is_active カラムの追加
ALTER TABLE public.work_types ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- A-2. 既存項目の sort_order 更新および is_active 設定
UPDATE public.work_types SET sort_order = 90 WHERE code = 'transplant';
UPDATE public.work_types SET sort_order = 100 WHERE code = 'fertilize';
UPDATE public.work_types SET sort_order = 250 WHERE code = 'harvest';
UPDATE public.work_types SET sort_order = 260 WHERE code = 'irrigation';
UPDATE public.work_types SET sort_order = 999 WHERE code = 'other';

-- 旧項目の非アクティブ化
UPDATE public.work_types SET is_active = false WHERE code IN ('tillage', 'puddling', 'seeding', 'pesticide', 'weeding');

-- 新規項目の挿入
INSERT INTO public.work_types (code, name, icon_key, color, sort_order, is_active) VALUES
  ('tillage_1', '耕耘（1回目）', 'shovel', '#a16207', 10, true),
  ('tillage_2', '耕耘（2回目）', 'shovel', '#a16207', 20, true),
  ('tillage_3', '耕耘（3回目）', 'shovel', '#a16207', 30, true),
  ('puddling_rough', '代かき（荒代）', 'waves', '#0369a1', 40, true),
  ('puddling_main', '代かき（本代）', 'waves', '#0369a1', 50, true),
  ('seeding_rice', '播種（稲）', 'seed', '#15803d', 60, true),
  ('seeding_wheat', '播種（麦）', 'seed', '#15803d', 70, true),
  ('seeding_soybean', '播種（大豆）', 'seed', '#15803d', 80, true),
  ('mech_weeding_1', '機械除草（1回目）', 'scissors', '#ca8a04', 110, true),
  ('mech_weeding_2', '機械除草（2回目）', 'scissors', '#ca8a04', 120, true),
  ('mech_weeding_3', '機械除草（3回目）', 'scissors', '#ca8a04', 130, true),
  ('levee_weeding_1', 'あぜ除草（1回目）', 'scissors', '#65a30d', 140, true),
  ('levee_weeding_2', 'あぜ除草（2回目）', 'scissors', '#65a30d', 150, true),
  ('levee_weeding_3', 'あぜ除草（3回目）', 'scissors', '#65a30d', 160, true),
  ('levee_weeding_4', 'あぜ除草（4回目）', 'scissors', '#65a30d', 170, true),
  ('herbicide_1', '除草剤散布（1）', 'spray', '#dc2626', 180, true),
  ('herbicide_2', '除草剤散布（2）', 'spray', '#dc2626', 190, true),
  ('herbicide_middry_1', '中干し後 除草剤散布（1）', 'spray', '#ea580c', 200, true),
  ('herbicide_middry_2', '中干し後 除草剤散布（2）', 'spray', '#ea580c', 210, true),
  ('pest_control_1', '殺菌・殺虫剤（1）', 'spray', '#db2777', 220, true),
  ('pest_control_2', '殺菌・殺虫剤（2）', 'spray', '#db2777', 230, true),
  ('kusanemu_removal', '収穫前クサネム取り', 'scissors', '#4d7c0f', 240, true)
ON CONFLICT (code) DO NOTHING;

-- A-5. 既存記録の新項目への付け替え（データ移行）
UPDATE public.field_work_records
SET work_type_id = (SELECT id FROM public.work_types WHERE code = 'tillage_1')
WHERE work_type_id = (SELECT id FROM public.work_types WHERE code = 'tillage')
  AND EXISTS (SELECT 1 FROM public.work_types WHERE code = 'tillage_1')
  AND EXISTS (SELECT 1 FROM public.work_types WHERE code = 'tillage');

UPDATE public.field_work_records
SET work_type_id = (SELECT id FROM public.work_types WHERE code = 'puddling_rough')
WHERE work_type_id = (SELECT id FROM public.work_types WHERE code = 'puddling')
  AND EXISTS (SELECT 1 FROM public.work_types WHERE code = 'puddling_rough')
  AND EXISTS (SELECT 1 FROM public.work_types WHERE code = 'puddling');

UPDATE public.field_work_records
SET work_type_id = (SELECT id FROM public.work_types WHERE code = 'seeding_rice')
WHERE work_type_id = (SELECT id FROM public.work_types WHERE code = 'seeding')
  AND EXISTS (SELECT 1 FROM public.work_types WHERE code = 'seeding_rice')
  AND EXISTS (SELECT 1 FROM public.work_types WHERE code = 'seeding');

UPDATE public.field_work_records
SET work_type_id = (SELECT id FROM public.work_types WHERE code = 'pest_control_1')
WHERE work_type_id = (SELECT id FROM public.work_types WHERE code = 'pesticide')
  AND EXISTS (SELECT 1 FROM public.work_types WHERE code = 'pest_control_1')
  AND EXISTS (SELECT 1 FROM public.work_types WHERE code = 'pesticide');

UPDATE public.field_work_records
SET work_type_id = (SELECT id FROM public.work_types WHERE code = 'mech_weeding_1')
WHERE work_type_id = (SELECT id FROM public.work_types WHERE code = 'weeding')
  AND EXISTS (SELECT 1 FROM public.work_types WHERE code = 'mech_weeding_1')
  AND EXISTS (SELECT 1 FROM public.work_types WHERE code = 'weeding');
