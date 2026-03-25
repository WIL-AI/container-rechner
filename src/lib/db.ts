import { createClient } from '@supabase/supabase-js';
import type { PacklistItem } from './packer';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export interface Project {
  id: string;
  name: string;
  updatedAt: number;
  containerSelection: string;
  packlist: PacklistItem[];
}

export async function getProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from('container_projects').select('*');
  if (error) {
    console.error('getProjects error:', error);
    return [];
  }
  return data || [];
}

export async function saveProject(project: Project): Promise<void> {
  const { error } = await supabase
    .from('container_projects')
    .upsert({
      id: project.id,
      name: project.name,
      updatedAt: Date.now(),
      containerSelection: project.containerSelection,
      packlist: project.packlist
    });
  
  if (error) console.error('saveProject error:', error);
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('container_projects').delete().eq('id', id);
  if (error) console.error('deleteProject error:', error);
}
