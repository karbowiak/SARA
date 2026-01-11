import { Command } from '@core';

export default class HelloCommand extends Command {
  static override signature = `
    hello
    {name? : Name to greet}
    {--u|uppercase : SHOUT THE GREETING}
    {--t|times=1 : Number of times to greet}
  `;

  static override description = 'Say hello to someone';

  async handle(): Promise<number> {
    const name = this.argument('name', 'World');
    const uppercase = this.option('uppercase') as boolean;
    const times = parseInt(this.option('times') as string, 10) || 1;

    let greeting = `Hello, ${name}!`;
    if (uppercase) {
      greeting = greeting.toUpperCase();
    }

    for (let i = 0; i < times; i++) {
      this.success(greeting);
    }

    return 0;
  }
}
