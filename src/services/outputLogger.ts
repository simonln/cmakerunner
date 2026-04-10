import * as vscode from 'vscode';

export class OutputLogger {
  public constructor(private readonly channel: vscode.OutputChannel) {}

  public info(message: string): void {
    this.write('INFO', message);
  }

  public warn(message: string): void {
    this.write('WARN', message);
  }

  public error(message: string): void {
    this.write('ERROR', message);
  }

  private write(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
    const timestamp = new Date().toISOString();
    this.channel.appendLine(`[${timestamp}] [${level}] ${message}`);
  }
}
