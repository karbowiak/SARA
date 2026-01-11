/**
 * CLI argument parser.
 * Parses command line arguments against a parsed signature.
 */

import type { ParsedSignature } from './signature';

export interface ParsedArgs {
  args: Record<string, string | string[] | undefined>;
  opts: Record<string, boolean | string | string[]>;
}

export interface ParseOptions {
  allowUnknownOptions?: boolean;
}

/**
 * Parse command line arguments against a signature.
 */
export function parseArgs(argv: string[], signature: ParsedSignature, options: ParseOptions = {}): ParsedArgs {
  const { allowUnknownOptions = false } = options;
  const args: Record<string, string | string[] | undefined> = {};
  const opts: Record<string, boolean | string | string[]> = {};

  // Initialize defaults
  for (const arg of signature.arguments) {
    if (arg.default !== undefined) {
      args[arg.name] = arg.default;
    } else if (arg.variadic) {
      args[arg.name] = [];
    }
  }

  for (const opt of signature.options) {
    if (opt.isArray) {
      opts[opt.name] = [];
    } else if (opt.default !== undefined) {
      opts[opt.name] = opt.default;
    } else if (!opt.requiresValue) {
      opts[opt.name] = false;
    }
  }

  // Build lookup maps
  const optionByName = new Map(signature.options.map((o) => [o.name, o]));
  const optionByShort = new Map(signature.options.filter((o) => o.short).map((o) => [o.short!, o]));

  let argIndex = 0;
  let i = 0;

  while (i < argv.length) {
    const token = argv[i]!;

    if (token === '--') {
      // Everything after -- is positional
      i++;
      while (i < argv.length) {
        assignArg(argv[i]!, argIndex, signature, args);
        argIndex++;
        i++;
      }
      break;
    }

    if (token.startsWith('--')) {
      // Long option
      const eqIndex = token.indexOf('=');
      let name: string;
      let value: string | undefined;

      if (eqIndex !== -1) {
        name = token.slice(2, eqIndex);
        value = token.slice(eqIndex + 1);
      } else {
        name = token.slice(2);
      }

      const opt = optionByName.get(name);
      if (!opt) {
        if (allowUnknownOptions) {
          // Store unknown option
          if (value !== undefined) {
            opts[name] = value;
          } else {
            // Check if next arg is a value (not starting with -)
            if (i + 1 < argv.length && !argv[i + 1]!.startsWith('-')) {
              i++;
              opts[name] = argv[i]!;
            } else {
              opts[name] = true;
            }
          }
          i++;
          continue;
        }
        throw new Error(`Unknown option: --${name}`);
      }

      if (opt.requiresValue) {
        if (value === undefined) {
          i++;
          if (i >= argv.length) {
            throw new Error(`Option --${name} requires a value`);
          }
          value = argv[i];
        }
        if (opt.isArray) {
          (opts[opt.name] as string[]).push(value!);
        } else {
          opts[opt.name] = value!;
        }
      } else {
        opts[opt.name] = true;
      }
    } else if (token.startsWith('-') && token.length > 1) {
      // Short option(s)
      const chars = token.slice(1);

      for (let j = 0; j < chars.length; j++) {
        const char = chars[j]!;
        const opt = optionByShort.get(char);

        if (!opt) {
          throw new Error(`Unknown option: -${char}`);
        }

        if (opt.requiresValue) {
          // Rest of chars or next arg is the value
          let value: string;
          if (j < chars.length - 1) {
            value = chars.slice(j + 1);
            j = chars.length; // Exit inner loop
          } else {
            i++;
            if (i >= argv.length) {
              throw new Error(`Option -${char} requires a value`);
            }
            value = argv[i]!;
          }

          if (opt.isArray) {
            (opts[opt.name] as string[]).push(value);
          } else {
            opts[opt.name] = value;
          }
        } else {
          opts[opt.name] = true;
        }
      }
    } else {
      // Positional argument
      assignArg(token, argIndex, signature, args);
      argIndex++;
    }

    i++;
  }

  // Validate required arguments
  for (const arg of signature.arguments) {
    if (arg.required && args[arg.name] === undefined) {
      throw new Error(`Missing required argument: ${arg.name}`);
    }
  }

  return { args, opts };
}

function assignArg(
  value: string,
  index: number,
  signature: ParsedSignature,
  args: Record<string, string | string[] | undefined>,
): void {
  const argDefs = signature.arguments;

  // Find the argument definition at this index
  let currentIndex = 0;
  for (const arg of argDefs) {
    if (arg.variadic) {
      // Variadic captures this and all remaining
      (args[arg.name] as string[]).push(value);
      return;
    }

    if (currentIndex === index) {
      args[arg.name] = value;
      return;
    }
    currentIndex++;
  }

  // Extra argument with no definition - might be variadic's values
  const lastArg = argDefs[argDefs.length - 1];
  if (lastArg?.variadic) {
    (args[lastArg.name] as string[]).push(value);
  }
}
