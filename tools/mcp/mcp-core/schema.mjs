/**
 * Minimal JSON Schema (2020-12 subset) checker for tool inputs (SDD v2 §0.5).
 *
 * Both servers author their own schemas, so only the keywords they use are
 * implemented: type (incl. arrays of types), enum, const, properties, required,
 * additionalProperties (boolean), items, minimum, maximum, minLength, maxLength,
 * pattern, minItems, maxItems, anyOf. Unknown keywords are ignored (annotation
 * behavior), matching JSON Schema semantics.
 */

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value; // string | boolean | object | undefined
}

function typeMatches(declared, value) {
  const actual = typeOf(value);
  if (declared === 'number') return actual === 'number' || actual === 'integer';
  return declared === actual;
}

export function validateSchema(schema, value, path = '$', errors = []) {
  if (schema === true || schema == null) return errors;
  if (schema === false) {
    errors.push(`${path}: schema forbids any value`);
    return errors;
  }

  if (schema.anyOf) {
    const ok = schema.anyOf.some((sub) => validateSchema(sub, value, path, []).length === 0);
    if (!ok) errors.push(`${path}: does not match any allowed variant`);
    return errors;
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(t, value))) {
      errors.push(`${path}: expected ${types.join('|')}, got ${typeOf(value)}`);
      return errors;
    }
  }

  if (schema.enum !== undefined && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
    return errors;
  }
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
    return errors;
  }

  const kind = typeOf(value);

  if (kind === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than maxLength ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match pattern ${schema.pattern}`);
  }

  if (kind === 'number' || kind === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
  }

  if (kind === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than minItems ${schema.minItems}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than maxItems ${schema.maxItems}`);
    if (schema.items !== undefined) value.forEach((item, i) => validateSchema(schema.items, item, `${path}[${i}]`, errors));
  }

  if (kind === 'object') {
    const props = schema.properties ?? {};
    for (const req of schema.required ?? []) {
      if (value[req] === undefined) errors.push(`${path}.${req}: required`);
    }
    for (const [key, subValue] of Object.entries(value)) {
      if (props[key] !== undefined) {
        validateSchema(props[key], subValue, `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: unexpected property`);
      }
    }
  }

  return errors;
}
