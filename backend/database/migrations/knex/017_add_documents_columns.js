// backend/database/migrations/knex/017_add_documents_columns.js
// Adds columns for Documents widget v4 (folder_path, table_type, base_id, created_by)

/**
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  // Add documents-related columns to universal_tables
  await knex.schema.alterTable('universal_tables', (table) => {
    table.text('folder_path');         // Path like 'databases/documents/'
    table.string('table_type', 50);    // 'documents_registry' | 'documents_atoms' | null
    table.string('base_id', 50);       // Unique base identifier
    table.integer('created_by').unsigned(); // User who created the table
  });
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.alterTable('universal_tables', (table) => {
    table.dropColumn('folder_path');
    table.dropColumn('table_type');
    table.dropColumn('base_id');
    table.dropColumn('created_by');
  });
}
