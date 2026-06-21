/**
 * Agent type visual configuration
 *
 * Maps each agent type to:
 *  - Tailwind color classes (text + bg + border + gradient)
 *  - Lucide icon component
 *  - Display label
 *
 * Used by the chat UI to color-code agents, sessions, tool calls, and timelines.
 */
import {
  Compass, Search, Brain, Code, Play, Wrench,
  Database, RefreshCw, FileText, Sparkles,
  type LucideIcon,
} from 'lucide-react';

export type AgentTypeKey =
  | 'planner' | 'research' | 'reasoning' | 'coding' | 'execution'
  | 'tool' | 'memory' | 'reflection' | 'summarizer' | 'custom';

export interface AgentTypeStyle {
  /** Display label e.g. "Planner" */
  label: string;
  /** Lucide icon component */
  icon: LucideIcon;
  /** Tailwind text color class e.g. "text-purple-600" */
  text: string;
  /** Tailwind bg tint class e.g. "bg-purple-500" */
  bg: string;
  /** Light bg tint class for badges / chips e.g. "bg-purple-100" */
  softBg: string;
  /** Light text color for soft backgrounds e.g. "text-purple-700" */
  softText: string;
  /** Border accent class e.g. "border-purple-300" */
  border: string;
  /** Gradient stops for avatars e.g. "from-purple-500 to-fuchsia-600" */
  gradient: string;
  /** Hex color for inline styles (charts, dots) e.g. "#9333ea" */
  hex: string;
}

export const AGENT_TYPE_STYLES: Record<AgentTypeKey, AgentTypeStyle> = {
  planner: {
    label: 'Planner', icon: Compass,
    text: 'text-purple-600', bg: 'bg-purple-500',
    softBg: 'bg-purple-100', softText: 'text-purple-700', border: 'border-purple-300',
    gradient: 'from-purple-500 to-fuchsia-600', hex: '#9333ea',
  },
  research: {
    label: 'Research', icon: Search,
    text: 'text-sky-600', bg: 'bg-sky-500',
    softBg: 'bg-sky-100', softText: 'text-sky-700', border: 'border-sky-300',
    gradient: 'from-sky-500 to-blue-600', hex: '#0284c7',
  },
  reasoning: {
    label: 'Reasoning', icon: Brain,
    text: 'text-emerald-600', bg: 'bg-emerald-500',
    softBg: 'bg-emerald-100', softText: 'text-emerald-700', border: 'border-emerald-300',
    gradient: 'from-emerald-500 to-teal-600', hex: '#059669',
  },
  coding: {
    label: 'Coding', icon: Code,
    text: 'text-amber-600', bg: 'bg-amber-500',
    softBg: 'bg-amber-100', softText: 'text-amber-700', border: 'border-amber-300',
    gradient: 'from-amber-500 to-orange-600', hex: '#d97706',
  },
  execution: {
    label: 'Execution', icon: Play,
    text: 'text-rose-600', bg: 'bg-rose-500',
    softBg: 'bg-rose-100', softText: 'text-rose-700', border: 'border-rose-300',
    gradient: 'from-rose-500 to-pink-600', hex: '#e11d48',
  },
  tool: {
    label: 'Tool', icon: Wrench,
    text: 'text-cyan-600', bg: 'bg-cyan-500',
    softBg: 'bg-cyan-100', softText: 'text-cyan-700', border: 'border-cyan-300',
    gradient: 'from-cyan-500 to-teal-600', hex: '#0891b2',
  },
  memory: {
    label: 'Memory', icon: Database,
    text: 'text-indigo-600', bg: 'bg-indigo-500',
    softBg: 'bg-indigo-100', softText: 'text-indigo-700', border: 'border-indigo-300',
    gradient: 'from-indigo-500 to-violet-600', hex: '#4f46e5',
  },
  reflection: {
    label: 'Reflection', icon: RefreshCw,
    text: 'text-orange-600', bg: 'bg-orange-500',
    softBg: 'bg-orange-100', softText: 'text-orange-700', border: 'border-orange-300',
    gradient: 'from-orange-500 to-red-600', hex: '#ea580c',
  },
  summarizer: {
    label: 'Summarizer', icon: FileText,
    text: 'text-slate-600', bg: 'bg-slate-500',
    softBg: 'bg-slate-100', softText: 'text-slate-700', border: 'border-slate-300',
    gradient: 'from-slate-500 to-gray-600', hex: '#64748b',
  },
  custom: {
    label: 'Custom', icon: Sparkles,
    text: 'text-fuchsia-600', bg: 'bg-fuchsia-500',
    softBg: 'bg-fuchsia-100', softText: 'text-fuchsia-700', border: 'border-fuchsia-300',
    gradient: 'from-fuchsia-500 to-pink-600', hex: '#c026d3',
  },
};

export function getAgentTypeStyle(type?: string): AgentTypeStyle {
  if (!type) return AGENT_TYPE_STYLES.custom;
  return AGENT_TYPE_STYLES[type as AgentTypeKey] ?? AGENT_TYPE_STYLES.custom;
}
