import type { ContainerType } from './containers';
import { CONTAINERS } from './containers';

export type PackagingType = 'Europalette' | 'Einwegpalette' | 'Kiste' | 'Verschlag' | 'Karton' | 'Fass' | 'Rollen' | 'Unverpackt' | 'Sonstige' | 'Karton auf Palette' | 'Euro-Gitterbox';
export type PriorityLevel = 1 | 2 | 3 | 4 | 5 | 'hoch' | 'normal' | 'niedrig';

export interface PacklistItem {
  id: string;
  quantity: number;
  contentDesc: string;
  packaging: PackagingType;
  length: number; // mm
  width: number;  // mm
  height: number; // mm
  weight: number; // kg

  // Advanced options
  priority: PriorityLevel;
  rotatable: boolean;
  stackableBottom: boolean;
  stackableTop: boolean;
  needsCraning: boolean;
  label: string;
  partialDeliveryId: string;
  color: string;
}

export interface PackedItemInfo {
  item: PacklistItem;
  x: number;
  y: number;
  z: number;
  l: number;
  w: number;
  h: number;
  loadingOrder: number;
}

export interface PackedContainer {
  container: ContainerType;
  items: PackedItemInfo[];
  totalWeight: number;
  totalVolume: number;
  utilizationVolumePercent: number;
  utilizationWeightPercent: number;
}

export interface PackingPlan {
  packedContainers: PackedContainer[];
  unpackedItems: { item: PacklistItem, missingCount: number, reason: string }[];
}



function findBestContainerForItems(items: PacklistItem[], containerSelection: string, groupByDescription: boolean, aisleWidthMm: number): ContainerType {
  const needsCraning = items.some(i => i.needsCraning);
  const needsHC = items.some(i => i.height > 2390 || (!i.rotatable && i.width > 2390 && i.length > 2390));

  // If container is manually selected, force it.
  if (containerSelection !== 'auto') {
    return CONTAINERS.find(c => c.id === containerSelection) || CONTAINERS[0];
  }

  // Pre-filter types based on technical requirements
  let candidates = [...CONTAINERS];
  if (needsCraning) {
    candidates = candidates.filter(c => c.isOpenTop);
  } else if (needsHC) {
    candidates = candidates.filter(c => c.id.includes('hc'));
  } else {
    // Normal cases: avoid HC/OT if not needed unless it's the only way (not the case here)
    candidates = candidates.filter(c => !c.isOpenTop && !c.id.includes('ot'));
  }

  if (candidates.length === 0) candidates = [CONTAINERS[0]];

  // If we have only one candidate after filters, use it.
  if (candidates.length === 1) return candidates[0];

  // Logic: Minimizing Container Count and Footprint.
  // We simulate packing for each candidate and choose based on a Score:
  // 1. Completion Rate: (Packed Items / Remaining Items)
  // 2. Volume Efficiency: (Packed Volume)
  
  let bestContainer = candidates[0];
  let bestScore = -1;

  for (const c of candidates) {
    const { packedItems, usedVolume } = packIntoContainer3D(items, c, groupByDescription, aisleWidthMm);
    
    // Calculate a score:
    // Base score is the number of packed items (favoring greedy filling).
    // Plus a completion bonus for the "perfect fit" to end the list.
    const isComplete = packedItems.length === items.length;
    const completionBonus = isComplete ? 10000000 : 0;
    
    // We use a multi-level score:
    // Millions: Completion (fits EVERYTHING left)
    // Units: Number of items packed (Fills this container as much as possible)
    // Fractions: Used Volume (Tie-breaker for density)
    const score = completionBonus + packedItems.length + (usedVolume / 1e12);

    if (score > bestScore) {
        bestScore = score;
        bestContainer = c;
    } else if (Math.abs(score - bestScore) < 0.00001) {
        // Tie-breaker: prefer the smaller container (cheaper)
        const currentSize = bestContainer.length * bestContainer.width * bestContainer.height;
        const candidateSize = c.length * c.width * c.height;
        if (candidateSize < currentSize) {
           bestContainer = c;
        } else if (candidateSize === currentSize) {
           // If same size, prefer higher payload capacity
           if (c.maxPayload > bestContainer.maxPayload) {
              bestContainer = c;
           }
        }
    }
  }

  return bestContainer;
}

