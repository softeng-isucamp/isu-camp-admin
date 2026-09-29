interface PathwayCrossingWarningProps {
  onCreateJunction: () => void;
}

/** Warns that two Pathways cross without a shared Junction, and offers to create it. */
export function PathwayCrossingWarning({ onCreateJunction: createJunctionAtCrossing }: PathwayCrossingWarningProps) {
  return (
      <div className="absolute bottom-4 left-4 z-[901] max-w-sm rounded-2xl border border-amber-300 bg-amber-50/95 px-4 py-3 text-xs text-amber-950 shadow-lg" role="alert" aria-label="Non-routable pathway crossing">
        <strong className="block">Pathways cross without a Junction</strong>
        <p className="mt-1">This visual crossing is not routable until a shared Junction Route Node is created.</p>
        <button type="button" onClick={createJunctionAtCrossing} className="mt-2 rounded-full bg-[#005931] px-3 py-2 font-bold text-white">
          Create Junction &amp; Split Pathway
        </button>
      </div>
  );
}
