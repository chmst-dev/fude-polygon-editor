'use client';
import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Lock, Mail, User, Shield, CheckCircle, AlertCircle, KeyRound } from 'lucide-react';

interface AuthModalProps {
  onSuccess: () => void;
}

export default function AuthModal({ onSuccess }: AuthModalProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgot, setIsForgot] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // ログイン・新規登録
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);

    if (!email || !password) {
      setErrorMsg('メールアドレスとパスワードを入力してください。');
      setLoading(false);
      return;
    }

    try {
      if (isSignUp) {
        if (!displayName) {
          setErrorMsg('お名前を入力してください。');
          setLoading(false);
          return;
        }

        // サインアップ時に display_name をメタデータとして渡す
        // 組織・プロフィールの自動作成は Supabase の Auth Trigger が行います
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName }
          }
        });

        if (signUpError) throw signUpError;

        setInfoMsg('登録が完了しました！そのままログインボタンを押してください。（メール確認が必要な場合は受信ボックスをご確認ください）');
        setIsSignUp(false);
      } else {
        // ログイン
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) throw signInError;

        onSuccess();
      }
    } catch (error: unknown) {
      console.error(error);
      const msg = error instanceof Error ? error.message : '認証エラーが発生しました。';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // パスワードリセットメール送信
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    if (!email) {
      setErrorMsg('メールアドレスを入力してください。');
      setLoading(false);
      return;
    }

    try {
      const redirectTo = `${window.location.origin}/auth/update-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (error) throw error;
      setResetSent(true);
    } catch (error: unknown) {
      console.error(error);
      const msg = error instanceof Error ? error.message : 'エラーが発生しました。しばらく経ってから再度お試しください。';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const backToLogin = () => {
    setIsForgot(false);
    setResetSent(false);
    setErrorMsg('');
    setInfoMsg('');
  };

  // ---- パスワードリセット: 送信完了画面 ----
  if (isForgot && resetSent) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-indigo-900 via-indigo-700 to-purple-800 relative overflow-hidden animate-fade-in">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-500/20 blur-3xl pointer-events-none" />
        <div className="relative w-full max-w-md rounded-3xl bg-white/95 backdrop-blur-xl border border-white/20 p-8 shadow-2xl z-10 m-4">
          <div className="mb-6 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
              <CheckCircle size={24} />
            </div>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-800">メールを送信しました</h2>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed text-center mb-6">
            ご入力のメールアドレスにパスワード再設定のご案内をお送りしました
            （アカウントが存在する場合）。<br />
            メール内のリンクからパスワードを再設定してください。
          </p>
          <button
            type="button"
            onClick={backToLogin}
            className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-95"
          >
            ログイン画面に戻る
          </button>
        </div>
      </div>
    );
  }

  // ---- パスワードリセット: メール入力画面 ----
  if (isForgot) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-indigo-900 via-indigo-700 to-purple-800 relative overflow-hidden animate-fade-in">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-500/20 blur-3xl pointer-events-none" />
        <div className="relative w-full max-w-md rounded-3xl bg-white/95 backdrop-blur-xl border border-white/20 p-8 shadow-2xl z-10 m-4">
          <div className="mb-6 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30">
              <KeyRound size={24} />
            </div>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-800">パスワードの再設定</h2>
            <p className="mt-1 text-sm text-slate-500">登録済みのメールアドレスを入力してください</p>
          </div>

          {errorMsg && (
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-100 p-3 text-xs text-rose-600">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">メールアドレス</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-3 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@fude.com"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-indigo-500 focus:bg-white"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 active:scale-95 disabled:opacity-50"
            >
              {loading ? '送信中...' : '再設定メールを送る'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={backToLogin}
              className="text-xs text-slate-500 hover:text-indigo-600 hover:underline"
            >
              &lt;- ログイン画面に戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- ログイン・新規登録画面 ----
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-indigo-900 via-indigo-700 to-purple-800 relative overflow-hidden animate-fade-in">
      {/* 背景の装飾 */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-500/20 blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md max-h-[95vh] overflow-y-auto rounded-3xl bg-white/95 backdrop-blur-xl border border-white/20 p-8 shadow-2xl transition-all duration-300 flex flex-col z-10 m-4">
        <div className="mb-6 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30">
            <Shield size={24} />
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-800">
            {isSignUp ? '新規アカウント作成' : 'みんなの圃場マップ ログイン'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {isSignUp ? 'アカウント情報を登録します' : 'アカウント情報を入力してログインしてください'}
          </p>
        </div>

        {errorMsg && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-100 p-3 text-xs text-rose-600">
            <AlertCircle size={16} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-xs text-emerald-600">
            <CheckCircle size={16} className="shrink-0" />
            <span>{infoMsg}</span>
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">メールアドレス</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-3 text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@fude.com"
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-indigo-500 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">パスワード</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-3 text-slate-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-indigo-500 focus:bg-white"
              />
            </div>
          </div>

          {isSignUp && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">お名前 (表示名)</label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="農場 太郎"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-indigo-500 focus:bg-white"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 active:scale-95 disabled:opacity-50"
          >
            {loading ? '処理中...' : isSignUp ? '新規登録する' : 'ログインする'}
          </button>
        </form>

        {/* パスワードをお忘れの方（ログイン画面のみ表示） */}
        {!isSignUp && (
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => { setIsForgot(true); setErrorMsg(''); setInfoMsg(''); }}
              className="text-xs text-slate-500 hover:text-indigo-600 hover:underline"
            >
              パスワードをお忘れですか？
            </button>
          </div>
        )}

        <div className="mt-4 text-center text-xs text-slate-500">
          {isSignUp ? (
            <p>
              すでにアカウントをお持ちですか？{' '}
              <button
                type="button"
                onClick={() => setIsSignUp(false)}
                className="font-semibold text-indigo-600 hover:underline"
              >
                ログイン
              </button>
            </p>
          ) : (
            <p>
              新しく使い始めますか？{' '}
              <button
                type="button"
                onClick={() => setIsSignUp(true)}
                className="font-semibold text-indigo-600 hover:underline"
              >
                新規登録はこちら
              </button>
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
