import { useRef, useState, useEffect, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Line } from '@react-three/drei';
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

// Scale factor: convert mm to scene units (1 unit = 1000mm = 1m)
const S = 1 / 1000;

function ContainerWireframe({ container }: { container: ContainerType }) {
  const cL = container.length * S;
  const cW = container.width * S;
  const cH = container.height * S;

  // 12 edges of a box
  const edges: [number, number, number][][] = [
    // bottom
    [[0,0,0],[cW,0,0]], [[cW,0,0],[cW,0,cL]], [[cW,0,cL],[0,0,cL]], [[0,0,cL],[0,0,0]],
    // top
    [[0,cH,0],[cW,cH,0]], [[cW,cH,0],[cW,cH,cL]], [[cW,cH,cL],[0,cH,cL]], [[0,cH,cL],[0,cH,0]],
    // vertical
    [[0,0,0],[0,cH,0]], [[cW,0,0],[cW,cH,0]], [[cW,0,cL],[cW,cH,cL]], [[0,0,cL],[0,cH,cL]]
  ];

  return (
    <group>
      {edges.map((pts, i) => (
        <Line key={i} points={pts} color="#4a90d9" lineWidth={1.5} opacity={0.6} transparent />
      ))}
      {/* Floor grid */}
      <mesh position={[cW/2, 0.001, cL/2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[cW, cL]} />
        <meshStandardMaterial color="#1a2744" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      {/* Door label */}
      <Text
        position={[cW/2, -0.15, 0]}
        fontSize={0.15}
        color="#4a90d9"
        anchorX="center"
        anchorY="top"
      >
        ← DOOR / TÜR →
      </Text>
    </group>
  );
}

function PackedBox({ item, isActive, dimmed, onClick, showLabel }: {
  item: PackedItemInfo;
  isActive: boolean;
  dimmed: boolean;
  onClick: () => void;
  showLabel: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const w = item.w * S;
  const h = item.h * S;
  const l = item.l * S;
  const px = item.x * S + w / 2;
  const py = item.y * S + h / 2;
  const pz = item.z * S + l / 2;

  const color = item.item.color || '#3b82f6';

  return (
    <group position={[px, py, pz]}>
      <mesh
        ref={meshRef}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        <boxGeometry args={[w, h, l]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={dimmed ? 0.15 : (isActive ? 1 : 0.85)}
          emissive={isActive ? color : '#000000'}
          emissiveIntensity={isActive ? 0.3 : 0}
        />
      </mesh>
      {/* Wireframe overlay */}
      <mesh>
        <boxGeometry args={[w, h, l]} />
        <meshBasicMaterial color="#ffffff" wireframe transparent opacity={dimmed ? 0.05 : 0.3} />
      </mesh>
      {/* Loading order number */}
      {showLabel && !dimmed && (
        <Text
          position={[0, 0, l / 2 + 0.01]}
          fontSize={Math.min(w, h) * 0.4}
          color="white"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.01}
          outlineColor="#000000"
        >
          {`${item.loadingOrder}`}
        </Text>
      )}
    </group>
  );
}

function CameraPresets({ preset, onDone }: { preset: string | null; onDone: () => void }) {
  const { camera } = useThree();

  useEffect(() => {
    if (!preset) return;
    const dur = 500;
    const start = performance.now();
    const startPos = camera.position.clone();
    let targetPos: THREE.Vector3;

    switch (preset) {
      case 'iso':
        targetPos = new THREE.Vector3(8, 6, -4);
        break;
      case 'top':
        targetPos = new THREE.Vector3(1.2, 10, 3);
        break;
      case 'side':
        targetPos = new THREE.Vector3(-8, 2, 3);
        break;
      case 'front':
        targetPos = new THREE.Vector3(1.2, 1.5, -6);
        break;
      default:
        targetPos = startPos;
    }

    const animate = (time: number) => {
      const elapsed = time - start;
      const t = Math.min(elapsed / dur, 1);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      camera.position.lerpVectors(startPos, targetPos, ease);
      camera.lookAt(1.2, 1, 3);
      if (t < 1) requestAnimationFrame(animate);
      else onDone();
    };
    requestAnimationFrame(animate);
  }, [preset, camera, onDone]);

  return null;
}


export function Container3DView({ container, items, lang, activeItemId, onItemClick }: Props) {
  const t = translations[lang];
  const [visibleStep, setVisibleStep] = useState<number>(items.length);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cameraPreset, setCameraPreset] = useState<string | null>(null);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const maxStep = items.length;

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
        if (prev >= maxStep) {
          stopPlay();
          return maxStep;
        }
        return prev + 1;
      });
    }, 600);
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [isPlaying, maxStep, stopPlay]);

  // Reset when items change
  useEffect(() => {
    setVisibleStep(items.length);
    stopPlay();
  }, [items, stopPlay]);

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
          <button type="button" style={presetBtnStyle} onClick={() => setCameraPreset('iso')}>{t.view3DPresetIso}</button>
          <button type="button" style={presetBtnStyle} onClick={() => setCameraPreset('top')}>{t.view3DPresetTop}</button>
          <button type="button" style={presetBtnStyle} onClick={() => setCameraPreset('side')}>{t.view3DPresetSide}</button>
          <button type="button" style={presetBtnStyle} onClick={() => setCameraPreset('front')}>{t.view3DPresetFront}</button>
        </div>
      </h4>
      
      <div style={{
        width: '100%',
        height: '350px',
        borderRadius: '12px',
        overflow: 'hidden',
        border: '2px solid var(--border)',
        background: 'linear-gradient(180deg, #0a0f1e 0%, #141e33 100%)',
        cursor: 'grab'
      }}>
        <Canvas
          camera={{ position: [8, 6, -4], fov: 35 }}
          gl={{ antialias: true }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[10, 10, -5]} intensity={0.8} />
          <directionalLight position={[-5, 8, 10]} intensity={0.4} />

          <ContainerWireframe container={container} />
          
          {visibleItems.map((item, idx) => (
            <PackedBox
              key={`${item.item.id}-${idx}`}
              item={item}
              isActive={activeItemId === item.item.id}
              dimmed={activeItemId !== null && activeItemId !== item.item.id}
              onClick={() => onItemClick(item.item.id)}
              showLabel={true}
            />
          ))}

          <OrbitControls
            target={[
              (container.width * S) / 2,
              (container.height * S) / 2,
              (container.length * S) / 2
            ]}
            enableDamping
            dampingFactor={0.1}
            minDistance={2}
            maxDistance={20}
          />
          <CameraPresets preset={cameraPreset} onDone={() => setCameraPreset(null)} />
        </Canvas>
      </div>

      {/* Step-by-step controls */}
      <div style={{
        marginTop: '0.75rem',
        padding: '0.75rem 1rem',
        background: 'rgba(0,0,0,0.3)',
        borderRadius: '10px',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem'
      }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
          {t.stepControlLabel}
        </span>

        <input
          type="range"
          min={0}
          max={maxStep}
          value={visibleStep}
          onChange={e => { stopPlay(); setVisibleStep(Number(e.target.value)); }}
          style={{ flex: 1, accentColor: 'var(--accent)' }}
        />

        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', minWidth: '50px', textAlign: 'center' }}>
          {visibleStep}/{maxStep}
        </span>

        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {!isPlaying ? (
            <button type="button" onClick={startPlay} style={{ ...presetBtnStyle, background: 'var(--accent)' }}>▶ {t.stepPlay}</button>
          ) : (
            <button type="button" onClick={stopPlay} style={{ ...presetBtnStyle, background: 'var(--danger)' }}>⏸ {t.stepPause}</button>
          )}
          <button type="button" onClick={() => { stopPlay(); setVisibleStep(maxStep); }} style={presetBtnStyle}>{t.stepAll}</button>
        </div>
      </div>
    </div>
  );
}
