import { useMemo } from 'react';
import { Star } from 'lucide-react';
import { Switch, TooltipAnchor } from '@librechat/client';
import { useWatch, useFormContext } from 'react-hook-form';
import { SystemRoles } from 'librechat-data-provider';
import type { AgentForm } from '~/common';
import { useAuthContext, useLocalize } from '~/hooks';
import { useSetDefaultAgentMutation, useUnsetDefaultAgentMutation } from '~/data-provider';

/**
 * Toggle switch that marks/unmarks an agent as the default for new conversations.
 *
 * Behavior:
 * - Only visible to ADMIN users.
 * - Only enabled when editing an EXISTING agent (agent_id is set).
 * - When toggled ON: calls POST /api/agents/:id/set-default
 * - When toggled OFF: calls POST /api/agents/:id/unset-default
 * - Shows a description explaining the impact.
 *
 * Note: this is independent from the form save flow — it calls the API directly
 * because the default flag is managed separately from the agent document fields.
 * The mutation invalidates the agents list cache so the badge updates everywhere.
 */
export default function DefaultAgentToggle() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const methods = useFormContext<AgentForm>();
  const { control } = methods;

  const agent_id = useWatch({ control, name: 'id' });
  const agent = useWatch({ control, name: 'agent' });

  const setDefaultMutation = useSetDefaultAgentMutation();
  const unsetDefaultMutation = useUnsetDefaultAgentMutation();

  // Only ADMIN can set/unset default agent
  const isAdmin = user?.role === SystemRoles.ADMIN;
  // Only show for existing agents (not during creation)
  const isExistingAgent = !!agent_id;

  const isDefault = useMemo(() => {
    return Boolean((agent as { isDefault?: boolean } | undefined)?.isDefault);
  }, [agent]);

  if (!isAdmin || !isExistingAgent) {
    return null;
  }

  const handleToggle = (checked: boolean) => {
    if (!agent_id) {
      return;
    }
    if (checked) {
      setDefaultMutation.mutate({ agent_id, roles: ['USER', 'ADMIN'] });
    } else {
      unsetDefaultMutation.mutate({ agent_id });
    }
  };

  const isPending = setDefaultMutation.isLoading || unsetDefaultMutation.isLoading;

  return (
    <div className="mb-4 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-1 items-start gap-2">
        <Star className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-text-primary">
            {localize('com_agents_set_as_default') || 'تعيين كـ Agent افتراضي'}
          </span>
          <span className="mt-0.5 text-xs text-text-secondary">
            {localize('com_agents_default_description') ||
              'سيتم استخدام هذا الـ Agent تلقائياً عند بدء أي محادثة جديدة في وضع Agent Mode'}
          </span>
        </div>
      </div>
      <TooltipAnchor
        description={
          isPending
            ? localize('com_ui_loading') || 'جاري...'
            : localize('com_agents_set_as_default') || 'تعيين كـ Agent افتراضي'
        }
      >
        <Switch
          checked={isDefault}
          onCheckedChange={handleToggle}
          disabled={isPending}
          aria-label={localize('com_agents_set_as_default') || 'تعيين كـ Agent افتراضي'}
        />
      </TooltipAnchor>
    </div>
  );
}
