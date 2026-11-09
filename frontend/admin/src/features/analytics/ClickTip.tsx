/** Tooltip body for clickable bars: the value line, then where a click goes. */
export function ClickTip({ title, value, action }: { title: string; value: string; action?: string }) {
  return (
    <div className="decision-tooltip">
      <strong>{title}</strong>
      <span>{value}</span>
      {action && <span className="tip-action">Click: {action}</span>}
    </div>
  );
}
