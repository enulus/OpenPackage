/**
 * Simple spinner utility for showing loading indicators in CLI
 */

export class Spinner {
  private intervalId: NodeJS.Timeout | null = null;
  private message: string;
  private frames: string[];
  private currentFrame: number = 0;
  private isRunning: boolean = false;
  private readonly isTTY: boolean;

  constructor(message: string = 'Loading...') {
    this.message = message;
    // Different spinner frames for variety
    this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.isTTY = !!process.stdout.isTTY;
  }

  private getColumns(): number {
    const columns = process.stdout.columns;
    return typeof columns === 'number' && Number.isFinite(columns) && columns > 0 ? columns : 80;
  }

  private formatLine(text: string): string {
    const columns = this.getColumns();

    // Ensure we never exceed terminal width; otherwise the terminal will wrap and "\r"
    // will no longer reliably overwrite the rendered spinner line.
    if (text.length >= columns) {
      const sliceLen = Math.max(0, columns - 1);
      return text.slice(0, sliceLen) + '…';
    }

    return text;
  }

  private render(): void {
    if (!this.isTTY || !this.isRunning) return;

    const frame = this.frames[this.currentFrame % this.frames.length];
    const line = this.formatLine(`${frame} ${this.message}`);

    // \r       : return to start of line
    // \x1b[2K  : clear entire line
    process.stdout.write(`\r\x1b[2K${line}`);
  }

  /**
   * Start the spinner animation
   */
  start(): void {
    if (!this.isTTY) {
      return;
    }

    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.currentFrame = 0;

    // Hide cursor for cleaner output
    process.stdout.write('\x1B[?25l');

    // Ensure cursor is restored if the process exits unexpectedly while spinning.
    process.once('exit', () => {
      this.stop();
    });

    // Render once immediately so short operations still show feedback.
    this.render();

    this.intervalId = setInterval(() => {
      this.currentFrame++;
      this.render();
    }, 80); // Update every 80ms for smooth animation
  }

  /**
   * Update the spinner message
   */
  update(message: string): void {
    this.message = message;
    this.render();
  }

  /**
   * Stop the spinner
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.isTTY) {
      // Clear the spinner line reliably, even after many updates.
      process.stdout.write('\r\x1b[2K\r');

      // Show cursor again
      process.stdout.write('\x1B[?25h');
    }
  }

  /**
   * Convenience method to run an async operation with a spinner
   */
  static async run<T>(
    message: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const spinner = new Spinner(message);
    spinner.start();

    try {
      const result = await operation();
      spinner.stop();
      return result;
    } catch (error) {
      spinner.stop();
      throw error;
    }
  }
}

