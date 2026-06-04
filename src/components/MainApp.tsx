'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './Sidebar';
import MapArea from './MapArea';
import { parseGeoJSON, exportToCSV, exportToGeoJSON, exportToKML } from '@/lib/utils';
import { DbServiceFactory, FieldService } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import AuthModal from './AuthModal';
import { ToastProvider, useToast } from './Toast';
import { User, LogOut, Cloud, Navigation, Compass, Search, Target, MapPin, X, ChevronDown } from 'lucide-react';

// 内部実装コンポーネント（ToastProviderでラップするために分離）
function MainAppInner() {
  const [polygons, setPolygons] = useState<any[]>([]);
  const [points, setPoints] = useState<any[]>([]);
  
  // 文字サイズ調整用のステート ('sm' | 'base' | 'lg' | 'xl')
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg' | 'xl'>('base');

  // 初期ロード時に localStorage からフォントサイズを取得
  useEffect(() => {
    const savedSize = localStorage.getItem('fude-font-size') as 'sm' | 'base' | 'lg' | 'xl' | null;
    if (savedSize && ['sm', 'base', 'lg', 'xl'].includes(savedSize)) {
      setFontSize(savedSize);
    }
  }, []);

  // フォントサイズ変更時に html 要素の fontSize を変更
  useEffect(() => {
    const sizeMap = {
      sm: '14px',
      base: '16px',
      lg: '18px',
      xl: '20px',
    };
    document.documentElement.style.fontSize = sizeMap[fontSize];
    localStorage.setItem('fude-font-size', fontSize);
  }, [fontSize]);

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

  // URLパラメータから初期ゲスト判定を行う（DB初期化前の高速適用のため）
  const isGuestByUrl = typeof window !== 'undefined' && (new URLSearchParams(window.location.search).has('org') || new URLSearchParams(window.location.search).has('share'));

  // 閲覧専用ゲストモードかどうか
  const isGuestMode = dbService?.isReadOnly() || isGuestByUrl;
  const orgId = user?.profile?.organization_id || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('org') : null);

  // スマホレスポンシブ用のステート
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<'map' | 'list' | 'edit' | 'points'>('map');

  // タブ切り替えステートのリフトアップ
  const [activeTab, setActiveTab] = useState<'list' | 'edit' | 'points' | 'map'>('list');

  const handleSetActiveTab = useCallback((tab: 'list' | 'edit' | 'points' | 'map') => {
    setActiveTab(tab);
    setMobileTab(tab); // mobileTabも同期させる
  }, []);

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

  // 圃場選択時に自動で編集タブに遷移（編集権限がある場合のみ）
  // ただし、ポイント追加モード中はタブを切り替えない（ポイントタブへの自動遷移を上書きしないため）
  useEffect(() => {
    if (selectedPolygonId && !isGuestMode && !isAddingPoint) {
      handleSetActiveTab('edit');
    }
  }, [selectedPolygonId, isGuestMode, handleSetActiveTab, isAddingPoint]);

  // ピン追加完了（またはキャンセル）時に、自動的にポイントタブに戻る
  // スマホ・PC問わず、地図上でピンを打った直後はポイント画面に留まるべき
  const prevIsAddingPointRef = useRef(false);
  useEffect(() => {
    if (prevIsAddingPointRef.current && !isAddingPoint) {
      // ピン追加が完了したらポイントタブへ（スマホでは地図タブから戻す）
      handleSetActiveTab('points');
    }
    prevIsAddingPointRef.current = isAddingPoint;
  }, [isAddingPoint, handleSetActiveTab]);

  // サイドバーリサイズ用マウスイベント
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
  const toast = useToast();
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
            toast.error('現在地の取得に失敗しました。GPS権限が許可されているか確認してください。');
            setIsTrackingGps(false);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      } else {
        toast.error('このデバイスはGPS位置情報取得に対応していません。');
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

  // 「地図で場所を確認」ボタン押下時に現在のビューポートのポリゴンを強制読み込みする関数
  // LeafletMapが地図タブ表示時に invalidateSize を値変化で知らせるためのトリガーカウンター
  const [forceRefreshMap, setForceRefreshMap] = useState(0);

  const handleShowMap = useCallback(() => {
    // invalidateSizeトリガー（値が変わればMapAreaに伝わり地図を再描画する）
    setForceRefreshMap(c => c + 1);
  }, []);

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


  // スマホで地図タブに戻ったとき Leaflet を強制再描画（display:none 回避策）
  useEffect(() => {
    if (isMobile && mobileTab === 'map') {
      setForceRefreshMap(c => c + 1);
    }
  }, [isMobile, mobileTab]);

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
            
            // 【バグ修正】: 関連する未保存ポイントの fieldInternalId も新しいUUIDに更新する
            setPoints(prevPts => prevPts.map(pt => 
              pt.fieldInternalId === id ? { ...pt, fieldInternalId: saved.internalId } : pt
            ));
            // prevRefも追従更新（差分検知で不整合を起こさないため）
            prevPointsRef.current = prevPointsRef.current.map(pt => 
              pt.fieldInternalId === id ? { ...pt, fieldInternalId: saved.internalId } : pt
            );
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
        // すでに保存済み(UUID)かつ変更がなければスキップ
        // ※ただし未保存(point-始まり)で、かつ圃場側が保存済み(poly- / source- 以外)になった場合は保存処理に回す
        const isUnsavedPointWithSavedField = pt.id.startsWith('point-') && 
          !pt.fieldInternalId.startsWith('poly-') && 
          !pt.fieldInternalId.startsWith('source-');
        
        if (!isUnsavedPointWithSavedField && prev && JSON.stringify(prev) === JSON.stringify(pt)) {
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
        .then(() => toast.success('閲覧用の共有URLをコピーしました！ログイン不要でマップを共有できます。'))
        .catch(() => toast.error('コピーに失敗しました。' + shareUrl));
    }
  };



  // ゲスト閲覧用情報パネルのステート
  const [infoPanelPolygon, setInfoPanelPolygon] = useState<any>(null);
  const [infoPanelPoint, setInfoPanelPoint] = useState<any>(null);

  const handleGuestFieldClick = useCallback((polygonId: string) => {
    const polygon = polygons.find((p: any) => p.internalId === polygonId);
    if (polygon) {
      setInfoPanelPolygon(polygon);
      setInfoPanelPoint(null);
      setSelectedPolygonId(polygonId);
    }
  }, [polygons]);

  const handleGuestPointClick = useCallback((point: any) => {
    setInfoPanelPoint(point);
    setInfoPanelPolygon(null);
  }, []);


  // ページタイトルを設定
  useEffect(() => {
    document.title = 'みんなの圃場マップ';
    
    // descriptionメタタグもクライアント側で動的に更新
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute('content', isGuestMode ? 'みんなの圃場マップ' : '圃場情報を入れる画面です');
    }
  }, [isGuestMode]);

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
            みんなの圃場マップ
          </h1>
          


          {user && (
            <span className="hidden sm:flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap mr-4">
              <Cloud size={10} /> 同期中
            </span>
          )}
          {isGuestMode && (
            <span className="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full whitespace-nowrap animate-pulse mr-4">
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

          {/* 文字サイズ調整 UI */}
          <div className="flex items-center bg-slate-100 rounded-xl p-0.5 border border-slate-200 shadow-inner mr-1 md:mr-2 shrink-0 select-none">
            <button
              onClick={() => setFontSize('sm')}
              title="文字サイズ: 小"
              className={`px-2 py-1 text-[10px] md:text-xs rounded-lg font-bold transition-all active:scale-95 cursor-pointer ${
                fontSize === 'sm'
                  ? 'bg-white text-indigo-700 shadow-sm font-extrabold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              A-
            </button>
            <button
              onClick={() => setFontSize('base')}
              title="文字サイズ: 標準"
              className={`px-2 py-1 text-[10px] md:text-xs rounded-lg font-bold transition-all active:scale-95 cursor-pointer ${
                fontSize === 'base'
                  ? 'bg-white text-indigo-700 shadow-sm font-extrabold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              標準
            </button>
            <button
              onClick={() => setFontSize('lg')}
              title="文字サイズ: 大"
              className={`px-2 py-1 text-[10px] md:text-xs rounded-lg font-bold transition-all active:scale-95 cursor-pointer ${
                fontSize === 'lg'
                  ? 'bg-white text-indigo-700 shadow-sm font-extrabold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              A+
            </button>
            <button
              onClick={() => setFontSize('xl')}
              title="文字サイズ: 特大"
              className={`px-2 py-1 text-[10px] md:text-xs rounded-lg font-bold transition-all active:scale-95 cursor-pointer ${
                fontSize === 'xl'
                  ? 'bg-white text-indigo-700 shadow-sm font-extrabold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              A++
            </button>
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
                      <p className="text-xs text-slate-500 font-medium">
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
        {/* スマホ時は absolute で地図に重ねる。display:none はサイドバー側のみ使用（Leaflet と無関係なので安全） */}
        <aside 
          style={{ 
            width: isMobile ? '100%' : sidebarWidth,
            ...(isMobile ? {
              position: 'absolute' as const,
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 10,
              display: mobileTab === 'map' ? 'none' : undefined,
            } : {})
          }} 
          className={`bg-white shrink-0 flex flex-col shadow-lg ${
            isMobile 
              ? 'w-full pb-16' 
              : 'relative h-full border-r z-0'
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
            isMobile={isMobile}
            onShowMap={handleShowMap}
            orgId={orgId}
            activeTabOverride={activeTab}
            setActiveTabOverride={handleSetActiveTab}
          />
          {/* ドラッグ用ハンドル (PCでのみ表示) */}
          <div onMouseDown={startResizing} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize bg-slate-200 hover:bg-indigo-400 z-50 transition-colors border-r hidden md:block" title="ドラッグで幅を調整" />
        </aside>
        
        {/* 地図エリア: スマホ時も display:none は使わず visibility で隠す。
             display:none だと Leaflet がコンテナサイズを 0x0 と認識して
             タイルもポリゴンも表示できなくなるため、常に DOM に存在させる。 */}
        <section 
          style={isMobile ? {
            position: 'absolute' as const,
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 0,
            // display:none の代わりに visibility で隠す（Leaflet は常にサイズを保持）
            visibility: mobileTab !== 'map' ? 'hidden' as const : 'visible' as const,
            pointerEvents: mobileTab !== 'map' ? 'none' as const : 'auto' as const,
          } : undefined}
          className={`flex-1 relative ${isMobile ? 'w-full h-full' : 'h-full w-full z-0'}`}
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
              forceRefresh={forceRefreshMap}
              isGuestMode={isGuestMode}
              onGuestFieldClick={isGuestMode ? handleGuestFieldClick : undefined}
              onGuestPointClick={isGuestMode ? handleGuestPointClick : undefined}
              setActiveTab={handleSetActiveTab}
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
            onClick={() => handleSetActiveTab('map')} 
            className={`flex flex-col items-center justify-center flex-1 py-1 text-xs font-bold transition-all ${mobileTab === 'map' ? 'text-indigo-600 scale-105' : 'text-slate-400'}`}
          >
            <Compass size={18} className="mb-0.5" />
            地図
          </button>
          <button 
            onClick={() => handleSetActiveTab('list')} 
            className={`flex flex-col items-center justify-center flex-1 py-1 text-xs font-bold transition-all ${mobileTab === 'list' ? 'text-indigo-600 scale-105' : 'text-slate-400'}`}
          >
            <Search size={18} className="mb-0.5" />
            一覧
          </button>
          {!isGuestMode && (
            <>
              <button 
                disabled={!selectedPolygonId}
                onClick={() => handleSetActiveTab('edit')} 
                className={`flex flex-col items-center justify-center flex-1 py-1 text-xs font-bold transition-all disabled:opacity-30 ${mobileTab === 'edit' ? 'text-indigo-600 scale-105' : 'text-slate-400'}`}
              >
                <User size={18} className="mb-0.5" />
                編集
              </button>
              <button 
                disabled={!selectedPolygonId}
                onClick={() => handleSetActiveTab('points')} 
                className={`flex flex-col items-center justify-center flex-1 py-1 text-xs font-bold transition-all disabled:opacity-30 ${mobileTab === 'points' ? 'text-indigo-600 scale-105' : 'text-slate-400'}`}
              >
                <Target size={18} className="mb-0.5" />
                ポイント
              </button>
            </>
          )}
        </div>
      )}

      {/* ゲスト閲覧用情報パネル（画面下部スライドアップ） */}
      {isGuestMode && (infoPanelPolygon || infoPanelPoint) && (
        <div
          className="fixed bottom-16 md:bottom-0 left-0 right-0 z-[2000] pointer-events-none flex justify-center px-2 pb-2"
        >
          <div className="pointer-events-auto w-full max-w-lg bg-white/98 backdrop-blur-xl border border-slate-200 rounded-2xl shadow-2xl p-4 animate-slide-up">
            {infoPanelPolygon ? (
              <>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center">
                      <MapPin size={16} className="text-indigo-600" />
                    </div>
                    <div>
                      <p className="font-extrabold text-slate-900 text-sm">
                        {infoPanelPolygon.fieldName || infoPanelPolygon.producerName || '名称未設定'}
                      </p>
                      {infoPanelPolygon.producerName && (
                        <p className="text-xs text-slate-500 font-medium">{infoPanelPolygon.producerName}</p>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setInfoPanelPolygon(null)} className="text-slate-400 hover:text-slate-700 transition p-1 rounded-lg hover:bg-slate-100">
                    <X size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {infoPanelPolygon.cropType && (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2 text-center">
                      <p className="text-[0.6875rem] font-bold text-emerald-600 uppercase tracking-wide">作物</p>
                      <p className="font-bold text-emerald-900 text-xs mt-0.5">{infoPanelPolygon.cropType}</p>
                    </div>
                  )}
                  {infoPanelPolygon.geometry && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-2 text-center">
                      <p className="text-[0.6875rem] font-bold text-indigo-600 uppercase tracking-wide">面積</p>
                      <p className="font-bold text-indigo-900 text-xs mt-0.5">
                        {(() => { try { const a = require('@turf/turf').area(infoPanelPolygon.geometry); return `${(a / 100).toFixed(1)}a`; } catch { return '-'; } })()}
                      </p>
                    </div>
                  )}
                  {points.filter((p: any) => p.fieldInternalId === infoPanelPolygon.internalId).length > 0 && (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-2 text-center">
                      <p className="text-[0.6875rem] font-bold text-amber-600 uppercase tracking-wide">ポイント</p>
                      <p className="font-bold text-amber-900 text-xs mt-0.5">{points.filter((p: any) => p.fieldInternalId === infoPanelPolygon.internalId).length}件</p>
                    </div>
                  )}
                </div>
                {infoPanelPolygon.notes && (
                  <div className="bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 text-xs text-rose-800 font-medium">
                    ⚠️ {infoPanelPolygon.notes}
                  </div>
                )}
                {points.filter((p: any) => p.fieldInternalId === infoPanelPolygon.internalId).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-xs font-bold text-slate-400 mb-2">登録ポイント</p>
                    <div className="flex flex-wrap gap-1.5">
                      {points.filter((p: any) => p.fieldInternalId === infoPanelPolygon.internalId).map((pt: any) => (
                        <button
                           key={pt.id}
                           onClick={() => { setInfoPanelPoint(pt); setInfoPanelPolygon(null); }}
                           className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                        >
                          📍 {pt.pointType}{pt.name && pt.name !== pt.pointType ? ` (${pt.name})` : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : infoPanelPoint ? (
              <>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
                      <MapPin size={16} className="text-amber-600" />
                    </div>
                    <div>
                      <p className="font-extrabold text-slate-900 text-sm">
                        {infoPanelPoint.pointType}{infoPanelPoint.name && infoPanelPoint.name !== infoPanelPoint.pointType ? ` (${infoPanelPoint.name})` : ''}
                      </p>
                      {(() => { const f = polygons.find((p: any) => p.internalId === infoPanelPoint.fieldInternalId); return f ? <p className="text-xs text-slate-500">{f.fieldName || f.producerName || '圃場'}</p> : null; })()}
                    </div>
                  </div>
                  <button onClick={() => setInfoPanelPoint(null)} className="text-slate-400 hover:text-slate-700 transition p-1 rounded-lg hover:bg-slate-100">
                    <X size={16} />
                  </button>
                </div>
                {infoPanelPoint.imageUrl && (
                  <div className="mb-3 rounded-xl overflow-hidden border border-slate-100">
                    <img src={infoPanelPoint.imageUrl} alt={infoPanelPoint.pointType} className="w-full h-40 object-cover" />
                  </div>
                )}
                {infoPanelPoint.description && (
                  <p className="text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">{infoPanelPoint.description}</p>
                )}
                <button
                  onClick={() => { const f = polygons.find((p: any) => p.internalId === infoPanelPoint.fieldInternalId); if (f) { setInfoPanelPolygon(f); setInfoPanelPoint(null); } }}
                  className="mt-3 text-xs text-indigo-600 font-bold hover:underline"
                >
                  ← 圃場情報に戻る
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}

    </div>
  );
}

export default function MainApp() {
  return (
    <ToastProvider>
      <MainAppInner />
    </ToastProvider>
  );
}
