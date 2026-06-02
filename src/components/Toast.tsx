'use client';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastContextValue {
  success: (msg: string, duration?: number) => void;
  error: (msg: string, duration?: number) => void;
  info: (msg: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const addToast = useCallback((type: ToastType, message: string, duration: number) => {
    const id = `toast-${Date.now()}-${counterRef.current++}`;
    setToasts(prev => [...prev, { id, type, message, duration }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const ctx: ToastContextValue = {
    success: (msg, dur = 3000) => addToast('success', msg, dur),
    error:   (msg, dur = 5000) => addToast('error',   msg, dur),
    info:    (msg, dur = 3500) => addToast('info',     msg, dur),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {/* ポータルの代わりに fixed で最前面に配置 */}
      <div className="fixed bottom-20 right-4 z-[9999] flex flex-col gap-2 pointer-events-none md:bottom-6">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // マウント直後にアニメーション開始
    const showTimer = setTimeout(() => setVisible(true), 10);
    // duration 後にフェードアウト開始
    const hideTimer = setTimeout(() => setVisible(false), toast.duration - 300);
    // フェードアウト完了後に削除
    const removeTimer = setTimeout(() => onRemove(toast.id), toast.duration);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      clearTimeout(removeTimer);
    };
  }, [toast, onRemove]);

  const configs = {
    success: {
      icon: <CheckCircle size={16} className="shrink-0" />,
      bg:   'bg-emerald-600',
      border: 'border-emerald-700',
    },
    error: {
      icon: <AlertCircle size={16} className="shrink-0" />,
      bg:   'bg-rose-600',
      border: 'border-rose-700',
    },
    info: {
      icon: <Info size={16} className="shrink-0" />,
      bg:   'bg-indigo-600',
      border: 'border-indigo-700',
    },
  };

  const { icon, bg, border } = configs[toast.type];

  return (
    <div
      className={`
        pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-2xl
        border text-white text-sm font-semibold max-w-[320px] backdrop-blur-md
        transition-all duration-300 ease-out
        ${bg} ${border}
        ${visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}
      `}
    >
      {icon}
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        onClick={() => onRemove(toast.id)}
        className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
