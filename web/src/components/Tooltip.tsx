import type { ReactNode } from 'react';

export interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

export function Tooltip({ state }: { state: TooltipState | null }) {
  if (!state) return null;
  return (
    <div className="tooltip" style={{ left: state.x, top: state.y - 8 }} role="tooltip">
      {state.content}
    </div>
  );
}
