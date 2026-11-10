/**
 * Server-sent events read as they arrive: text in, whole events out. A
 * line ends at LF, CRLF or CR; a blank line ends an event; a comment
 * (`:`, voice's keep-alive) is no event. What is left of the last chunk
 * waits for the next.
 */
export type SseEvent = { event: string; data: string };

export class SseReader {
  private rest = '';
  private event = '';
  private data: string[] = [];

  /** The events `chunk` completes. */
  feed(chunk: string): SseEvent[] {
    const out: SseEvent[] = [];
    let text = this.rest + chunk;
    // a CR that ends the text may be half of a CRLF: wait for what follows
    let held = '';
    if (text.endsWith('\r')) {
      held = '\r';
      text = text.slice(0, -1);
    }
    const lines = text.split(/\r\n|\r|\n/);
    this.rest = (lines.pop() ?? '') + held;
    for (const line of lines) {
      const ev = this.line(line);
      if (ev) out.push(ev);
    }
    return out;
  }

  /** What the stream's end completes: an event the server ended without a blank line. */
  end(): SseEvent[] {
    const out: SseEvent[] = [];
    const rest = this.rest.replace(/\r$/, '');
    this.rest = '';
    if (rest) {
      const ev = this.line(rest);
      if (ev) out.push(ev);
    }
    const last = this.line('');
    if (last) out.push(last);
    return out;
  }

  private line(line: string): SseEvent | null {
    if (line === '') {
      if (!this.data.length) {
        this.event = '';
        return null;
      }
      const ev = { event: this.event, data: this.data.join('\n') };
      this.event = '';
      this.data = [];
      return ev;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    return null;
  }
}
