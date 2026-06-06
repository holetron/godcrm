/**
 * Widget Presets Configuration - Single Source of Truth
 * 
 * Uses shared widget-presets.json as base data.
 * Adds Lucide icons for React components.
 * 
 * To add a new widget:
 * 1. Edit /shared/widget-presets.json
 * 2. Add icon mapping in ICON_MAP below
 * 3. Both frontend and backend will use the new preset
 */

import {
  Table2, LayoutGrid, Calendar, GitBranch, BarChart3,
  ListTodo, Activity, Database, Bot, FileText, Link2,
  TrendingUp, Image, Hash, HeartPulse, Beaker, Building2, Coins, Gamepad2, Home, LucideIcon
} from 'lucide-react';

// Import JSON data (Vite handles JSON imports)
import presetsData from '../../../../shared/widget-presets.json';

// ============ ICON MAPPING ============

/** Map preset ID to Lucide icon component */
const ICON_MAP: Record<string, LucideIcon> = {
  table_view: Table2,
  kanban_board: LayoutGrid,
  calendar_widget: Calendar,
  timeline_widget: GitBranch,
  gallery_widget: Image,
  chart_widget: BarChart3,
  number_widget: Hash,
  project_stats: TrendingUp,
  task_list: ListTodo,
  recent_activity: Activity,
  quick_links: Link2,
  ai_agents: Bot,
  data_sources: Database,
  documents: FileText,
  wellness: HeartPulse,
  labs: Beaker,
  virtual_office: Building2,
  token_usage: Coins,
  '16neo': Gamepad2,
  welcome_dashboard: Home,
};

// ============ TYPES ============

export interface WidgetTableColumn {
  /** Config key (e.g., 'titleColumn') */
  key: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Allowed column types */
  types: string[];
  /** Is this column required? */
  required: boolean;
}

export interface WidgetDefaultColumn {
  name: string;
  displayName: string;
  type: string;
  required: boolean;
  options?: string[];
}

export interface WidgetTableRequirement {
  /** Unique key for this table in widget config (e.g., 'documents', 'atoms') */
  key: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Is this table required? */
  required: boolean;
  /** Can user create a new table for this? */
  canCreate: boolean;
  /** Default name for auto-created table */
  defaultTableName?: string;
  /** Default columns for auto-created table */
  defaultColumns?: WidgetDefaultColumn[];
  /** Required column mappings */
  requiredColumns: WidgetTableColumn[];
}

export interface WidgetPresetConfig {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  emoji: string;
  color: string;
  category: 'display' | 'productivity' | 'analytics' | 'system' | 'documents';
  defaultSize: { w: number; h: number };
  deprecated?: boolean;
  /** Tables required by this widget */
  tables: WidgetTableRequirement[];
  /** Auto-initialize resource on widget creation (e.g., Labs) */
  autoInit?: boolean;
  /** API endpoint for auto-initialization */
  initEndpoint?: string;
}

// ============ BUILD PRESETS FROM JSON ============

type JsonPresetData = typeof presetsData;
type JsonPreset = JsonPresetData[keyof JsonPresetData];

function buildPresets(): Record<string, WidgetPresetConfig> {
  const result: Record<string, WidgetPresetConfig> = {};
  
  for (const [id, data] of Object.entries(presetsData) as [string, JsonPreset][]) {
    const preset: WidgetPresetConfig = {
      id: data.id,
      name: data.name,
      description: data.description,
      icon: ICON_MAP[id] || Database,
      emoji: data.emoji,
      color: data.color,
      category: data.category as WidgetPresetConfig['category'],
      defaultSize: data.defaultSize,
      deprecated: data.deprecated,
      tables: (data.tables || []) as WidgetTableRequirement[],
    };
    
    // Add autoInit properties if present in JSON
    if ('autoInit' in data) {
      preset.autoInit = (data as { autoInit?: boolean }).autoInit;
    }
    if ('initEndpoint' in data) {
      preset.initEndpoint = (data as { initEndpoint?: string }).initEndpoint;
    }
    
    result[id] = preset;
  }
  
  return result;
}

export const WIDGET_PRESETS = buildPresets();

// ============ DERIVED DATA ============

/** All preset IDs */
export type PresetWidgetName = keyof typeof WIDGET_PRESETS;

/** Array of all preset IDs */
export const PRESET_IDS = Object.keys(WIDGET_PRESETS) as PresetWidgetName[];

/** Active (non-deprecated) presets for widget creation */
export const ACTIVE_PRESETS = Object.values(WIDGET_PRESETS).filter(p => !p.deprecated);

/** Presets grouped by category */
export const PRESETS_BY_CATEGORY = ACTIVE_PRESETS.reduce((acc, preset) => {
  if (!acc[preset.category]) acc[preset.category] = [];
  acc[preset.category].push(preset);
  return acc;
}, {} as Record<string, WidgetPresetConfig[]>);

/** Lookup table: preset ID → icon component */
export const PRESET_ICONS: Record<string, LucideIcon> = Object.fromEntries(
  Object.entries(WIDGET_PRESETS).map(([id, config]) => [id, config.icon])
);

/** Lookup table: preset ID → color */
export const PRESET_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(WIDGET_PRESETS).map(([id, config]) => [id, config.color])
);

/** Lookup table: preset ID → emoji */
export const PRESET_EMOJIS: Record<string, string> = Object.fromEntries(
  Object.entries(WIDGET_PRESETS).map(([id, config]) => [id, config.emoji])
);

/** Check if preset requires any tables */
export function presetRequiresTable(presetId: string): boolean {
  const tables = WIDGET_PRESETS[presetId]?.tables || [];
  return tables.some(t => t.required);
}

/** Get preset config by ID */
export function getPresetConfig(presetId: string): WidgetPresetConfig | undefined {
  return WIDGET_PRESETS[presetId];
}

/** Get required tables for preset */
export function getPresetTables(presetId: string): WidgetTableRequirement[] {
  return WIDGET_PRESETS[presetId]?.tables || [];
}

/** Get default emoji for preset */
export function getPresetEmoji(presetId: string): string {
  return WIDGET_PRESETS[presetId]?.emoji ?? '📦';
}

/** Check if preset has autoInit enabled */
export function hasAutoInit(presetId: string): boolean {
  return WIDGET_PRESETS[presetId]?.autoInit === true;
}

/** Get autoInit endpoint for preset */
export function getAutoInitEndpoint(presetId: string): string | undefined {
  return WIDGET_PRESETS[presetId]?.initEndpoint;
}

// Legacy compatibility - flat required columns (first table only)
export const PRESET_REQUIRED_COLUMNS: Record<string, WidgetTableColumn[]> = Object.fromEntries(
  Object.entries(WIDGET_PRESETS).map(([id, config]) => [
    id, 
    config.tables[0]?.requiredColumns || []
  ])
);
