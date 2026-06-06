# ADR-0009 Phase 3 execution report

- Timestamp: 2026-04-22T16:20:21.182Z
- Target: prod
- Mode: COMMIT (destructive)
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
| table_rows | 1256 |
| universal_tables | 3754 |
| projects | 5493 |
| calendar_events | 0 |
| modules | 289 |
| widget_library | 1520 |
| fitness_workouts | 10 |
| fitness_exercises | 0 |
| wellness_levels | 0 |
| wellness_points | 0 |
| wellness_profiles | 0 |
| wellness_streaks | 0 |
| wellness_vitals | 0 |
| wellness_user_achievements | 0 |
| labs | 21 |
| schema_layouts | 0 |
| files | 0 |
| dashboards | 710 |
| user_access_permissions_by_space | 0 |
| spaces | 5306 |
| user_access_permissions_by_user | 0 |
| user_settings | 0 |
| audit_log | 36 |
| users | 5842 |

## Post-delete totals (in-transaction)
| metric | value |
|---|---:|
| users_remaining | 92 |
| spaces_remaining | 86 |
| projects_remaining | 196 |
| tables_remaining | 1376 |
| rows_remaining | 92257 |
