'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './Sidebar';
import MapArea from './MapArea';
import { parseGeoJSON, exportToCSV, exportToGeoJSON, exportToKML } from '@/lib/utils';
import { DbServiceFactory, FieldService } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import AuthModal from './AuthModal';
import { User, LogOut, Cloud, Navigation, Compass, Search, Target } from 'lucide-react';

export default function MainApp() {
  const [polygons, setPolygons] = useState<any[]>([]);
  const [points, setPoints] = useState<any[]>([]);
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null);
  const [isAddingPoint, setIsAddingPoint] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState<string>("");

  // 複数選択と複数結合（グループ化）
  const [selectedPolygonIds, setSelectedPolygonIds] = useState<string[]>([]);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

  // GPS現在地関連のステート
  const [gpsPosition, setGpsPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [isTrackingGps, setIsTrackingGps] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  // 認証とDBサービスの状態
  const [dbService, setDbService] = useState<FieldService | null>(null);
  const [user, setUser] = useState<any>(null);

  // スマホレスポンシブ用のステート
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<'map' | 'list' | 'edit' | 'points'>('map');

  // サイドバー幅調整用のState
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isDragging = useRef(false);

  // インポート中フラグ（自動保存を抑止するため）
  const isImportingRef = useRef(false);

  // ビューポートベースDB取得用キャッシュ（ID→polygon Map）
  const polygonCacheRef = useRef<Map<string, any>>(new Map());

  const startResizing = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
  }, []);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 圃場選択時にスマホでは自動で編集タブに遷移
  useEffect(() => {
    if (selectedPolygonId && isMobile) {
      setMobileTab('edit');
    }
  }, [selectedPolygonId, isMobile]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      if (e.clientX > 250 && e.clientX < 800) setSidebarWidth(e.clientX);
    };
    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = 'default';
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // GPS追跡用の位置情報ハンドリング
  useEffect(() => {
    if (isTrackingGps) {
      if ('geolocation' in navigator) {
        watchIdRef.current = window.navigator.geolocation.watchPosition(
          (position) => {
            setGpsPosition({
              lat: position.coords.latitude,
              lng: position.coords.longitude
            });
          },
          (error) => {
            console.error('GPS error:', error);
            alert('現在地の取得に失敗しました。GPS権限が許可されているか確認してください。');
            setIsTrackingGps(false);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      } else {
        alert('このデバイスはGPS位置情報取得に対応していません。');
        setIsTrackingGps(false);
      }
    } else {
      if (watchIdRef.current !== null) {
        window.navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setGpsPosition(null);
    }

    return () => {
      if (watchIdRef.current !== null) {
        window.navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [isTrackingGps]);

  // ビューポート変更時にDBから表示範囲内の筆ポリゴンを取得してキャッシュに追加
  const onMapBoundsChange = useCallback(async (bounds: { west: number; south: number; east: number; north: number }) => {
    if (!dbService || isImportingRef.current) return;
    try {
      const newPolys = await dbService.getSourcePolygonsInBbox(
        bounds.west, bounds.south, bounds.east, bounds.north
      );
      let changed = false;
      for (const poly of newPolys) {
        if (!polygonCacheRef.current.has(poly.internalId)) {
          polygonCacheRef.current.set(poly.internalId, poly);
          changed = true;
        }
      }
      if (changed) {
        // キャッシュ済みのuser-editedフィールドと新規筆データをマージ
        setPolygons(prev => {
          const editedMap = new Map(prev
            .filter(p => !p.properties?.isUnmapped || p.producerName || p.cropType)
            .map(p => [p.internalId, p])
          );
          const merged = new Map([...polygonCacheRef.current, ...editedMap]);
          return Array.from(merged.values());
        });
      }
    } catch (e) {
      console.error('Bbox fetch error:', e);
    }
  }, [dbService]);

  // DBサービス初期化とDBが変わったらキャッシュをリセット
  const initDb = useCallback(async () => {
    setLoadingMsg("データ読み込み中...");
    try {
      const service = await DbServiceFactory.getService();
      setDbService(service);
      
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*, organizations(name)')
          .eq('id', session.user.id)
          .single();
        setUser({ ...session.user, profile });
      } else {
        setUser(null);
      }

      const loadedPolygons = await service.getFields(); // 編集済みfieldのみ
      const loadedPoints = await service.getPoints();
      
      // 編集済みfieldsをキャッシュに追加
      polygonCacheRef.current = new Map(loadedPolygons.map(p => [p.internalId, p]));
      setPolygons(loadedPolygons);
      setPoints(loadedPoints);
      
      prevPolygonsRef.current = loadedPolygons;
      prevPointsRef.current = loadedPoints;
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMsg("");
    }
  }, []);

  useEffect(() => {
    initDb();

    // 認証状態の変更を監視
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      initDb();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [initDb]);

  // 2. 差分検知自動保存の仕組み (保存中フラグと同期更新で無限ループを鉄壁防御)
  const prevPolygonsRef = useRef<any[]>([]);
  const prevPointsRef = useRef<any[]>([]);
  const isSavingFieldRef = useRef<Set<string>>(new Set());
  const isSavingPointRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!dbService) return;
    // インポート中は自動保存をスキップ（フリーズ防止）
    if (isImportingRef.current) return;

    const timer = setTimeout(async () => {
      // polygons の追加・更新（isUnmapped=trueの未編集筆はスキップ）
      for (const poly of polygons) {
        // 未着手筆（サーバーから取得したまま未編集）は保存不要
        if (poly.properties?.isUnmapped && !poly.producerName && !poly.cropType && !poly.notes) continue;
        const id = poly.internalId;
        if (isSavingFieldRef.current.has(id)) continue; // すでに保存中なら多重実行をスキップ

        const prev = prevPolygonsRef.current.find(p => p.internalId === id);
        
        // 差分がなければ完全にスルー
        if (prev && JSON.stringify(prev) === JSON.stringify(poly)) {
          continue;
        }

        // 保存ロック
        isSavingFieldRef.current.add(id);

        try {
          const fieldData = {
            ...poly,
            _localGeometries: polygons.reduce((acc, curr) => {
              if (curr.internalId) acc[curr.internalId] = curr;
              return acc;
            }, {} as any)
          };
          
          const saved = await dbService.saveField(fieldData);
          
          // 保存が完了したタイミングで、同期的に prevRef を即座に更新 (再発火時の誤判定を防ぐ)
          prevPolygonsRef.current = prevPolygonsRef.current.map(p => p.internalId === id ? saved : p);
          
          // IDが変わった新規インサート時のみ React State を更新 (既存更新時はStateはすでに最新なので再セット不要＝無限ループを回避)
          if (saved.internalId !== id) {
            setPolygons(prevPolys => prevPolys.map(p => p.internalId === id ? saved : p));
            if (selectedPolygonId === id) {
              setSelectedPolygonId(saved.internalId);
            }
          }
        } catch (e) {
          console.error('Auto-save field failed:', e);
        } finally {
          isSavingFieldRef.current.delete(id);
        }
      }

      // points の追加・更新
      for (const pt of points) {
        const id = pt.id;
        if (isSavingPointRef.current.has(id)) continue; // 多重実行をスキップ

        const prev = prevPointsRef.current.find(p => p.id === id);
        if (prev && JSON.stringify(prev) === JSON.stringify(pt)) {
          continue;
        }

        isSavingPointRef.current.add(id);

        try {
          const saved = await dbService.savePoint(pt);
          prevPointsRef.current = prevPointsRef.current.map(p => p.id === id ? saved : p);
          
          if (saved.id !== id) {
            setPoints(prevPts => prevPts.map(p => p.id === id ? saved : p));
          }
        } catch (e) {
          console.error('Auto-save point failed:', e);
        } finally {
          isSavingPointRef.current.delete(id);
        }
      }

      // 削除された polygons の検知
      if (prevPolygonsRef.current.length > polygons.length) {
        for (const prev of prevPolygonsRef.current) {
          if (!polygons.some(p => p.internalId === prev.internalId) && !prev.internalId.startsWith('poly-')) {
            await dbService.deleteField(prev.internalId).catch(console.error);
          }
        }
        prevPolygonsRef.current = polygons;
      }

      // 削除された points の検知
      if (prevPointsRef.current.length > points.length) {
        for (const prev of prevPointsRef.current) {
          if (!points.some(p => p.id === prev.id) && !prev.id.startsWith('point-')) {
            await dbService.deletePoint(prev.id).catch(console.error);
          }
        }
        prevPointsRef.current = points;
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [polygons, points, dbService, selectedPolygonId]);


  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    initDb();
  };

  const copyShareUrl = () => {
    if (user?.profile?.organization_id) {
      const shareUrl = `${window.location.origin}/?org=${user.profile.organization_id}`;
      navigator.clipboard.writeText(shareUrl)
        .then(() => alert('閲覧用の共有URLをコピーしました！ログイン不要でマップを共有できます。'))
        .catch(() => alert('コピーに失敗しました。次のURLをコピーしてください:\n' + shareUrl));
    }
  };

  // 閲覧専用ゲストモードかどうか
  const isGuestMode = dbService?.isReadOnly() || false;

  // DB初期化待ち状態を考慮
  if (!dbService) {
    return <div className="flex h-screen w-full items-center justify-center bg-slate-50"><p className="text-slate-500 font-semibold animate-pulse">読み込み中...</p></div>;
  }

  // ログインしていない場合（ゲストモード以外）は全画面でAuthModalを表示
  if (!user && !isGuestMode) {
    return <AuthModal onSuccess={() => initDb()} />;
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between shrink-0 shadow-sm" style={{ zIndex: 1000 }}>
        <div className="flex items-center space-x-2 md:space-x-4">
          <h1 className="font-bold text-indigo-700 flex items-center gap-1.5 text-sm md:text-base">
            圃場地図
          </h1>
          


          {user && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap mr-4">
              <Cloud size={10} /> 同期中
            </span>
          )}
          {isGuestMode && (
            <span className="flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full whitespace-nowrap animate-pulse mr-4">
              閲覧専用
            </span>
          )}
          {loadingMsg && <span className="text-xs md:text-sm font-bold text-red-600 animate-pulse truncate max-w-[120px] md:max-w-none mr-4">{loadingMsg}</span>}
        </div>
        
        <div className="flex items-center space-x-2 md:space-x-4">
          {/* PC専用操作パネル (スマホでは非表示にしてスッキリさせます) */}
          <div className="hidden lg:flex space-x-2 text-xs">
            <button onClick={() => exportToGeoJSON({ polygons, points })} className="border px-2 py-1 bg-blue-50 text-blue-700 rounded shadow-sm font-semibold">GeoJSON</button>
            <button onClick={() => {
              const producer = window.prompt("特定の生産者のみ出力する場合は名前を入力してください。\n（空欄の場合は入力済みの全件を出力します）");
              if (producer !== null) exportToKML({ polygons, points }, producer.trim());
            }} className="border px-2 py-1 bg-green-50 text-green-700 font-bold rounded shadow-sm">KML出力</button>
            <button onClick={() => exportToCSV({ polygons, points })} className="border px-2 py-1 bg-orange-50 text-orange-700 rounded shadow-sm font-semibold">CSV</button>
          </div>

          <div className="h-6 w-px bg-gray-200 hidden md:block" />

          {/* 認証ユーザーUI（ゲストモード時はログインを非表示にしてスッキリさせます） */}
          {!isGuestMode && (
            <div className="flex items-center text-xs">
              {user ? (
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="text-right hidden md:block">
                    <p className="font-semibold text-slate-800 flex items-center gap-1 justify-end">
                      <User size={12} className="text-slate-500" />
                      {user.profile?.display_name || 'ユーザー'}
                    </p>
                    {user.profile?.organizations?.name && (
                      <p className="text-[10px] text-slate-500 font-medium">
                        {user.profile.organizations.name}
                      </p>
                    )}
                  </div>
                  {/* 【追加】共有URLコピーボタン */}
                  {user.profile?.organization_id && (
                    <button
                      onClick={copyShareUrl}
                      className="flex items-center gap-1 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-150 px-2.5 py-1.5 font-bold text-indigo-700 shadow-sm transition active:scale-95 whitespace-nowrap"
                    >
                      共有URLコピー
                    </button>
                  )}
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-800 active:scale-95"
                  >
                    <LogOut size={12} />
                    <span className="hidden sm:inline">ログアウト</span>
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </header>

      {/* メインビューエリア（スマホ時は縦レイアウト、PC時は横並び） */}
      <div className="flex flex-1 overflow-hidden relative flex-col md:flex-row">
        
        {/* 幅調整可能なサイドバー (PCでは横並び、スマホではタブ切り替えで全画面表示) */}
        <aside 
          style={{ 
            width: isMobile ? '100%' : sidebarWidth,
            display: isMobile && mobileTab === 'map' ? 'none' : undefined
          }} 
          className={`bg-white relative shrink-0 flex flex-col shadow-lg transition-all duration-200 ${
            isMobile 
              ? 'flex-1 w-full h-[calc(100svh-8rem)] pb-16 z-10' 
              : 'h-full border-r z-0'
          }`}
        >
          <Sidebar
            polygons={polygons}
            points={points}
            setPolygons={setPolygons}
            setPoints={setPoints}
            selectedPolygonId={selectedPolygonId}
            setSelectedPolygonId={setSelectedPolygonId}
            isAddingPoint={isAddingPoint}
            setIsAddingPoint={setIsAddingPoint}
            dbService={dbService}
            selectedPolygonIds={selectedPolygonIds}
            setSelectedPolygonIds={setSelectedPolygonIds}
            isMultiSelectMode={isMultiSelectMode}
            setIsMultiSelectMode={setIsMultiSelectMode}
            gpsPosition={gpsPosition}
            activeTabOverride={isMobile ? mobileTab : undefined}
            setActiveTabOverride={isMobile ? setMobileTab : undefined}
          />
          {/* ドラッグ用ハンドル (PCでのみ表示) */}
          <div onMouseDown={startResizing} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize bg-slate-200 hover:bg-indigo-400 z-50 transition-colors border-r hidden md:block" title="ドラッグで幅を調整" />
        </aside>
        
        {/* 地図エリア (PCでは残り全体、スマホでは map タブ時のみ全画面表示) */}
        <section 
          style={{ display: isMobile && mobileTab !== 'map' ? 'none' : undefined }}
          className={`flex-1 relative ${isMobile ? 'w-full h-[calc(100svh-4rem)]' : 'h-full w-full z-0'}`}
        >
          <div className={`absolute inset-0 ${isMobile ? 'pb-16' : ''}`}>
            <MapArea
              polygons={polygons}
              points={points}
              selectedPolygonId={selectedPolygonId}
              setSelectedPolygonId={setSelectedPolygonId}
              isAddingPoint={isAddingPoint}
              setIsAddingPoint={setIsAddingPoint}
              setPoints={setPoints}
              selectedPolygonIds={selectedPolygonIds}
              setSelectedPolygonIds={setSelectedPolygonIds}
              isMultiSelectMode={isMultiSelectMode}
              gpsPosition={gpsPosition}
              onBoundsChange={onMapBoundsChange}
            />
          </div>

          {/* フローティングGPS現在位置コントロール */}
          <div className="absolute top-4 right-4 z-50 flex flex-col gap-2">
            <button
              onClick={() => setIsTrackingGps(!isTrackingGps)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-xs font-bold shadow-xl backdrop-blur-md transition-all active:scale-95 ${
                isTrackingGps 
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo-600/20' 
                  : 'bg-white/95 text-slate-700 border-slate-200/80 hover:bg-slate-50'
              }`}
            >
              {isTrackingGps ? <Compass className="animate-spin text-white" size={14} /> : <Navigation className="text-indigo-600" size={14} />}
              {isTrackingGps ? 'GPS追跡: ON' : '現在地を取得'}
            </button>
          </div>
        </section>
      </div>

      {/* スマホ用下部タブナビゲーションバー（モバイルかつゲスト以外、またはゲストでも閲覧用に表示） */}
      {isMobile && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t flex justify-around items-center z-40 shadow-xl px-2 pb-1">
          <button 
            onClick={() => setMobileTab('map')} 
            className={`flex flex-col items-center justify-center flex-1 py-1 text-[10px] font-bold transition-all ${mobileTab === 'map' ? 'text-indigo-600 scale-105' : 'text-slate-400'}`}
          >
            <Compass size={18} className="mb-0.5" />
            地図
          </button>
          <button 
            onClick={() => setMobileTab('list')} 
            className={`flex flex-col items-center justify-center flex-1 py-1 text-[10px] font-bold transition-all ${mobileTab === 'list' ? 'text-indigo-600 scale-105' : 'text-slate-400'}`}
          >
            <Search size={18} className="mb-0.5" />
            一覧
          </button>
          <button 
            disabled={!selectedPolygonId}
            onClick={() => setMobileTab('edit')} 
            className={`flex flex-col items-center justify-center flex-1 py-1 text-[10px] font-bold transition-all disabled:opacity-30 ${mobileTab === 'edit' ? 'text-indigo-600 scale-105' : 'text-slate-400'}`}
          >
            <User size={18} className="mb-0.5" />
            編集
          </button>
          <button 
            disabled={!selectedPolygonId}
            onClick={() => setMobileTab('points')} 
            className={`flex flex-col items-center justify-center flex-1 py-1 text-[10px] font-bold transition-all disabled:opacity-30 ${mobileTab === 'points' ? 'text-indigo-600 scale-105' : 'text-slate-400'}`}
          >
            <Target size={18} className="mb-0.5" />
            ポイント
          </button>
        </div>
      )}


    </div>
  );
}
