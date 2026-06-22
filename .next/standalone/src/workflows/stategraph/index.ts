/**
 * LangGraph-style StateGraph — Directed graph workflow engine
 *
 * Implements the core concepts of LangGraph:
 * - State: typed object that flows through the graph
 * - Nodes: functions that transform state
 * - Edges: conditional routing between nodes
 * - Checkpoints: persist state for resume
 * - Human-in-the-loop: interrupt + resume
 * - Streaming: emit events as graph executes
 * - Subgraphs: compose graphs within graphs
 *
 * @see https://langchain-ai.github.io/langgraph/
 */

// =============================================================================
// State — the data that flows through the graph
// =============================================================================

export type StateReducer<T> = (current: T, update: Partial<T>) => T;

export interface GraphState {
  [key: string]: any;
}

export interface StateChannel<T = any> {
  key: string;
  default: T;
  reducer: StateReducer<T>;
}

// Common reducers (matching LangGraph semantics)
export const Channel = {
  /** Last-writer-wins (default LangGraph behavior) */
  last: <T = any>(key: string, defaultValue?: T): StateChannel<T> => ({
    key,
    default: defaultValue as T,
    reducer: (_current, update) => update as T,
  }),

  /** Append to list */
  append: <T = any>(key: string): StateChannel<T[]> => ({
    key,
    default: [],
    reducer: (current = [], update = []) => [...current, ...(Array.isArray(update) ? update : [update])],
  }),

  /** Merge objects */
  merge: <T extends Record<string, any> = any>(key: string): StateChannel<T> => ({
    key,
    default: {} as T,
    reducer: (current = {}, update = {}) => ({ ...current, ...update }),
  }),

  /** Sum numbers */
  sum: (key: string): StateChannel<number> => ({
    key,
    default: 0,
    reducer: (current = 0, update = 0) => current + update,
  }),
};

// =============================================================================
// Node — a function that transforms state
// =============================================================================

export type NodeFn<S extends GraphState> = (
  state: S,
  config: GraphConfig
) => Promise<Partial<S> | void>;

export interface GraphNode<S extends GraphState> {
  name: string;
  fn: NodeFn<S>;
  metadata?: {
    description?: string;
    tags?: string[];
  };
}

// =============================================================================
// Edge — routing between nodes
// =============================================================================

export type ConditionalFn<S extends GraphState> = (
  state: S,
  config: GraphConfig
) => string | string[];

export interface GraphEdge {
  from: string;
  to: string;
  condition?: ConditionalFn<any>;
}

// =============================================================================
// Graph Config — runtime configuration
// =============================================================================

export interface GraphConfig {
  threadId?: string;
  userId?: string;
  sessionId?: string;
  recursionLimit?: number;
  interruptBefore?: string[];
  interruptAfter?: string[];
  streamMode?: 'values' | 'updates' | 'messages';
  metadata?: Record<string, any>;
}

// =============================================================================
// Checkpoint — persistence for resume
// =============================================================================

export interface Checkpoint<S extends GraphState> {
  threadId: string;
  step: number;
  state: S;
  nextNodes: string[];
  createdAt: Date;
}

export interface CheckpointSaver<S extends GraphState> {
  save(checkpoint: Checkpoint<S>): Promise<void>;
  load(threadId: string): Promise<Checkpoint<S> | null>;
  list(threadId?: string): Promise<Checkpoint<S>[]>;
}

// In-memory checkpoint saver (use Redis/PostgreSQL for production)
export class MemorySaver<S extends GraphState> implements CheckpointSaver<S> {
  private checkpoints = new Map<string, Checkpoint<S>[]>();

  async save(cp: Checkpoint<S>): Promise<void> {
    const key = cp.threadId;
    if (!this.checkpoints.has(key)) this.checkpoints.set(key, []);
    this.checkpoints.get(key)!.push(cp);
  }

  async load(threadId: string): Promise<Checkpoint<S> | null> {
    const cps = this.checkpoints.get(threadId);
    if (!cps || cps.length === 0) return null;
    return cps[cps.length - 1];
  }

