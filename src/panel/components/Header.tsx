type Props = {
  refineEnabled: boolean;
  onToggleRefine: (enabled: boolean) => void;
  itemCount: number;
};

export function Header({ refineEnabled, onToggleRefine, itemCount }: Props) {
  return (
    <header className="ifl-header">
      <div className="ifl-header-title">
        <div className="ifl-logo" aria-hidden>⟡</div>
        <div>
          <h1>Interface Finetuning</h1>
          <p className="ifl-subtle ifl-subtle-small">
            {itemCount} refinement{itemCount === 1 ? '' : 's'} this session
          </p>
        </div>
      </div>
      <label className={`ifl-toggle ${refineEnabled ? 'is-on' : ''}`}>
        <input
          type="checkbox"
          checked={refineEnabled}
          onChange={(e) => onToggleRefine(e.currentTarget.checked)}
        />
        <span>Refine Mode</span>
      </label>
    </header>
  );
}
