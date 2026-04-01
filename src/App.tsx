import { useState, useEffect, useMemo, useCallback } from 'react';
import { CONTAINERS } from './lib/containers';
import { calculateHeterogeneousPacking } from './lib/packer';
import type { PacklistItem, PackagingType, PackedItemInfo, PackedContainer, CustomFleetItem } from './lib/packer';
import { getProjects, saveProject, deleteProject } from './lib/db';
import type { Project } from './lib/db';
import { ContainerViews } from './components/ContainerViews';
import { Container3DView } from './components/Container3DView';
import { ManualPacker } from './components/ManualPacker';
import { translations } from './lib/translations';
import type { Language } from './lib/translations';
import { parseExcelFile } from './lib/excelImporter';
import './index.css';

const PACKAGING_TYPES: PackagingType[] = ['Europalette', 'Einwegpalette', 'Kiste', 'Verschlag', 'Karton', 'Fass', 'Rollen', 'Unverpackt', 'Sonstige', 'Karton auf Palette', 'Euro-Gitterbox'];

const DEFAULT_FORM: Partial<PacklistItem> = {
  quantity: 1, contentDesc: '', packaging: 'Europalette', 
  length: 1200, width: 800, height: 1000, weight: 500,
  priority: 3, rotatable: false, stackableBottom: false, stackableTop: false, 
  needsCraning: false, label: '', partialDeliveryId: '', color: '#3b82f6'
};

const applyLabelColors = (items: PacklistItem[]): PacklistItem[] => {
  const distinctLabels: string[] = [];
  items.forEach(i => {
    const rawLabel = i.label?.trim() || '';
    if (rawLabel !== '' && !distinctLabels.includes(rawLabel)) {
      distinctLabels.push(rawLabel);
    }
  });

  const palette = ['#eab308', '#ef4444', '#a855f7', '#22c55e', '#f97316', '#ec4899', '#14b8a6', '#6366f1', '#84cc16'];

  return items.map(item => {
    const rawLabel = item.label?.trim() || '';
    if (!rawLabel) {
      return item.color !== '#3b82f6' ? { ...item, color: '#3b82f6' } : item;
    }
    const idx = distinctLabels.indexOf(rawLabel);
    const assignedColor = palette[idx % palette.length];
    return item.color !== assignedColor ? { ...item, color: assignedColor } : item;
  });
};
const getPrioStyle = (prio: string | number) => {
  const p = Number(prio === 'hoch' ? 1 : prio === 'niedrig' ? 5 : prio === 'normal' ? 3 : prio);
  if (p === 1) return { background: 'rgba(255,0,85,0.15)', color: '#ff0055', border: '1px solid rgba(255,0,85,0.4)', padding: '2px 8px', borderRadius: '4px', textShadow: '0 0 8px rgba(255,0,85,0.4)' };
  if (p <= 3) return { background: 'rgba(0,218,243,0.1)', color: '#00daf3', border: '1px solid rgba(0,218,243,0.3)', padding: '2px 8px', borderRadius: '4px' };
  return { background: 'rgba(173,198,255,0.1)', color: '#adc6ff', border: '1px solid rgba(173,198,255,0.2)', padding: '2px 8px', borderRadius: '4px' };
};