function packIntoContainer3D(items: PacklistItem[], container: ContainerType, groupByDescription: boolean = false, aisleWidthMm: number = 0) {
   let usedVolume = 0;
   let usedWeight = 0;
   const packedItems: PackedItemInfo[] = [];
   const remainingItems: PacklistItem[] = [];
   let loadingCounter = 0;
   
   const itemsToPack: PacklistItem[] = [];
   for (const i of items) {
       for(let n=0; n < i.quantity; n++) {
           itemsToPack.push({...i, quantity: 1});
       }
   }

    // Sort: Priority (1 first, 5 last) -> Footprint (group similar footprints for stacking) -> Height
  itemsToPack.sort((a, b) => {
       const getPrioValue = (p: PriorityLevel): number => {
         if (typeof p === 'number') return p;
         if (p === 'hoch') return 1;
         if (p === 'niedrig') return 5;
         return 3;
       };
       const pA = getPrioValue(a.priority);
       const pB = getPrioValue(b.priority);
       
       if (pA !== pB) {
          return pA - pB;
       }

       if (groupByDescription) {
           const descA = a.contentDesc || a.packaging;
           const descB = b.contentDesc || b.packaging;
           if (descA !== descB) {
               return descA.localeCompare(descB);
           }
       }
       
       const areaA = a.length * a.width;
       const areaB = b.length * b.width;
       if (areaB !== areaA) return areaB - areaA;

       return b.height - a.height;
    });

   // COORDINATE SYSTEM: 
   // Z=0 is Back Wall (Stirnwand)
   // Z increases towards the Door
   let currentZ = 0;
   let currentX = 0;
   let currentY = 0;
   let sliceMaxL = 0;   // Max length (Z) of items in the current slice
   let columnMaxW = 0;  // Max width (X) of items in the current column stacking upwards

   for (const item of itemsToPack) {
       if (usedWeight + item.weight > container.maxPayload) {
          remainingItems.push(item);
          continue;
       }

        // --- ROTATION & STACKING LOGIC ---
        let l = item.length;
        let w = item.width;
        let h = item.height;

        // 1. Rotation Logic: If rotatable, choose the orientation that fits better
        // We prefer keeping the larger dimension in Z (length) to fill slices deeper if needed,
        // but if it doesn't fit in X, we MUST rotate. 
        // More importantly: if rotating results in a smaller "slice-depth" impact, we do it.
        if (item.rotatable) {
           const fitsNormal = (currentX + w <= container.width) && (currentZ + l <= container.length);
           const fitsRotated = (currentX + l <= container.width) && (currentZ + w <= container.length);
           
           if (fitsRotated && !fitsNormal) {
              // Forced rotation to fit
              [l, w] = [w, l];
           } else if (fitsNormal && fitsRotated) {
              // Optional rotation to save width in the current column or length in the slice
              // Prefer orientation that fits in current columnMaxW if possible
              if (w > columnMaxW && l <= columnMaxW && l < w) {
                 [l, w] = [w, l];
              }
           }
        }

        if (item.needsCraning && !container.isOpenTop) {
            remainingItems.push(item);
            continue;
        }

        // --- OVERLAP-SAFE PACKING & STACKING ---
        
        // A. If the current stack (currentY) is NOT zero, we are trying to stack on top of the PREVIOUS item.
        // We can only do this if the PREVIOUS item allowed it AND the CURRENT item allows it.
        const prevItem = packedItems.length > 0 ? packedItems[packedItems.length - 1] : null;
        const canStackAbove = prevItem && prevItem.x === currentX && prevItem.z === currentZ && prevItem.item.stackableBottom;
        const canStackHere = item.stackableTop;

        if (currentY > 0 && (!canStackAbove || !canStackHere)) {
            // Cannot stack here -> move to next X-column
            currentY = 0;
            currentX += columnMaxW;
            columnMaxW = 0;
        }

        // B. Vertical Height check
        if (currentY + h > container.height) {
           currentY = 0;
           currentX += columnMaxW;
           columnMaxW = 0;
        }

        // C. Width check (move to next slice)
        const usableW = Math.max(0, container.width - aisleWidthMm);
        if (currentX + w > usableW) {
           currentX = 0;
           currentY = 0;
           currentZ += sliceMaxL;
           sliceMaxL = 0;
           columnMaxW = 0;
        }

        // D. Depth check (exit container)
        if (currentZ + l > container.length) {
            remainingItems.push(item);
            continue;
        }

        // --- COMMIT PACKING ---
        loadingCounter++;
        packedItems.push({
            item,
            x: currentX,
            y: currentY,
            z: currentZ,
            w, h, l,
            loadingOrder: loadingCounter
        });

        usedVolume += (w * h * l);
        usedWeight += item.weight;

        // Update tracking
        if (l > sliceMaxL) sliceMaxL = l;
        if (w > columnMaxW) columnMaxW = w;
        
        // Prepare for NEXT item in the same stack (Y-increment)
        // Note: we ONLY stay in the same stack if this item allows something on top.
        if (item.stackableBottom) {
           currentY += h;
        } else {
           currentY = 0;
           currentX += columnMaxW;
           columnMaxW = 0;
        }
   }

   const remainingGrouped = new Map<string, PacklistItem>();
   for (const rem of remainingItems) {
       if (remainingGrouped.has(rem.id)) {
           remainingGrouped.get(rem.id)!.quantity += 1;
       } else {
           remainingGrouped.set(rem.id, { ...rem, quantity: 1 });
       }
   }

   return { 
       packedItems, 
       remainingItems: Array.from(remainingGrouped.values()), 
       usedVolume, 
       usedWeight 
   };
}

