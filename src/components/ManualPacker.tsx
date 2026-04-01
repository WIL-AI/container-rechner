import React, { useState, useRef, useMemo } from 'react';
import type { PacklistItem, PackedItemInfo } from '../lib/packer';
import type { ContainerType } from '../lib/containers';
import { CONTAINERS } from '../lib/containers';
import { Container3DView } from './Container3DView';

interface ManualPackerProps {
  packlist: PacklistItem[];
  goBack: () => void;
  lang: 'de' | 'en';
}

// Global reference for scaling (40ft High Cube)
const MAX_CONTAINER_LENGTH = 12025; 

export function ManualPacker({ packlist, goBack, lang }: ManualPackerProps) {
  const [container, setContainer] = useState<ContainerType>(CONTAINERS[0]);
  const [packedItems, setPackedItems] = useState<PackedItemInfo[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  
  // DRAG STATE for internal moves
  const [draggedIndices, setDraggedIndices] = useState<number[]>([]);

  const inventory = useMemo(() => {
    const list: PacklistItem[] = [];
    packlist.forEach(p => {
      for(let i=0; i<p.quantity; i++) list.push({...p, quantity: 1, id: `${p.id}_${i}`});
    });
    const packedIds = packedItems.map(pi => pi.item.id);
    return list.filter(i => !packedIds.includes(i.id));
  }, [packlist, packedItems]);

  const floorRef = useRef<HTMLDivElement>(null);

  // --- DRAG HANDLERS ---

  const handleInventoryDragStart = (e: React.DragEvent, item: PacklistItem) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'inventory', item }));
    e.dataTransfer.effectAllowed = 'copyMove';
    setDraggedIndices([]);
  };

  const handleFloorDragStart = (e: React.DragEvent, index: number) => {
    // Find all items on top of this one (the STACK)
    const baseItem = packedItems[index];
    const stackIndices: number[] = [index];

    // Simple recursive stack finder: find items with same center/bottom footprint AND Y > baseItem.Y
    const findStack = (currentIdx: number) => {
        const current = packedItems[currentIdx];
        packedItems.forEach((pi, idx) => {
            if (stackIndices.includes(idx)) return;
            // Check if pi is directly on top of current (within 5mm tolerance)
            const footprintMatch = Math.abs(pi.x - current.x) < 5 && Math.abs(pi.z - current.z) < 5;
            const yMatch = Math.abs(pi.y - (current.y + current.h)) < 5;
            if (footprintMatch && yMatch) {
                stackIndices.push(idx);
                findStack(idx);
            }
        });
    };
    findStack(index);

    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'container', indices: stackIndices }));
    e.dataTransfer.effectAllowed = 'move';
    setDraggedIndices(stackIndices);
  };

  const handleDropOnFloor = (e: React.DragEvent) => {
    e.preventDefault();
    if (!floorRef.current) return;
    
    const dataStr = e.dataTransfer.getData('application/json');
    if (!dataStr) return;
    const data = JSON.parse(dataStr);

    const rect = floorRef.current.getBoundingClientRect();
    const dropX = e.clientX - rect.left;
    const dropY = e.clientY - rect.top;

    const scaleX = container.width / rect.width;
    const scaleZ = container.length / rect.height;

    let targetX = Math.round(dropX * scaleX);
    let targetZ = Math.round(dropY * scaleZ);

    if (data.type === 'inventory') {
        addItemToContainer(data.item, targetX, targetZ);
    } else if (data.type === 'container') {
        moveStackInContainer(data.indices, targetX, targetZ);
    }
    setDraggedIndices([]);
  };

  // --- LOGIC HELPERS ---

  const addItemToContainer = (item: PacklistItem, x: number, z: number) => {
    const { mmX, mmZ, targetY } = findSafePosition(item.width, item.length, item.height, x, z);
    
    if (targetY + item.height > container.height) {
        alert(lang === 'de' ? 'Höhe überschritten!' : 'Height exceeded!');
        return;
    }

    setPackedItems(prev => [...prev, {
        item, x: mmX, y: targetY, z: mmZ,
        l: item.length, w: item.width, h: item.height,
        loadingOrder: prev.length + 1
    }]);
  };

  const moveStackInContainer = (indices: number[], x: number, z: number) => {
    setPackedItems(prev => {
        const next = [...prev];
        const baseIndex = indices[0];
        const baseItem = next[baseIndex];
        
        // Temporarily remove stack to calculate "new ground" correctly
        const otherItems = next.filter((_, i) => !indices.includes(i));
        const { mmX, mmZ, targetY } = findSafePosition(baseItem.w, baseItem.l, baseItem.h, x, z, otherItems);

        if (targetY + baseItem.h > container.height) {
            alert(lang === 'de' ? 'Stapel passt hier nicht in die Höhe!' : 'Stack exceeds height!');
            return prev;
        }

        const deltaX = mmX - baseItem.x;
        const deltaZ = mmZ - baseItem.z;
        const deltaY = targetY - baseItem.y;

        indices.forEach(idx => {
            next[idx] = {
                ...next[idx],
                x: next[idx].x + deltaX,
                z: next[idx].z + deltaZ,
                y: next[idx].y + deltaY
            };
        });

        return next;
    });
  };

  const findSafePosition = (w: number, l: number, h: number, x: number, z: number, existing = packedItems) => {
    let mmX = x;
    let mmZ = z;

    if (mmX + w > container.width) mmX = container.width - w;
    if (mmZ + l > container.length) mmZ = container.length - l;
    if (mmX < 0) mmX = 0;
    if (mmZ < 0) mmZ = 0;

    let targetY = 0;
    const sortedPacked = [...existing].sort((a,b) => b.y - a.y);
    
    for (const pCheck of sortedPacked) {
        const overlapX = (mmX < pCheck.x + pCheck.w) && (mmX + w > pCheck.x);
        const overlapZ = (mmZ < pCheck.z + pCheck.l) && (mmZ + l > pCheck.z);
        if (overlapX && overlapZ) {
            targetY = pCheck.y + pCheck.h;
            mmX = pCheck.x;
            mmZ = pCheck.z;
            break;
        }
    }
    return { mmX, mmZ, targetY };
  };

  const removePackedItem = (index: number) => {
      setPackedItems(prev => {
          const newArr = prev.filter((_, i) => i !== index);
          return newArr.map((pi, idx) => ({...pi, loadingOrder: idx + 1}));
      });
  };

  // --- UI VALUES ---
  const containerScale = container.length / MAX_CONTAINER_LENGTH;

  return (
    <div style={{ padding: '1rem' }} className="animate-in">
      <div className="header-section" style={{ marginBottom: '1rem', padding: 0 }}>
        <div>
           <h2 className="app-title" style={{ fontSize: '1.8rem', color: 'var(--accent)' }}>Aero-Deck: Manuelle Disposition V2</h2>
           <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Drag & Drop Supervisor Mode (Stack-Support)</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn" style={{ background: 'rgba(255,255,255,0.1)', width: 'auto', padding: '0.5rem 1rem' }} onClick={() => setShowHelp(!showHelp)}>
            ℹ️ {lang === 'de' ? 'Anleitung' : 'Manual'}
          </button>
          <button className="btn" style={{ background: 'var(--danger)', width: 'auto', padding: '0.5rem 1rem' }} onClick={goBack}>
            {lang === 'de' ? 'Beenden' : 'Exit'}
          </button>
        </div>
      </div>

      {showHelp && (
        <div className="glass-panel" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)', padding: '1.5rem' }}>
          <h3 style={{ marginTop: 0, color: 'var(--accent)' }}>{lang === 'de' ? 'V2: Expert Mode Anleitung' : 'V2: Expert Mode Instructions'}</h3>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>
            <li><strong>Verschieben:</strong> Du kannst bereits platzierte Kisten im Container anklicken und an eine neue Position ziehen.</li>
            <li><strong>Stapel-Support:</strong> Wenn du eine Kiste verschiebst, auf der andere Kisten stehen, wird automatisch der <strong>gesamte Stapel</strong> mitbewegt!</li>
            <li><strong>Skalierung:</strong> Die 2D-Fläche zeigt jetzt die wahre Proportion (20ft vs 40ft). Achte darauf, dass der Platz bei 20ft Containern deutlich begrenzter ist.</li>
            <li><strong>Löschen:</strong> Nutze das kleine [X] in der Ecke einer Box zum Entfernen.</li>
          </ul>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 1.5fr', gap: '1.5rem' }}>
        
        {/* LEFT: INVENTORY */}
        <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', height: '70vh' }}>
           <h3 style={{ marginTop: 0 }}>Inventar ({inventory.length})</h3>
           <div style={{ overflowY: 'auto', flex: 1, paddingRight: '0.5rem' }}>
              {inventory.map(item => (
                <div 
                  key={item.id}
                  draggable
                  onDragStart={(e) => handleInventoryDragStart(e, item)}
                  style={{
                    background: 'rgba(9, 28, 53, 0.8)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    marginBottom: '0.5rem',
                    cursor: 'grab',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <strong style={{ color: item.color || 'var(--accent)' }}>{item.contentDesc || item.packaging}</strong>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block' }}>
                    {item.length/10}x{item.width/10}x{item.height/10}cm • {item.weight}kg
                  </span>
                </div>
              ))}
           </div>
        </div>

        {/* CENTER: 2D FLOOR GRID */}
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', height: '70vh' }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
               <select className="input-field" style={{ width: '220px', padding: '0.5rem' }} value={container.id} onChange={e => {
                   const c = CONTAINERS.find(x => x.id === e.target.value);
                   if (c) { 
                      if (packedItems.length > 0 && !window.confirm(lang === 'de' ? 'Container-Wechsel löscht alle bisherigen Platzierungen. Fortfahren?' : 'Changing container clears all items. Continue?')) return;
                      setContainer(c); 
                      setPackedItems([]); 
                   }
               }}>
                 {CONTAINERS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
               </select>
               <button className="btn" style={{ width: 'auto', background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '0.5rem 1rem' }} onClick={() => packedItems.length > 0 && window.confirm('Reset?') && setPackedItems([])}>
                 Reset
               </button>
           </div>

           {/* Realistic Scaling Wrapper */}
           <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', borderRadius: '12px', padding: '1rem', overflow: 'hidden' }}>
              <div 
                ref={floorRef}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={handleDropOnFloor}
                style={{
                  width: 'calc(100% - 20px)',
                  height: `${containerScale * 100}%`,
                  maxHeight: '100%',
                  aspectRatio: `${container.width} / ${container.length}`,
                  background: 'linear-gradient(rgba(0,218,243,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,218,243,0.05) 1px, transparent 1px)',
                  backgroundSize: '30px 30px',
                  border: '2px solid rgba(0,218,243,0.3)',
                  boxShadow: '0 0 20px rgba(0,218,243,0.1)',
                  position: 'relative',
                  transition: 'height 0.5s cubic-bezier(0.16, 1, 0.3, 1)'
                }}
              >
                  {packedItems.map((pi, idx) => {
                      const leftPct = (pi.x / container.width) * 100;
                      const topPct = (pi.z / container.length) * 100;
                      const wPct = (pi.w / container.width) * 100;
                      const hPct = (pi.l / container.length) * 100;
                      const opacity = 0.6 + Math.min(0.4, pi.y / 1500);
                      
                      const isDragging = draggedIndices.includes(idx);

                      return (
                          <div key={idx} 
                               draggable
                               onDragStart={(e) => handleFloorDragStart(e, idx)}
                               style={{
                                  position: 'absolute',
                                  left: `${leftPct}%`,
                                  top: `${topPct}%`,
                                  width: `${wPct}%`,
                                  height: `${hPct}%`,
                                  backgroundColor: pi.item.color || 'var(--accent)',
                                  opacity: isDragging ? 0.3 : opacity,
                                  border: isDragging ? '2px dashed var(--accent)' : '1px solid rgba(255,255,255,0.4)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '0.65rem',
                                  fontWeight: 'bold',
                                  color: 'white',
                                  cursor: 'grab',
                                  boxShadow: '0 4px 8px rgba(0,0,0,0.5)',
                                  transition: 'transform 0.1s',
                                  zIndex: Math.floor(pi.y / 10) + 1
                               }}>
                                #{pi.loadingOrder}

                                {/* DELETE ICON */}
                                <div 
                                    onClick={(e) => { e.stopPropagation(); removePackedItem(idx); }}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        right: 0,
                                        width: '18px',
                                        height: '18px',
                                        background: 'var(--danger)',
                                        color: 'white',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '12px',
                                        borderRadius: '0 0 0 4px',
                                        cursor: 'pointer',
                                        zIndex: 100
                                    }}>
                                    ✕
                                </div>
                          </div>
                      );
                  })}
              </div>
           </div>
        </div>

        {/* RIGHT: 3D PREVIEW */}
        <div className="glass-panel" style={{ padding: 0, height: '70vh', overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--accent)' }}>
                3D Live Update
            </div>
            {packedItems.length > 0 ? (
                <Container3DView 
                  container={container}
                  items={packedItems}
                  lang={lang}
                  activeItemId={null}
                  onItemClick={() => {}}
                />
            ) : (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
                    AeroDeck 3D Engine bereit.<br/>Disposition einpflegen...
                </div>
            )}
        </div>

      </div>
    </div>
  );
}
