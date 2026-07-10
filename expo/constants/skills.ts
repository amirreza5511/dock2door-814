/**
 * Skills catalog — the single source of truth for the trades/roles a worker can
 * list and an employer can require. The `id` values MUST match the Postgres
 * `shift_category` enum labels (see migration 0130). Display labels and grouping
 * live here so the same list drives worker profiles, job posting, browsing,
 * filtering and matching everywhere in the app.
 */
import type { ShiftCategory } from '@/constants/types';

export interface SkillDef {
  id: ShiftCategory;
  label: string;
}

export interface SkillGroup {
  key: string;
  title: string;
  skills: SkillDef[];
}

export const SKILL_GROUPS: SkillGroup[] = [
  {
    key: 'warehouse',
    title: 'Warehouse & Logistics',
    skills: [
      { id: 'General', label: 'General Labour' },
      { id: 'Forklift', label: 'Forklift' },
      { id: 'HighReach', label: 'High Reach / Order Picker' },
      { id: 'Driver', label: 'Driver' },
      { id: 'Loader', label: 'Loader / Unloader' },
      { id: 'Inventory', label: 'Inventory / Cycle Count' },
    ],
  },
  {
    key: 'construction',
    title: 'Construction & Trades',
    skills: [
      { id: 'Electrical', label: 'Electrical' },
      { id: 'Plumbing', label: 'Plumbing' },
      { id: 'Painting', label: 'Painting' },
      { id: 'Carpentry', label: 'Carpentry' },
      { id: 'Drywall', label: 'Drywall' },
      { id: 'Welding', label: 'Welding' },
      { id: 'HVAC', label: 'HVAC' },
      { id: 'Roofing', label: 'Roofing' },
      { id: 'Construction', label: 'General Construction' },
      { id: 'Landscaping', label: 'Landscaping' },
    ],
  },
  {
    key: 'facilities',
    title: 'Facilities & Cleaning',
    skills: [
      { id: 'Janitorial', label: 'Janitorial' },
      { id: 'IndustrialCleaning', label: 'Industrial Cleaning' },
      { id: 'Groundskeeping', label: 'Groundskeeping' },
    ],
  },
  {
    key: 'hospitality',
    title: 'Hospitality & Retail',
    skills: [
      { id: 'Server', label: 'Server' },
      { id: 'Barista', label: 'Barista' },
      { id: 'Kitchen', label: 'Kitchen / Prep' },
      { id: 'Cashier', label: 'Cashier' },
      { id: 'Stocker', label: 'Stocker' },
      { id: 'EventStaff', label: 'Event Staff' },
    ],
  },
  {
    key: 'media',
    title: 'Media & Production',
    skills: [
      { id: 'FilmCrew', label: 'Film Crew' },
      { id: 'Grip', label: 'Grip' },
      { id: 'CameraAssistant', label: 'Camera Assistant' },
      { id: 'ProductionAssistant', label: 'Production Assistant' },
      { id: 'Lighting', label: 'Lighting' },
    ],
  },
  {
    key: 'health',
    title: 'Health & Care',
    skills: [
      { id: 'PharmacyWorker', label: 'Pharmacy Worker' },
      { id: 'CareAide', label: 'Care Aide' },
      { id: 'MedicalAssistant', label: 'Medical Assistant' },
      { id: 'CleaningTech', label: 'Cleaning Tech' },
    ],
  },
  {
    key: 'office',
    title: 'Office & Other',
    skills: [
      { id: 'Reception', label: 'Reception' },
      { id: 'DataEntry', label: 'Data Entry' },
      { id: 'Security', label: 'Security' },
      { id: 'Flagger', label: 'Flagger / Traffic Control' },
    ],
  },
];

/** Flat list of every skill definition. */
export const ALL_SKILLS: SkillDef[] = SKILL_GROUPS.flatMap((g) => g.skills);

/** Every valid skill id. */
export const ALL_SKILL_IDS: ShiftCategory[] = ALL_SKILLS.map((s) => s.id);

const LABEL_BY_ID: Record<string, string> = ALL_SKILLS.reduce((acc, s) => {
  acc[s.id] = s.label;
  return acc;
}, {} as Record<string, string>);

/** Human label for a skill id. Falls back to the raw id if unknown. */
export function skillLabel(id: string | null | undefined): string {
  if (!id) return '';
  return LABEL_BY_ID[id] ?? id;
}

/** Map a list of skill ids to their labels. */
export function skillLabels(ids: readonly string[] | null | undefined): string[] {
  return (ids ?? []).map(skillLabel);
}
