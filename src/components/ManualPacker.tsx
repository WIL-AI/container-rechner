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

export function ManualPacker({ packlist, goBack, lang }: ManualPackerProps) {
  const [container, setContainer] = useState<ContainerType>(CONTAINERS[0]);
  const [packedItems, setPackedItems] = useState<PackedItemInfo[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  
  // Expand quantity to single actionable items
  const inventory = useMemo(() => {
    const list: PacklistItem[] = [];
    packlist.forEach(p => {
      for(let i=0; i<p.quantity; i++) list.push({...p, quantity: 1, id: `${p.id}_${i}`});
    });
    // Remove already packed items from inventory
    const packedIds = packedItems.map(pi => pi.item.id);
    return list.filter(i => !packedIds.includes(i.id));
  }, [packlist, packedItems]);

  const floorRef = useRef<HTMLDivElement>(null);

  const handleDragStart = (e: React.DragEvent, item: PacklistItem) => {
    e.dataTransfer.setData('text/plain', JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDropOnFloor = (e: React.DragEvent) => {
    e.preventDefault();
    if (!floorRef.current) return;
    
    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;
    const item: PacklistItem = JSON.parse(data);

    // Calculate drop position relative to floor div
    const rect = floorRef.current.getBoundingClientRect();
    const dropX = e.clientX - rect.left;
    const dropY = e.clientY - rect.top;

    // Convert pixels to mm based on container scale
    const scaleX = container.width / rect.width;
    const scaleZ = container.length / rect.height; // Using Y pixel as Z depth

    let mmX = Math.round(dropX * scaleX);
    let mmZ = Math.round(dropY * scaleZ);

    // Bounds check
    const l = item.length;
    const w = item.width;
    const h = item.height;

    if (mmX + w > container.width) mmX = container.width - w;
    if (mmZ + l > container.length) mmZ = container.length - l;
    if (mmX < 0) mmX = 0;
    if (mmZ < 0) mmZ = 0;

    // VERY naive stacking: check if this drop overlaps an existing item
    // If it does, place it on top.
    let targetY = 0;
    // Sort items by highest Y first to stack correctly
    const sortedPacked = [...packedItems].sort((a,b) => b.y - a.y);
    
    for (const pCheck of sortedPacked) {
        // AABB Collision on X/Z plane
        const overlapX = (mmX < pCheck.x + pCheck.w) && (mmX + w > pCheck.x);
        const overlapZ = (mmZ < pCheck.z + pCheck.l) && (mmZ + l > pCheck.z);
        if (overlapX && overlapZ) {
            targetY = pCheck.y + pCheck.h;
            // Snap coords to the box below for neatness
            mmX = pCheck.x;
            mmZ = pCheck.z;
            break;
        }
    }

    if (targetY + h > container.height) {
        alert(lang === 'de' ? 'Höhe überschritten! Das passt nicht mehr rein.' : 'Height exceeded! Does not fit.');
        return;
    }

    const newItemInfo: PackedItemInfo = {
        item,
        x: mmX,
        y: targetY,
        z: mmZ,
        l: item.length,
        w: item.width,
        h: item.height,
        loadingOrder: packedItems.length + 1
    };

    setPackedItems(prev => [...prev, newItemInfo]);
  };

  const removePackedItem = (index: number) => {
      setPackedItems(prev => {
          const newArr = [...prev];
          newArr.splice(index, 1);
          // Redo loading orders
          return newArr.map((pi, idx) => ({...pi, loadingOrder: idx + 1}));
      });
  };

  const clearAll = () => setPackedItems([]);

  return (
    <div style={{ padding: '1rem' }} className="animate-in">
      <div className="header-section" style={{ marginBottom: '1rem', padding: 0 }}>
        <div>
           <h2 className="app-title" style={{ fontSize: '1.8rem', color: 'var(--accent)' }}>Aero-Deck: Manuelle Disposition</h2>
           <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Drag & Drop Supervisor Mode</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn" style={{ background: 'rgba(255,255,255,0.1)', width: 'auto', padding: '0.5rem 1rem' }} onClick={() => setShowHelp(!showHelp)}>
            ℹ️ {lang === 'de' ? 'Anleitung' : 'Manual'}
          </button>
          <button className="btn" style={{ background: 'var(--danger)', width: 'auto', padding: '0.5rem 1rem' }} onClick={goBack}>
            {lang === 'de' ? 'Zurück zur Automatik' : 'Back to Auto'}
          </button>
        </div>
      </div>

      {showHelp && (
        <div className="glass-panel" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)', padding: '1.5rem' }}>
          <h3 style={{ marginTop: 0, color: 'var(--accent)' }}>{lang === 'de' ? 'Betriebsanleitung: Manuelles Stauen' : 'Operating Manual: Manual Packing'}</h3>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>
            <li><strong>Auswahl:</strong> Wähle in der mittleren Spalte zunächst den gewünschten Container-Typ.</li>
            <li><strong>Drag & Drop:</strong> Greife ein Packstück aus dem linken Inventar und ziehe es per gedrückter Maustaste auf die 2D-Fläche (Bodenansicht) in der Mitte.</li>
            <li><strong>Stapeln:</strong> Lässt du ein Packstück über einem bereits platzierten Stück fallen, wird es von der Engine automatisch obendrauf gestapelt (sofern die Deckenhöhe des Containers ausreicht). Es rastet automatisch auf den Kanten des unteren Stücks ein.</li>
            <li><strong>Löschen:</strong> Klicke auf ein bereits platziertes Päckchen im Container (auf der Liste in der mittleren Spalte), um es wieder in das Inventar zurückzuschicken.</li>
            <li><strong>Live-View:</strong> Auf der rechten Seite siehst du in Echtzeit die holografische 3D-Auswirkung deiner Disposition.</li>
          </ul>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1.5fr', gap: '1.5rem' }}>
        
        {/* LEFT: INVENTORY */}
        <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', height: '70vh' }}>
           <h3 style={{ marginTop: 0 }}>Inventar ({inventory.length})</h3>
           <div style={{ overflowY: 'auto', flex: 1, paddingRight: '0.5rem' }}>
              {inventory.map(item => (
                <div 
                  key={item.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                  style={{
                    background: 'rgba(9, 28, 53, 0.8)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    marginBottom: '0.5rem',
                    cursor: 'grab',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}
                  title="Drag me!"
                >
                  <strong style={{ color: item.color || 'var(--accent)' }}>{item.contentDesc || item.packaging}</strong>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {item.length/10} x {item.width/10} x {item.height/10} cm • {item.weight} kg
                  </span>
                </div>
              ))}
              {inventory.length === 0 && <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Alle Stücke verladen.</p>}
           </div>
        </div>

        {/* CENTER: 2D FLOOR GRID */}
        <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', height: '70vh' }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
               <select className="input-field" style={{ width: '200px', padding: '0.5rem' }} value={container.id} onChange={e => {
                   const c = CONTAINERS.find(x => x.id === e.target.value);
                   if (c) { setContainer(c); clearAll(); }
               }}>
                 {CONTAINERS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
               </select>
               <button className="btn" style={{ width: 'auto', background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '0.5rem 1rem' }} onClick={clearAll}>
                 Reset
               </button>
           </div>

           <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', borderRadius: '12px', overflow: 'hidden' }}>
              {/* Floor Plane visualization */}
              <div 
                ref={floorRef}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={handleDropOnFloor}
                style={{
                  width: '100%',
                  aspectRatio: `${container.width} / ${container.length}`,
                  maxHeight: '100%',
                  maxWidth: '100%',
                  background: 'linear-gradient(rgba(0,218,243,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,218,243,0.1) 1px, transparent 1px)',
                  backgroundSize: '20px 20px',
                  border: '2px dashed rgba(0,218,243,0.4)',
                  position: 'relative'
                }}
              >
                  {/* Render placed items as absolute divs on the floor plan */}
                  {packedItems.map((pi, idx) => {
                      // px = mm * (pixel_width / mm_width)
                      // We must use % to keep it responsive to the aspect ratio box
                      const leftPct = (pi.x / container.width) * 100;
                      const topPct = (pi.z / container.length) * 100;
                      const wPct = (pi.w / container.width) * 100;
                      const hPct = (pi.l / container.length) * 100;
                      
                      // Brighten the color based on Y level to show stacking
                      const opacity = 0.5 + Math.min(0.5, pi.y / 1000);

                      return (
                          <div key={idx} 
                               onClick={() => removePackedItem(idx)}
                               title={`Klick zum Löschen. Y (Höhe): ${pi.y/10}cm`}
                               style={{
                                  position: 'absolute',
                                  left: `${leftPct}%`,
                                  top: `${topPct}%`,
                                  width: `${wPct}%`,
                                  height: `${hPct}%`,
                                  backgroundColor: pi.item.color || 'var(--accent)',
                                  opacity,
                                  border: '1px solid white',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '0.7rem',
                                  fontWeight: 'bold',
                                  color: 'white',
                                  cursor: 'pointer',
                                  boxShadow: '0 4px 8px rgba(0,0,0,0.5)'
                               }}>
                                #{pi.loadingOrder}
                          </div>
                      );
                  })}
              </div>
           </div>
        </div>

        {/* RIGHT: 3D PREVIEW */}
        <div className="glass-panel" style={{ padding: 0, height: '70vh', overflow: 'hidden', position: 'relative' }}>
            <h3 style={{ position: 'absolute', top: '1rem', left: '1rem', margin: 0, zIndex: 10 }}>Live Hologram</h3>
            {packedItems.length > 0 ? (
                <Container3DView 
                  container={container}
                  items={packedItems}
                  lang={lang}
                  activeItemId={null}
                  onItemClick={() => {}}
                />
            ) : (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                    Ziehe Elemente in den Container, um 3D-Ansicht zu generieren.
                </div>
            )}
        </div>

      </div>
    </div>
  );
}
