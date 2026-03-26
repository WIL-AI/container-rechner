import { useRef, useState, useEffect, useCallback, useMemo, memo, Suspense } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Line, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { PackedItemInfo } from '../lib/packer';
import type { ContainerType } from '../lib/containers';
import { translations } from '../lib/translations';
import type { Language } from '../lib/translations';

interface Props {
  container: ContainerType;
  items: PackedItemInfo[];
  lang: Language;
  activeItemId: string | null;
  onItemClick: (id: string) => void;
}

const S = 1 / 1000;

function ContainerWireframe({ container }: { container: ContainerType }) {
  const cL = container.length * S;
  const cW = container.width * S;
  const cH = container.height * S;

  const edges: [number, number, number][][] = [
    [[0,0,0],[cW,0,0]], [[cW,0,0],[cW,0,cL]], [[cW,0,cL],[0,0,cL]], [[0,0,cL],[0,0,0]],
    [[0,cH,0],[cW,cH,0]], [[cW,cH,0],[cW,cH,cL]], [[cW,cH,cL],[0,cH,cL]], [[0,cH,cL],[0,cH,0]],
    [[0,0,0],[0,cH,0]], [[cW,0,0],[cW,cH,0]], [[cW,0,cL],[cW,cH,cL]], [[0,0,cL],[0,cH,cL]]
  ];

  return (
    <group>
      {edges.map((pts, i) => (
        <Line key={i} points={pts} color="#4a90d9" lineWidth={1.5} opacity={0.6} transparent />
      ))}
      <mesh position={[cW/2, 0.001, cL/2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[cW, cL]} />
        <meshStandardMaterial color="#1a2744" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      <Text position={[cW/2, -0.18, 0]} fontSize={0.18} color="#ef4444" anchorX="center" anchorY="top" fontWeight="bold">
        ← TÜR / DOOR →
      </Text>
      <Text position={[cW/2, -0.18, cL]} fontSize={0.14} color="#4a90d9" anchorX="center" anchorY="top">
        STIRNWAND / BACK
      </Text>
    </group>
  );
}

function PackedBox({ item, isActive, dimmed, onClick }: {
  item: PackedItemInfo;
  isActive: boolean;
  dimmed: boolean;
  onClick: () => void;
}) {
  const w = item.w * S;
  const h = item.h * S;
  const l = item.l * S;
  const px = item.x * S + w / 2;
  const py = item.y * S + h / 2;
  const pz = item.z * S + l / 2;
  const color = item.item.color || '#3b82f6';

  return (
    <group position={[px, py, pz]}>
      <mesh onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <boxGeometry args={[w, h, l]} />
        <meshStandardMaterial
          color={color} transparent
          opacity={dimmed ? 0.15 : (isActive ? 1 : 0.85)}
          emissive={isActive ? color : '#000000'}
          emissiveIntensity={isActive ? 0.3 : 0}
        />
      </mesh>
      <mesh>
        <boxGeometry args={[w, h, l]} />
        <meshBasicMaterial color="#ffffff" wireframe transparent opacity={dimmed ? 0.05 : 0.3} />
      </mesh>
      {!dimmed && (
        <Text
          position={[0, 0, l / 2 + 0.01]}
          fontSize={Math.min(w, h) * 0.4}
          color="white" anchorX="center" anchorY="middle"
          outlineWidth={0.01} outlineColor="#000000"
        >
          {`${item.loadingOrder}`}
        </Text>
      )}
    </group>
  );
}

function CameraGuard({ target }: { target: THREE.Vector3 }) {
  const { camera } = useThree();
  const initRef = useRef(false);

  useFrame(() => {
    // Force initial lookAt once
    if (!initRef.current) {
      camera.position.set(8, 6, -4);
      camera.lookAt(target);
      initRef.current = true;
      console.log("3D View [Guard]: Initial lookAt set to", target);
    }
    
    const dist = camera.position.distanceTo(target);
    if (dist > 50 || isNaN(dist)) {
       camera.position.set(8, 6, -4);
       camera.lookAt(target);
       console.warn("3D View [Guard]: Resetting camera due to drift/NaN.");
    }
  });
  return <PerspectiveCamera makeDefault position={[8, 6, -4]} fov={35} />;
}

export const Container3DView = memo(({ container, items, lang, activeItemId, onItemClick }: Props) => {
  const t = translations[lang];
  const [visibleStep, setVisibleStep] = useState<number>(items.length);
  const [isPlaying, setIsPlaying] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const controlsRef = useRef<any>(null);
  const maxStep = items.length;

  const target = useMemo(() => new THREE.Vector3(
    (container.width * S) / 2,
    (container.height * S) / 2,
    (container.length * S) / 2
  ), [container.width, container.height, container.length]);

  const startPlay = useCallback(() => {
    setVisibleStep(0);
    setIsPlaying(true);
  }, []);

  const stopPlay = useCallback(() => {
    setIsPlaying(false);
    if (playRef.current) clearInterval(playRef.current);
    playRef.current = null;
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    playRef.current = setInterval(() => {
      setVisibleStep(prev => {
        if (prev >= maxStep) { stopPlay(); return maxStep; }
        return prev + 1;
      });
    }, 600);
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [isPlaying, maxStep, stopPlay]);

  useEffect(() => {
    setVisibleStep(items.length);
    stopPlay();
  }, [items.length, stopPlay]);

  const applyPreset = useCallback((preset: string) => {
    if (!controlsRef.current) return;
    const controls = controlsRef.current;
    const cam = controls.object;
    switch (preset) {
      case 'iso': cam.position.set(8, 6, -4); break;
      case 'top': cam.position.set(target.x, 10, target.z + 0.01); break;
      case 'side': cam.position.set(-8, 2, target.z); break;
      case 'front': cam.position.set(target.x, 1.5, -6); break;
    }
    controls.target.copy(target);
    controls.update();
  }, [target]);

  const visibleItems = items.filter(i => i.loadingOrder <= visibleStep);

  const presetBtnStyle = {
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: 'white',
    padding: '0.3rem 0.6rem',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: 'bold' as const,
  };

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>🎮 {t.view3DTitle}</span>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button type="button" style={presetBtnStyle} onClick={() => applyPreset('iso')}>{t.view3DPresetIso}</button>
          <button type="button" style={presetBtnStyle} onClick={() => applyPreset('top')}>{t.view3DPresetTop}</button>
          <button type="button" style={presetBtnStyle} onClick={() => applyPreset('side')}>{t.view3DPresetSide}</button>
          <button type="button" style={presetBtnStyle} onClick={() => applyPreset('front')}>{t.view3DPresetFront}</button>
        </div>
      </h4>
      
      <div style={{
        width: '100%', height: '350px', borderRadius: '12px', overflow: 'hidden',
        border: '2px solid var(--border)',
        background: 'linear-gradient(180deg, #0a0f1e 0%, #141e33 100%)',
        cursor: 'grab', position: 'relative',
        contain: 'strict', // HARD-STOP for ResizeObserver loops
        minHeight: '350px',
        maxHeight: '350px'
      }}>
        <Canvas 
          key={`canvas-${container.id}-${items.length}`}
          gl={{ antialias: true }}
        >
          <Suspense fallback={null}>
            <CameraGuard target={target} />
            <ambientLight intensity={0.8} />
            <directionalLight position={[10, 10, 10]} intensity={1} />
            <directionalLight position={[-10, 10, -10]} intensity={0.5} />
            <ContainerWireframe container={container} />
            {visibleItems.map((item) => (
              <PackedBox 
                key={`${item.item.id}-${item.loadingOrder}`} 
                item={item}
                isActive={activeItemId === item.item.id}
                dimmed={activeItemId !== null && activeItemId !== item.item.id}
                onClick={() => onItemClick(item.item.id)} 
              />
            ))}
            <OrbitControls ref={controlsRef} target={target} makeDefault enableDamping={false} minDistance={1} maxDistance={100} />
          </Suspense>
        </Canvas>
      </div>

      <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', background: 'rgba(0,0,0,0.3)', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{t.stepControlLabel}</span>
        <input type="range" min={0} max={maxStep} value={visibleStep}
          onChange={e => { stopPlay(); setVisibleStep(Number(e.target.value)); }}
          style={{ flex: 1, accentColor: 'var(--accent)' }} />
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', minWidth: '50px', textAlign: 'center' }}>
          {visibleStep}/{maxStep}
        </span>
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {!isPlaying ? (
            <button type="button" onClick={startPlay} style={{ ...presetBtnStyle, background: 'var(--accent)', padding: '0.3rem 0.5rem' }}>▶ {t.stepPlay}</button>
          ) : (
            <button type="button" onClick={stopPlay} style={{ ...presetBtnStyle, background: 'var(--danger)', padding: '0.3rem 0.5rem' }}>⏸ {t.stepPause}</button>
          )}
          <button type="button" onClick={() => { stopPlay(); setVisibleStep(maxStep); }} style={{ ...presetBtnStyle, padding: '0.3rem 0.5rem' }}>{t.stepAll}</button>
        </div>
      </div>
    </div>
  );
});
