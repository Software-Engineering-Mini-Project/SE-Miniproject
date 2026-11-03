'use client';

import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';

/** Centered modal for short forms and confirmations. */
export function Modal({ open, onOpenChange, title, description, children, initialFocus }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="dialog-popup" initialFocus={initialFocus}>
          <div className="dialog-header">
            <div>
              <Dialog.Title className="dialog-title">{title}</Dialog.Title>
              {description ? <Dialog.Description className="dialog-description">{description}</Dialog.Description> : null}
            </div>
            <Dialog.Close className="btn" data-variant="ghost" data-size="sm" data-icon-only aria-label="Close">
              <span className="btn-label">
                <X size={16} />
              </span>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Side sheet (bottom sheet on phones) for task details. */
export function Sheet({ open, onOpenChange, children }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="sheet-popup">{children}</Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const SheetTitle = Dialog.Title;
export const SheetClose = Dialog.Close;
