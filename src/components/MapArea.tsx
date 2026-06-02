'use client';
import dynamic from 'next/dynamic';
const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">地図を読み込み中...</div> });
export default function MapArea(props: any) { return <div className="w-full h-full relative z-0"><LeafletMap {...props} /></div>; }
