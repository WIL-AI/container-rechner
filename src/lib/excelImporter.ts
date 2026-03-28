import * as XLSX from 'xlsx';
import type { PacklistItem, PackagingType } from './packer';

// Ensure the valid types for parsing
const VALID_PACKAGING_TYPES = ['Europalette', 'Einwegpalette', 'Kiste', 'Verschlag', 'Karton', 'Fass', 'Rollen', 'Unverpackt', 'Sonstige', 'Karton auf Palette', 'Euro-Gitterbox'];

export async function parseExcelFile(file: File): Promise<PacklistItem[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Output format: Array of Arrays, header starting from 1 means it returns raw rows.
        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        const importedItems: PacklistItem[] = [];
        
        // Skip header row (index 0)
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          
          // Column 1 (index 0): Menge
          const quantity = Number(row[0]) || 1;
          
          // Column 2 (index 1): Inhalt / Bezeichnung
          const contentDesc = String(row[1] || 'Importiertes Stück').trim();
          
          // Column 3 (index 2): Länge
          const rawLen = String(row[2] || '0').replace(',', '.');
          const length = Math.round((Number(rawLen) || 0) * 10);
          
          // Column 4 (index 3): Breite
          const rawWid = String(row[3] || '0').replace(',', '.');
          const width = Math.round((Number(rawWid) || 0) * 10);
          
          // Column 5 (index 4): Höhe
          const rawHei = String(row[4] || '0').replace(',', '.');
          const height = Math.round((Number(rawHei) || 0) * 10);
          
          // Column 6 (index 5): Verpackung
          const rawPackaging = String(row[5] || '').trim();
          let packaging: PackagingType = 'Karton'; // Default
          
          if (VALID_PACKAGING_TYPES.includes(rawPackaging)) {
            packaging = rawPackaging as PackagingType;
          } else if (rawPackaging) {
            // Check if there is a match ignoring case
            const matched = VALID_PACKAGING_TYPES.find(vp => vp.toLowerCase() === rawPackaging.toLowerCase());
            if (matched) packaging = matched as PackagingType;
            else packaging = 'Sonstige';
          }
          
          // Column 7 (index 6): Gewicht
          const weight = Number(row[6]) || 0;
          
          // Skip invalid items (at least dimensions and weight should exist to be fully valid, but we allow 0 and user edits them later if needed, or we skip if ALL dims are 0)
          if (length === 0 && width === 0 && height === 0 && weight === 0) continue;

          importedItems.push({
            id: `import-${Date.now()}-${i}`,
            quantity,
            contentDesc,
            length,
            width,
            height,
            packaging,
            weight,
            priority: 'normal',
            rotatable: false,
            stackableBottom: false,
            stackableTop: false,
            needsCraning: false,
            color: '#3b82f6',
            label: '',
            partialDeliveryId: ''
          });
        }
        
        resolve(importedItems);
      } catch (err) {
        console.error('Error parsing excel:', err);
        reject(err);
      }
    };

    reader.onerror = (err) => {
      reject(err);
    };

    reader.readAsArrayBuffer(file);
  });
}
