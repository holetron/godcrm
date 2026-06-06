/**
 * Data / Table Tool Handlers
 *
 * Handles: get_workspace_info, query_table_data, get_table_schema,
 *          create_table, get_table_row, add_table_row, list_tables,
 *          analyze_table_data
 */

import { dbGet, dbRun, dbAll, isPostgres, sqlNow } from '../../database/connection.js';
import { generateBaseId } from '../../utils/baseId.js';
import { resolveSelectValues, validateAllColumns } from '../SelectValueResolver.js';
import { applyAtomVersioning, isAtomsV2Table } from '../atoms-archive.js';
import { coerceDataObject } from './coerceDataInput.js';

/**
 * Safe parse data - handles both PostgreSQL (object) and SQLite (string)
 */
export function parseRowData(data) {
  if (data === null || data === undefined) return {};
  if (typeof data === 'object') return data; // PostgreSQL JSONB
  try {
    return JSON.parse(data); // SQLite string
  } catch {
    return {};
  }
}

/**
 * Data tool handlers
 */
export const dataToolHandlers = {
  // === CONSULTING ===
  async get_workspace_info({ space_id }) {
    const space = await dbGet('SELECT * FROM spaces WHERE id = ?', [space_id]);
    if (!space) {
      return { error: 'Space not found' };
    }

    const projects = await dbAll(`
      SELECT id, name, icon, description
      FROM projects
      WHERE space_id = ?
    `, [space_id]);

    const tables = await dbAll(`
      SELECT ut.id, ut.name, ut.icon, ut.description, p.name as project_name
      FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      WHERE p.space_id = ?
    `, [space_id]);

    return {
      space: { id: space.id, name: space.name, type: space.type, icon: space.icon },
      projects: projects,
      tables: tables,
      summary: {
        project_count: projects.length,
        table_count: tables.length
      }
    };
  },

  async query_table_data({ table_id, limit = 100, search }) {
    const table = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [table_id]);
    if (!table) {
      return { error: 'Table not found' };
    }

    const pg = isPostgres();
    let paramIdx = 1;
    let query = pg
      ? `SELECT id, data, created_at FROM table_rows WHERE table_id = $${paramIdx++}`
      : 'SELECT id, data, created_at FROM table_rows WHERE table_id = ?';
    const params = [table_id];

    if (search) {
      query += pg
        ? ` AND data::text ILIKE $${paramIdx++}`
        : ' AND data LIKE ?';
      params.push(`%${search}%`);
    }

    query += pg
      ? ` ORDER BY created_at DESC LIMIT $${paramIdx++}`
      : ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = await dbAll(query, params);

    return {
      table: { id: table.id, name: table.name },
      rows: rows.map(r => ({ id: r.id, ...parseRowData(r.data), created_at: r.created_at })),
      total: rows.length
    };
  },

  async get_table_schema({ table_id }) {
    const table = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [table_id]);
    if (!table) {
      return { error: 'Table not found' };
    }

    const columns = await dbAll(`
      SELECT id, column_name, display_name, type, config, is_required, order_index
      FROM table_columns
      WHERE table_id = ?
      ORDER BY order_index, id
    `, [table_id]);

    return {
      table: { id: table.id, name: table.name, icon: table.icon },
      columns: columns.map(c => {
        const config = parseRowData(c.config);
        return {
          key: c.column_name,
          name: c.display_name || c.column_name,
          type: c.type,
          icon: config?.icon || null,
          required: c.is_required === 1,
          settings: config || {}
        };
      })
    };
  },

  // === TABLE MANAGEMENT ===
  async create_table({ project_id, name, icon = '📊', columns }, userId) {
    // Create table
    const tableResult = await dbRun(`
      INSERT INTO universal_tables (project_id, name, icon, description, created_at, updated_at)
      VALUES (?, ?, ?, '', datetime('now'), datetime('now'))
    `, [project_id, name, icon]);

    const tableId = tableResult.lastInsertRowid;

    // Create columns
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const config = {
        icon: col.icon || '📝',
        ...(col.settings || {})
      };
      await dbRun(`
        INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, is_required, order_index, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `, [
        tableId,
        col.name.toLowerCase().replace(/\s+/g, '_'),
        col.name,
        col.type || 'text',
        JSON.stringify(config),
        col.width || 150,
        col.required ? 1 : 0,
        i + 1
      ]);
    }

    return {
      success: true,
      table_id: tableId,
      message: `Table "${name}" created with ${columns.length} columns`
    };
  },

  async get_table_row({ table_id, row_id }) {
    const table = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [table_id]);
    if (!table) {
      return { success: false, error: `Table ${table_id} not found` };
    }

    const row = await dbGet(
      'SELECT * FROM table_rows WHERE id = ? AND table_id = ?',
      [row_id, table_id]
    );
    if (!row) {
      return { success: false, error: `Row ${row_id} not found in table ${table_id}` };
    }

    const columns = await dbAll(
      'SELECT id, column_name, display_name, type FROM table_columns WHERE table_id = ? ORDER BY order_index',
      [table_id]
    );

    const parsedData = parseRowData(row.data) || {};

    return {
      success: true,
      row: {
        id: row.id,
        base_id: row.base_id,
        table_id: row.table_id,
        data: parsedData,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at
      },
      columns: columns.map(c => ({
        id: c.id,
        key: c.column_name,
        name: c.display_name || c.column_name,
        type: c.type
      }))
    };
  },

  async add_table_row({ table_id, data }, userId) {
    try { data = coerceDataObject(data, 'data'); }
    catch (e) { return { error: e.message }; }
    if (!data) return { error: 'data is required' };

    const { resolvedData, errors, rejections } = await resolveSelectValues(table_id, data);
    if (errors.length > 0) {
      return {
        error: 'Invalid select values — see rejected_fields for details',
        rejected_fields: rejections,
        hint: 'Use one of the valid_options listed for each rejected field'
      };
    }

    // Validate non-select column types (number, email, url, phone, date, datetime, checkbox)
    const colValidation = await validateAllColumns(table_id, resolvedData);
    if (colValidation.errors.length > 0) {
      return {
        error: 'Invalid column values — see rejected_fields for details',
        rejected_fields: colValidation.rejections,
        hint: 'Fix the values to match the expected type/format for each rejected field'
      };
    }

    const base_id = generateBaseId();
    const result = await dbRun(`
      INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [table_id, base_id, JSON.stringify(resolvedData), userId || 1]);

    return {
      success: true,
      row_id: result.lastInsertRowid,
      message: 'Row added successfully'
    };
  },

  async list_tables({ project_id, space_id }) {
    let tables;

    if (project_id) {
      // Filter by project
      tables = await dbAll(`
        SELECT id, name, icon, description,
          (SELECT COUNT(*) FROM table_rows WHERE table_id = ut.id) as row_count
        FROM universal_tables ut
        WHERE project_id = ?
      `, [project_id]);
    } else if (space_id) {
      // Get all tables in space (grouped by project)
      tables = await dbAll(`
        SELECT ut.id, ut.name, ut.icon, ut.description, p.name as project_name, p.id as project_id,
          (SELECT COUNT(*) FROM table_rows WHERE table_id = ut.id) as row_count
        FROM universal_tables ut
        JOIN projects p ON ut.project_id = p.id
        WHERE p.space_id = ?
        ORDER BY p.name, ut.name
      `, [space_id]);
    } else {
      return { error: 'Either project_id or space_id is required', tables: [] };
    }

    return { tables };
  },

  // === UPDATE / DELETE (ADR-144 P0) ===
  async update_table_row({ table_id, row_id, data }, userId) {
    try { data = coerceDataObject(data, 'data'); }
    catch (e) { return { error: e.message }; }
    if (!data) return { error: 'data is required' };

    const row = await dbGet('SELECT * FROM table_rows WHERE id = ? AND table_id = ?', [row_id, table_id]);
    if (!row) return { error: `Row ${row_id} not found in table ${table_id}` };

    const { resolvedData, errors, rejections } = await resolveSelectValues(table_id, data);
    if (errors.length > 0) {
      return {
        error: 'Invalid select values — see rejected_fields for details',
        rejected_fields: rejections,
        hint: 'Use one of the valid_options listed for each rejected field'
      };
    }

    // Validate non-select column types
    const colValidation = await validateAllColumns(table_id, resolvedData);
    if (colValidation.errors.length > 0) {
      return {
        error: 'Invalid column values — see rejected_fields for details',
        rejected_fields: colValidation.rejections,
        hint: 'Fix the values to match the expected type/format for each rejected field'
      };
    }

    const existing = parseRowData(row.data);
    let merged = { ...existing, ...resolvedData };

    // ADR-0001 Wave 1: atoms_v2 versioning hook
    if (isAtomsV2Table(table_id)) {
      try {
        merged = await applyAtomVersioning({
          table_id,
          row_id,
          newData: merged,
          oldRow: { id: row_id, data: existing },
          changedByUser: userId || null,
          changeReason: data?.change_reason || null,
        });
      } catch (hookErr) {
        console.warn('[atoms_v2 hook] update_table_row failed:', hookErr.message);
      }
    }

    await dbRun(
      `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ? AND table_id = ?`,
      [JSON.stringify(merged), row_id, table_id]
    );

    return { success: true, row_id, message: 'Row updated', data: merged };
  },

  async delete_table_row({ table_id, row_id }) {
    const row = await dbGet('SELECT id FROM table_rows WHERE id = ? AND table_id = ?', [row_id, table_id]);
    if (!row) return { error: `Row ${row_id} not found in table ${table_id}` };

    await dbRun('DELETE FROM table_rows WHERE id = ? AND table_id = ?', [row_id, table_id]);
    return { success: true, message: `Row ${row_id} deleted` };
  },

  async batch_update_rows({ table_id, updates }, userId) {
    if (!updates || updates.length === 0) return { error: 'No updates provided' };
    if (updates.length > 100) return { error: 'Max 100 rows per batch' };

    const table = await dbGet('SELECT id FROM universal_tables WHERE id = ?', [table_id]);
    if (!table) return { error: `Table ${table_id} not found` };

    const results = { success: [], failed: [] };
    for (const upd of updates) {
      const { row_id } = upd;
      let { data } = upd;
      try {
        try { data = coerceDataObject(data, `updates[].data (row_id=${row_id})`); }
        catch (e) { results.failed.push({ row_id, error: e.message }); continue; }
        if (!data) { results.failed.push({ row_id, error: 'data is required' }); continue; }

        const row = await dbGet('SELECT data FROM table_rows WHERE id = ? AND table_id = ?', [row_id, table_id]);
        if (!row) { results.failed.push({ row_id, error: 'Not found' }); continue; }
        const { resolvedData, errors, rejections } = await resolveSelectValues(table_id, data);
        if (errors.length > 0) {
          results.failed.push({ row_id, error: 'Invalid select values', rejected_fields: rejections });
          continue;
        }
        // Validate non-select column types
        const colValidation = await validateAllColumns(table_id, resolvedData);
        if (colValidation.errors.length > 0) {
          results.failed.push({ row_id, error: 'Invalid column values', rejected_fields: colValidation.rejections });
          continue;
        }
        const oldData = parseRowData(row.data);
        let merged = { ...oldData, ...resolvedData };
        // ADR-0001 Wave 1: atoms_v2 versioning hook (per-row in batch)
        if (isAtomsV2Table(table_id)) {
          try {
            merged = await applyAtomVersioning({
              table_id,
              row_id,
              newData: merged,
              oldRow: { id: row_id, data: oldData },
              changedByUser: userId || null,
              changeReason: data?.change_reason || null,
            });
          } catch (hookErr) {
            console.warn('[atoms_v2 hook] batch_update_rows failed:', hookErr.message);
          }
        }
        await dbRun(
          `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ? AND table_id = ?`,
          [JSON.stringify(merged), row_id, table_id]
        );
        results.success.push(row_id);
      } catch (err) {
        results.failed.push({ row_id, error: err.message });
      }
    }
    return { ...results, message: `${results.success.length} updated, ${results.failed.length} failed` };
  },

  async batch_delete_rows({ table_id, row_ids }) {
    if (!row_ids || row_ids.length === 0) return { error: 'No row_ids provided' };
    if (row_ids.length > 100) return { error: 'Max 100 rows per batch' };

    const table = await dbGet('SELECT id FROM universal_tables WHERE id = ?', [table_id]);
    if (!table) return { error: `Table ${table_id} not found` };

    const results = { success: [], failed: [] };
    for (const row_id of row_ids) {
      try {
        const row = await dbGet('SELECT id FROM table_rows WHERE id = ? AND table_id = ?', [row_id, table_id]);
        if (!row) { results.failed.push({ row_id, error: 'Not found' }); continue; }
        await dbRun('DELETE FROM table_rows WHERE id = ? AND table_id = ?', [row_id, table_id]);
        results.success.push(row_id);
      } catch (err) {
        results.failed.push({ row_id, error: err.message });
      }
    }
    return { ...results, message: `${results.success.length} deleted, ${results.failed.length} failed` };
  },

  async delete_table({ table_id }) {
    const table = await dbGet('SELECT id, name FROM universal_tables WHERE id = ?', [table_id]);
    if (!table) return { error: `Table ${table_id} not found` };

    await dbRun('DELETE FROM table_rows WHERE table_id = ?', [table_id]);
    await dbRun('DELETE FROM table_columns WHERE table_id = ?', [table_id]);
    await dbRun('DELETE FROM universal_tables WHERE id = ?', [table_id]);
    return { success: true, message: `Table "${table.name}" (${table_id}) deleted with all rows and columns` };
  },

  // === ANALYSIS ===
  async analyze_table_data({ table_id, analysis_type, columns = [] }) {
    const { rows } = await dataToolHandlers.query_table_data({ table_id, limit: 1000 });

    if (rows.length === 0) {
      return { error: 'No data to analyze' };
    }

    const result = {
      table_id,
      analysis_type,
      row_count: rows.length,
      analysis: {}
    };

    switch (analysis_type) {
      case 'summary': {
        // Basic stats for each column
        const allColumns = columns.length > 0 ? columns : Object.keys(rows[0]).filter(k => k !== 'id' && k !== 'created_at');
        result.analysis.columns = {};

        for (const col of allColumns) {
          const values = rows.map(r => r[col]).filter(v => v !== null && v !== undefined);
          const numericValues = values.filter(v => !isNaN(Number(v))).map(Number);

          result.analysis.columns[col] = {
            total_values: values.length,
            unique_values: [...new Set(values)].length,
            empty_count: rows.length - values.length
          };

          if (numericValues.length > 0) {
            const sum = numericValues.reduce((a, b) => a + b, 0);
            result.analysis.columns[col].numeric_stats = {
              min: Math.min(...numericValues),
              max: Math.max(...numericValues),
              avg: sum / numericValues.length,
              sum
            };
          }
        }
        break;
      }

      case 'distribution': {
        // Value distribution for categorical columns
        const distColumns = columns.length > 0 ? columns : Object.keys(rows[0]).slice(0, 5);
        result.analysis.distributions = {};

        for (const col of distColumns) {
          const counts = {};
          rows.forEach(r => {
            const val = String(r[col] || 'Empty');
            counts[val] = (counts[val] || 0) + 1;
          });
          result.analysis.distributions[col] = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([value, count]) => ({ value, count, percentage: ((count / rows.length) * 100).toFixed(1) + '%' }));
        }
        break;
      }

      default:
        result.analysis.message = `Analysis type "${analysis_type}" provides basic statistics`;
    }

    return result;
  }
};
