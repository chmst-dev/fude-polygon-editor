'use client';

/**
 * /auth/update-password
 *
 * Supabase のパスワードリセットメール経由でアクセスされる画面。
 *
 * フロー（implicit flow / hash token）:
 *   1. ユーザーがメール内リンクをクリック
 *      → /auth/update-password#access_token=...&type=recovery が開く
 *   2. Supabase JS クライアント（detectSessionInUrl: true デフォルト）が
 *      hash fragment を自動解析してセッションを確立する
 *   3. onAuthStateChange が PASSWORD_RECOVERY イベントを発火
 *   4. ページ側は getSession() + onAuthStateChange 両方でセッションを確認し、
 *      どちらか早い方でフォームを表示する
 *   5. ユーザーが新パスワードを入力 → supabase.auth.updateUser({ password })
 *   6. 成功後はトップ（/）にリダイレクト
 *
 * エラーケース:
 *   - リカバリセッションなし（直接アクセス）
 *   - リンク期限切れ・不正
 *   → 「再度パスワードリセットメールを送ってください」を表示
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Lock, CheckCircle, AlertCircle, KeyRound, ArrowLeft } from 'lucide-react';

type PageStatus =
  | 'checking'       // セッション確認中
  | 'ready'          // リカバリセッション確認済み、フォーム表示
  | 'submitting'     // パスワード更新中
  | 'success'        // 更新成功
  | 'invalid';       // セッションなし・期限切れ・不正リンク

export default function UpdatePasswordPage() {
  const router = useRouter();

  const [status, setStatus] = useState<PageStatus>('checking');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let settled = false;

    // ① ページ表示直後に getSession() を確認する
    // detectSessionInUrl: true (デフォルト) により、クライアント初期化時に
    // hash fragment / code query が自動処理されている場合はここで取得できる
    const checkExistingSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (settled) return;

      // セッションが存在し、かつ recovery セッションであることを確認
      // user.aud が 'authenticated' かつ token_type が recovery の場合を想定
      // getSession() で取得できたセッションは PASSWORD_RECOVERY イベント後と同等とみなす
      if (session?.user) {
        // hash fragment に type=recovery が含まれていたかを URL から確認（イベントより先に処理された場合）
        const hash = window.location.hash;
        const params = new URLSearchParams(hash.replace('#', ''));
        const type = params.get('type');

        if (type === 'recovery' || session !== null) {
          // recovery type が明示されている、またはセッション確立済みならフォームを表示
          // （onAuthStateChange が PASSWORD_RECOVERY を発火する前にセッションが確立されるケースに対応）
          settled = true;
          setStatus('ready');
        }
      }
    };

    checkExistingSession();

    // ② onAuthStateChange で PASSWORD_RECOVERY イベントを待つ
    // ①より遅れて発火することもあるため、両方用意する
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (settled) return;

      if (event === 'PASSWORD_RECOVERY') {
        settled = true;
        setStatus('ready');
        return;
      }

      // SIGNED_IN イベントで recovery セッションが確立される場合もある
      // URL の hash に type=recovery がある場合はフォームを表示する
      if (event === 'SIGNED_IN' && session?.user) {
        const hash = window.location.hash;
        const params = new URLSearchParams(hash.replace('#', ''));
        if (params.get('type') === 'recovery') {
          settled = true;
          setStatus('ready');
        }
      }
    });

    // ③ タイムアウト: 5秒待ってもセッションが取れない場合は invalid 扱い
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        setStatus('invalid');
      }
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    // バリデーション
    if (newPassword.length < 8) {
      setErrorMsg('パスワードは8文字以上で入力してください。');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('パスワードが一致しません。');
      return;
    }

    setStatus('submitting');

    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setStatus('success');
      // 3秒後にトップへ
      setTimeout(() => router.push('/'), 3000);
    } catch (error: unknown) {
      console.error(error);
      const msg = error instanceof Error ? error.message : 'パスワードの更新に失敗しました。もう一度お試しください。';
      setErrorMsg(msg);
      setStatus('ready');
    }
  };

  // ---- セッション確認中 ----
  if (status === 'checking') {
    return (
      <Wrapper>
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="h-10 w-10 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
          <p className="text-sm text-slate-500">認証情報を確認しています...</p>
        </div>
      </Wrapper>
    );
  }

  // ---- セッション無効・期限切れ・不正リンク ----
  if (status === 'invalid') {
    return (
      <Wrapper>
        <div className="mb-6 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-lg shadow-rose-500/30">
            <AlertCircle size={24} />
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-800">リンクが無効です</h2>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed text-center mb-6">
          このリンクは期限切れか、すでに使用済みです。<br />
          再度パスワードリセットメールを送ってください。
        </p>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-95"
        >
          <ArrowLeft size={16} />
          ログイン画面に戻る
        </button>
      </Wrapper>
    );
  }

  // ---- 更新成功 ----
  if (status === 'success') {
    return (
      <Wrapper>
        <div className="mb-6 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
            <CheckCircle size={24} />
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-800">パスワードを更新しました</h2>
        </div>
        <p className="text-sm text-slate-600 text-center mb-6">
          新しいパスワードで設定が完了しました。<br />
          まもなくログイン画面に移動します。
        </p>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 active:scale-95"
        >
          今すぐログイン画面へ
        </button>
      </Wrapper>
    );
  }

  // ---- パスワード入力フォーム（ready / submitting）----
  return (
    <Wrapper>
      <div className="mb-6 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30">
          <KeyRound size={24} />
        </div>
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-800">新しいパスワードの設定</h2>
        <p className="mt-1 text-sm text-slate-500">8文字以上のパスワードを入力してください</p>
      </div>

      {errorMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-100 p-3 text-xs text-rose-600">
          <AlertCircle size={16} className="shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleUpdatePassword} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">新しいパスワード</label>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-3 text-slate-400" />
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="8文字以上"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-indigo-500 focus:bg-white"
              disabled={status === 'submitting'}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">パスワード（確認）</label>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-3 text-slate-400" />
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="もう一度入力"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-indigo-500 focus:bg-white"
              disabled={status === 'submitting'}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={status === 'submitting'}
          className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 active:scale-95 disabled:opacity-50"
        >
          {status === 'submitting' ? '更新中...' : 'パスワードを変更する'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="text-xs text-slate-500 hover:text-indigo-600 hover:underline"
        >
          &lt;- ログイン画面に戻る
        </button>
      </div>
    </Wrapper>
  );
}

// ---- 共通ラッパー ----
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-indigo-900 via-indigo-700 to-purple-800 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-500/20 blur-3xl pointer-events-none" />
      <div className="relative w-full max-w-md rounded-3xl bg-white/95 backdrop-blur-xl border border-white/20 p-8 shadow-2xl z-10 m-4">
        {children}
      </div>
    </div>
  );
}
