export const TEMPLATE_INTEGER_FIELDS = new Set([
  'x',
  'y',
  'width',
  'height',
  'fps',
  'decimal_rounding',
  'segments',
  'scale_ticks',
])

export function isTemplateIntegerField(field) {
  return TEMPLATE_INTEGER_FIELDS.has(field)
}

export function normalizeTemplateIntegerField(field, value) {
  if (!isTemplateIntegerField(field)) return value
  if (value === undefined || value === null || value === '') return value
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : value
}

export function normalizeElementField(field, value) {
  return normalizeTemplateIntegerField(field, value)
}

export function normalizeElementUpdates(updates) {
  const normalized = { ...updates }
  for (const field of TEMPLATE_INTEGER_FIELDS) {
    if (field in normalized) {
      normalized[field] = normalizeElementField(field, normalized[field])
    }
  }
  return normalized
}
