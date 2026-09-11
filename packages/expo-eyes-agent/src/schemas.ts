/**
 * Zod schemas for runtime validation.
 *
 * Single source of truth is types.ts. These schemas derive from the same
 * shapes and are used to:
 *   - validate tool args coming from the agent (CLI / MCP / SDK)
 *   - validate tool results coming back from the relay
 *   - generate JSON schemas for the MCP server (via zod-to-json-schema
 *     internally in @modelcontextprotocol/sdk)
 *
 * Verified against zod 4.6.1 (see docs/libraries/zod-API-summary.md).
 * Key v4 specifics:
 *   - z.enum(['a','b']) takes a string array (not a z.nativeEnum)
 *   - .optional() for optional fields
 *   - .default() short-circuits (used carefully)
 *   - safeParse returns { success, data } | { success, error }
 */

import { z } from 'zod';

// ─── Common schemas ───────────────────────────────────────────────────

export const LayoutSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const ElementStateSchema = z.object({
  disabled: z.boolean().optional(),
  pressed: z.boolean().optional(),
  checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
  selected: z.boolean().optional(),
  focused: z.boolean().optional(),
});

// TreeNode is recursive — Zod 4 supports z.lazy with registration.
// We use a forward-declared type with z.lazy to break the cycle.
export type TreeNodeRaw = {
  ref: string;
  stableId?: string;
  type: string;
  name?: string;
  text?: string;
  testID?: string;
  role?: string;
  label?: string;
  layout?: z.infer<typeof LayoutSchema>;
  state?: z.infer<typeof ElementStateSchema>;
  props?: Record<string, unknown>;
  children: TreeNodeRaw[];
  truncated?: boolean;
  virtualized?: boolean;
  itemCount?: number;
  renderedRange?: [number, number];
};

export const TreeNodeSchema: z.ZodType<TreeNodeRaw> = z.lazy(() =>
  z.object({
    ref: z.string(),
    stableId: z.string().optional(),
    type: z.string(),
    name: z.string().optional(),
    text: z.string().optional(),
    testID: z.string().optional(),
    role: z.string().optional(),
    label: z.string().optional(),
    layout: LayoutSchema.optional(),
    state: ElementStateSchema.optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(TreeNodeSchema),
    truncated: z.boolean().optional(),
    virtualized: z.boolean().optional(),
    itemCount: z.number().optional(),
    renderedRange: z.tuple([z.number(), z.number()]).optional(),
  }),
);

// ─── Tool arg schemas ─────────────────────────────────────────────────

export const InspectArgsSchema = z.object({
  since: z.literal('last').optional(),
});

export const SnapshotArgsSchema = z.object({
  ref: z.string().min(1, 'ref is required (get it from a prior inspect())'),
});

export const TapArgsSchema = z.object({
  ref: z.string().min(1, 'ref is required'),
});

export const LongPressArgsSchema = z.object({
  ref: z.string().min(1, 'ref is required'),
  durationMs: z.number().int().positive().default(500),
});

export const TypeArgsSchema = z.object({
  ref: z.string().min(1, 'ref is required'),
  text: z.string(),
  append: z.boolean().default(false),
});

export const ScrollDirectionSchema = z.enum(['up', 'down', 'left', 'right']);

export const ScrollToArgsSchema = z.object({
  ref: z.string().min(1, 'ref is required'),
  x: z.number().optional(),
  y: z.number().optional(),
  animated: z.boolean().default(true),
  direction: ScrollDirectionSchema.optional(),
  amount: z.number().optional(),
});

export const ExpandListArgsSchema = z.object({
  listRef: z.string().min(1, 'listRef is required'),
  from: z.number().int().min(0).default(0),
  to: z.number().int().min(0).optional(),
});

// ─── Tool result schemas ──────────────────────────────────────────────

const ResultExtras = z.object({
  refsStillValid: z.boolean().optional(),
  durationMs: z.number().optional(),
});

export const InspectResultSchema = z.object({
  tree: TreeNodeSchema.nullable(),
  totalNodes: z.number().int(),
  prunedNodes: z.number().int(),
  renderTimeMs: z.number(),
}).merge(ResultExtras);

export const SnapshotResultSchema = z.object({
  element: TreeNodeSchema,
  renderTimeMs: z.number(),
}).merge(ResultExtras);

export const TapResultSchema = z.object({
  ok: z.boolean(),
}).merge(ResultExtras);

export const LongPressResultSchema = z.object({
  ok: z.boolean(),
}).merge(ResultExtras);

export const TypeResultSchema = z.object({
  ok: z.boolean(),
  newValue: z.string(),
}).merge(ResultExtras);

export const ScrollToResultSchema = z.object({
  ok: z.boolean(),
  scrolledTo: z.object({ x: z.number(), y: z.number() }),
}).merge(ResultExtras);

export const ExpandListResultSchema = z.object({
  items: z.array(TreeNodeSchema),
  renderedRange: z.tuple([z.number(), z.number()]),
  itemCount: z.number().int(),
  renderTimeMs: z.number(),
}).merge(ResultExtras);

// ─── Tool registry ────────────────────────────────────────────────────

export interface ToolSpec {
  description: string;
  argsSchema: z.ZodType<any>;
  resultSchema: z.ZodType<any>;
}

export const TOOLS: Record<string, ToolSpec> = {
  inspect: {
    description: 'Return the visible React Native tree as JSON (pruned, agent-friendly). Use this first to discover refs.',
    argsSchema: InspectArgsSchema,
    resultSchema: InspectResultSchema,
  },
  snapshot: {
    description: 'Drill into one element + its actual rendered children. Deeper than inspect; use when inspect shows truncated=true.',
    argsSchema: SnapshotArgsSchema,
    resultSchema: SnapshotResultSchema,
  },
  tap: {
    description: 'Tap (press) an element. Fires onPressIn → onPressOut → onPress on the nearest pressable ancestor.',
    argsSchema: TapArgsSchema,
    resultSchema: TapResultSchema,
  },
  longPress: {
    description: 'Long-press an element. Fires onPressIn → wait → onLongPress → onPressOut.',
    argsSchema: LongPressArgsSchema,
    resultSchema: LongPressResultSchema,
  },
  type: {
    description: 'Set text in a TextInput. Replaces the value unless append=true.',
    argsSchema: TypeArgsSchema,
    resultSchema: TypeResultSchema,
  },
  scrollTo: {
    description: 'Programmatically scroll a ScrollView/FlatList. Pass the ref of a scrollable OR an element inside one.',
    argsSchema: ScrollToArgsSchema,
    resultSchema: ScrollToResultSchema,
  },
  expandList: {
    description: 'Scroll a virtualized list (FlatList/SectionList) so items [from..to] are rendered, then return them.',
    argsSchema: ExpandListArgsSchema,
    resultSchema: ExpandListResultSchema,
  },
};
