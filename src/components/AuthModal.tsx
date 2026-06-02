'use client';
import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Lock, Mail, User, Shield, CheckCircle, AlertCircle } from 'lucide-react';

interface AuthModalProps {
  onSuccess: () => void;
  onClose?: () => void;
}

export default function AuthModal({ onSuccess, onClose }: AuthModalProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [loading, setLoading] = useState(false);

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
    } catch (error: any) {
      console.error(error);
      setErrorMsg(error.message || '認証エラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 animate-fade-in"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.96)', zIndex: 999999 }}
    >
      <div 
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-200 p-8 shadow-2xl transition-all duration-300 flex flex-col"
        style={{ 
          position: 'fixed', 
          top: '50%', 
          left: '50%', 
          transform: 'translate(-50%, -50%)', 
          backgroundColor: '#ffffff', 
          opacity: 1, 
          color: '#1e293b',
          zIndex: 1000000
        }}
      >
        <div className="mb-6 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30">
            <Shield size={24} />
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-800">
            {isSignUp ? '新規アカウント作成' : '共同編集システム ログイン'}
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
                placeholder="••••••••"
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

        <div className="mt-6 text-center text-xs text-slate-500">
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

        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
