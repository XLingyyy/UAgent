import { responsesError } from "./protocol.js";

export interface ResponsesSseEvent {
  event?: string;
  data: unknown;
}

/** Native SSE framing: UTF-8 byte splits, CR/LF/CRLF and multiline data fields. */
export async function* responsesSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  providerId: string,
  interrupt: Promise<never>,
  maxBytes: number,
): AsyncIterable<ResponsesSseEvent> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "",
    event: string | undefined,
    data: string[] = [],
    bytes = 0,
    count = 0;
  const dispatch = (): ResponsesSseEvent | undefined => {
    if (!data.length) {
      event = undefined;
      return;
    }
    if (++count > 20_000) throw responsesError(providerId, "Responses event count exceeded.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.join("\n"));
    } catch {
      throw responsesError(providerId, "Responses SSE contained invalid JSON.");
    }
    const result = { event, data: parsed };
    data = [];
    event = undefined;
    return result;
  };
  while (true) {
    const next = await Promise.race([reader.read(), interrupt]);
    if (next.done) {
      try {
        buffer += decoder.decode();
      } catch {
        throw responsesError(providerId, "Responses SSE contained invalid UTF-8.");
      }
    }
    bytes += next.value?.byteLength ?? 0;
    if (bytes > maxBytes)
      throw responsesError(providerId, "Responses body exceeds the configured byte limit.");
    try {
      if (!next.done) buffer += decoder.decode(next.value, { stream: true });
    } catch {
      throw responsesError(providerId, "Responses SSE contained invalid UTF-8.");
    }
    while (true) {
      const newline = buffer.search(/[\r\n]/);
      if (newline < 0 || (buffer[newline] === "\r" && newline === buffer.length - 1 && !next.done))
        break;
      const line = buffer.slice(0, newline);
      const width = buffer[newline] === "\r" && buffer[newline + 1] === "\n" ? 2 : 1;
      buffer = buffer.slice(newline + width);
      if (!line) {
        const value = dispatch();
        if (value) yield value;
        continue;
      }
      if (line[0] === ":") continue;
      const colon = line.indexOf(":"),
        field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? "" : line.slice(colon + 1);
      if (value[0] === " ") value = value.slice(1);
      if (field === "data") data.push(value);
      else if (field === "event") event = value;
    }
    if (next.done) {
      if (buffer || data.length)
        throw responsesError(providerId, "Responses SSE ended inside an event.");
      return;
    }
  }
}
