/**
 * Base Command class.
 * Extend this to create CLI commands with Laravel-style signatures.
 */

import { ConsoleIO } from './console-io';
import { generateHelp, type ParsedSignature, parseSignature } from './signature';

export abstract class Command {
  /**
   * Command signature using Laravel-style syntax.
   * Example: "users:create {email : User email} {--a|admin : Make admin}"
   */
  static signature: string;

  /**
   * Command description shown in help.
   */
  static description: string = '';

  /**
   * Allow unknown options to be passed through without validation.
   */
  static allowUnknownOptions: boolean = false;

  /**
   * Parsed signature (cached).
   */
  private static _parsed?: ParsedSignature;

  /**
   * Get parsed signature.
   */
  static getParsed(): ParsedSignature {
    if (!Command._parsed) {
      Command._parsed = parseSignature(Command.signature);
    }
    return Command._parsed;
  }

  /**
   * Get command name from signature.
   */
  static getName(): string {
    return Command.getParsed().name;
  }

  // Instance properties
  protected io: ConsoleIO;
  private _args: Record<string, string | string[] | undefined> = {};
  private _opts: Record<string, boolean | string | string[]> = {};

  constructor() {
    this.io = new ConsoleIO();
  }

  /**
   * Initialize with parsed arguments and options.
   */
  _init(args: Record<string, string | string[] | undefined>, opts: Record<string, boolean | string | string[]>): void {
    this._args = args;
    this._opts = opts;
  }

  /**
   * Get an argument value.
   */
  protected argument(name: string): string | string[] | undefined;
  protected argument<T>(name: string, defaultValue: T): string | string[] | T;
  protected argument<T>(name: string, defaultValue?: T): string | string[] | T | undefined {
    const value = this._args[name];
    if (value === undefined) return defaultValue;
    return value;
  }

  /**
   * Get all arguments.
   */
  protected arguments(): Record<string, string | string[] | undefined> {
    return { ...this._args };
  }

  /**
   * Get an option value.
   */
  protected option(name: string): boolean | string | string[] | undefined;
  protected option<T>(name: string, defaultValue: T): boolean | string | string[] | T;
  protected option<T>(name: string, defaultValue?: T): boolean | string | string[] | T | undefined {
    const value = this._opts[name];
    if (value === undefined) return defaultValue;
    return value;
  }

  /**
   * Get all options.
   */
  protected options(): Record<string, boolean | string | string[]> {
    return { ...this._opts };
  }

  /**
   * Get all options with type coercion.
   * Converts string values to numbers/booleans where appropriate.
   */
  protected getAllOptions(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(this._opts)) {
      if (typeof value === 'string') {
        // Try to coerce string values
        if (value === 'true') {
          result[key] = true;
        } else if (value === 'false') {
          result[key] = false;
        } else if (value !== '' && !Number.isNaN(Number(value))) {
          result[key] = Number(value);
        } else if (value.startsWith('{') || value.startsWith('[')) {
          try {
            result[key] = JSON.parse(value);
          } catch {
            result[key] = value;
          }
        } else {
          result[key] = value;
        }
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  // IO convenience methods - delegate to ConsoleIO

  protected write(text: string): void {
    this.io.write(text);
  }

  protected writeln(text: string = ''): void {
    this.io.writeln(text);
  }

  protected newLine(count: number = 1): void {
    this.io.newLine(count);
  }

  protected info(text: string): void {
    this.io.info(text);
  }

  protected success(text: string): void {
    this.io.success(text);
  }

  protected warning(text: string): void {
    this.io.warning(text);
  }

  protected error(text: string): void {
    this.io.error(text);
  }

  protected comment(text: string): void {
    this.io.comment(text);
  }

  protected table(headers: string[], rows: string[][]): void {
    this.io.table(headers, rows);
  }

  protected async ask(question: string, defaultValue?: string): Promise<string> {
    return this.io.ask(question, defaultValue);
  }

  protected async secret(question: string): Promise<string> {
    return this.io.secret(question);
  }

  protected async confirm(question: string, defaultValue: boolean = false): Promise<boolean> {
    return this.io.confirm(question, defaultValue);
  }

  protected async choice<T extends string>(question: string, choices: T[], defaultIndex: number = 0): Promise<T> {
    return this.io.choice(question, choices, defaultIndex);
  }

  /**
   * Show help for this command.
   */
  showHelp(): void {
    const parsed = (this.constructor as typeof Command).getParsed();
    const description = (this.constructor as typeof Command).description;
    console.log(generateHelp(parsed, description));
  }

  /**
   * The main command logic. Return exit code (0 = success).
   */
  abstract handle(): Promise<number>;
}

export type CommandConstructor = typeof Command & { new (): Command };
