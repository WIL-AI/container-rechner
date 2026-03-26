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

function getLoadingOrderColor(order: number, total: number): string {
  if (total <= 1) return '#3b82f6';
  const t = (order - 1) / (total - 1);
  // Green -> Yellow -> Red gradient based on loading order
  const r = Math.round(34 + t * (239 - 34));
  const g = Math.round(197 - t * (197 - 68));
  const b = Math.round(94 - t * (94 - 68));
  return `rgb(${r},${g},${b})`;
}

export function ContainerViews({ container, items, lang, activeItemId, onItemClick }: Props) {
  const t = translations[lang];
  const containerL = container.length;
  const containerW = container.width;
  const containerH = container.height;
  const totalItems = items.length;

  const renderBox = (item: PackedItemInfo, view: 'top' | 'side-left' | 'side-right' | 'front') => {
    let left = 0, top = 0, width = 0, height = 0;
    
    if (view === 'top') {
      left = (item.x / containerW) * 100;
      top = (item.z / containerL) * 100;
      width = (item.w / containerW) * 100;
      height = (item.l / containerL) * 100;
    } else if (view === 'side-left') {
      left = (item.z / containerL) * 100;
      top = 100 - ((item.y + item.h) / containerH) * 100;
      width = (item.l / containerL) * 100;
      height = (item.h / containerH) * 100;
    } else if (view === 'side-right') {
      left = ((containerL - item.z - item.l) / containerL) * 100;
      top = 100 - ((item.y + item.h) / containerH) * 100;
      width = (item.l / containerL) * 100;
      height = (item.h / containerH) * 100;
    } else if (view === 'front') {
      left = (item.x / containerW) * 100;
      top = 100 - ((item.y + item.h) / containerH) * 100;
      width = (item.w / containerW) * 100;
      height = (item.h / containerH) * 100;
    }

    const isActive = activeItemId === item.item.id;
    const orderColor = getLoadingOrderColor(item.loadingOrder, totalItems);

    const tooltipText = [
      `#${item.loadingOrder} – ${item.item.contentDesc || item.item.packaging}`,
      `${item.l}×${item.w}×${item.h} mm`,
      `${t.posFromDoor}: ${item.z} mm`,
      `${t.posFromFloor}: ${item.y} mm`,
      `${t.posFromLeft}: ${item.x} mm`
    ].join('\n');

    return (
      <div 
        key={`${item.item.id}-${view}-${item.x}-${item.y}-${item.z}`} 
        title={tooltipText}
        onClick={() => onItemClick(item.item.id)}
        style={{
          position: 'absolute',
          left: `${left}%`,
          top: `${top}%`,
          width: `${width}%`,
          height: `${height}%`,
          backgroundColor: item.item.color || '#3b82f6',
          border: isActive ? '2px solid white' : '1px solid rgba(255,255,255,0.8)',
          boxShadow: isActive ? '0 0 12px rgba(255,255,255,0.8) inset' : 'inset 0 0 8px rgba(0,0,0,0.5)',
          opacity: activeItemId ? (isActive ? 1 : 0.2) : 0.9,
          zIndex: isActive ? 10 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: 'pointer',
          transition: 'all 0.2s ease'
        }}
      >
        {/* Loading order badge */}
        <span style={{
          fontSize: Math.min(width, height) > 8 ? '0.65rem' : '0.5rem',
          color: 'white',
          fontWeight: 'bold',
          textShadow: '0 1px 3px rgba(0,0,0,0.9)',
          background: `${orderColor}cc`,
          borderRadius: '3px',
          padding: '1px 3px',
          lineHeight: 1,
          minWidth: '14px',
          textAlign: 'center'
        }}>
          {item.loadingOrder}
        </span>
      </div>
    );
  };

  const frameStyle = {
      position: 'relative' as const, 
      background: 'rgba(0,0,0,0.3)', 
      border: '2px solid var(--border)',
      borderRadius: '4px',
      overflow: 'hidden'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1.5rem' }}>
      
      {/* Top and Front View Grid */}
      <div className="view-grid">
         <div>
            <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between' }}>
              <span>{t.viewTop}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{t.viewTopSub}</span>
            </h4>
            <div style={{ ...frameStyle, width: '100%', paddingBottom: `${(containerL / containerW) * 100}%` }}>
              {items.map(i => renderBox(i, 'top'))}
            </div>
         </div>
         
         <div>
            <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>{t.viewFront}</h4>
            <div style={{ ...frameStyle, width: '100%', paddingBottom: `${(containerH / containerW) * 100}%` }}>
              {items.map(i => renderBox(i, 'front'))}
            </div>
         </div>
      </div>

      {/* Two Side Views Grid */}
      <div className="side-view-grid">
        <div>
           <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between' }}>
             <span>{t.viewSideLeft}</span>
             <span style={{ color: 'var(--text-secondary)' }}>{t.viewSideLeftSub}</span>
           </h4>
           <div style={{ ...frameStyle, width: '100%', paddingBottom: `${(containerH / containerL) * 100}%` }}>
             {items.map(i => renderBox(i, 'side-left'))}
           </div>
        </div>
        <div>
           <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between' }}>
             <span>{t.viewSideRight}</span>
             <span style={{ color: 'var(--text-secondary)' }}>{t.viewSideRightSub}</span>
           </h4>
           <div style={{ ...frameStyle, width: '100%', paddingBottom: `${(containerH / containerL) * 100}%` }}>
             {items.map(i => renderBox(i, 'side-right'))}
           </div>
        </div>
      </div>

    </div>
  );
}
