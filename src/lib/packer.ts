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
  if (containerSelection !== 'auto') {
    const specified = CONTAINERS.find(c => c.id === containerSelection);
    if (specified) return specified;
  }

  const needsCraning = items.some(i => i.needsCraning);
  const needsHC = items.some(i => i.height > 2390 || (!i.rotatable && i.width > 2390 && i.length > 2390));

  if (needsCraning) {
     return CONTAINERS.find(c => c.id === '40ft-ot') || CONTAINERS.find(c => c.isOpenTop) || CONTAINERS[0];
  }
  if (needsHC) {
     return CONTAINERS.find(c => c.id === '40ft-hc') || CONTAINERS[0];
  }
  
  let totalVol = 0;
  let totalWeight = 0;
  for (const item of items) {
    totalVol += item.length * item.width * item.height * item.quantity;
    totalWeight += item.weight * item.quantity;
  }

  const c20 = CONTAINERS.find(c => c.id === '20ft')!;
  const c40 = CONTAINERS.find(c => c.id === '40ft')!;

  if (totalVol <= c20.length * c20.width * c20.height * 0.85 && totalWeight <= c20.maxPayload) {
     return c20;
  }
  return c40;
}

function packIntoContainer3D(items: PacklistItem[], container: ContainerType) {
   let usedVolume = 0;
   let usedWeight = 0;
   const packedItems: PackedItemInfo[] = [];
   const remainingItems: PacklistItem[] = [];
   let loadingCounter = 0;
   
   // Expand distinct items to a sequence of individual items (1 per quantity)
   const itemsToPack: PacklistItem[] = [];
   for (const i of items) {
       for(let n=0; n < i.quantity; n++) {
           itemsToPack.push({...i, quantity: 1});
       }
   }

   // Shelf packing state
   let currentX = 0; // Width axis (door left -> right)
   let currentY = 0; // Height axis (floor -> ceiling)
   let currentZ = 0; // Length axis (doors -> front wall)
   let rowMaxX = 0;  // Max width of items in current Z-row
   let shelfMaxY = 0; // Max height of items on the current Y-shelf

   // Sort: Priority -> Height (for shelf alignment) -> Volume
   itemsToPack.sort((a,b) => {
      const pWeight = { hoch: 3, normal: 2, niedrig: 1 };
      if (pWeight[a.priority] !== pWeight[b.priority]) {
         return pWeight[b.priority] - pWeight[a.priority];
      }
      if (b.height !== a.height) return b.height - a.height;
      return (b.length * b.width) - (a.length * a.width);
   });

   for (const item of itemsToPack) {
       if (usedWeight + item.weight > container.maxPayload) {
          remainingItems.push(item);
          continue;
       }

       let l = item.length;
       let w = item.width;
       const h = item.height;
       
       if (item.rotatable && currentZ + l > container.length && currentZ + w <= container.length) {
           l = item.width;
           w = item.length;
       }

       if (item.needsCraning && !container.isOpenTop) {
           remainingItems.push(item);
           continue;
       }

       // Step 1: Does it fit in the current Z row?
       if (currentZ + l > container.length) {
           currentX += rowMaxX;
           currentZ = 0;
           rowMaxX = 0;
       }

       // Step 2: Does it fit on the current X row (Shelf depth)?
       if (currentX + w > container.width) {
           currentY += shelfMaxY;
           currentX = 0;
           currentZ = 0;
           rowMaxX = 0;
           shelfMaxY = 0;
       }

       // Step 3: Does it fit in the Container completely (Y)?
       if (currentY + h > container.height || currentX + w > container.width || currentZ + l > container.length) {
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

       currentZ += l;
       if (w > rowMaxX) rowMaxX = w;
       if (h > shelfMaxY) shelfMaxY = h;
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
