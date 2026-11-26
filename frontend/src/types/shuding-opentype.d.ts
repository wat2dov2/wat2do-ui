/**
 * The part of satori's font engine (`@shuding/opentype.js`, which ships no
 * types) that image renderers use to measure text exactly as satori does.
 */
declare module "@shuding/opentype.js" {
  export interface Font {
    getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean; letterSpacing?: number }): number;
  }
  export function parse(buffer: ArrayBufferLike, options?: { lowMemory?: boolean }): Font;
}