export interface CustomFleetItem {
  containerId: string;
  count: number;
}

export function calculateHeterogeneousPacking(
  packlist: PacklistItem[],
  containerSelection: string,
  customFleet: CustomFleetItem[] = [],
  groupByDescription: boolean = false,
  aisleWidthMm: number = 0
): PackingPlan {
  const plan: PackingPlan = { packedContainers: [], unpackedItems: [] };
  
  let currentItems = [...packlist];
  let safetyIterator = 0;

  // Build the exact container sequence if 'fleet' mode
  const fleetSequence: import('./containers').ContainerType[] = [];
  if (containerSelection === 'fleet') {
      for (const item of customFleet) {
          const c = CONTAINERS.find(x => x.id === item.containerId);
          if (c) {
              for (let i = 0; i < item.count; i++) fleetSequence.push(c);
          }
      }
  }

  while (currentItems.length > 0 && safetyIterator < 30) {
     safetyIterator++;
     
     let container: import('./containers').ContainerType;
     if (containerSelection === 'fleet') {
         if (fleetSequence.length === 0) break; // Fleet is exhausted
         container = fleetSequence.shift()!;
     } else {
         container = findBestContainerForItems(currentItems, containerSelection, groupByDescription, aisleWidthMm);
     }

     const { packedItems, remainingItems, usedVolume, usedWeight } = packIntoContainer3D(currentItems, container, groupByDescription, aisleWidthMm);

     if (packedItems.length === 0) {
        if (containerSelection === 'fleet') {
           // Container is empty but we couldn't pack the next item. Try next in fleet.
           continue;
        } else {
           const unp = remainingItems.shift();
           if (unp) {
              plan.unpackedItems.push({ item: unp, missingCount: unp.quantity, reason: 'Maße/Gewicht überschreiten alle Grenzen dieses Containers.' });
           }
           currentItems = remainingItems;
           continue;
        }
     }

     const containerVol = container.length * container.width * container.height;
     
     plan.packedContainers.push({
        container,
        items: packedItems,
        totalVolume: usedVolume,
        totalWeight: usedWeight,
        utilizationVolumePercent: Number(((usedVolume / containerVol) * 100).toFixed(1)),
        utilizationWeightPercent: Number(((usedWeight / container.maxPayload) * 100).toFixed(1))
     });

     currentItems = remainingItems;
  }

  if (currentItems.length > 0) {
     for (const item of currentItems) {
        const reason = containerSelection === 'fleet' ? 'Abbruch: Fuhrpark-Kapazität vollständig ausgeschöpft.' : 'Abbruch: Max. Containeranzahl erreicht.';
        plan.unpackedItems.push({ item, missingCount: item.quantity, reason });
     }
  }

  return plan;
}
