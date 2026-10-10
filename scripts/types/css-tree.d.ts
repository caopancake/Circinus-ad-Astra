declare module 'css-tree' {
  export type CssNode = Record<string, unknown>;
  export function parse(source: string, options?: { positions?: boolean }): CssNode;
  export function generate(node: CssNode): string;
  export function walk(node: CssNode, options: { visit: string; enter: (node: CssNode) => void }): void;
}