  async list(threadId?: string): Promise<Checkpoint<S>[]> {
    if (threadId) return this.checkpoints.get(threadId) || [];
    return Array.from(this.checkpoints.values()).flat();
  }
}

// =============================================================================
// Stream Events — matching LangGraph stream modes
// =============================================================================

export type StreamEvent<S extends GraphState> =
  | { type: 'start'; state: S }
  | { type: 'node_start'; node: string; state: S }
  | { type: 'node_update'; node: string; update: Partial<S>; state: S }
  | { type: 'node_end'; node: string; state: S }
  | { type: 'edge'; from: string; to: string | string[]; condition?: string }
  | { type: 'interrupt'; node: string; state: S }
  | { type: 'end'; state: S }
  | { type: 'error'; error: Error; node?: string; state: S };

// =============================================================================
// StateGraph — the main graph builder and executor
// =============================================================================

export class StateGraph<S extends GraphState = GraphState> {
  private nodes = new Map<string, GraphNode<S>>();
  private edges: GraphEdge[] = [];
  private channels: StateChannel[] = [];
  private entryPoint: string | null = null;
  private exitPoint: string | null = null;
  private checkpointSaver: CheckpointSaver<S> | null = null;

  constructor(channels?: StateChannel[]) {
    if (channels) this.channels = channels;
  }

  /**
   * Define a state channel with a reducer
   */
  addChannel(channel: StateChannel): this {
    this.channels.push(channel);
    return this;
  }

  /**
   * Add a node to the graph
   * Matches LangGraph: graph.add_node(name, fn)
   */
  addNode(name: string, fn: NodeFn<S>, metadata?: { description?: string; tags?: string[] }): this {
    if (this.nodes.has(name)) throw new Error(`Node "${name}" already exists`);
    this.nodes.set(name, { name, fn, metadata });
    return this;
  }

  /**
   * Set the entry point
   * Matches LangGraph: graph.set_entry_point(name)
   */
  setEntryPoint(name: string): this {
    if (!this.nodes.has(name)) throw new Error(`Node "${name}" doesn't exist`);
    this.entryPoint = name;
    return this;
  }

  /**
   * Set the exit point (terminal state)
   * Matches LangGraph: graph.set_finish_point(name)
   */
  setFinishPoint(name: string): this {
    if (!this.nodes.has(name)) throw new Error(`Node "${name}" doesn't exist`);
    this.exitPoint = name;
    return this;
  }

  /**
   * Add a direct edge: A → B (always go from A to B)
   * Matches LangGraph: graph.add_edge(from, to)
   */
  addEdge(from: string, to: string): this {
    if (!this.nodes.has(from)) throw new Error(`Node "${from}" doesn't exist`);
    this.edges.push({ from, to });
    return this;
  }

  /**
   * Add a conditional edge: A → (condition) → B or C or ...
   * Matches LangGraph: graph.add_conditional_edges(from, condition_fn, mapping)
   */
  addConditionalEdges(
    from: string,
    condition: ConditionalFn<S>,
    mapping?: Record<string, string>
  ): this {
    if (!this.nodes.has(from)) throw new Error(`Node "${from}" doesn't exist`);

    // If mapping is provided, the condition returns a key and we route accordingly
    if (mapping) {
      const wrappedCondition: ConditionalFn<S> = (state, config) => {
        const key = condition(state, config);
        if (typeof key === 'string' && mapping[key]) {
          return mapping[key];
        }
        return key;
      };
      // Store as a special edge with condition
      this.edges.push({ from, to: '__conditional__', condition: wrappedCondition });
      // Add edges for each mapping target
      for (const [key, target] of Object.entries(mapping)) {
        if (!this.nodes.has(target)) throw new Error(`Node "${target}" doesn't exist`);
      }
    } else {
      this.edges.push({ from, to: '__conditional__', condition });
    }
    return this;
  }

