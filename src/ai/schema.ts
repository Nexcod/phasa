/**
 * The JSON-schema subset our prompts use, and a validator for it. The same schema goes to
 * OpenAI as `text.format: json_schema` (strict) and checks the answer here: strict mode worked
 * in the spike (docs/spikes.md §2), the check guards against a model or route that ignores it.
 */

export type JsonSchema =
  | { type: 'string'; enum?: readonly string[]; description?: string }
  | { type: readonly ['string', 'null']; description?: string }
  | { type: 'array'; items: JsonSchema; description?: string }
  | {
      type: 'object';
      properties: Readonly<Record<string, JsonSchema>>;
      required: readonly string[];
      additionalProperties: false;
      description?: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Problems with `value`, as JSON-pointer-ish paths; empty when it matches. */
export function validate(schema: JsonSchema, value: unknown, path = ''): string[] {
  const at = path || '/';
  if (Array.isArray(schema.type)) {
    return value === null || typeof value === 'string' ? [] : [`${at}: expected string or null`];
  }
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return [`${at}: expected string`];
      if ('enum' in schema && schema.enum && !schema.enum.includes(value)) {
        return [`${at}: not one of ${schema.enum.join(', ')}`];
      }
      return [];
    case 'array':
      if (!Array.isArray(value)) return [`${at}: expected array`];
      return value.flatMap((item, index) =>
        validate((schema as { items: JsonSchema }).items, item, `${path}/${index}`),
      );
    case 'object': {
      if (!isRecord(value)) return [`${at}: expected object`];
      const object = schema;
      const problems: string[] = [];
      for (const key of object.required) {
        if (!Object.hasOwn(value, key)) problems.push(`${path}/${key}: missing`);
      }
      for (const [key, item] of Object.entries(value)) {
        const property = object.properties[key];
        if (!property) problems.push(`${path}/${key}: unexpected`);
        else problems.push(...validate(property, item, `${path}/${key}`));
      }
      return problems;
    }
    default:
      return [`${at}: unsupported schema`];
  }
}
