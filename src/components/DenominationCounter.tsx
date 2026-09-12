import { DENOMINATIONS, denominationTotal, type CashDenominations } from '../lib/cashDenominations';

interface Props { value: CashDenominations; onChange?: (value: CashDenominations) => void; label: string; }
export default function DenominationCounter({ value, onChange, label }: Props) {
  return <fieldset className="my-4 border border-slate-200 rounded-lg p-3">
    <legend className="font-medium px-1">{label}</legend>
    <div className="grid grid-cols-3 gap-2 text-sm mb-2 font-medium"><span>Value</span><span>Quantity</span><span className="text-right">Subtotal</span></div>
    {DENOMINATIONS.map((d) => <div key={d} className="grid grid-cols-3 gap-2 items-center mb-2 text-sm">
      <label htmlFor={`${label}-${d}`}>₹{d}</label>
      {onChange ? <input id={`${label}-${d}`} aria-label={`${label}: quantity of ₹${d}`} type="number" inputMode="numeric" min="0" max="1000000" step="1"
        className="border border-slate-300 rounded px-2 py-2 w-full" value={value[String(d)] ?? ''} placeholder="0"
        onChange={(e) => { const raw = e.target.value; if (raw === '' || (/^\d+$/.test(raw) && Number(raw) <= 1_000_000)) onChange({ ...value, [String(d)]: Number(raw || 0) }); }} />
        : <span>{value[String(d)] ?? 0}</span>}
      <span className="text-right">₹{(d * (value[String(d)] ?? 0)).toFixed(2)}</span>
    </div>)}
    <p className="border-t pt-3 flex justify-between font-semibold"><span>Total cash</span><output>₹{denominationTotal(value).toFixed(2)}</output></p>
    {onChange && <p className="text-xs text-slate-500 mt-2">Enter note and coin quantities. Blank rows count as zero.</p>}
  </fieldset>;
}
