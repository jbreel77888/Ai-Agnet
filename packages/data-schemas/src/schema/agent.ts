import { Schema } from 'mongoose';
import type { IAgent } from '~/types';

const agentSchema: Schema<IAgent> = new Schema<IAgent>(
  {
    id: {
      type: String,
      required: true,
    },
    name: {
      type: String,
    },
    description: {
      type: String,
    },
    instructions: {
      type: String,
    },
    avatar: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    provider: {
      type: String,
      required: true,
    },
    model: {
      type: String,
      required: true,
    },
    model_parameters: {
      type: Object,
    },
    artifacts: {
      type: String,
    },
    access_level: {
      type: Number,
    },
    recursion_limit: {
      type: Number,
    },
    tools: {
      type: [String],
      default: undefined,
    },
    skills: {
      type: [String],
      default: undefined,
    },
    skills_enabled: {
      type: Boolean,
      default: undefined,
    },
    tool_kwargs: {
      type: [{ type: Schema.Types.Mixed }],
    },
    actions: {
      type: [String],
      default: undefined,
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    authorName: {
      type: String,
      default: undefined,
    },
    hide_sequential_outputs: {
      type: Boolean,
    },
    end_after_tools: {
      type: Boolean,
    },
    /** @deprecated Use edges instead */
    agent_ids: {
      type: [String],
    },
    edges: {
      type: [{ type: Schema.Types.Mixed }],
      default: [],
    },
    conversation_starters: {
      type: [String],
      default: [],
    },
    tool_resources: {
      type: Schema.Types.Mixed,
      default: {},
    },
    versions: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    category: {
      type: String,
      trim: true,
      index: true,
      default: 'general',
    },
    support_contact: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    is_promoted: {
      type: Boolean,
      default: false,
      index: true,
    },
    /** MCP server names extracted from tools for efficient querying */
    mcpServerNames: {
      type: [String],
      default: [],
      index: true,
    },
    /** Per-tool configuration (defer_loading, allowed_callers) */
    tool_options: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    /** Subagent spawning configuration — isolated-context child agents. */
    subagents: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    /**
     * Whether this agent is the default agent for new conversations.
     * Only one agent per (tenantId, role) should have isDefault=true at a time.
     * Enforced by a partial unique index below.
     */
    isDefault: {
      type: Boolean,
      default: false,
      index: true,
    },
    /**
     * Which roles use this agent by default when starting a new conversation
     * in Agent Mode. e.g., ['USER', 'ADMIN'].
     */
    defaultForRoles: {
      type: [String],
      default: [],
      index: true,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

agentSchema.index({ id: 1, tenantId: 1 }, { unique: true });
agentSchema.index({ updatedAt: -1, _id: 1 });
agentSchema.index({ 'edges.to': 1 });

/**
 * Ensure only ONE default agent per (tenantId, role) exists.
 * Partial filter: only applies when isDefault=true.
 * Note: defaultForRoles is an array, so the unique constraint cannot be
 * on the array directly. Instead we enforce uniqueness at the application
 * layer in the /set-default endpoint by removing isDefault from other
 * agents for the same role before setting it on the new one.
 */
agentSchema.index(
  { tenantId: 1, isDefault: 1 },
  { unique: false, partialFilterExpression: { isDefault: true } },
);

export default agentSchema;
