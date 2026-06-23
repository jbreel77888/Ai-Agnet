import React, { useState, useMemo, useCallback } from 'react';
import * as Ariakit from '@ariakit/react';
import { TooltipAnchor, DropdownPopup } from '@librechat/client';
import { Server, Plus, Search, Settings2 } from 'lucide-react';
import type { MenuItemProps } from '~/common';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import { useLocalize, useHasAccess } from '~/hooks';
import MCPSubMenu from '~/components/Chat/Input/MCPSubMenu';
import { useGetStartupConfig } from '~/data-provider';
import { useBadgeRowContext } from '~/Providers';
import { cn } from '~/utils';

interface ToolsDropdownProps {
  disabled?: boolean;
}

/**
 * MCP Browser Dropdown — replaces the old tools dropdown.
 * 
 * All tools (code execution, web search, file search) are now ALWAYS enabled
 * automatically (see BadgeRowContext.tsx). This button is repurposed to:
 *   - Browse available MCP servers
 *   - Add new MCP servers
 *   - Search for MCP tools
 * 
 * Like Manus AI — the user doesn't manage tools manually. The agent
 * auto-selects which tools to use. MCP servers are the only thing
 * the user can manage.
 */
const ToolsDropdown = ({ disabled }: ToolsDropdownProps) => {
  const localize = useLocalize();
  const context = useBadgeRowContext();
  const { data: startupConfig } = useGetStartupConfig();

  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });

  const [isPopoverActive, setIsPopoverActive] = useState(false);
  const isDisabled = disabled ?? false;
  const { mcpServerManager } = context ?? {};

  const mcpPlaceholder = startupConfig?.interface?.mcpServers?.placeholder;

  const dropdownItems: MenuItemProps[] = [];

  // Show MCP servers submenu if available
  const { availableMCPServers } = mcpServerManager ?? {};
  if (canUseMcp && availableMCPServers && availableMCPServers.length > 0) {
    dropdownItems.push({
      hideOnClick: false,
      render: (props) => <MCPSubMenu {...props} placeholder={mcpPlaceholder} />,
    });
  }

  // Always show "Browse MCP Servers" option
  dropdownItems.push({
    hideOnClick: false,
    render: (props) => (
      <div {...props} className="flex items-center gap-2 cursor-pointer">
        <Server className="icon-md" />
        <span>{localize('com_ui_mcp_servers') || 'MCP Servers'}</span>
        {availableMCPServers && availableMCPServers.length > 0 && (
          <span className="ml-auto text-xs text-text-secondary">
            {availableMCPServers.length}
          </span>
        )}
      </div>
    ),
  });

  // Show "Add MCP Server" option
  dropdownItems.push({
    hideOnClick: false,
    render: (props) => (
      <div {...props} className="flex items-center gap-2 cursor-pointer">
        <Plus className="icon-md" />
        <span>{localize('com_ui_add_mcp_server') || 'Add MCP Server'}</span>
      </div>
    ),
  });

  const menuTrigger = (
    <TooltipAnchor
      render={
        <Ariakit.MenuButton
          disabled={isDisabled}
          id="tools-dropdown-button"
          aria-label="MCP Servers"
          className={cn(
            'flex size-9 items-center justify-center rounded-full p-1 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-opacity-50',
            isPopoverActive && 'bg-surface-hover',
          )}
        >
          <div className="flex w-full items-center justify-center gap-2">
            <Settings2 className="size-5" aria-hidden="true" />
          </div>
        </Ariakit.MenuButton>
      }
      id="tools-dropdown-button"
      description="MCP Servers"
      disabled={isDisabled}
    />
  );

  return (
    <DropdownPopup
      itemClassName="flex w-full cursor-pointer rounded-lg items-center justify-between hover:bg-surface-hover gap-5"
      menuId="tools-dropdown-menu"
      isOpen={isPopoverActive}
      setIsOpen={setIsPopoverActive}
      modal={true}
      unmountOnHide={true}
      trigger={menuTrigger}
      items={dropdownItems}
      iconClassName="mr-0"
    />
  );
};

export default React.memo(ToolsDropdown);
