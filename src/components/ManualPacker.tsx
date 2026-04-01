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

// Global reference for scaling (no longer needed for fixed aspect ratio)
// const MAX_CONTAINER_LENGTH = 12025; 

export function ManualPacker({ packlist, goBack, lang }: ManualPackerProps) {
  const [container, setContainer] = useState<ContainerType>(CONTAINERS[0]);
  const [packedItems, setPackedItems] = useState<PackedItemInfo[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  
  // DRAG STATE for internal moves (Pointer Events)
  const [draggedIndices, setDraggedIndices] = useState<number[]>([]);
  const [isPointerDragging, setIsPointerDragging] = useState(false);
  const [pointerOffset, setPointerOffset] = useState({ x: 0, z: 0 }); // mm offset from item origin
  const [ghostPos, setGhostPos] = useState<{ x: number, z: number, y: number } | null>(null);
  const [draggedRotation, setDraggedRotation] = useState(false); // whether current drag is rotated
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [isInvalidGhost, setIsInvalidGhost] = useState(false);

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
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'inventory', item }));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handlePointerDown = (e: React.PointerEvent, index: number) => {
    // Prevent delete button from triggering drag
    if ((e.target as HTMLElement).closest('button')) return;

    e.preventDefault();
    const baseItem = packedItems[index];
    const stackIndices: number[] = [index];

    const findStack = (currentIdx: number) => {
        const current = packedItems[currentIdx];
        packedItems.forEach((pi, idx) => {
            if (stackIndices.includes(idx)) return;
            const footprintMatch = Math.abs(pi.x - current.x) < 5 && Math.abs(pi.z - current.z) < 5;
            const yMatch = Math.abs(pi.y - (current.y + current.h)) < 5;
            if (footprintMatch && yMatch) {
                stackIndices.push(idx);
                findStack(idx);
            }
        });
    };
    findStack(index);

    // Calculate pointer offset in MM 
    // In Front-Top Vertical view: 
    // e.clientX is X (width)
    // e.clientY is Z (length, but inverted so 0 is bottom)
    if (!floorRef.current) return;
    const rect = floorRef.current.getBoundingClientRect();
    const scaleX = container.width / rect.width;
    const scaleZ = container.length / rect.height;
    
    const clickXmm = (e.clientX - rect.left) * scaleX;
    const clickZmm = container.length - (e.clientY - rect.top) * scaleZ;

    setPointerOffset({ 
        x: clickXmm - baseItem.x, 
        z: clickZmm - baseItem.z 
    });
    setDraggedIndices(stackIndices);
    setIsPointerDragging(true);
    setDraggedRotation(false);
    setSelectedIndices(stackIndices);
    
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isPointerDragging || draggedIndices.length === 0 || !floorRef.current) return;

    const rect = floorRef.current.getBoundingClientRect();
    const scaleX = container.width / rect.width;
    const scaleZ = container.length / rect.height;
    
    const currentXmm = (e.clientX - rect.left) * scaleX;
    const currentZmm = container.length - (e.clientY - rect.top) * scaleZ;

    const baseItem = packedItems[draggedIndices[0]];
    // Target is current - initial offset
    let tx = currentXmm - pointerOffset.x;
    let tz = currentZmm - pointerOffset.z;

    // Use current rotation dimensions
    const curW = draggedRotation ? baseItem.l : baseItem.w;
    const curL = draggedRotation ? baseItem.w : baseItem.l;

    const otherItems = packedItems.filter((_, i) => !draggedIndices.includes(i));
    const { mmX, mmZ, targetY } = findSafePosition(curW, curL, baseItem.h, tx, tz, otherItems);
    
    // Check height for all items in stack if they were moved
    let exceedsHeight = false;
    const dy = targetY - baseItem.y;
    draggedIndices.forEach(idx => {
        if (packedItems[idx].y + dy + packedItems[idx].h > container.height) exceedsHeight = true;
    });

    setIsInvalidGhost(exceedsHeight);
    setGhostPos({ x: mmX, z: mmZ, y: targetY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isPointerDragging || draggedIndices.length === 0 || !ghostPos) {
        setIsPointerDragging(false);
        setDraggedIndices([]);
        setGhostPos(null);
        return;
    }

    const indices = draggedIndices;
    const gPos = ghostPos;
    const isRot = draggedRotation;

    // Height check
    const baseItemOrig = packedItems[indices[0]];
    const dy = gPos.y - baseItemOrig.y;
    let exceeds = false;
    indices.forEach(idx => {
        if (packedItems[idx].y + dy + packedItems[idx].h > container.height) exceeds = true;
    });

    if (exceeds) {
        alert(lang === 'de' ? 'Maximale Höhe überschritten!' : 'Maximum height exceeded!');
        setIsPointerDragging(false);
        setDraggedIndices([]);
        setGhostPos(null);
        return;
    }

    setPackedItems(prev => {
        const next = [...prev];
        const baseItem = next[indices[0]];
        
        const deltaX = gPos.x - baseItem.x;
        const deltaZ = gPos.z - baseItem.z;
        const deltaY = gPos.y - baseItem.y;

        indices.forEach(idx => {
            let item = { ...next[idx] };
            if (isRot) {
                [item.w, item.l] = [item.l, item.w];
            }
            item.x += deltaX;
            item.z += deltaZ;
            item.y += deltaY;
            next[idx] = item;
        });

        return next;
    });

    setIsPointerDragging(false);
    setDraggedIndices([]);
    setGhostPos(null);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isPointerDragging && e.code === 'Space') {
        e.preventDefault();
        setDraggedRotation(prev => !prev);
    }
    // Keyboard shortcuts for selected items
    if (selectedIndices.length > 0 && !isPointerDragging) {
        if (e.code === 'Space') { e.preventDefault(); handleRotate3D('horizontal'); }
        if (e.key.toLowerCase() === 'x') { e.preventDefault(); handleRotate3D('flipL'); }
        if (e.key.toLowerCase() === 'y') { e.preventDefault(); handleRotate3D('flipW'); }
    }
  };

  const handleRotate3D = (type: 'horizontal' | 'flipL' | 'flipW') => {
    if (selectedIndices.length === 0) return;

    setPackedItems(prev => {
        const next = [...prev];
        const baseIndex = selectedIndices[0];
        const baseItem = next[baseIndex];

        let targetW = baseItem.w;
        let targetL = baseItem.l;
        let targetH = baseItem.h;

        if (type === 'horizontal') { [targetW, targetL] = [targetL, targetW]; }
        if (type === 'flipL') { [targetL, targetH] = [targetH, targetL]; }
        if (type === 'flipW') { [targetW, targetH] = [targetH, targetW]; }

        // Check if rotation fits in height and bounds
        const otherItems = next.filter((_, i) => !selectedIndices.includes(i));
        const { targetY } = findSafePosition(targetW, targetL, targetH, baseItem.x, baseItem.z, otherItems);
        
        const deltaY = targetY - baseItem.y;
        let exceeds = false;
        selectedIndices.forEach(idx => {
            let nextH = next[idx].h;
            if (type === 'flipL') nextH = next[idx].l;
            if (type === 'flipW') nextH = next[idx].w;

            if (next[idx].y + deltaY + nextH > container.height) exceeds = true;
        });

        if (exceeds) {
            alert(lang === 'de' ? 'Rotation nicht möglich: Höhe überschritten!' : 'Rotation not possible: Height exceeded!');
            return prev;
        }

        selectedIndices.forEach(idx => {
            let item = { ...next[idx] };
            if (type === 'horizontal') [item.w, item.l] = [item.l, item.w];
            if (type === 'flipL') [item.l, item.h] = [item.h, item.l];
            if (type === 'flipW') [item.w, item.h] = [item.h, item.w];
            item.y += deltaY;
            next[idx] = item;
        });

        return next;
    });
  };

  const handleDropOnFloor = (e: React.DragEvent) => {
    e.preventDefault();
    if (!floorRef.current) return;
    
    const dataStr = e.dataTransfer.getData('text/plain');
    if (!dataStr) return;
    let data;
    try {
        data = JSON.parse(dataStr);
    } catch(err) {
        return;
    }

    const rect = floorRef.current.getBoundingClientRect();
    const dropX = e.clientX - rect.left;
    const dropY = e.clientY - rect.top;

    const scaleX = container.width / rect.width;
    const scaleZ = container.length / rect.height;

    let targetX = Math.round(dropX * scaleX);
    let targetZ = Math.round(container.length - (dropY * scaleZ));

    if (data.type === 'inventory') {
        addItemToContainer(data.item, targetX, targetZ);
    }
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

  const findSafePosition = (w: number, l: number, _h: number, x: number, z: number, existing = packedItems) => {
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
            <li><strong>3D-Rotation:</strong> Nutze die Buttons in der Toolbar, um Kisten zu drehen oder auf die Seite/Stirnseite zu kippen.</li>
            <li><strong>Hotkeys:</strong> [Leertaste] = Drehen, [X] = Längs kippen, [Y] = Quer kippen.</li>
            <li><strong>Skalierung:</strong> Die 2D-Fläche zeigt jetzt die wahre Proportion (20ft vs 40ft).</li>
            <li><strong>Löschen:</strong> Nutze das kleine [X] in der Ecke einer Box zum Entfernen.</li>
          </ul>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 1.5fr', gap: '1.5rem' }}>
        
        {/* LEFT: INVENTORY */}
        <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', height: '95vh' }}>
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
        <div className="glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', height: '95vh', overflow: 'hidden' }}>
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

           <div 
             tabIndex={0} 
             onKeyDown={handleKeyDown}
             style={{ 
               flex: 1, 
               display: 'flex', 
               flexDirection: 'column', 
               alignItems: 'center', 
               justifyContent: 'center', 
               background: 'rgba(0,0,0,0.4)', 
               borderRadius: '12px', 
               padding: '1rem', 
               overflow: 'hidden', 
               outline: 'none',
               position: 'relative'
             }}
           >
              <div 
                ref={floorRef}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={handleDropOnFloor}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                style={{
                  width: '100%',
                  height: '100%',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  aspectRatio: `${container.width} / ${container.length}`,
                  background: 'linear-gradient(rgba(0,218,243,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,218,243,0.05) 1px, transparent 1px)',
                  backgroundSize: '30px 30px',
                  border: '2px solid rgba(0,218,243,0.3)',
                  boxShadow: '0 0 20px rgba(0,218,243,0.1)',
                  position: 'relative',
                  transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                  touchAction: 'none'
                }}
              >
                  {/* WALL LABELS (Now inside Grid relative space to prevent clipping) */}
                  <div style={{ position: 'absolute', top: '5px', width: '100%', textAlign: 'center', fontSize: '0.75rem', color: 'var(--accent)', opacity: 1, fontWeight: 'bold' }}>FRONT (Eingang)</div>
                  <div style={{ position: 'absolute', bottom: '5px', width: '100%', textAlign: 'center', fontSize: '0.75rem', color: 'var(--accent)', opacity: 1, fontWeight: 'bold' }}>BACK (Rückwand)</div>

                  {packedItems.map((pi, idx) => {
                      // Front-Top Vertical View:
                      // Left = X (width), Top = Length - Z (depth)
                      const leftPct = (pi.x / container.width) * 100;
                      // topPct maps z=0 to bottom. top 0 is z=container.length
                      const topPct = ((container.length - pi.z - pi.l) / container.length) * 100;
                      const itemWPct = (pi.w / container.width) * 100;
                      const itemHPct = (pi.l / container.length) * 100;
                      const opacity = 0.6 + Math.min(0.4, pi.y / 1500);
                      
                      const isDragging = draggedIndices.includes(idx);
                      const isSelected = selectedIndices.includes(idx);
                      
                      return (
                          <div key={`${pi.item.id}-${pi.x}-${pi.y}-${pi.z}`} 
                               onPointerDown={(e) => handlePointerDown(e, idx)}
                               style={{
                                  position: 'absolute',
                                  left: `${leftPct}%`,
                                  top: `${topPct}%`,
                                  width: `${itemWPct}%`,
                                  height: `${itemHPct}%`,
                                  backgroundColor: pi.item.color || 'var(--accent)',
                                  opacity: isDragging ? 0.2 : opacity,
                                  border: isSelected ? '2px solid #fff' : (isDragging ? '1px dashed var(--accent)' : '1px solid rgba(255,255,255,0.4)'),
                                  boxShadow: isSelected ? '0 0 15px #fff' : '0 4px 8px rgba(0,0,0,0.5)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '0.65rem',
                                  fontWeight: 'bold',
                                  color: 'white',
                                  cursor: 'grab',
                                  transition: 'transform 0.1s',
                                  zIndex: Math.floor(pi.y / 10) + 1,
                                  userSelect: 'none',
                                  pointerEvents: 'auto'
                               }}>
                                #{pi.loadingOrder}

                                {/* DELETE ICON - Small and isolated */}
                                <button 
                                    type="button"
                                    onClick={(e) => { 
                                        e.preventDefault();
                                        e.stopPropagation(); 
                                        console.log("Delete button clicked for index", idx);
                                        removePackedItem(idx); 
                                    }}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        right: 0,
                                        width: '16px',
                                        height: '16px',
                                        background: 'var(--danger)',
                                        color: 'white',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '10px',
                                        border: 'none',
                                        borderRadius: '0 0 0 4px',
                                        cursor: 'pointer',
                                        padding: 0,
                                        lineHeight: 1,
                                        zIndex: 1000
                                    }}>
                                    ✕
                                </button>
                          </div>
                      );
                  })}

                  {/* GHOST PREVIEW DURING DRAG */}
                  {isPointerDragging && ghostPos && draggedIndices.length > 0 && (
                      <div style={{
                          position: 'absolute',
                          left: `${(ghostPos.x / container.width) * 100}%`,
                          top: `${((container.length - ghostPos.z - (draggedRotation ? packedItems[draggedIndices[0]].w : packedItems[draggedIndices[0]].l)) / container.length) * 100}%`,
                          width: `${((draggedRotation ? packedItems[draggedIndices[0]].l : packedItems[draggedIndices[0]].w) / container.width) * 100}%`,
                          height: `${((draggedRotation ? packedItems[draggedIndices[0]].w : packedItems[draggedIndices[0]].l) / container.length) * 100}%`,
                          background: isInvalidGhost ? 'rgba(255, 68, 68, 0.4)' : 'rgba(0, 218, 243, 0.4)',
                          border: `2px solid ${isInvalidGhost ? 'var(--danger)' : 'var(--accent)'}`,
                          zIndex: 2000,
                          pointerEvents: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.7rem',
                          color: 'white',
                          fontWeight: 'bold',
                          boxShadow: `0 0 15px ${isInvalidGhost ? 'var(--danger)' : 'var(--accent)'}`
                      }}>
                        {isInvalidGhost ? (lang === 'de' ? 'Zu hoch!' : 'Too high!') : (lang === 'de' ? 'Verschieben...' : 'Moving...')}
                      </div>
                  )}
                {/* FLOATING ROTATION CONSOLE (AeroDeck V2.11) */}
              {selectedIndices.length > 0 && (
                <div className="animate-in" style={{ 
                    position: 'absolute',
                    bottom: '3rem',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '260px',
                    display: 'flex', 
                    flexDirection: 'column',
                    gap: '0.4rem', 
                    padding: '0.75rem', 
                    background: 'rgba(9, 28, 53, 0.85)', 
                    backdropFilter: 'blur(10px)',
                    borderRadius: '12px', 
                    border: '1px solid var(--accent)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                    zIndex: 5000,
                    pointerEvents: 'auto'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 'bold' }}>
                          #{packedItems[selectedIndices[0]].loadingOrder} {lang === 'de' ? 'Ausrichtung' : 'Align'}
                        </span>
                        <button 
                          onClick={() => setSelectedIndices([])}
                          style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px' }}
                        >
                          ✕
                        </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <button 
                            className="btn" 
                            onClick={() => handleRotate3D('horizontal')}
                            style={{ justifyContent: 'flex-start', padding: '0.5rem 0.75rem', background: 'var(--accent)', color: 'var(--bg-deep)', fontSize: '0.75rem' }}
                        >
                            🔄 {lang === 'de' ? 'Ebene drehen' : 'Rotate Floor'}
                        </button>
                        <button 
                            className="btn" 
                            onClick={() => handleRotate3D('flipL')}
                            style={{ justifyContent: 'flex-start', padding: '0.5rem 0.75rem', background: 'var(--accent)', color: 'var(--bg-deep)', fontSize: '0.75rem' }}
                        >
                            📐 {lang === 'de' ? 'Längs kippen' : 'Flip Long'}
                        </button>
                        <button 
                            className="btn" 
                            onClick={() => handleRotate3D('flipW')}
                            style={{ justifyContent: 'flex-start', padding: '0.5rem 0.75rem', background: 'var(--accent)', color: 'var(--bg-deep)', fontSize: '0.75rem' }}
                        >
                            📐 {lang === 'de' ? 'Quer kippen' : 'Flip Short'}
                        </button>
                    </div>
                    
                    {packedItems[selectedIndices[0]]?.item.rotatable === false && (
                        <div style={{ fontSize: '0.6rem', color: '#ffcc00', marginTop: '0.2rem', textAlign: 'center' }}>
                        </div>
                    )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: 3D PREVIEW */}
        <div className="glass-panel" style={{ padding: 0, height: '95vh', overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', bottom: '1.25rem', right: '1.25rem', zIndex: 10, background: 'rgba(0,0,0,0.6)', padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
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
