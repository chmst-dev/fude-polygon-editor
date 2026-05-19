'use client';
import dynamic from 'next/dynamic';
const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center">Loading Map...</div> });
export default function MapArea(props: any) { return <div className="w-full h-full relative z-0"><LeafletMap {...props} /></div>; }
