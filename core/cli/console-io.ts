/**
 * Console IO helpers for beautiful CLI output.
 * Inspired by Symfony Console.
 */

export const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
} as const;

export function color(text: string, ...codes: string[]): string {
  if (!process.stdout.isTTY) return text;
  return codes.join('') + text + COLORS.reset;
}

export class ConsoleIO {
  /**
   * Write plain text to stdout.
   */
  write(text: string): void {
    process.stdout.write(text);
  }

  /**
   * Write a line to stdout.
   */
  writeln(text: string = ''): void {
    console.log(text);
  }

  /**
   * Write empty lines.
   */
  newLine(count: number = 1): void {
    for (let i = 0; i < count; i++) {
      console.log();
    }
  }

  /**
   * Info message (blue).
   */
  info(text: string): void {
    console.log(color(`ℹ ${text}`, COLORS.blue));
  }

  /**
   * Success message (green).
   */
  success(text: string): void {
    console.log(color(`✓ ${text}`, COLORS.green));
  }

  /**
   * Warning message (yellow).
   */
  warning(text: string): void {
    console.log(color(`⚠ ${text}`, COLORS.yellow));
  }

  /**
   * Error message (red).
   */
  error(text: string): void {
    console.log(color(`✗ ${text}`, COLORS.red));
  }

  /**
   * Comment/muted text (dim).
   */
  comment(text: string): void {
    console.log(color(text, COLORS.dim));
  }

  /**
   * Highlighted text block.
   */
  block(text: string, style: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    const styles = {
      info: [COLORS.bgBlue, COLORS.white],
      success: [COLORS.bgGreen, COLORS.white],
      warning: [COLORS.bgYellow, COLORS.black],
      error: [COLORS.bgRed, COLORS.white],
    };
    const padding = ' '.repeat(2);
    console.log(color(`${padding}${text}${padding}`, ...styles[style]));
  }

  /**
   * Display a table.
   */
  table(headers: string[], rows: string[][]): void {
    const allRows = [headers, ...rows];
    const colWidths = headers.map((_, i) => Math.max(...allRows.map((row) => (row[i] || '').length)));

    const divider = colWidths.map((w) => '─'.repeat(w + 2)).join('┼');

    // Header
    const headerRow = headers.map((h, i) => ` ${h.padEnd(colWidths[i]!)} `).join('│');
    console.log(color(headerRow, COLORS.bold));
    console.log(divider);

    // Rows
    for (const row of rows) {
      const rowStr = row.map((c, i) => ` ${(c || '').padEnd(colWidths[i]!)} `).join('│');
      console.log(rowStr);
    }
  }

  /**
   * Ask a question and get a string answer.
   */
  async ask(question: string, defaultValue?: string): Promise<string> {
    const prompt =
      defaultValue !== undefined
        ? color(`${question} `, COLORS.green) + color(`[${defaultValue}] `, COLORS.dim)
        : color(`${question} `, COLORS.green);

    process.stdout.write(prompt);

    const answer = await this.readLine();
    return answer || defaultValue || '';
  }

  /**
   * Ask for a secret (password) - input not displayed.
   */
  async secret(question: string): Promise<string> {
    process.stdout.write(color(`${question} `, COLORS.green));

    // Hide input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    let input = '';
    return new Promise((resolve) => {
      const onData = (data: Buffer) => {
        const char = data.toString();

        if (char === '\r' || char === '\n') {
          process.stdin.removeListener('data', onData);
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          console.log();
          resolve(input);
        } else if (char === '\u007F' || char === '\b') {
          // Backspace
          input = input.slice(0, -1);
        } else if (char === '\u0003') {
          // Ctrl+C
          process.exit(1);
        } else {
          input += char;
        }
      };

      process.stdin.resume();
      process.stdin.on('data', onData);
    });
  }

  /**
   * Ask a yes/no question.
   */
  async confirm(question: string, defaultValue: boolean = false): Promise<boolean> {
    const hint = defaultValue ? '[Y/n]' : '[y/N]';
    const prompt = color(`${question} `, COLORS.green) + color(`${hint} `, COLORS.dim);

    process.stdout.write(prompt);
    const answer = (await this.readLine()).toLowerCase().trim();

    if (!answer) return defaultValue;
    return answer === 'y' || answer === 'yes';
  }

  /**
   * Present a choice and get selection.
   */
  async choice<T extends string>(question: string, choices: T[], defaultIndex: number = 0): Promise<T> {
    console.log(color(question, COLORS.green));

    for (let i = 0; i < choices.length; i++) {
      const marker = i === defaultIndex ? color('›', COLORS.cyan) : ' ';
      console.log(`  ${marker} [${i}] ${choices[i]}`);
    }

    const prompt = color(`Enter choice `, COLORS.dim) + color(`[${defaultIndex}] `, COLORS.dim);
    process.stdout.write(prompt);

    const answer = await this.readLine();
    const index = answer ? parseInt(answer, 10) : defaultIndex;

    if (Number.isNaN(index) || index < 0 || index >= choices.length) {
      this.error(`Invalid choice: ${answer}`);
      return this.choice(question, choices, defaultIndex);
    }

    return choices[index]!;
  }

  /**
   * Create a progress bar.
   */
  progress(total: number): ProgressBar {
    return new ProgressBar(total);
  }

  /**
   * Read a line from stdin.
   */
  private readLine(): Promise<string> {
    return new Promise((resolve) => {
      let input = '';

      const onData = (data: Buffer) => {
        const str = data.toString();

        if (str.includes('\n') || str.includes('\r')) {
          process.stdin.removeListener('data', onData);
          process.stdin.pause();
          resolve(input.trim());
        } else {
          input += str;
        }
      };

      process.stdin.resume();
      process.stdin.on('data', onData);
    });
  }
}

class ProgressBar {
  private current = 0;
  private width = 40;

  constructor(private total: number) {
    this.render();
  }

  advance(step: number = 1): void {
    this.current = Math.min(this.current + step, this.total);
    this.render();
  }

  set(value: number): void {
    this.current = Math.min(value, this.total);
    this.render();
  }

  finish(): void {
    this.current = this.total;
    this.render();
    console.log();
  }

  private render(): void {
    const percent = this.total > 0 ? this.current / this.total : 0;
    const filled = Math.round(this.width * percent);
    const empty = this.width - filled;

    const bar = color('█'.repeat(filled), COLORS.green) + color('░'.repeat(empty), COLORS.dim);
    const percentStr = `${Math.round(percent * 100)}%`.padStart(4);

    process.stdout.write(`\r  ${bar} ${percentStr} (${this.current}/${this.total})`);
  }
}