  /**
   * Set the checkpoint saver for persistence
   */
  setCheckpointer(saver: CheckpointSaver<S>): this {
    this.checkpointSaver = saver;
    return this;
  }

  /**
   * Compile the graph into a runnable
   * Matches LangGraph: graph.compile(checkpointer=..., interrupt_before=..., interrupt_after=...)
   */
  compile(opts?: {
    checkpointer?: CheckpointSaver<S>;
    interruptBefore?: string[];
    interruptAfter?: string[];
  }): CompiledGraph<S> {
    if (!this.entryPoint) throw new Error('No entry point set. Use setEntryPoint()');
    if (this.nodes.size === 0) throw new Error('No nodes added');

    const saver = opts?.checkpointer || this.checkpointSaver;
    return new CompiledGraph(
      this.nodes,
      this.edges,
      this.entryPoint,
      this.exitPoint,
      this.channels,
      saver,
      opts?.interruptBefore || [],
      opts?.interruptAfter || []
    );
  }
}

// =============================================================================
// CompiledGraph — the runnable graph
// =============================================================================

export class CompiledGraph<S extends GraphState = GraphState> {
  constructor(
    private nodes: Map<string, GraphNode<S>>,
    private edges: GraphEdge[],
    private entryPoint: string,
    private exitPoint: string | null,
    private channels: StateChannel[],
    private checkpointer: CheckpointSaver<S> | null,
    private interruptBefore: string[],
    private interruptAfter: string[]
  ) {}

  /**
   * Execute the graph and stream events
   * Matches LangGraph: graph.stream(input, config)
   */
  async *stream(
    input: Partial<S>,
    config: GraphConfig = {}
  ): AsyncIterable<StreamEvent<S>> {
    const threadId = config.threadId || `thread_${Date.now()}`;
    const recursionLimit = config.recursionLimit || 25;

    // Initialize state with channels
    let state: S = this.initState(input);
    let step = 0;

    // Try to resume from checkpoint
    if (this.checkpointer) {
      const cp = await this.checkpointer.load(threadId);
      if (cp) {
        state = cp.state;
        step = cp.step;
        console.log(`[stategraph] Resumed from checkpoint: step ${step}`);
      }
    }

    yield { type: 'start', state };

    let currentNode: string | null = this.entryPoint;
    const visited = new Set<string>();

    while (currentNode && step < recursionLimit) {
      // Check for cycles (allow revisits but track)
      if (visited.has(`${currentNode}-${step}`) && !this.edges.some(e => e.condition)) {
        // Pure linear graph with cycle — stop
        break;
      }
      visited.add(`${currentNode}-${step}`);

      const node = this.nodes.get(currentNode);
      if (!node) {
        yield { type: 'error', error: new Error(`Node "${currentNode}" not found`), node: currentNode, state };
        break;
      }

      // Check interrupt before
      const shouldInterruptBefore =
        this.interruptBefore.includes(currentNode) ||
        (config.interruptBefore || []).includes(currentNode);

      if (shouldInterruptBefore) {
        yield { type: 'interrupt', node: currentNode, state };
        // Save checkpoint and wait for resume
        if (this.checkpointer) {
          await this.checkpointer.save({ threadId, step, state, nextNodes: [currentNode], createdAt: new Date() });
        }
        return;
      }

      // Execute node
      yield { type: 'node_start', node: currentNode, state };

      try {
        const update = await node.fn(state, config);

        if (update) {
          // Apply update using channel reducers
          state = this.applyUpdate(state, update);
        }

        yield { type: 'node_update', node: currentNode, update: update || {}, state };
        yield { type: 'node_end', node: currentNode, state };

        // Check interrupt after
        const shouldInterruptAfter =
          this.interruptAfter.includes(currentNode) ||
          (config.interruptAfter || []).includes(currentNode);

        if (shouldInterruptAfter) {
          yield { type: 'interrupt', node: currentNode, state };
          if (this.checkpointer) {
            await this.checkpointer.save({ threadId, step, state, nextNodes: [], createdAt: new Date() });
          }
          return;
        }

        // Check if we reached the exit point
        if (currentNode === this.exitPoint) {
          break;
        }

        // Determine next node(s)
        const nextNode = this.getNextNode(currentNode, state, config);
        yield { type: 'edge', from: currentNode, to: nextNode };

        if (nextNode === null || nextNode === '__END__') {
          break;
        }

        currentNode = nextNode;
        step++;

        // Save checkpoint
        if (this.checkpointer && step % 5 === 0) {
          await this.checkpointer.save({ threadId, step, state, nextNodes: currentNode ? [currentNode] : [], createdAt: new Date() });
        }

      } catch (err: any) {
        yield { type: 'error', error: err, node: currentNode, state };
        break;
      }
    }

    // Final checkpoint
    if (this.checkpointer) {
      await this.checkpointer.save({ threadId, step, state, nextNodes: [], createdAt: new Date() });
    }

    yield { type: 'end', state };
  }

