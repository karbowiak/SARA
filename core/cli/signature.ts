/**
 * Laravel-style signature parser.
 * Parses signatures like:
 *   "users:create {email : Email address} {name? : Optional name} {--a|admin : Admin flag}"
 */

import { COLORS, color } from './console-io';

export interface ParsedArgument {
  name: string;
  description: string;
  required: boolean;
  variadic: boolean;
  default?: string;
}

export interface ParsedOption {
  name: string;
  short?: string;
  description: string;
  requiresValue: boolean;
  isArray: boolean;
  default?: string;
}

export interface ParsedSignature {
  name: string;
  arguments: ParsedArgument[];
  options: ParsedOption[];
}

/**
 * Parse a command signature string into structured data.
 */
export function parseSignature(signature: string): ParsedSignature {
  const normalized = signature.replace(/\s+/g, ' ').trim();
  const tokens = tokenize(normalized);

  if (tokens.length === 0) {
    throw new Error('Signature must include a command name');
  }

  const name = tokens[0]!;
  if (name.startsWith('{')) {
    throw new Error('Signature must start with command name, not an argument');
  }

  const args: ParsedArgument[] = [];
  const opts: ParsedOption[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!token.startsWith('{') || !token.endsWith('}')) {
      throw new Error(`Invalid token in signature: ${token}`);
    }

    const inner = token.slice(1, -1).trim();

    if (inner.startsWith('--')) {
      opts.push(parseOption(inner));
    } else {
      args.push(parseArgument(inner));
    }
  }

  return { name, arguments: args, options: opts };
}

/**
 * Tokenize signature, respecting braces.
 */
function tokenize(signature: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of signature) {
    if (char === '{') {
      if (depth === 0 && current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
      depth++;
      current += char;
    } else if (char === '}') {
      depth--;
      current += char;
      if (depth === 0) {
        tokens.push(current.trim());
        current = '';
      }
    } else if (char === ' ' && depth === 0) {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens;
}

/**
 * Parse an argument definition: "name", "name?", "name=default", "name?*"
 */
function parseArgument(inner: string): ParsedArgument {
  const [definition = '', ...descParts] = inner.split(':');
  const description = descParts.join(':').trim();
  let def = definition.trim();

  let required = true;
  let variadic = false;
  let defaultValue: string | undefined;

  // Check for variadic (must come before optional check)
  if (def.endsWith('*')) {
    variadic = true;
    def = def.slice(0, -1);
  }

  // Check for optional
  if (def.endsWith('?')) {
    required = false;
    def = def.slice(0, -1);
  }

  // Check for default value
  const eqIndex = def.indexOf('=');
  let name = def;
  if (eqIndex !== -1) {
    name = def.slice(0, eqIndex);
    defaultValue = def.slice(eqIndex + 1);
    required = false;
  }

  return { name, description, required, variadic, default: defaultValue };
}

/**
 * Parse an option definition: "--flag", "--o|option", "--option=", "--option=default", "--option=*"
 */
function parseOption(inner: string): ParsedOption {
  const [definition = '', ...descParts] = inner.split(':');
  const description = descParts.join(':').trim();
  let def = definition.trim();

  // Remove leading --
  def = def.replace(/^--/, '');

  let short: string | undefined;
  let requiresValue = false;
  let isArray = false;
  let defaultValue: string | undefined;

  // Check for short alias: "a|admin" or "admin|a"
  if (def.includes('|')) {
    const parts = def.split('|');
    if (parts[0]!.length === 1) {
      short = parts[0];
      def = parts.slice(1).join('|');
    } else if (parts[1] && parts[1].length === 1) {
      short = parts[1];
      def = parts[0]!;
    } else {
      def = parts.join('|');
    }
  }

  // Check for value requirement and default
  const eqIndex = def.indexOf('=');
  let name = def;
  if (eqIndex !== -1) {
    name = def.slice(0, eqIndex);
    const valueSpec = def.slice(eqIndex + 1);
    requiresValue = true;

    if (valueSpec === '*') {
      isArray = true;
    } else if (valueSpec) {
      defaultValue = valueSpec;
    }
  }

  return { name, short, description, requiresValue, isArray, default: defaultValue };
}

/**
 * Generate help text from a parsed signature.
 */
export function generateHelp(parsed: ParsedSignature, description: string): string {
  const lines: string[] = [];

  lines.push('');

  // Usage line
  let usage = color('  Usage: ', COLORS.yellow) + color(parsed.name, COLORS.green);
  for (const arg of parsed.arguments) {
    if (arg.required) {
      usage += arg.variadic ? color(` <${arg.name}...>`, COLORS.cyan) : color(` <${arg.name}>`, COLORS.cyan);
    } else {
      usage += arg.variadic ? color(` [${arg.name}...]`, COLORS.dim) : color(` [${arg.name}]`, COLORS.dim);
    }
  }
  if (parsed.options.length > 0) {
    usage += color(' [options]', COLORS.dim);
  }
  lines.push(usage);
  lines.push('');

  // Description
  if (description) {
    lines.push(`  ${description}`);
    lines.push('');
  }

  // Arguments
  if (parsed.arguments.length > 0) {
    lines.push(color('  Arguments:', COLORS.yellow));
    const maxLen = Math.max(...parsed.arguments.map((a) => a.name.length));
    for (const arg of parsed.arguments) {
      const padded = arg.name.padEnd(maxLen + 2);
      let desc = arg.description || '';
      if (arg.default !== undefined) {
        desc += color(` (default: "${arg.default}")`, COLORS.dim);
      }
      lines.push(`    ${color(padded, COLORS.green)}${desc}`);
    }
    lines.push('');
  }

  // Options
  if (parsed.options.length > 0) {
    lines.push(color('  Options:', COLORS.yellow));
    const optStrings = parsed.options.map((o) => {
      let str = '';
      if (o.short) {
        str += `-${o.short}, `;
      } else {
        str += '    ';
      }
      str += `--${o.name}`;
      if (o.requiresValue) {
        str += o.isArray ? '=<value>...' : '=<value>';
      }
      return str;
    });
    const maxLen = Math.max(...optStrings.map((s) => s.length));

    for (let i = 0; i < parsed.options.length; i++) {
      const opt = parsed.options[i]!;
      const padded = optStrings[i]!.padEnd(maxLen + 2);
      let desc = opt.description || '';
      if (opt.default !== undefined) {
        desc += color(` (default: "${opt.default}")`, COLORS.dim);
      }
      lines.push(`    ${color(padded, COLORS.green)}${desc}`);
    }
    lines.push('');
  }

  // Always add help option
  lines.push(`    ${color('-h, --help'.padEnd(20), COLORS.green)}Show this help message`);
  lines.push('');

  return lines.join('\n');
}