export default function App() {
  const [lang, setLang] = useState<Language>('de');
  const t = translations[lang];

  const [projectId, setProjectId] = useState<string>(`proj-${Date.now()}`);
  const [projectName, setProjectName] = useState<string>('');
  const [projectEditor, setProjectEditor] = useState<string>('');
  const [containerSelection, setContainerSelection] = useState<string>('auto');
  const [aisleActive, setAisleActive] = useState<boolean>(false);
  const [aislePosition, setAislePosition] = useState<'left'|'center'|'right'>('right');
  const [aisleWidth, setAisleWidth] = useState<number>(60);
  const [customFleet, setCustomFleet] = useState<CustomFleetItem[]>([]);
  const [packlist, setPacklist] = useState<PacklistItem[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [groupByDescription, setGroupByDescription] = useState<boolean>(false);
  const [manualMode, setManualMode] = useState<boolean>(false);
  const [showAisleInfo, setShowAisleInfo] = useState<boolean>(false);

  // Auto-sync colors based on label
  useEffect(() => {
    const recolored = applyLabelColors(packlist);
    const changed = recolored.some((item, i) => packlist[i].color !== item.color);
    if (changed) {
       setPacklist(recolored);
    }
  }, [packlist]);
  
  const [showProjectsModal, setShowProjectsModal] = useState(false);
  const [savedProjects, setSavedProjects] = useState<Project[]>([]);

  const [form, setForm] = useState<Partial<PacklistItem>>(DEFAULT_FORM);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  useEffect(() => {
    if (showProjectsModal) {
      getProjects().then(setSavedProjects);
    }
  }, [showProjectsModal]);

  useEffect(() => {
    if (!projectName && packlist.length === 0) return;
    const timeout = setTimeout(() => {
      let savedSelection = containerSelection;
      if (containerSelection === 'fleet') {
         savedSelection = 'fleet:' + customFleet.map(f => `${f.containerId}=${f.count}`).join(';');
      }
      saveProject({
        id: projectId,
        name: projectName || (lang === 'de' ? 'Unbenanntes Projekt' : 'Unnamed Project'),
        updatedAt: Date.now(),
        containerSelection: savedSelection,
        packlist
      });
    }, 1000);
    return () => clearTimeout(timeout);
  }, [projectId, projectName, containerSelection, customFleet, packlist, lang]);

  const loadProject = (p: Project) => {
    setProjectId(p.id); setProjectName(p.name); setPacklist(p.packlist);
    if (p.containerSelection.startsWith('fleet:')) {
       setContainerSelection('fleet');
       const parts = p.containerSelection.split(':')[1].split(';').filter(Boolean);
       const fleet = parts.map(pt => {
          const [cid, cnt] = pt.split('=');
          return { containerId: cid, count: Number(cnt) };
       });
       setCustomFleet(fleet);
    } else {
       setContainerSelection(p.containerSelection);
       setCustomFleet([]);
    }
    setShowProjectsModal(false); setEditingItemId(null); setForm(DEFAULT_FORM);
  };

  const createNewProject = () => {
    setProjectId(`proj-${Date.now()}`); setProjectName(''); setContainerSelection('auto'); setPacklist([]);
    setCustomFleet([]);
    setShowProjectsModal(false); setEditingItemId(null); setForm(DEFAULT_FORM);
  };

  const handleDeleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteConfirmId(id);
  };

  const confirmDeleteProject = async () => {
    if (!deleteConfirmId) return;
    await deleteProject(deleteConfirmId);
    setSavedProjects(prev => prev.filter(p => p.id !== deleteConfirmId));
    setDeleteConfirmId(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = e.target as HTMLInputElement;
    const name = target.name;
    const type = target.type;
    const value = type === 'checkbox' ? target.checked : target.value;
    setForm(prev => {
      let finalVal: string | number | boolean = type === 'number' ? Number(value) : value;
      if (type === 'number' && (name === 'length' || name === 'width' || name === 'height')) {
        finalVal = Math.round(Number(value) * 10);
      }
      if (name === 'priority') {
        finalVal = Number(value);
      }
      return { ...prev, [name]: finalVal };
    });
  };

  const submitPacklistItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.length || !form.width || !form.height || !form.weight || !form.quantity) return;
    
    if (editingItemId) {
      setPacklist(prev => prev.map(item => item.id === editingItemId ? { ...item, ...form } as PacklistItem : item));
      setEditingItemId(null);
    } else {
      const newItem: PacklistItem = { ...(form as PacklistItem), id: `item-${Date.now()}` };
      setPacklist(prev => [...prev, newItem]);
    }
    setForm({ ...DEFAULT_FORM, color: form.color });
  };

  const cancelEdit = () => {
    setEditingItemId(null);
    setForm({ ...DEFAULT_FORM, color: form.color });
  };

  const handlePrintPacklist = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const loc = lang === 'de' ? 'de-DE' : 'en-US';
    const dateStr = new Date().toLocaleString(loc);
    
    const itemsHtml = packlist.map((it: PacklistItem, idx: number) => {
      const advanced = [];
      if (it.label) advanced.push((lang === 'de' ? 'Beschriftung: ' : 'Label: ') + it.label);
      if (it.partialDeliveryId) advanced.push((lang === 'de' ? 'Teillief.: ' : 'Partial Del.: ') + it.partialDeliveryId);
      if (it.rotatable) advanced.push(lang === 'de' ? 'Rotierbar' : 'Rotatable');
      if (it.stackableBottom) advanced.push(lang === 'de' ? 'Stapelbar (Unten)' : 'Stackable (Bottom)');
      if (it.stackableTop) advanced.push(lang === 'de' ? 'Stapelbar (Oben)' : 'Stackable (Top)');
      if (it.needsCraning) advanced.push(lang === 'de' ? 'Kranverladung' : 'Crane needed');

      const advancedHtml = advanced.length > 0 
        ? `<div style="font-size: 0.85em; color: #666; margin-top: 4px;">${advanced.join(' | ')}</div>` 
        : '';

      return `
      <tr>
        <td style="border: 1px solid #ddd; padding: 8px; vertical-align: top;">${idx + 1}</td>
        <td style="border: 1px solid #ddd; padding: 8px; vertical-align: top;">${it.quantity}x</td>
        <td style="border: 1px solid #ddd; padding: 8px; vertical-align: top;">
          <div style="font-weight: bold;">${it.contentDesc || it.packaging}</div>
          ${advancedHtml}
        </td>
        <td style="border: 1px solid #ddd; padding: 8px; vertical-align: top;">${it.length / 10} x ${it.width / 10} x ${it.height / 10} cm</td>
        <td style="border: 1px solid #ddd; padding: 8px; vertical-align: top;">${it.weight} kg</td>
      </tr>
      `;
    }).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>${t.appTitle} - ${t.packlistTitle}</title>
          <style>
            body { font-family: sans-serif; padding: 40px; color: #333; }
            h1 { color: #1a2744; margin-bottom: 5px; }
            .header-info { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; border-bottom: 2px solid #eee; padding-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background: #f1f5f9; text-align: left; border: 1px solid #ddd; padding: 10px; }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <h1>${t.packlistTitle}</h1>
              <p style="margin: 0; color: #666;">${projectName || '-'}</p>
            </div>
            <div style="text-align: right;">
              <p><strong>${t.printDateLabel}:</strong> ${dateStr}</p>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>${t.quantityLabel}</th>
                <th>${t.contentDescLabel}</th>
                <th>Maße (LxBxH)</th>
                <th>${t.weightLabel}</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <p class="no-print" style="margin-top: 40px;">
            <button onclick="window.print()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">
              Drucken / Print
            </button>
          </p>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handlePrint = (pc: PackedContainer) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const loc = lang === 'de' ? 'de-DE' : 'en-US';
    const dateStr = new Date().toLocaleString(loc);
    
    const itemsHtml = pc.items.map((it: PackedItemInfo) => {
      const advanced = [];
      if (it.item.label) advanced.push((lang === 'de' ? 'Beschriftung: ' : 'Label: ') + it.item.label);
      if (it.item.partialDeliveryId) advanced.push((lang === 'de' ? 'Teillief.: ' : 'Partial Del.: ') + it.item.partialDeliveryId);
      if (it.item.rotatable) advanced.push(lang === 'de' ? 'Rotierbar' : 'Rotatable');
      if (it.item.stackableBottom) advanced.push(lang === 'de' ? 'Stapelbar (Unten)' : 'Stackable (Bottom)');
      if (it.item.stackableTop) advanced.push(lang === 'de' ? 'Stapelbar (Oben)' : 'Stackable (Top)');
      if (it.item.needsCraning) advanced.push(lang === 'de' ? 'Kranverladung' : 'Crane needed');

      const advancedHtml = advanced.length > 0 
        ? `<div style="font-size: 0.85em; color: #666; margin-top: 4px;">${advanced.join(' | ')}</div>` 
        : '';

      return `
      <tr>
        <td style="border: 1px solid #ddd; padding: 8px; vertical-align: top;">#${it.loadingOrder}</td>
        <td style="border: 1px solid #ddd; padding: 8px; vertical-align: top;">
          <div style="font-weight: bold;">${it.item.contentDesc || it.item.packaging}</div>
          ${advancedHtml}
        </td>
        <td style="border: 1px solid #ddd; padding: 8px; vertical-align: top;">${it.l / 10} x ${it.w / 10} x ${it.h / 10} cm</td>
        <td style="border: 1px solid #ddd; padding: 8px; vertical-align: top;">${it.item.weight} kg</td>
        <td style="border: 1px solid #ddd; padding: 8px; vertical-align: top;">${formatPosition(it.x, it.y, it.z, pc.container.width, pc.container.length)}</td>
      </tr>
      `;
    }).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>${t.appTitle} - ${projectName || 'Report'}</title>
          <style>
            body { font-family: sans-serif; padding: 40px; color: #333; }
            h1 { color: #1a2744; margin-bottom: 5px; }
            .header-info { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; border-bottom: 2px solid #eee; padding-bottom: 20px; }
            .stats { display: flex; gap: 30px; margin-bottom: 30px; background: #f8fafc; padding: 15px; borderRadius: 8px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background: #f1f5f9; text-align: left; border: 1px solid #ddd; padding: 10px; }
            .badge { background: #3b82f6; color: white; padding: 2px 6px; borderRadius: 4px; fontSize: 0.8em; }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <h1>${t.appTitle}</h1>
              <p style="margin: 0; color: #666;">${t.appSubtitle}</p>
            </div>
            <div style="text-align: right;">
              <p><strong>${t.printDateLabel}:</strong> ${dateStr}</p>
            </div>
          </div>

          <div class="header-info" style="margin-top: 20px;">
            <div>
              <p><strong>${t.printProjectLabel}:</strong> ${projectName || '-'}</p>
              <p><strong>${t.printEditorLabel}:</strong> ${projectEditor || '-'}</p>
            </div>
            <div>
              <p><strong>${t.printContainerInfo}:</strong> ${pc.container.name} (${pc.container.length / 10}x${pc.container.width / 10}x${pc.container.height / 10} cm)</p>
            </div>
          </div>

          <div class="stats">
            <div><strong>${t.volumeLabel}:</strong> ${pc.utilizationVolumePercent.toFixed(1)}%</div>
            <div><strong>${t.weightLabel2}:</strong> ${pc.utilizationWeightPercent.toFixed(1)}%</div>
            <div><strong>${t.loadedItemsLabel}:</strong> ${pc.items.length}</div>
          </div>

          <h2>${t.printLoadingSeqTitle}</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>${t.contentDescLabel}</th>
                <th>Maße (LxBxH)</th>
                <th>${t.weightLabel}</th>
                <th>Position (mm)</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div style="margin-top: 40px; font-size: 0.9em; color: #666; font-style: italic;">
            ${t.efficiencyExplanation}
          </div>

          <p class="no-print" style="margin-top: 40px;">
            <button onclick="window.print()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">
              Drucken / Print
            </button>
          </p>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const removePacklistItem = (id: string, e?: React.MouseEvent) => {
    if(e) e.stopPropagation();
    setPacklist(prev => prev.filter(i => i.id !== id));
    if (editingItemId === id) cancelEdit();
  };

  const handleEditItem = (item: PacklistItem) => {
    setEditingItemId(item.id);
    setForm(item);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onItemClick = useCallback((id: string) => {
    setActiveItemId(prev => prev === id ? null : id);
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = await parseExcelFile(file);
      if (imported.length > 0) {
        setPacklist(prev => [...prev, ...imported]);
        alert(t.importSuccess);
      }
    } catch (err) {
      console.error(err);
      alert(t.importError);
    }
    e.target.value = '';
  };

  const result = useMemo(() => {
    if (packlist.length === 0) return null;
    return calculateHeterogeneousPacking(packlist, containerSelection, customFleet, groupByDescription, aisleActive ? aisleWidth * 10 : 0, aislePosition);
  }, [packlist, containerSelection, customFleet, groupByDescription, aisleActive, aisleWidth, aislePosition]);

  const addFleetItem = () => {
     setCustomFleet(prev => [...prev, { containerId: CONTAINERS[0].id, count: 1 }]);
  };
  const removeFleetItem = (idx: number) => {
     setCustomFleet(prev => prev.filter((_, i) => i !== idx));
  };
  const handleFleetCountChange = (idx: number, count: number) => {
     setCustomFleet(prev => prev.map((f, i) => i === idx ? { ...f, count: Math.max(1, count) } : f));
  };
  const handleFleetTypeChange = (idx: number, containerId: string) => {
     setCustomFleet(prev => prev.map((f, i) => i === idx ? { ...f, containerId } : f));
  };

  const formatPosition = (x: number, y: number, z: number, cW: number, cL: number) => {
    const area = z < cL / 3 ? t.posBack : z < (cL * 2) / 3 ? t.posMiddle : t.posFront;
    const side = x < cW / 3 ? t.posLeft : x < (cW * 2) / 3 ? t.posMiddle : t.posRight;
    const level = y < 100 ? t.posFloor : `${t.posLevel} ${Math.floor(y/800) + 2}`;
    return `${area}, ${side}, ${level}`;
  };

  const groupItems = (items: PackedItemInfo[], cW: number, cL: number) => {
    const map = new Map<string, { item: PacklistItem, count: number, orderMin: number, orderMax: number, posDesc: string }>();
    items.forEach(i => {
      const existing = map.get(i.item.id);
      const posDesc = formatPosition(i.x, i.y, i.z, cW, cL); 
      if(existing) {
        existing.count += 1;
        existing.orderMin = Math.min(existing.orderMin, i.loadingOrder);
        existing.orderMax = Math.max(existing.orderMax, i.loadingOrder);
      } else {
        map.set(i.item.id, { item: i.item, count: 1, orderMin: i.loadingOrder, orderMax: i.loadingOrder, posDesc });
      }
    });
    return Array.from(map.values());
  };

  return (
    <>
      {/* Header */}
      <div className="header-section">
        <div className="header-content">
          <h1 className="app-title">{t.appTitle}</h1>
          <p className="subtitle">{t.appSubtitle}</p>
        </div>
        <div className="header-actions">
          {packlist.length > 0 && !manualMode && (
            <button type="button" onClick={() => setManualMode(true)} className="btn" style={{ background: 'rgba(0,218,243,0.15)', color: 'var(--accent)', border: '1px solid rgba(0,218,243,0.5)', padding: '0.5rem 1rem', width: 'auto', marginRight: '1rem', textShadow: '0 0 10px rgba(0,218,243,0.3)' }}>
              🕹️ Manuelle Bepackung
            </button>
          )}

          <input type="file" id="excel-upload-header" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} style={{ display: 'none' }} />
          <label htmlFor="excel-upload-header" className="btn" style={{ background: 'rgba(59,130,246,0.2)', color: 'white', border: '1px solid var(--accent)', padding: '0.5rem 1rem', cursor: 'pointer', margin: 0, width: 'auto' }}>
            {t.btnImportExcel}
          </label>
          <button type="button" onClick={() => setShowProjectsModal(true)} className="btn" style={{ background: 'rgba(226, 181, 255, 0.15)', color: 'var(--accent-purple)', border: '1px solid rgba(226, 181, 255, 0.4)', textShadow: '0 0 10px rgba(226, 181, 255, 0.3)', width: 'auto', padding: '0.5rem 1rem' }}>
            {t.loadProjectsBtn}
          </button>
          
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)' }}>
            <button type="button" onClick={() => setLang('de')} style={{ position: 'relative', zIndex: 10, border: 'none', background: lang === 'de' ? 'var(--accent)' : 'transparent', color: 'white', padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 'bold' }}>DE</button>
            <button type="button" onClick={() => setLang('en')} style={{ position: 'relative', zIndex: 10, border: 'none', background: lang === 'en' ? 'var(--accent)' : 'transparent', color: 'white', padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 'bold' }}>EN</button>
          </div>
        </div>
      </div>

      {manualMode ? (
         <ManualPacker packlist={packlist} goBack={() => setManualMode(false)} lang={lang} />
      ) : (
      <div className="app-grid">
        {/* Left Column: Form Workflow */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Step 1: Project Information */}
          <div className="glass-panel animate-in" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>{t.projectInfoTitle}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t.projectPlaceholder.replace('...', '')}</label>
                <input
                  type="text"
                  placeholder={t.projectPlaceholder}
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  className="input-field"
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', fontWeight: 'bold', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t.projectEditorLabel}</label>
                <input
                  type="text"
                  placeholder={t.projectEditorPlaceholder}
                  value={projectEditor}
                  onChange={e => setProjectEditor(e.target.value)}
                  className="input-field"
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          </div>

          {/* Step 2: Container Selection */}
          <div className="glass-panel animate-in" style={{ padding: '1.5rem' }}>
             <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>{t.step1Title}</h2>
             <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>{t.step1Desc}</p>
             
             {/* Compact Layout */}
             <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
               <div 
                  className={`radio-card ${containerSelection === 'auto' ? 'active' : ''}`} 
                  onClick={() => setContainerSelection('auto')} 
                  style={{ padding: '1rem', width: '100%', boxSizing: 'border-box' }}
               >
                   <h3 style={{ fontSize: '1.1rem', margin: '0 0 4px 0' }}>🤖 {t.autoMixTitle}</h3>
                   <p style={{ margin: 0, fontSize: '0.85rem' }}>{t.autoMixDesc}</p>
               </div>
               
               <div 
                  className={`radio-card ${containerSelection === 'fleet' ? 'active' : ''}`} 
                  onClick={() => setContainerSelection('fleet')} 
                  style={{ padding: '1rem', width: '100%', boxSizing: 'border-box' }}
               >
                   <h3 style={{ fontSize: '1.1rem', margin: '0 0 4px 0' }}>🚛 {t.manualFleetTitle}</h3>
                   <p style={{ margin: 0, fontSize: '0.85rem' }}>{t.manualFleetDesc}</p>
                   
                   {containerSelection === 'fleet' && (
                     <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }} onClick={e => e.stopPropagation()}>
                        {customFleet.map((f, idx) => (
                           <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                             <input type="number" min="1" value={f.count} onChange={e => handleFleetCountChange(idx, Number(e.target.value))} className="input-field" style={{ width: '70px', padding: '0.4rem' }} />
                             <span style={{ color: 'var(--text-secondary)' }}>x</span>
                             <select value={f.containerId} onChange={e => handleFleetTypeChange(idx, e.target.value)} className="input-field" style={{ flex: 1, padding: '0.4rem' }}>
                               {CONTAINERS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                             </select>
                             <button type="button" onClick={() => removeFleetItem(idx)} className="btn" style={{ width: 'auto', background: 'transparent', color: 'var(--danger)', padding: '0.4rem' }}>🗑️</button>
                           </div>
                        ))}
                        <button type="button" onClick={addFleetItem} className="btn" style={{ background: 'rgba(255,255,255,0.1)', padding: '0.5rem', width: 'auto', alignSelf: 'flex-start', fontSize: '0.85rem', marginTop: '0.5rem' }}>{t.fleetAddBtn}</button>
                     </div>
                   )}
               </div>

               <div className="input-group">
                 <label className="input-label" style={{ marginBottom: '8px' }}>{t.manualContainerLabel}</label>
                 <select value={['auto', 'fleet'].includes(containerSelection) ? '' : containerSelection} onChange={e => setContainerSelection(e.target.value)} className="input-field" style={{ width: '100%', padding: '0.75rem' }}>
                    <option value="" disabled>-- {t.manualContainerLabel} --</option>
                    {CONTAINERS.map(c => (
                      <option key={c.id} value={c.id}>{c.name} (Max. {c.maxPayload.toLocaleString('de-DE')} kg)</option>
                    ))}
                 </select>
               </div>

               <div className="input-group" style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                     <label className="input-label" style={{ color: aisleActive ? 'var(--accent)' : 'var(--text-secondary)', margin: 0 }}>
                       Laufgang (Aisle) freihalten
                     </label>
                     <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={aisleActive} onChange={e => setAisleActive(e.target.checked)} />
                        {aisleActive ? 'An' : 'Aus'}
                     </label>
                 </div>
                 
                 {aisleActive && (
                     <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', marginTop: '0.5rem' }}>
                       <div style={{ flex: 1 }}>
                         <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Breite (cm)</label>
                         <input type="number" min="10" max="200" value={aisleWidth} onChange={e => setAisleWidth(Math.max(0, Number(e.target.value)))} className="input-field" style={{ width: '100%', padding: '0.75rem' }} />
                       </div>
                       <div style={{ flex: 2 }}>
                         <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Positionierung</label>
                         <select value={aislePosition} onChange={e => setAislePosition(e.target.value as 'left'|'center'|'right')} className="input-field" style={{ width: '100%', padding: '0.75rem' }}>
                            <option value="right">▶ {lang === 'de' ? 'Rechts (Standard)' : 'Right (Default)'}</option>
                            <option value="left">◀ {lang === 'de' ? 'Links' : 'Left'}</option>
                            <option value="center">◆ {lang === 'de' ? 'Mitte (Achtung)' : 'Center (Alert)'}</option>
                         </select>
                       </div>
                       <button 
                         type="button" 
                         onClick={() => setShowAisleInfo(!showAisleInfo)} 
                         style={{ background: 'rgba(0,218,243,0.1)', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '0.75rem', marginTop: '24px' }}
                         title={lang === 'de' ? 'Mehr Informationen' : 'More Information'}
                        >
                         ?
                       </button>
                     </div>
                 )}
                 {aisleActive && showAisleInfo && (
                    <div style={{ background: 'rgba(0,218,243,0.05)', border: '1px solid rgba(0,218,243,0.2)', padding: '0.75rem', marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', borderRadius: '8px', lineHeight: '1.4' }}>
                        {lang === 'de' ? (
                            <>
                                <strong>Hinweis zur Laufgang-Logik:</strong><br/>
                                Ein Laufgang reduziert die nutzbare Verladebreite. Er wird bevorzugt für Wartungs- oder Kontrollzwecke eingesetzt. 
                                Bitte beachte, dass dadurch die Effizienz der Raumausnutzung sinkt und breite Packstücke evtl. nicht mehr geladen werden können.
                            </>
                        ) : (
                            <>
                                <strong>Note on Aisle Logic:</strong><br/>
                                An aisle reduces the usable loading width. It is primarily used for maintenance or inspection purposes.
                                Please note that this reduces space utilization efficiency and wide items may no longer fit.
                            </>
                        )}
                    </div>
                 )}
                 {aisleActive && aislePosition === 'center' && (
                    <div style={{ background: 'rgba(255,0,85,0.1)', borderLeft: '4px solid var(--danger)', padding: '0.75rem', marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-primary)', borderRadius: '4px' }}>
                        <strong>Achtung: Mitte-Laufgang</strong><br/>
                        Ein mittiger Gang spaltet den Container in rechte und linke Hälfte. Packstücke, die breiter als eine dieser Hälften sind, werden vom Algorithmus abgelehnt!
                    </div>
                 )}
               </div>

             </div>
          </div>

          {/* Step 2: Form */}
          <form className="glass-panel animate-in" style={{ animationDelay: '0.1s', padding: '1.5rem' }} onSubmit={submitPacklistItem}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>{t.step2Title}</h2>
            
            {/* Compactly Grouped Form Fields */}
            <div className="form-grid" style={{ marginBottom: '1rem' }}>
              <div className="input-group" style={{ gridColumn: 'span 2' }}>
                <label className="input-label">{t.contentDescLabel}</label>
                <input type="text" name="contentDesc" value={form.contentDesc || ''} onChange={handleInputChange} className="input-field" placeholder={t.contentDescPlaceholder} required />
              </div>
              
              <div className="input-group">
                <label className="input-label">{t.quantityLabel}</label>
                <input type="number" name="quantity" value={form.quantity || 1} onChange={handleInputChange} className="input-field" min="1" required />
              </div>
              
              <div className="input-group">
                <label className="input-label">{t.packagingLabel}</label>
                <select name="packaging" value={form.packaging} onChange={handleInputChange} className="input-field">
                  {PACKAGING_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                </select>
              </div>

              <div className="input-group">
                <label className="input-label">{t.lengthLabel}</label>
                <input type="number" name="length" value={form.length ? form.length / 10 : ''} onChange={handleInputChange} className="input-field" min="1" step="0.1" required />
              </div>
              <div className="input-group">
                <label className="input-label">{t.widthLabel}</label>
                <input type="number" name="width" value={form.width ? form.width / 10 : ''} onChange={handleInputChange} className="input-field" min="1" step="0.1" required />
              </div>
              
              <div className="input-group">
                <label className="input-label">{t.heightLabel}</label>
                <input type="number" name="height" value={form.height ? form.height / 10 : ''} onChange={handleInputChange} className="input-field" min="1" step="0.1" required />
              </div>
              <div className="input-group">
                <label className="input-label">{t.weightLabel}</label>
                <input type="number" name="weight" value={form.weight || ''} onChange={handleInputChange} className="input-field" min="1" required />
              </div>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--accent)', fontStyle: 'italic', marginBottom: '1rem' }}>{t.advancedInfoText}</p>
            
            <h3 style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginBottom: '1rem', fontSize: '1rem' }}>{t.advancedOptionsTitle}</h3>
            
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.25rem', borderRadius: '12px', marginBottom: '1.5rem', display: 'grid', gap: '1rem', gridTemplateColumns: '1fr 1fr' }}>
               <div className="input-group" style={{ gridColumn: 'span 2' }}>
                 <label className="input-label">{t.priorityLabel}</label>
                 <select name="priority" value={form.priority} onChange={handleInputChange} className="input-field">
                   <option value="1">{t.prio1}</option>
                   <option value="2">{t.prio2}</option>
                   <option value="3">{t.prio3}</option>
                   <option value="4">{t.prio4}</option>
                   <option value="5">{t.prio5}</option>
                 </select>
               </div>
               
               <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', gridColumn: 'span 2' }}>
                 <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input type="checkbox" name="rotatable" checked={form.rotatable || false} onChange={handleInputChange} style={{ transform: 'scale(1.2)' }} />
                   {t.rotatableLabel}
                 </label>
                 <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input type="checkbox" name="stackableBottom" checked={form.stackableBottom || false} onChange={handleInputChange} style={{ transform: 'scale(1.2)' }} />
                   {t.stackBottomLabel}
                 </label>
                 <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input type="checkbox" name="stackableTop" checked={form.stackableTop || false} onChange={handleInputChange} style={{ transform: 'scale(1.2)' }} />
                   {t.stackTopLabel}
                 </label>
                 <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)', cursor: 'pointer' }}>
                   <input type="checkbox" name="needsCraning" checked={form.needsCraning || false} onChange={handleInputChange} style={{ transform: 'scale(1.2)' }} />
                   {t.craningLabel}
                 </label>
               </div>

               <div className="input-group">
                 <label className="input-label">{t.customLabelLabel}</label>
                 <input type="text" name="label" value={form.label || ''} onChange={handleInputChange} className="input-field" placeholder={t.optionalText} />
               </div>
               <div className="input-group">
                 <label className="input-label">{t.partialDelLabel}</label>
                 <input type="text" name="partialDeliveryId" value={form.partialDeliveryId || ''} onChange={handleInputChange} className="input-field" placeholder={t.optionalText} />
               </div>

               <div className="input-group" style={{ gridColumn: 'span 2' }}>
                 <label className="input-label">{t.colorLabel}</label>
                 <input type="color" name="color" value={form.color || '#3b82f6'} onChange={handleInputChange} style={{ width: '100%', height: '40px', padding: '0', border: 'none', borderRadius: '8px', cursor: 'pointer' }} />
               </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit" className="btn" style={{ flex: 1, background: editingItemId ? 'var(--success)' : 'var(--accent)' }}>
                  {editingItemId ? `✓ ${t.btnConfirmEdit}` : t.btnAddItem}
                </button>
                {editingItemId && (
                  <button type="button" onClick={cancelEdit} className="btn" style={{ background: 'rgba(255,255,255,0.1)' }}>
                    {t.btnCancelEdit}
                  </button>
                )}
            </div>
          </form>
        </div>

        {/* Right Column: Packlist overview and Results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Active Container Info */}
          <div className="glass-panel animate-in" style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid var(--accent)', flexWrap: 'wrap', gap: '1rem' }}>
             <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 'bold', marginBottom: '4px' }}>
                  {lang === 'de' ? 'Aktueller Lade-Modus:' : 'Current Load Mode:'}
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>
                  {containerSelection === 'auto' 
                    ? (lang === 'de' ? '🤖 Logistik-KI (Auto-Mix)' : '🤖 Logistics AI (Auto-Mix)')
                    : (containerSelection === 'fleet' 
                         ? (lang === 'de' ? '🚛 Manuelle Flotte' : '🚛 Custom Fleet')
                         : CONTAINERS.find(c => c.id === containerSelection)?.name)}
                </div>
             </div>
             {containerSelection === 'auto' && result && result.packedContainers.length > 0 && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    {lang === 'de' ? 'Genutzte Container:' : 'Used Containers:'}
                  </div>
                  <div style={{ fontWeight: 'bold' }}>
                    {result.packedContainers.map(pc => pc.container.name).join(', ')}
                  </div>
                </div>
             )}
          </div>

          <div className="glass-panel animate-in" style={{ animationDelay: '0.2s', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <h2 style={{ fontSize: '1.25rem', margin: 0 }}>{t.packlistTitle}</h2>
               <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                 <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', background: 'rgba(255,255,255,0.05)', padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid var(--border)' }} title={lang === 'de' ? 'Aktiviert: Packstücke mit exakt gleicher Bezeichnung landen bevorzugt gebündelt im selben Container' : 'Enabled: Items with identical descriptions are strictly grouped into the same container'}>
                    <input type="checkbox" checked={groupByDescription} onChange={e => setGroupByDescription(e.target.checked)} />
                    {lang === 'de' ? 'Gleiche bündeln' : 'Group similar'}
                 </label>
                 {packlist.length > 0 && (
                   <button type="button" onClick={handlePrintPacklist} className="btn" style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.85rem', display: 'inline-block', margin: 0, width: 'auto' }}>
                     {t.btnPrintPacklist}
                   </button>
                 )}
               </div>
            </div>
            {packlist.length === 0 ? (
               <p style={{ color: 'var(--text-secondary)', marginTop: '1rem' }}>{t.emptyPacklist}</p>
            ) : (
              <>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>💡 {t.doubleClickHint}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
                  {packlist.map((item) => (
                    <div 
                      key={item.id} 
                      onClick={() => setActiveItemId(prev => prev === item.id ? null : item.id)}
                      onDoubleClick={() => handleEditItem(item)}
                      title={t.doubleClickHint}
                      style={{ 
                          display: 'flex', flexDirection: 'column',
                          background: editingItemId === item.id ? 'rgba(255,255,255,0.15)' : (activeItemId === item.id ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)'), 
                          padding: '1rem', borderRadius: '8px', borderLeft: `6px solid ${item.color}`,
                          boxShadow: activeItemId === item.id ? `0 0 12px ${item.color}40` : 'none',
                          cursor: 'pointer', transition: 'all 0.2s'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontWeight: 'bold' }}>{item.quantity}x {item.contentDesc || item.packaging}</div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {item.length / 10}x{item.width / 10}x{item.height / 10} cm, {item.weight} kg
                            {item.needsCraning && <span style={{ color: 'var(--danger)', marginLeft: '8px' }}>[Kran]</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button onClick={(e) => { e.stopPropagation(); handleEditItem(item); }} style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--accent)', border: '1px solid rgba(59,130,246,0.3)', padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }} title={t.btnConfirmEdit}>
                            ✏️ {lang === 'de' ? 'Bearbeiten' : 'Edit'}
                          </button>
                          <button onClick={(e) => removePacklistItem(item.id, e)} style={{ background: 'transparent', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)', padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
                            {t.btnDelete}
                          </button>
                        </div>
                      </div>
                      
                      {activeItemId === item.id && (
                         <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><strong>Priorität:</strong> <span style={getPrioStyle(item.priority)}>{
                              item.priority === 1 ? t.prio1 :
                              item.priority === 2 ? t.prio2 :
                              item.priority === 3 ? t.prio3 :
                              item.priority === 4 ? t.prio4 :
                              item.priority === 5 ? t.prio5 :
                              item.priority === 'hoch' ? t.prio1 :
                              item.priority === 'niedrig' ? t.prio5 : t.prio3
                            }</span></div>
                            <div><strong>Verpackung:</strong> {item.packaging}</div>
                            {item.rotatable && <div><strong>Rotierbar:</strong> Ja</div>}
                            {item.stackableBottom && <div><strong>Stapelbar:</strong> Unten</div>}
                            {item.stackableTop && <div><strong>Stapelbar:</strong> Oben</div>}
                            {item.needsCraning && <div style={{ color: 'var(--danger)' }}><strong>Kran nötig:</strong> Ja</div>}
                            {item.label && <div style={{ gridColumn: 'span 2' }}><strong>Label:</strong> {item.label}</div>}
                         </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="glass-panel" style={{ padding: '1.5rem' }}>
             <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>{t.loadPlanTitle}</h2>
             {packlist.length === 0 ? (
               <div style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: '1rem 0' }}>
                 {t.loadPlanEmpty}
               </div>
             ) : (
               <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                  {result && result.packedContainers.length > 0 ? (
                    <>
                      {result.packedContainers.map((pc: PackedContainer, idx: number) => (
                        <div key={`${pc.container.id}-${idx}`} style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h3 style={{ margin: 0, color: 'var(--accent)', fontSize: '1.3rem' }}>
                              {idx + 1}. {pc.container.name}
                            </h3>
                            <button 
                              type="button" 
                              onClick={() => handlePrint(pc)} 
                              className="btn" 
                              style={{ width: 'auto', padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: 'rgba(59,130,246,0.1)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
                            >
                              {t.printBtnLabel}
                            </button>
                          </div>
                          
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                            <div>
                              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t.volumeLabel}</div>
                              <div style={{ fontWeight: 'bold' }}>{pc.utilizationVolumePercent.toFixed(1)}% ({(pc.totalVolume / 1e9).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', {minimumFractionDigits: 1, maximumFractionDigits: 2})} m³)</div>
                              <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', marginTop: '4px', overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(100, pc.utilizationVolumePercent)}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', transition: 'width 0.5s ease' }}></div>
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t.weightLabel2}</div>
                              <div style={{ fontWeight: 'bold' }}>{pc.utilizationWeightPercent.toFixed(1)}% ({(pc.totalWeight).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')} kg)</div>
                              <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', marginTop: '4px', overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(100, pc.utilizationWeightPercent)}%`, height: '100%', background: pc.utilizationWeightPercent > 90 ? 'linear-gradient(90deg, #f59e0b, #ef4444)' : 'linear-gradient(90deg, #10b981, #34d399)', transition: 'width 0.5s ease' }}></div>
                              </div>
                            </div>
                          </div>

                          {/* Remaining capacity */}
                          {(() => {
                            const cVol = pc.container.length * pc.container.width * pc.container.height;
                            const cArea = pc.container.length * pc.container.width;
                            const freeVol = (cVol - pc.totalVolume) / 1e9;
                            const freeArea = (cArea - pc.items.reduce((acc, it) => { const footprint = it.l * it.w; return acc + footprint; }, 0)) / 1e6;
                            const freeWeight = pc.container.maxPayload - pc.totalWeight;
                            const loc = lang === 'de' ? 'de-DE' : 'en-US';
                            return (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', padding: '0.6rem 0.8rem' }}>
                                  <div style={{ fontSize: '0.7rem', color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>{t.freeVolumeLabel}</div>
                                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#10b981' }}>{freeVol.toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} m³</div>
                                </div>
                                <div style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', padding: '0.6rem 0.8rem' }}>
                                  <div style={{ fontSize: '0.7rem', color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>{t.freeAreaLabel}</div>
                                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#3b82f6' }}>{Math.max(0, freeArea).toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} m²</div>
                                </div>
                                <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', padding: '0.6rem 0.8rem' }}>
                                  <div style={{ fontSize: '0.7rem', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>{t.freePayloadLabel}</div>
                                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#f59e0b' }}>{freeWeight.toLocaleString(loc)} kg</div>
                                </div>
                              </div>
                            );
                          })()}

                          <div>
                            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', paddingBottom: '0.25rem' }}>{t.loadedItemsLabel}</div>
                            <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '0', fontSize: '0.9rem', listStyle: 'none' }}>
                              {groupItems(pc.items, pc.container.width, pc.container.length).map((pi, iIdx) => (
                                 <li key={iIdx} style={{ marginBottom: '8px', display: 'flex', alignItems: 'center' }}>
                                   <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '2px', background: pi.item.color || '#ccc', marginRight: '12px', border: '1px solid rgba(255,255,255,0.2)' }}></span>
                                   <span style={{ flex: 1 }}>
                                     <strong>{pi.count}x</strong> {pi.item.contentDesc || pi.item.packaging}
                                   </span>
                                   <span style={{ color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 'bold', marginRight: '8px', background: 'rgba(59,130,246,0.15)', padding: '2px 6px', borderRadius: '4px' }}>
                                     #{pi.orderMin === pi.orderMax ? pi.orderMin : `${pi.orderMin}-${pi.orderMax}`}
                                   </span>
                                   <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', flex: 1, textAlign: 'right' }}>
                                     {pi.posDesc}
                                   </span>
                                 </li>
                              ))}
                            </ul>
                          </div>

                          <Container3DView container={pc.container} items={pc.items} lang={lang} activeItemId={activeItemId} onItemClick={onItemClick} />

                          <ContainerViews container={pc.container} items={pc.items} lang={lang} activeItemId={activeItemId} onItemClick={onItemClick} />

                          {/* Efficiency explanation */}
                          <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '10px', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                            {t.efficiencyExplanation}
                          </div>

                        </div>
                      ))}
                      
                      {result.unpackedItems.length > 0 && (
                        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', padding: '1.25rem', borderRadius: '12px' }}>
                           <h3 style={{ margin: '0 0 0.75rem 0', color: 'var(--danger)', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                             {t.unloadableTitle}
                           </h3>
                           <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.9rem', color: '#fca5a5' }}>
                              {result.unpackedItems.map((up, i) => (
                                <li key={i} style={{ marginBottom: '4px' }}>
                                  <strong>{up.missingCount}x</strong> {up.item.contentDesc || up.item.packaging} <br/>
                                  <span style={{ opacity: 0.7, fontSize: '0.8rem' }}>{t.reasonPrefix} {up.reason}</span>
                                </li>
                              ))}
                           </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ color: 'var(--danger)', textAlign: 'center', margin: '2rem 0' }}>
                      {t.noValidPlan}
                    </div>
                  )}
               </div>
             )}
          </div>
        </div>
      </div>
      )}

      {/* Projects Modal */}
      {showProjectsModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(8px)' }}>
          <div className="glass-panel" style={{ width: '90%', maxWidth: '600px', maxHeight: '80vh', overflowY: 'auto', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <h2 style={{ margin: 0 }}>{t.modalTitle}</h2>
              <button onClick={() => { setShowProjectsModal(false); setDeleteConfirmId(null); }} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
            </div>
            
            <button onClick={createNewProject} className="btn" style={{ marginBottom: '2rem', width: '100%' }}>
              {t.btnNewProject}
            </button>

            <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>{t.savedProjectsTitle} ({savedProjects.length})</h3>
            
            {savedProjects.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{t.noSavedProjects}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {savedProjects.sort((a,b) => b.updatedAt - a.updatedAt).map(p => (
                  <div key={p.id} style={{ position: 'relative' }}>
                    <div onClick={() => loadProject(p)} style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'background 0.2s ease' }} onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'} onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}>
                      <div>
                        <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--accent)', marginBottom: '4px' }}>{p.name}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          {t.lastEdited} {new Date(p.updatedAt).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')} <br/>
                          {p.packlist.length} {t.packlistCountText}
                        </div>
                      </div>
                      <button onClick={(e) => handleDeleteProject(e, p.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.5rem', borderRadius: '50%' }} title={t.btnDelete}>
                        🗑️
                      </button>
                    </div>
                    {/* Delete confirmation popup */}
                    {deleteConfirmId === p.id && (
                      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#1e293b', border: '2px solid var(--danger)', borderRadius: '12px', padding: '1.25rem 1.5rem', zIndex: 10, textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', minWidth: '250px' }}>
                      <div style={{ marginBottom: '1rem', fontWeight: 'bold', fontSize: '1rem' }}>{t.deleteConfirmTitle}</div>
                      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                        <button onClick={(e) => { e.stopPropagation(); confirmDeleteProject(); }} className="btn" style={{ background: 'var(--danger)', padding: '0.5rem 1.25rem', width: 'auto' }}>{t.deleteConfirmYes}</button>
                        <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }} className="btn" style={{ background: 'rgba(255,255,255,0.1)', padding: '0.5rem 1.25rem', width: 'auto' }}>{t.deleteConfirmNo}</button>
                      </div>
                    </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <footer style={{ textAlign: 'center', padding: '3rem 1rem 1rem', color: 'var(--text-secondary)', fontSize: '0.85rem', opacity: 0.7 }}>
        &copy; {new Date().getFullYear()} wil-AI
      </footer>
    </>
  );
}
