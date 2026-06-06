# ADR-0009 Phase 3 execution report

- Timestamp: 2026-04-28T07:19:12.719Z
- Target: prod
- Mode: ROLLBACK (dry-transaction)
- DB: localhost/godcrm_prod

## Delete counts per table
| Table | rowCount |
|---|---:|
| agent_jobs | 0 |
| terminal_commands | 0 |
| terminal_sessions | 0 |
| tool_approval_rules | 0 |
| wa_auth_tokens | 0 |
| wa_presence | 2 |
| table_rows | 648 |
| universal_tables | 1675 |
| projects | 2341 |
| calendar_events | 0 |
| modules | 108 |
| widget_library | 552 |
| fitness_workouts | 10 |
| fitness_exercises | 0 |
| wellness_levels | 0 |
| wellness_points | 0 |
| wellness_profiles | 0 |
| wellness_streaks | 0 |
| wellness_vitals | 0 |
| wellness_user_achievements | 0 |
| labs | 12 |
| schema_layouts | 0 |
| files | 0 |
| dashboards | 282 |
| user_access_permissions_by_space | 0 |
| spaces | 2281 |
| user_access_permissions_by_user | 0 |
| user_settings | 0 |
| audit_log | 18 |
| users | 2502 |

## Post-delete totals (in-transaction)
| metric | value |
|---|---:|
| users_remaining | 99 |
| spaces_remaining | 95 |
| projects_remaining | 208 |
| tables_remaining | 1401 |
| rows_remaining | 96365 |
