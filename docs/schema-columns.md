## Table `data_sources`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `code` | `varchar` |  Unique |
| `name` | `varchar` |  |
| `base_url` | `text` |  |
| `description` | `text` |  Nullable |
| `is_active` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `sync_logs`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `source_id` | `int8` |  |
| `started_at` | `timestamptz` |  |
| `finished_at` | `timestamptz` |  Nullable |
| `status` | `varchar` |  |
| `records_received` | `int4` |  |
| `records_created` | `int4` |  |
| `records_updated` | `int4` |  |
| `records_skipped` | `int4` |  |
| `error_summary` | `text` |  Nullable |
| `request_url` | `text` |  Nullable |

## Table `earthquake_events`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `source_id` | `int8` |  |
| `source_event_id` | `varchar` |  Nullable |
| `last_sync_id` | `int8` |  Nullable |
| `occurred_at` | `timestamptz` |  Nullable |
| `source_reported_at` | `timestamptz` |  Nullable |
| `location_description` | `text` |  |
| `latitude` | `numeric` |  Nullable |
| `longitude` | `numeric` |  Nullable |
| `magnitude` | `numeric` |  Nullable |
| `depth_km` | `numeric` |  Nullable |
| `tsunami_potential` | `bool` |  Nullable |
| `source_url` | `text` |  Nullable |
| `source_attribution` | `varchar` |  |
| `raw_payload` | `jsonb` |  Nullable |
| `imported_at` | `timestamptz` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `regions`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `name` | `varchar` |  |
| `region_type` | `varchar` |  |
| `country_code` | `bpchar` |  |
| `created_at` | `timestamptz` |  |

## Table `event_regions`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `event_id` | `int8` | Primary |
| `region_id` | `int8` | Primary |
| `relationship` | `varchar` |  |

## Table `event_updates`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `event_id` | `int8` |  |
| `sync_log_id` | `int8` |  Nullable |
| `change_type` | `varchar` |  |
| `changed_at` | `timestamptz` |  |
| `changed_fields` | `jsonb` |  |
| `note` | `text` |  Nullable |