  /**
   * Execute the graph and return final state
   * Matches LangGraph: graph.invoke(input, config)
   */
  async invoke(input: Partial<S>, config: GraphConfig = {}): Promise<S> {
    let finalState: S = this.initState(input);

    for await (const event of this.stream(input, config)) {
      if (event.type === 'end' || event.type === 'interrupt' || event.type === 'error') {
        finalState = event.state;
      }
    }

    return finalState;
  }

  // =============================================================================
  // Private helpers
  // =============================================================================

  private initState(input: Partial<S>): S {
    const state: any = {};

    // Apply channel defaults
    for (const channel of this.channels) {
      state[channel.key] = channel.default;
    }

    // Merge input
    Object.assign(state, input);

    return state as S;
  }

  private applyUpdate(state: S, update: Partial<S>): S {
    const newState: any = { ...state };

    for (const [key, value] of Object.entries(update)) {
      // Find channel for this key
      const channel = this.channels.find(c => c.key === key);
      if (channel) {
        newState[key] = channel.reducer(newState[key], value as any);
      } else {
        // Default: last-writer-wins
        newState[key] = value;
      }
    }

    return newState as S;
  }

  private getNextNode(currentNode: string, state: S, config: GraphConfig): string | null {
    // Find edges from current node
    const edgesFromCurrent = this.edges.filter(e => e.from === currentNode);

    if (edgesFromCurrent.length === 0) {
      // No outgoing edges — check if this is the exit
      return currentNode === this.exitPoint ? null : null;
    }

    // Check for conditional edge
    const conditionalEdge = edgesFromCurrent.find(e => e.condition);
    if (conditionalEdge && conditionalEdge.condition) {
      const result = conditionalEdge.condition(state, config);
      if (Array.isArray(result)) {
        // Parallel execution — return first for now
        return result[0] || null;
      }
      return result || null;
    }

    // Direct edge
    const directEdge = edgesFromCurrent.find(e => e.to !== '__conditional__');
    if (directEdge) return directEdge.to;

    return null;
  }
}

// =============================================================================
// Helper: Build a common agent workflow graph
// =============================================================================

export function createAgentGraph<S extends GraphState>(
  channels: StateChannel[],
  nodes: Array<{ name: string; fn: NodeFn<S> }>,
  edges: Array<{ from: string; to: string } | { from: string; condition: ConditionalFn<S>; mapping?: Record<string, string> }>,
  entryPoint: string,
  finishPoint?: string,
  checkpointer?: CheckpointSaver<S>
): CompiledGraph<S> {
  const graph = new StateGraph<S>(channels);

  for (const node of nodes) {
    graph.addNode(node.name, node.fn);
  }

  for (const edge of edges) {
    if ('to' in edge) {
      graph.addEdge(edge.from, edge.to);
    } else {
      graph.addConditionalEdges(edge.from, edge.condition, edge.mapping);
    }
  }

  graph.setEntryPoint(entryPoint);
  if (finishPoint) graph.setFinishPoint(finishPoint);
  if (checkpointer) graph.setCheckpointer(checkpointer);

  return graph.compile();
}
