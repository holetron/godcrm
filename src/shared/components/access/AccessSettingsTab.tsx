/**
 * AccessSettingsTab - "Доступ" tab content for UserAccessPanel
 * Contains: God badge, hierarchy info, context panel, table/column selectors, role mappings
 */

import React from 'react';
import {
  Crown,
  Settings,
  Edit3,
  Eye,
  Ban,
  Info,
  Database,
  Shield,
  UserPlus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/shared/components/ui';
import type { UserAccessLevel, PermissionEntityType } from '@/shared/types/user-access.types';
import {
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVEL_COLORS,
} from '@/shared/types/user-access.types';
import type { User, SpaceTable, TableColumn, RoleMapping } from './types';
import { getLevelIcon } from './utils';

interface AccessSettingsTabProps {
  entityType: PermissionEntityType;
  entityId: number;
  // Context info
  spaceName?: string;
  projectName?: string;
  tableName?: string;
  columnName?: string;
  // Navigation
  onNavigateToSpace?: () => void;
  onNavigateToProject?: () => void;
  onNavigateToTable?: () => void;
  // Data
  ownerOwnerUser: User | null;
  tablesByProject: Record<string, SpaceTable[]>;
  selectedTableId: number | null;
  tablesData: { tables: SpaceTable[]; default_table_id: number | null } | undefined;
  isLoadingTables: boolean;
  tableColumns: TableColumn[];
  selectedRoleColumnId: string | null;
  roleMappings: RoleMapping[];
  customMappingValue: string;
  customMappingLevel: UserAccessLevel;
  // Actions
  setSelectedTableId: (id: number | null) => void;
  setSelectedRoleColumnId: (id: string | null) => void;
  setRoleMappings: React.Dispatch<React.SetStateAction<RoleMapping[]>>;
  setCustomMappingValue: (val: string) => void;
  setCustomMappingLevel: (level: UserAccessLevel) => void;
  getAvailableLevels: () => { value: UserAccessLevel; label: string }[];
}

export const AccessSettingsTab = ({
  entityType,
  entityId,
  spaceName,
  projectName,
  tableName,
  columnName,
  onNavigateToSpace,
  onNavigateToProject,
  onNavigateToTable,
  ownerOwnerUser,
  tablesByProject,
  selectedTableId,
  tablesData,
  isLoadingTables,
  tableColumns,
  selectedRoleColumnId,
  roleMappings,
  customMappingValue,
  customMappingLevel,
  setSelectedTableId,
  setSelectedRoleColumnId,
  setRoleMappings,
  setCustomMappingValue,
  setCustomMappingLevel,
  getAvailableLevels,
}: AccessSettingsTabProps) => {
  return (
    <div className="space-y-4">
      {/* God badge - creator with full access */}
      {ownerOwnerUser && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary-500/10 border border-primary-500/30 text-sm">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
              <span className="text-white font-bold text-xs">G</span>
            </div>
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-primary-400 rounded-full flex items-center justify-center animate-pulse">
              <Crown className="w-2.5 h-2.5 text-white" />
            </div>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-primary-400 font-bold">God:</span>
              <span className="text-[var(--text-primary)] font-medium">{ownerOwnerUser.email}</span>
              <span className="text-[var(--text-tertiary)] text-xs">(id{ownerOwnerUser.id})</span>
            </div>
            <span className="text-xs text-primary-300/70">Создатель • Полный доступ • Неограничен</span>
          </div>
        </div>
      )}

      {/* Info panel with hierarchy and context - two columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Left: Permission hierarchy */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-primary-500/10 border border-primary-500/30 text-sm text-primary-400">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <strong>Иерархия прав:</strong>
            <div className="mt-2 space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <Crown className="w-3 h-3 text-yellow-400" />
                <span className="w-16 text-[var(--text-tertiary)]">Owner:</span>
                <span>Полный доступ (нельзя ограничить)</span>
              </div>
              <div className="flex items-center gap-2">
                <Settings className="w-3 h-3 text-purple-400" />
                <span className="w-16 text-[var(--text-tertiary)]">Admin:</span>
                <span>Настройки + редактирование</span>
              </div>
              <div className="flex items-center gap-2">
                <Edit3 className="w-3 h-3 text-primary-400" />
                <span className="w-16 text-[var(--text-tertiary)]">Editor:</span>
                <span>Только редактирование</span>
              </div>
              <div className="flex items-center gap-2">
                <Eye className="w-3 h-3 text-green-400" />
                <span className="w-16 text-[var(--text-tertiary)]">Viewer:</span>
                <span>Только просмотр</span>
              </div>
              <div className="flex items-center gap-2">
                <Ban className="w-3 h-3 text-red-400" />
                <span className="w-16 text-[var(--text-tertiary)]">Denied:</span>
                <span>Нет доступа (скрыт)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Current context and navigation */}
        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-[var(--accent-primary)]" />
            <span className="text-sm font-medium text-[var(--text-primary)]">Контекст</span>
          </div>

          {/* What we're editing */}
          <div className="text-xs space-y-2">
            <div className="flex items-center gap-2 p-2 rounded bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/30">
              <span className="text-[var(--accent-primary)] font-medium">
                {entityType === 'space' && '🌐 Доступ к пространству'}
                {entityType === 'project' && '📁 Доступ к проекту'}
                {entityType === 'table' && '📋 Доступ к таблице'}
                {entityType === 'column' && '📊 Доступ к колонке'}
              </span>
            </div>

            {/* Breadcrumb path */}
            <div className="space-y-1.5 text-[var(--text-tertiary)]">
              {spaceName && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider opacity-60">Пространство:</span>
                  {onNavigateToSpace && entityType !== 'space' ? (
                    <button
                      onClick={onNavigateToSpace}
                      className="text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:underline transition-colors"
                    >
                      🌐 {spaceName}
                    </button>
                  ) : (
                    <span className="text-[var(--text-secondary)]">🌐 {spaceName}</span>
                  )}
                </div>
              )}

              {projectName && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider opacity-60">Проект:</span>
                  {onNavigateToProject && entityType !== 'project' ? (
                    <button
                      onClick={onNavigateToProject}
                      className="text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:underline transition-colors"
                    >
                      📁 {projectName}
                    </button>
                  ) : (
                    <span className="text-[var(--text-secondary)]">📁 {projectName}</span>
                  )}
                </div>
              )}

              {tableName && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider opacity-60">Таблица:</span>
                  {onNavigateToTable && entityType !== 'table' ? (
                    <button
                      onClick={onNavigateToTable}
                      className="text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:underline transition-colors"
                    >
                      📋 {tableName}
                    </button>
                  ) : (
                    <span className="text-[var(--text-secondary)]">📋 {tableName}</span>
                  )}
                </div>
              )}

              {columnName && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider opacity-60">Колонка:</span>
                  <span className="text-[var(--text-primary)] font-medium">📊 {columnName}</span>
                </div>
              )}
            </div>

            {/* Inheritance direction */}
            <div className="pt-2 mt-2 border-t border-[var(--border-secondary)]">
              <span className="text-[10px] uppercase tracking-wider opacity-60">Наследование:</span>
              <div className="mt-1 text-[var(--text-secondary)]">
                {entityType === 'column' && '📊 Колонка → 📋 Таблица → 📁 Проект → 🌐 Пространство'}
                {entityType === 'table' && '📋 Таблица → 📁 Проект → 🌐 Пространство'}
                {entityType === 'project' && '📁 Проект → 🌐 Пространство'}
                {entityType === 'space' && '🌐 Пространство (верхний уровень)'}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Users table and Role column - combined in one row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Users table selector */}
        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-[var(--accent-primary)]" />
            <label className="text-sm font-medium text-[var(--text-primary)]">
              Таблица пользователей
            </label>
          </div>
          {isLoadingTables ? (
            <div className="text-sm text-[var(--text-tertiary)]">Загрузка...</div>
          ) : (
            <select
              value={selectedTableId?.toString() || ''}
              onChange={(e) => setSelectedTableId(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full px-3 py-2 text-sm rounded-md border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
            >
              <option value="">— Выберите таблицу —</option>
              {Object.entries(tablesByProject).map(([projName, tables]) => (
                <optgroup key={projName} label={projName}>
                  {tables.map((table) => (
                    <option key={table.id} value={table.id.toString()}>
                      {table.display_name} (ID: {table.id})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          {selectedTableId && tablesData?.default_table_id === selectedTableId && (
            <p className="mt-1 text-xs text-green-400">
              ✓ Таблица "Users" из System Data
            </p>
          )}
        </div>

        {/* Role column selector */}
        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
          <div className="flex items-center gap-2 mb-2">
            <Settings className="w-4 h-4 text-[var(--accent-primary)]" />
            <label className="text-sm font-medium text-[var(--text-primary)]">
              Колонка ролей
            </label>
          </div>
          {selectedTableId && tableColumns.length > 0 ? (
            <>
              <select
                value={selectedRoleColumnId || ''}
                onChange={(e) => setSelectedRoleColumnId(e.target.value || null)}
                className="w-full px-3 py-2 text-sm rounded-md border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
              >
                <option value="">— Не выбрано —</option>
                {tableColumns.map((col: TableColumn) => (
                  <option key={col.id} value={col.id}>
                    {col.display_name || col.name} ({col.column_type || col.type})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                Колонка с ролями: owner, admin, editor, viewer
              </p>
            </>
          ) : (
            <div className="text-sm text-[var(--text-tertiary)] py-2">
              {selectedTableId ? 'Загрузка колонок...' : 'Сначала выберите таблицу'}
            </div>
          )}
        </div>
      </div>

      {/* Role mappings */}
      {selectedRoleColumnId && (
        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-[var(--accent-primary)]" />
            <label className="text-sm font-medium text-[var(--text-primary)]">
              Маппинг ролей
            </label>
          </div>

          {/* Current mappings */}
          <div className="space-y-2 mb-3">
            {roleMappings.map((mapping, index) => (
              <div
                key={index}
                className="flex items-center gap-2 p-2 rounded-md bg-[var(--bg-primary)]"
              >
                <code className="flex-1 px-2 py-1 text-sm bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]">
                  "{mapping.columnValue}"
                </code>
                <span className="text-[var(--text-tertiary)]">→</span>
                <div
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm"
                  style={{
                    backgroundColor: `${ACCESS_LEVEL_COLORS[mapping.accessLevel]}20`,
                    color: ACCESS_LEVEL_COLORS[mapping.accessLevel]
                  }}
                >
                  {getLevelIcon(mapping.accessLevel)}
                  <span>{ACCESS_LEVEL_LABELS[mapping.accessLevel]}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRoleMappings(prev => prev.filter((_, i) => i !== index));
                  }}
                  className="p-1 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add new mapping */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs text-[var(--text-tertiary)] mb-1">Column value</label>
              <input
                type="text"
                value={customMappingValue}
                onChange={(e) => setCustomMappingValue(e.target.value)}
                placeholder="e.g.: manager"
                className="w-full px-2 py-1.5 text-sm rounded-md border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-[var(--text-tertiary)] mb-1">Access level</label>
              <select
                value={customMappingLevel}
                onChange={(e) => setCustomMappingLevel(e.target.value as UserAccessLevel)}
                className="w-full px-2 py-1.5 text-sm rounded-md border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
              >
                {getAvailableLevels().map(level => (
                  <option key={level.value} value={level.value}>{level.label}</option>
                ))}
              </select>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (customMappingValue.trim()) {
                  setRoleMappings(prev => [
                    ...prev.filter(m => m.columnValue !== customMappingValue.trim()),
                    { columnValue: customMappingValue.trim(), accessLevel: customMappingLevel }
                  ]);
                  setCustomMappingValue('');
                }
              }}
              disabled={!customMappingValue.trim()}
            >
              <UserPlus className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
