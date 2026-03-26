import type { ContainerType } from './containers';
import { CONTAINERS } from './containers';

export type PackagingType = 'Europalette' | 'Einwegpalette' | 'Kiste' | 'Verschlag' | 'Karton' | 'Fass' | 'Rollen' | 'Unverpackt' | 'Sonstige' | 'Karton auf Palette' | 'Euro-Gitterbox';
export type PriorityLevel = 'hoch' | 'normal' | 'niedrig';

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



function findBestContainerForItems(items: PacklistItem[], containerSelection: string): ContainerType {
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
    const { packedItems } = packIntoContainer3D(items, c);
    
    // Calculate a score:
    // Base score is the number of packed items (favoring completion).
    // Plus a fractional bonus for volume utilization.
    const isComplete = packedItems.length === items.length;
    const completionBonus = isComplete ? 1000000 : 0;
    const score = completionBonus + packedItems.length;

    if (score > bestScore) {
        bestScore = score;
        bestContainer = c;
    } else if (score === bestScore) {
        // Tie-breaker: prefer the smaller container
        const currentSize = bestContainer.length * bestContainer.width * bestContainer.height;
        const candidateSize = c.length * c.width * c.height;
        if (candidateSize < currentSize) {
           bestContainer = c;
        } else if (candidateSize === currentSize) {
           // If sizes are equal, check usedVolume specifically
           // and favor the one with higher payload capacity
           if (c.maxPayload > bestContainer.maxPayload) {
              bestContainer = c;
           }
        }
    }
  }

  return bestContainer;
}

function packIntoContainer3D(items: PacklistItem[], container: ContainerType) {
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

   // Sort: Priority -> Height (Bottom items should be high) -> Volume
   itemsToPack.sort((a,b) => {
      const pWeight = { hoch: 3, normal: 2, niedrig: 1 };
      if (pWeight[a.priority] !== pWeight[b.priority]) {
         return pWeight[b.priority] - pWeight[a.priority];
      }
      if (b.height !== a.height) return b.height - a.height;
      return (b.length * b.width) - (a.length * a.width);
   });

   // COORDINATE SYSTEM: 
   // Z=0 is Back Wall (Stirnwand)
   // Z increases towards the Door
   let currentZ = 0;
   let currentX = 0;
   let currentY = 0;
   let layerMaxZ = 0;

   for (const item of itemsToPack) {
       if (usedWeight + item.weight > container.maxPayload) {
          remainingItems.push(item);
          continue;
       }

       let l = item.length;
       let w = item.width;
       const h = item.height;
       
       // Optimal rotation for fitting into the remaining depth
       if (item.rotatable && currentZ + l > container.length && currentZ + w <= container.length) {
            l = item.width;
            w = item.length;
       }

       if (item.needsCraning && !container.isOpenTop) {
           remainingItems.push(item);
           continue;
       }

       // --- PACKING LOGIC: Cross-Section Layering ---
       
       // 1. Try to stack in Y at current X/Z
       if (currentY + h > container.height) {
          currentY = 0;
          currentX += w; // Try next column in the same Z-slice
       }

       // 2. Try to move to next X column in the same Slice
       if (currentX + w > container.width) {
          currentX = 0;
          currentY = 0;
          currentZ += layerMaxZ; // Advance Z by the depth of the previous section
          layerMaxZ = 0;
       }

       // 3. Check if Z is out of bounds
       if (currentZ + l > container.length || currentX + w > container.width || currentY + h > container.height) {
           remainingItems.push(item);
           continue;
       }

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

       // Track the deepest item in the current "slice" to know how far to advance Z
       if (l > layerMaxZ) layerMaxZ = l;
       
       // For now, simple stacking: Increment Y for next item at this X/Z if it fits
       // actually, many items have same bottom footprint, so we can stack them
       currentY += h;
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

export function calculateHeterogeneousPacking(
  packlist: PacklistItem[],
  containerSelection: string
): PackingPlan {
  const plan: PackingPlan = { packedContainers: [], unpackedItems: [] };
  
  let currentItems = [...packlist];
  let safetyIterator = 0;

  while (currentItems.length > 0 && safetyIterator < 30) {
     safetyIterator++;
     
     const container = findBestContainerForItems(currentItems, containerSelection);
     const { packedItems, remainingItems, usedVolume, usedWeight } = packIntoContainer3D(currentItems, container);

     if (packedItems.length === 0) {
        const unp = remainingItems.shift();
        if (unp) {
           plan.unpackedItems.push({ item: unp, missingCount: unp.quantity, reason: 'Maße/Gewicht überschreiten alle Grenzen dieses Containers.' });
        }
        currentItems = remainingItems;
        continue;
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
        plan.unpackedItems.push({ item, missingCount: item.quantity, reason: 'Abbruch: Max. Containeranzahl erreicht.' });
     }
  }

  return plan;
}
