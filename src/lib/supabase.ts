import { createClient } from '@supabase/supabase-js';

// 環境変数が未定義の場合でもビルド時のPrerender Errorを防ぐため、ダミーのプレースホルダーを指定する
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn(
    'Warning: Supabase credentials are not defined in environmental variables. Falling back to local storage.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

