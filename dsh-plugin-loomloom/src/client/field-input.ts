import type { LoomField } from './api.js'

/**
 * Which control a published field is drawn with.
 *
 * The policy is driven by `presentation.widget` first because that is what the
 * author asked for, then by the value type. Across the live public market the
 * widgets in use are `input`, `text`, `textarea` and `select`, and the value types
 * are `string`, `integer`, `enum`, `asset_ref` and `text_reference`; `enum` and
 * `select` both mean a closed set, and only `asset_ref` needs bytes rather than
 * text.
 */
export type FieldControl = 'select' | 'textarea' | 'checkbox' | 'file' | 'number' | 'text'

export function fieldControl(field: LoomField): FieldControl {
  if (field.valueType === 'asset_ref') return 'file'
  if (field.enumValues !== undefined || field.valueType === 'enum' || field.widget === 'select') return 'select'
  if (field.valueType === 'boolean' || field.valueType === 'bool') return 'checkbox'
  if (field.widget === 'textarea') return 'textarea'
  if (field.valueType === 'integer' || field.valueType === 'number' || field.valueType === 'float') return 'number'
  return 'text'
}

function scalar(value: string, integer: boolean): string | number {
  if (!integer) return value
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : value
}

/** Values a form starts with, taking every published `default_value` into account. */
export function initialValues(fields: readonly LoomField[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of fields) {
    const fallback = field.defaultValue
    if (fallback === undefined || fallback === '') continue
    if (field.valueType === 'boolean' || field.valueType === 'bool') values[field.key] = fallback === 'true'
    else values[field.key] = scalar(fallback, field.valueType === 'integer')
  }
  return values
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  return false
}

/**
 * Required fields with no usable value.
 *
 * The Market rejects a run with missing required input, so the form blocks first
 * and names the offending fields instead of spending a quote on a doomed request.
 */
export function missingRequired(fields: readonly LoomField[], values: Record<string, unknown>): readonly LoomField[] {
  return fields.filter(field => field.required && isBlank(values[field.key]))
}

/**
 * The single input row to submit.
 *
 * Blank optional fields are omitted rather than sent as empty strings, and
 * integers are sent as numbers so the server does not have to interpret text. A
 * file field carries the uploaded `inputAssetId` its upload returned.
 */
export function payloadRow(
  fields: readonly LoomField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const field of fields) {
    const value = values[field.key]
    if (isBlank(value)) continue
    if (field.valueType === 'integer') {
      const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
      if (Number.isFinite(parsed)) { row[field.key] = parsed; continue }
    }
    row[field.key] = value
  }
  return row
}
