// backend/database/migrations/knex/007_create_table_rows.js
// Table Rows: Dynamic data storage with JSON
export async function up(knex) {
  await knex.schema.createTable('table_rows', (table) => {
    table.increments('id').primary();
    table.integer('table_id').unsigned().notNullable()
      .references('id').inTable('universal_tables').onDelete('CASCADE');
    table.string('base_id', 255).unique().notNullable();
    table.text('data').notNullable(); // JSON data
    table.integer('created_by').unsigned()
      .references('id').inTable('users').onDelete('SET NULL');
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Indexes
    table.index('table_id');
    table.index('base_id');
    table.index('created_by');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('table_rows');
}
