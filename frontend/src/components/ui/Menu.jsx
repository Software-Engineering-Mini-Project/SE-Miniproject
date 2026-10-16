'use client';

import { Menu as BaseMenu } from '@base-ui/react/menu';

/**
 * Dropdown menu. `trigger` is the element to render (e.g. <Button />); `triggerContent` goes inside it.
 * Items: { label, icon?, onSelect, tone?, disabled? } | { separator: true } | { group: 'Label' }.
 */
export function Menu({ trigger, triggerContent, items, align = 'end' }) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger}>{triggerContent}</BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="menu-positioner" sideOffset={6} align={align}>
          <BaseMenu.Popup className="menu-popup">
            {items.filter(Boolean).map((item, index) => {
              if (item.separator) return <BaseMenu.Separator key={`sep-${index}`} className="menu-separator" />;
              if (item.group) {
                return (
                  <div key={`group-${index}`} className="menu-group-label" aria-hidden="true">
                    {item.group}
                  </div>
                );
              }
              const Icon = item.icon;
              return (
                <BaseMenu.Item key={item.label} className="menu-item" data-tone={item.tone} disabled={item.disabled} onClick={item.onSelect}>
                  {Icon ? <Icon size={16} aria-hidden="true" /> : null}
                  {item.label}
                </BaseMenu.Item>
              );
            })}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
