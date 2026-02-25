/**
 * Buffered Output Adapter
 *
 * Wraps the OutputPort interface to buffer all output calls in memory.
 * Used during parallel package installations to prevent interleaved output.
 * After the install completes, call `flush(target)` to replay all buffered
 * output to the real output port sequentially.
 */

import type { OutputPort, UnifiedSpinner } from './output.js';

interface BufferedCall {
  method: string;
  args: any[];
}

/**
 * An OutputPort implementation that records all calls in an internal buffer.
 * No output is emitted until `flush()` is called.
 */
export class BufferedOutputAdapter implements OutputPort {
  private buffer: BufferedCall[] = [];

  info(message: string): void {
    this.buffer.push({ method: 'info', args: [message] });
  }

  step(message: string): void {
    this.buffer.push({ method: 'step', args: [message] });
  }

  connector(): void {
    this.buffer.push({ method: 'connector', args: [] });
  }

  message(message: string): void {
    this.buffer.push({ method: 'message', args: [message] });
  }

  success(message: string): void {
    this.buffer.push({ method: 'success', args: [message] });
  }

  error(message: string): void {
    this.buffer.push({ method: 'error', args: [message] });
  }

  warn(message: string): void {
    this.buffer.push({ method: 'warn', args: [message] });
  }

  note(content: string, title?: string): void {
    this.buffer.push({ method: 'note', args: [content, title] });
  }

  async confirm(message: string, options?: { initial?: boolean }): Promise<boolean> {
    // During buffered/parallel execution, prompts are not supported.
    // Return the default value (same behavior as PlainOutputAdapter in non-interactive mode).
    this.buffer.push({ method: 'info', args: [`${message} (auto: ${options?.initial ? 'Y' : 'N'})`] });
    return options?.initial ?? false;
  }

  spinner(): UnifiedSpinner {
    // Return a recording spinner that captures start/stop/message as info calls.
    // The actual spinner animation is not meaningful when output is buffered.
    const buf = this.buffer;
    let lastMessage: string | undefined;
    return {
      start(message: string) {
        lastMessage = message;
      },
      stop(finalMessage?: string) {
        // Only record the final message (the spinner's resolved state)
        if (finalMessage) {
          buf.push({ method: 'step', args: [finalMessage] });
        } else if (lastMessage) {
          buf.push({ method: 'step', args: [lastMessage] });
        }
        lastMessage = undefined;
      },
      message(text: string) {
        lastMessage = text;
      },
    };
  }

  /**
   * Replay all buffered output calls to the target OutputPort.
   * After flushing, the internal buffer is cleared.
   */
  flush(target: OutputPort): void {
    for (const entry of this.buffer) {
      const fn = (target as any)[entry.method];
      if (typeof fn === 'function') {
        fn.apply(target, entry.args);
      }
    }
    this.buffer = [];
  }

  /** Returns true if no output has been buffered */
  get isEmpty(): boolean {
    return this.buffer.length === 0;
  }
}
