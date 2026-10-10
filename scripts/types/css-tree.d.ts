declare module 'css-tree' {
  interface Location {
    start: { line: number; column: number };
    end: { line: number; column: number };
  }
  interface NodeBase {
    loc?: Location | null;
  }
  interface List<T> extends Iterable<T> {
    first: T | null;
    toArray(): T[];
  }
  export interface Declaration extends NodeBase {
    type: 'Declaration';
    property: string;
    value: Value;
  }
  interface Rule extends NodeBase {
    type: 'Rule';
    prelude: SelectorList | { type: 'Raw' };
    block: Block;
  }
  interface SelectorList extends NodeBase {
    type: 'SelectorList';
    children: List<CssNode>;
  }
  interface Block extends NodeBase {
    type: 'Block';
    children: List<CssNode>;
  }
  interface Value extends NodeBase {
    type: 'Value';
    children: List<CssNode>;
  }
  interface FunctionNode extends NodeBase {
    type: 'Function';
    name: string;
    children: List<CssNode>;
  }
  interface Identifier extends NodeBase {
    type: 'Identifier';
    name: string;
  }
  interface Dimension extends NodeBase {
    type: 'Dimension';
    value: string;
    unit: string;
  }
  interface OtherNode extends NodeBase {
    type: 'StyleSheet' | 'Selector' | 'Raw' | 'Operator' | 'Number' | 'Percentage' | 'Hash' | 'String';
  }
  export type CssNode = Declaration | Rule | SelectorList | Block | Value | FunctionNode | Identifier | Dimension | OtherNode;
  export function parse(source: string, options?: { positions?: boolean; parseCustomProperty?: boolean }): CssNode;
  export function generate(node: CssNode): string;
  export function walk<T extends CssNode['type']>(
    node: CssNode,
    options: { visit: T; enter: (node: Extract<CssNode, { type: T }>) => void },
  ): void;
}
